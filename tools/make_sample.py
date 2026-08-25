# -*- coding: utf-8 -*-
"""
Apps Script(Utilities.unzip -> Utilities.zip)의 재압축 동작을 흉내 내어
샘플 재직증명서를 만든다. 이 파일이 한컴오피스에서 정상적으로 열리면
A안(서버 없는 Apps Script)으로 진행해도 안전하다는 뜻이다.

핵심: Apps Script는 ZIP 엔트리별 압축 방식을 지정할 수 없어 mimetype까지
전부 Deflate로 압축된다. 여기서도 똑같이 전부 Deflate로 다시 묶는다.
"""
import io
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "재직증명서_양식.hwpx"
OUT = ROOT / "샘플_재직증명서_홍길동.hwpx"

SECTION = "Contents/section0.xml"
PRVTEXT = "Preview/PrvText.txt"

# 양식에 실제로 들어있는 원본 문자열 -> 치환할 값
REPLACEMENTS = {
    "김 신 우": "홍 길 동",
    "961002-1******": "900101-2******",
    "서울특별시 마포구 성미산로26길 38 삼화빌 202호": "경기도 성남시 분당구 판교역로 235, 101동 1503호",
    "경영기획실": "개발본부",
    "매니저": "책임연구원",
    "2026년 3월 16일 ~ 2026년 현재": "2024년 7월 1일 ~ 2026년 현재",
    "상기인은 2026년 3월 16일 당사에 입사하여 현재 재직중에 있음을 증명합니다.":
        "상기인은 2024년 7월 1일 당사에 입사하여 현재 재직중에 있음을 증명합니다.",
    "2026년 06월 18일": "2026년 08월 24일",
    # 비즈폼 워터마크(표 캡션, 1pt라 사실상 안 보임) 제거
    "문서서식포탈비즈폼": "",
}


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def patch_xml(xml: str) -> str:
    """<hp:t>...</hp:t> 텍스트 조각 단위로만 치환한다 (태그 손상 방지)."""
    hits = []

    def repl(m):
        body = m.group(1)
        if body in REPLACEMENTS:
            hits.append(body)
            return "<hp:t>%s</hp:t>" % esc(REPLACEMENTS[body])
        return m.group(0)

    out = re.sub(r"<hp:t>(.*?)</hp:t>", repl, xml, flags=re.S)
    missed = [k for k in REPLACEMENTS if k not in hits]
    if missed:
        print("[warn] 양식에서 못 찾은 문자열:", missed, file=sys.stderr)
    return out


def main():
    src = zipfile.ZipFile(TEMPLATE, "r")
    entries = [(i.filename, src.read(i.filename)) for i in src.infolist()]
    src.close()

    patched = []
    for name, data in entries:
        if name == SECTION:
            data = patch_xml(data.decode("utf-8")).encode("utf-8")
        elif name == PRVTEXT:
            txt = data.decode("utf-8")
            for old, new in REPLACEMENTS.items():
                txt = txt.replace(old, new)
            data = txt.encode("utf-8")
        patched.append((name, data))

    # mimetype을 맨 앞으로 (Apps Script 스크립트에서도 동일하게 정렬)
    patched.sort(key=lambda kv: 0 if kv[0] == "mimetype" else 1)

    buf = io.BytesIO()
    # Apps Script와 동일하게 '전부 Deflate'
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in patched:
            z.writestr(name, data)

    OUT.write_bytes(buf.getvalue())
    print("생성 완료:", OUT)


if __name__ == "__main__":
    main()

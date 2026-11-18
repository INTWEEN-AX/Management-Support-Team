# 인트윈 경영지원 업무 도구

구글 스프레드시트에 흩어져 있던 실적·인력 데이터를 하나의 화면에서 조회하고,
재직증명서를 자동 발급하는 사내 도구입니다.
**기존 운영 도구는 Google Apps Script 구성입니다. 새 React AX 앱은 별도 `web/`에 추가했으며 아직 배포하지 않았습니다.**

| 기능 | 형태 | 하는 일 |
|---|---|---|
| **대시보드** | 웹앱 (URL 접속) | 실적증빙리스트 검색·통계, 인력현황 조회 |
| **입찰공고 수집** | 웹앱 + 자동 트리거 | 나라장터 공고를 매일 키워드로 걸러 수집 + 신규 건 메일 알림 |
| **재직증명서 발급** | 스프레드시트 메뉴 | 행 선택 → hwpx 생성 → 드라이브 저장 + 다운로드 링크 |
| **생일 축하 메일** | 자동 트리거 | 인력 명단의 생일자에게 매일 오전 자동 발송 |

---

## 파일 구성

Apps Script 프로젝트의 파일들이 이 저장소의 `apps-script/` 와 1:1로 대응합니다.

| 파일 | 역할 |
|---|---|
| `apps-script/Menu.gs` | `onOpen` 메뉴 등록, `include()` |
| `apps-script/Certificate.gs` | 재직증명서 발급 (hwpx 텍스트 치환) |
| `apps-script/Dashboard.gs` | `doGet` 웹앱 진입점, 실적·인력 데이터 로드 |
| `apps-script/Bid.gs` | 나라장터 입찰공고 수집·저장·알림 |
| `apps-script/Code.gs` | 생일 축하 메일 발송 |
| `apps-script/Index.html` | 포털 홈 + 각 탭 화면 구조 |
| `apps-script/Stylesheet.html` | 디자인 (다크 네이비 + 골드) |
| `apps-script/JavaScript.html` | 필터·차트·목록 렌더링 |
| `apps-script/birthday_template.html` | 생일 메일 본문 템플릿 |

그 외:

| 경로 | 용도 |
|---|---|
| `재직증명서_양식.hwpx` | 원본 양식 — 드라이브에 업로드해서 사용 |
| `tools/make_sample.py` | 호환성 검증용 샘플 hwpx 생성기 (로컬 전용) |
| `apps-script/_backup/` | 교체 전 디자인 보관 + 되돌리는 법 |

> ⚠️ **`onOpen` 은 프로젝트 전체에 하나만** 있어야 합니다. `.gs` 파일이 나뉘어 있어도
> 전역 스코프는 하나라, 두 곳에 정의하면 한쪽 메뉴가 조용히 사라집니다.
> 그래서 `Menu.gs` 에 몰아두었습니다.

---

## 제안서 작성 예시

업로드 단계에서 **참여인력 예시 HWPX** 또는 **수행실적 예시 HWPX**를 선택하면 가상 데이터가 들어간 샘플을 내려받습니다. 실제 사람·회사 자료를 사용하지 않으며 시트나 Drive에 저장하지 않습니다. `.hwp` 원본은 앱에서 직접 읽지 않습니다. 한컴오피스의 **파일 → 다른 이름으로 저장 → HWPX 문서** 또는 [한컴 HWP 일괄 변환기 안내](https://www.hancom.com/support/faqCenter/faq/detail/3128)를 이용한 뒤 업로드하세요.

## 설치

### 1. Apps Script 파일 만들기

대상 스프레드시트에서 **확장 프로그램 → Apps Script** → 파일 6개를 만들고
위 표대로 내용을 붙여넣습니다. (`.gs` 는 스크립트, `.html` 은 HTML로 생성)

### 2. 권한 승인

편집기에서 **`onOpen` 을 한 번 수동 실행**합니다. 승인 창에서
**고급 → (프로젝트명)으로 이동 → 허용**. 드라이브 읽기/쓰기 권한이 필요합니다.

이후 스프레드시트를 새로고침하면 상단에 **[재직증명서]**, **[대시보드]** 메뉴가 생깁니다.

> `onOpen` 은 **스프레드시트에 종속된(container-bound) 스크립트**에서만 동작합니다.
> 드라이브에서 독립 실행형으로 만든 프로젝트면 메뉴가 나타나지 않습니다.

### 3. 데이터 소스 지정

`Dashboard.gs` 상단에서 직접 수정합니다.

```js
var SHEET_ID = '...';        // 실적 스프레드시트
var SHEET_NAME = '실적';
var HR_SHEET_ID = '...';     // 인력현황 스프레드시트
var HR_STATUS_TABS = ['재직(상근)', '재직(비상근)', '휴직'];
```

재직증명서 쪽은 코드가 아니라 **메뉴 → [재직증명서] → [설정]** 에서
양식 파일 링크와 저장 폴더 링크를 넣습니다. (스크립트 속성에 저장됨)

**데이터는 캐시되지 않습니다.** `getPerformanceData()` / `getHRData()` 는 호출될
때마다 시트를 새로 읽으므로, 시트를 고치면 **웹 페이지를 새로고침(F5)** 하는 것만으로
반영됩니다. 재배포도 필요 없습니다. 단, 프론트엔드는 페이지를 열 때 한 번만
데이터를 가져오므로 열어둔 화면이 저절로 갱신되지는 않습니다.

메뉴의 **[대시보드] → [… 파싱 점검]** 은 새로고침 기능이 아니라, 컬럼이 제대로
매칭됐는지 첫 행의 JSON을 눈으로 확인하는 진단 도구입니다.

### 4. 웹앱 배포

**배포 → 새 배포 → 유형: 웹 앱**

| 항목 | 값 |
|---|---|
| 실행 계정 | 나 |
| 액세스 권한 | 조직 내 모든 사용자 (테스트 중이면 "나만") |

> ⚠️ **코드를 고쳐도 웹앱 URL에는 자동 반영되지 않습니다.**
> **배포 → 배포 관리 → ✏️ → 버전 `새 버전` → 배포** 를 해야 합니다.
> 개발 중에는 **배포 → 배포 테스트** 의 `/dev` URL이 항상 최신이라 더 편합니다.

> ⚠️ **실행 계정을 "나"로 두면**, 접속자가 인력현황 스프레드시트 접근 권한이 없어도
> 데이터를 보게 됩니다. 상세보기에 생년월일·집주소·전화번호가 나오므로,
> 액세스 범위를 넓히기 전에 의도한 것인지 확인하세요. 특정 인원만 봐야 한다면
> 실행 계정을 **"웹 앱에 액세스하는 사용자"** 로 바꾸고 시트 공유 권한으로 통제합니다.

---

## 실행 함수 정리

편집기에서 직접 실행할 함수는 **`onOpen` 하나뿐**입니다. 나머지는 전부 자동 호출됩니다.

| 함수 | 호출 주체 |
|---|---|
| `onOpen` | 시트 열 때 자동 (최초 1회만 수동 실행) |
| `issueSelected` | 메뉴 [재직증명서] → [선택한 행 발급] |
| `showSettings` / `checkSettings` / `diagnoseColumns` | 메뉴 [재직증명서] |
| `debugPerformanceData` / `debugHRData` | 메뉴 [대시보드] — 파싱 점검용 |
| `doGet` | 웹앱 접속 시 자동 — **직접 실행하면 오류** |
| `getPerformanceData` / `getHRData` / `getBidData` | 브라우저에서 `google.script.run` |
| `collectBids` | 매일 오전 8시 트리거 — 나라장터 수집 |
| `collectBidsManual` / `showBidSettings` / `testBidApi` / `debugBidData` | 메뉴 [입찰공고] |
| `include` | `Index.html` 이 자동 호출 |
| `_` 로 끝나는 함수 | 내부 전용 |

---

## 입찰공고 자동 수집

조달청 **나라장터 입찰공고정보서비스**(공공데이터포털 `15129394`)를 매일 호출해서,
공고명이 설정된 키워드에 걸리는 것만 스프레드시트 `입찰공고` 탭에 누적합니다.

### 최초 설정

1. [공공데이터포털 활용신청](https://www.data.go.kr/data/15129394/openapi.do) → 인증키 발급
   (승인은 보통 즉시. 발급 직후에는 반영까지 최대 1시간 걸릴 수 있습니다)
2. 메뉴 **[입찰공고] → [설정 (인증키/키워드)]** 에서 인증키·키워드·알림 수신자 입력
3. 메뉴 **[입찰공고] → [API 연결 테스트]** 로 통신 확인
4. 메뉴 **[입찰공고] → [트리거 등록/재등록]** 으로 매일 자동 수집 켜기

`UrlFetchApp` 을 새로 쓰기 때문에 **첫 실행 때 권한 재승인 화면이 한 번 더 뜹니다.**

### 동작 방식

| 항목 | 값 |
|---|---|
| 조회 범위 | 최근 2일치 (트리거가 한 번 걸러도 메우도록) |
| 업무구분 | 용역 → 물품 → 공사 순으로 각각 조회 |
| 중복 제거 | `공고번호 + 차수` 기준 |
| 저장 위치 | 실적 스프레드시트의 `입찰공고` 탭 (`BID_SHEET_ID` 로 변경 가능) |
| 알림 | 신규 건이 있을 때만 메일 발송 |

키워드는 Script Properties `BID_KEYWORDS` / `BID_EXCLUDE_KEYWORDS` 에 저장되며,
설정하지 않으면 `Bid.gs` 의 기본값(행사·박람회·창업·교육 등)이 쓰입니다.

> ⚠️ **실제 투찰은 자동화하지 않습니다.** 공동인증서와 지문보안토큰이 필요하고
> 자동화 자체가 나라장터 약관 위반입니다. 이 기능은 **공고 수집·알림까지**입니다.

### 조달청 API 경로에 대해

엔드포인트가 개편 이력 때문에 두 가지로 돌아다닙니다.

```
https://apis.data.go.kr/1230000/ad/BidPublicInfoService/...
https://apis.data.go.kr/1230000/BidPublicInfoService/...
```

`Bid.gs` 는 첫 호출 때 둘 다 시도하고, 성공한 쪽을 Script Properties `G2B_BASE_OK` 에
기억해둡니다. 조달청이 경로를 또 바꾸면 이 값을 지우면 다시 탐색합니다.

---

## 재직증명서 — 시트 컬럼 매핑

| 증명서 항목 | 시트 컬럼 | 비고 |
|---|---|---|
| 성 명 | `이름` | 양식 스타일에 맞춰 `홍 길 동` 처럼 자동 자간 처리 |
| 주민등록번호 | `생년월일` + `성별` | 아래 주의사항 참고 |
| 주 소 | `집주소` | |
| 소 속 | `부서` | |
| 직 위 | `직위` | |
| 기 간 | `인트윈 입사년월일` | `2024년 7월 1일 ~ 2026년 현재` 형태로 자동 생성 |
| 본문 입사일 | `인트윈 입사년월일` | |
| 발급일자 | (자동) | 실행한 날짜 |

`만 나이`·`최종학력`·`이메일 주소`·`전화번호`·`경력 기간` 은 증명서에 쓰이지 않습니다.

머리글은 **상위 5행에서 `이름` 컬럼을 찾아** 그 행을 머리글로 잡습니다.
컬럼명 비교는 **공백·줄바꿈을 무시**하므로 `성 별`, 여러 줄 머리글도 인식합니다.
이름이 아예 다르면 `Certificate.gs` 상단 `COLUMN_ALIASES` 에 별칭을 추가하세요.

값이 안 채워지면 **[재직증명서] → [컬럼 인식 진단]** 을 실행하세요.
머리글 인식 결과, 컬럼별 매칭 여부, 선택한 행의 실제 값을 한 번에 보여줍니다.

### ⚠ 주민등록번호

양식이 `961002-1******` 형태라 **뒷자리 첫 숫자(성별 코드)** 가 필요합니다.
공식 문서이므로 임의 추정하지 않고 이 순서로 처리합니다.

1. `주민등록번호` 컬럼이 있으면 → 그 값을 자동 마스킹해서 사용 **(권장)**
2. 없으면 `생년월일` + `성별` 로 `YYMMDD-N******` 생성
   (1900년대생 1/2, 2000년대생 3/4 자동 판별 · `남`/`남자`/`M`/`1` 모두 인식)
3. 둘 다 없으면 `YYMMDD-*******` + 발급 결과 창에 경고

**`성별` 컬럼 하나만 추가하면 완전 자동화됩니다.**

---

## 디자인

`Stylesheet.html` 은 **ShelfAlign Backoffice**(`C:\dev\comp_lib\web\apps\backoffice`)의
디자인을 이식한 것입니다. shadcn/ui `new-york` 스타일 + zinc 팔레트를
Tailwind 없이 순수 CSS로 옮겼습니다.

**분야별 카테고리 색상은 색각이상 검증을 통과한 팔레트**입니다.

```
[PASS] 명도대역      6색 전부 L 0.43–0.77
[PASS] 채도 하한     전부 ≥ 0.1
[PASS] 색각이상 분리  최악 인접쌍 ΔE 9.1  (기준 ≥8)
[PASS] 일반시야 분리  최악 인접쌍 ΔE 19.6 (기준 ≥15)
```

> ⚠️ `--field-*` 의 **선언 순서가 곧 색각 안전장치**입니다. 순서를 섞으면 검증이 무효화됩니다.

> ⚠️ `JavaScript.html` 이 `resolveColor('var(--accent)')` 로 막대 차트 색을 가져다 씁니다.
> shadcn 원본에서 `--accent` 는 hover 배경(연회색)이지만 여기서는 **브랜드 강조색**으로
> 유지했습니다. hover 배경이 필요하면 `--muted` 를 쓰세요.

되돌리려면 `apps-script/_backup/2026-08-25_paper/REVERT.md` 를 보세요.

---

## 개발 워크플로

```bash
git add -A
git commit -m "메시지"
git push
```

Apps Script 편집기와 이 저장소는 **아직 수동 동기화**(복사·붙여넣기)입니다.
`clasp` 을 붙이면 자동화됩니다.

```bash
npm install -g @google/clasp
clasp login
clasp clone <스크립트 ID>
clasp push   # 로컬 → Apps Script
clasp pull   # Apps Script → 로컬
```

사전에 [script.google.com/home/usersettings](https://script.google.com/home/usersettings)
에서 **Google Apps Script API** 를 켜야 합니다.

> `clasp push` 는 Apps Script 쪽을 통째로 덮어씁니다. 편집기에서 직접 고친 내용이
> 있으면 먼저 `clasp pull` 하세요. 반대로 `clasp pull` 은 로컬을 덮어씁니다.

---

## 알려진 제약

- **PDF 변환 불가** — hwpx → PDF 는 한컴오피스 설치 환경에서만 가능합니다.
  PDF가 필요하면 한컴에서 열어 저장하거나 별도 구조로 재설계해야 합니다.
- **직인** — 양식에 `(인)` 텍스트만 있고 도장 이미지가 없습니다. 출력 후 날인 방식입니다.
- **드라이브 썸네일** — `Preview/PrvImage.png` 는 원본 양식 그대로라 목록에서
  옛 내용이 보입니다. 파일을 열면 내용은 정상입니다.
- **양식 수정 시** — `Certificate.gs` 상단 `TPL` 의 원본 문자열도 함께 고쳐야 합니다.
  치환 대상을 하나도 못 찾으면 스크립트가 오류로 알려줍니다.
- **일괄 발급 상한** — 한 번에 20명.

### hwpx 재압축 호환성 (검증 완료)

Apps Script 는 ZIP 엔트리별 압축 방식을 지정할 수 없어, 원본 양식에서 무압축(Stored)인
`mimetype` 항목까지 Deflate 로 압축됩니다. **한컴오피스에서 정상적으로 열리는 것을
확인했습니다.** 양식을 교체한 뒤 다시 확인하려면:

```bash
python tools/make_sample.py    # 샘플_재직증명서_홍길동.hwpx 생성 → 한컴에서 열어보기
```

생성된 샘플은 개인정보 취급 편의상 `.gitignore` 로 제외되어 저장소에는 없습니다.

---

## 미해결 항목

- [ ] **`최종학력` 2단 머리글** — 시트가 1행 `최종학력` / 2행 `학교·전공·학위·졸업년월`
      구조면 `getHRData()` 가 학력 값을 못 읽습니다 (상세보기에 `-` 로 표시).
      **[대시보드] → [인력현황 데이터 새로고침 확인]** 으로 `eduSchool` 이 비었는지 확인 필요.
- [ ] **`경력 기간` 우선순위** — 머리글 매칭이 공백 무시로 바뀌면서, 이제 시트에 적힌
      값이 자동 계산값(`calcCareerPeriod`)보다 우선합니다. 시트 값이 최신이 아니면
      항상 계산값을 쓰도록 바꿀지 결정 필요.
- [ ] **clasp 연동** — 현재 수동 복사·붙여넣기.
- [ ] **웹앱에서 재직증명서 발급** — 인력현황 탭에서 바로 발급 버튼을 다는 방안.
      `getHRData()` 가 이미 있어 이름으로 찾아 발급하는 함수만 추가하면 됩니다.
      활성 시트에 의존하지 않게 되는 이점도 있습니다.


## 2026-11-17 신규 AX React 앱 (`web/`)

기존 Apps Script와 `FormFill.gs`·`FormAnalyzer.gs`는 수정하지 않았습니다. 기존 도구의 표 분류·라벨/열 별칭·빈 셀 채움·초과 감지 로직을 새 JavaScript 모듈로 재사용했습니다. `web/`와 로컬 import 도구는 `.claspignore`에서 제외해 clasp 배포에 섞이지 않게 했습니다. 실제 clasp push·새 배포는 하지 않았습니다.

새 앱은 공고 선택 → HWPX 업로드/제출요건·매핑 → 승인 인력·실적 검색·선택 → 반영 미리보기 → 생성·재열기 확인·다운로드 흐름입니다. 사용법·허용 필드·DB/RLS·설치·검증·배포 전제조건은 [web/README.md](web/README.md), 단계별 상태는 [PROGRESS.md](PROGRESS.md)를 보세요.

새 앱에서 사용하는 프로젝트는 AX `oancjcvjtpbipodewjki`이며 APFS 및 기존 `intw-ax` 소스와 분리합니다. 원본 Apps Script의 생년월일·주소·주민번호·연락처·첨부파일 기능을 새 앱으로 가져오지 않았습니다. 기존 도구의 권한·공유 설정도 변경하지 않았습니다. 새 앱의 schema는 미적용 초안이며 실제 직원/실적 행은 아직 import하지 않았습니다.


## 최종 외부 상태 재확인 — 초기 SQL 재실행 금지

작업 시작의 읽기 전용 조회에서는 AX public 업무 테이블이 없었으나 최종 조회에서는 `ax_proposal_mvp` migration(version `20261117080248`)과 RLS가 켜진 `ax_*` 테이블 8개가 발견됐다. 이 작업 세션/병행 에이전트는 운영 migration·SQL 쓰기를 호출하지 않았다. 변경 주체는 확인하지 않았으며 외부 작업을 되돌리지 않는다. profiles/staff/performance/participation/bid/mapping/generation 건수는 모두 0이다. 실제 행은 조회하지 않았다.

현행 컬럼·RLS 이름은 새 앱 계약과 맞지만 함수 메타데이터상 통합 학력 `education` 매핑과 신규 생성의 활성 인력 검사 보완이 필요하다. `001_ax_schema.sql`은 빈 프로젝트용 참고본이므로 **현재 프로젝트에 다시 적용하지 않는다**. 기존 함수 정의/권한을 비공개로 보관하고 `003_existing_schema_alignment.sql`의 두 함수만 실제 정의와 비교한 뒤 승인 적용한다. 이 파일은 행·Auth bootstrap·다른 함수·기존 테이블을 삭제하거나 덮어쓰지 않는다. 실패 전에는 transaction rollback, 적용 후에는 보관한 두 함수 정의로만 되돌리며 기존 데이터/감사 이력은 보존한다.

현재 마지막 단계는 초기 SQL 일괄 실행이 아니라 기존 migration 출처/상태 확인 → 차이 SQL 검토 → 초기 승인 계정/환경변수/허용 열 import → 실제 JWT 검증이다. 운영 상태와 로컬 검증을 구분한다.

### Apps Script: local legacy HWP conversion

The Apps Script upload flow now converts ordinary HWP 5.0–5.1 to HWPX locally
(maximum 10 MiB), preserving the original without transmitting it. Protected,
distribution-only and unsupported formats fail with Hancom Save As guidance.
Generated HWPX is checked before entering the existing flow. Always compare final
layout in Hancom; conversion can lose document features. Synthetic sample buttons
remain available. See [converter review, licenses and rebuild instructions](tools/hwp-converter/THIRD_PARTY.md).

### Apps Script: guided HWP/HWPX auto-fill (first-run flow)

1. Upload the RFP/forms (**HWP or HWPX**). HWP 5.0–5.1 is converted in the browser (progress, cancel, retry; the original HWP is kept in the tab and can be downloaded untouched; it is never sent to a server). The converted HWPX is checked for structure (sections/tables) before it enters the fill flow. Layout fidelity (fonts, margins, shapes) is **not** guaranteed — compare with the original in Hancom.
2. Click people/performances to add them; the **selected items** tray shows counts, flags missing fields ("확인 필요" – never invented) and lets you remove each item.
3. **반영 미리보기** shows, per table, the header→field mapping, empty-row capacity vs. selected count, and the exact values that will be written. Mapping is automatic by header names; manual column mapping exists only in the `web/` tool.
4. **서식 자동작성** writes a **new** file (`…_작성_<time>.hwpx`). The review lists filled values with source and location (section · table · row · column), overflow, unmatched labels and policy skips (birth date is never written). Page numbers are not shown because HWPX files do not store reliable pagination.

Practice without real data: use the example templates (staff / performance / combined) or **가상 데이터로 체험** (synthetic rows only; nothing is read from or written to the sheet).

Deployment is unchanged: `clasp push` + redeploy the web app. Output HWPX is packed by an in-repo STORED ZIP writer (`zipStored_` in FormFill.gs) so `mimetype` is first and uncompressed; all entries are stored uncompressed, so files are larger. Only syntax-checked, not executed in Apps Script: open one result in Hancom after deploying. Page numbers are still not shown (HWPX has no reliable page data); only section/table/row/column.

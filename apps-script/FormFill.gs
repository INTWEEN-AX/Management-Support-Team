/**
 * FormFill.gs — 필요 서식 목록화 + hwpx 서식 자동 채우기
 *
 * 두 가지를 한다.
 *   1) 공고에 어떤 서식이 필요한지 목록으로 뽑고, 각각 우리가 만들 수 있는지 판정
 *   2) 만들 수 있는 서식(hwpx)의 표에 실적·인력·회사정보를 채워 새 파일로 생성
 *
 * ⚠ 채우기는 hwpx 에서만 된다. 구형 hwp 는 바이너리라 손댈 수 없다.
 *   PDF 는 공고문을 '읽는' 데는 쓰지만 '채우는' 대상이 아니다.
 *
 * 표를 채우는 방식은 두 가지다.
 *   라벨형  | 업체명 | ____ |        → 라벨 오른쪽/아래 빈 칸에 값
 *   반복형  | 과업명 | 발주처 | 금액 |  → 머리글 아래 빈 행들에 실적을 한 줄씩
 *          |  ____  |  ____  | ___ |
 */

// ─────────────────────────────────────────────────────────────
// 서식 분류
// ─────────────────────────────────────────────────────────────

/**
 * 서식 이름 → 무엇으로 채울 수 있는가
 *   perf     우리 실적 DB 로 생성 가능
 *   hr       인력현황 DB 로 생성 가능
 *   company  회사 기본정보로 생성 가능
 *   holding  이미 보유한 행정서류로 대체 (입찰서류 탭)
 *   writing  사람이 직접 작성해야 함
 */
var FORM_KINDS = [
  { kind: 'perf',    label: '실적',     source: '수행실적 DB',
    words: ['수행실적', '용역실적', '유사용역', '실적증명', '사업실적', '납품실적', '실적확인'] },
  { kind: 'hr',      label: '인력',     source: '인력현황 DB',
    words: ['참여인력', '투입인력', '기술인력', '인력현황', '이력서', '이력사항', '참여기술자',
            '조직도', '조직및인력', '인력구성', '인력보유', '인적사항', '발표자'] },
  { kind: 'company', label: '회사정보', source: '회사 기본정보',
    words: ['일반현황', '회사현황', '업체현황', '기업현황', '회사소개', '참가신청', '입찰참가신청',
            '접수증', '청렴계약', '서약서', '확약서', '위임장', '동의서', '보안서약'] },
  { kind: 'holding', label: '보유서류', source: '입찰서류 보관함',
    words: ['사업자등록증', '법인등기', '인감증명', '납세증명', '완납증명', '4대보험', '보험가입',
            '신용평가', '중소기업확인', '직접생산', '재무제표', '통장사본', '산업재해', '신인도'] },
  { kind: 'writing', label: '직접작성', source: '담당자 작성',
    words: ['제안서', '수행계획', '사업계획', '가격제안', '가격입찰', '산출내역', '견적',
            '과업수행계획', '하도급'] },
  { kind: 'reference', label: '읽는 문서', source: '내용 파악용',
    words: ['입찰공고문', '공고문', '제안요청서', '과업지시서', '과업내용서', '규격서',
            '안내문', '유의사항', '행동규범', '설명서', '지침'] }
];

function classifyFormName_(name) {
  var lower = String(name || '').toLowerCase().replace(/\s+/g, '');
  for (var i = 0; i < FORM_KINDS.length; i++) {
    var k = FORM_KINDS[i];
    for (var j = 0; j < k.words.length; j++) {
      if (lower.indexOf(k.words[j]) > -1) {
        return { kind: k.kind, label: k.label, source: k.source, matched: k.words[j] };
      }
    }
  }
  return { kind: 'unknown', label: '분류 안 됨', source: '확인 필요', matched: '' };
}

/** 라벨형 표인지 — 회사정보 라벨이 몇 개나 있는가 */
function countCompanyLabels_(trs) {
  var n = 0;
  trs.forEach(function (tr) {
    tr.getChildren().forEach(function (tc) {
      if (tc.getName() !== 'tc') return;
      if (COMPANY_LABEL_MAP[normLabel_(collectText_(tc))]) n++;
    });
  });
  return n;
}

// ─────────────────────────────────────────────────────────────
// 제안요청서의 '입찰 관련 서식' 목차 추출
//
// 제안요청서 뒤쪽에는 보통 이런 목차가 붙어 있다.
//   [서식 1호] 입찰참가신청서
//   [서식 8호] 유사용역 수행실적
//   [서식 7-1호] 참여인력 이력사항
// 여기서 '이 공고에 뭘 내야 하는지' 를 그대로 읽어낸다.
// ─────────────────────────────────────────────────────────────

/**
 * 기관마다 서식 목차 표기가 제각각이라 흔한 형태를 모두 받아둔다.
 *   [서식 1호] · [별지 제3호 서식] · 서식 16호. · <서식 2> · 〈서식 5호〉
 *   (서식3) · [양식 4] · 붙임 2.
 */
var FORM_INDEX_PATTERNS = [
  /\[\s*서식\s*([\d\-]+)\s*호?\s*\]\s*([^\n\r\[※<(]{2,40})/g,
  /\[\s*별지\s*제?\s*([\d\-]+)\s*호\s*서식\s*\]\s*([^\n\r\[※<(]{2,40})/g,
  /서식\s*([\d\-]+)\s*호\s*[.)]\s*([^\n\r\[※<(]{2,40})/g,
  /[<〈]\s*서식\s*([\d\-]+)\s*호?\s*[>〉]\s*([^\n\r\[※<(]{2,40})/g,
  /\(\s*서식\s*([\d\-]+)\s*호?\s*\)\s*([^\n\r\[※<(]{2,40})/g,
  /\[\s*양식\s*([\d\-]+)\s*호?\s*\]\s*([^\n\r\[※<(]{2,40})/g,
  /(?:^|\n)\s*(?:붙임|별첨)\s*([\d\-]+)\s*[.)]\s*([^\n\r\[※<(]{2,40})/g
];

/** 목차 점선·페이지번호·꼬리 기호를 떼어낸다 */
function cleanFormName_(s) {
  return String(s)
    .replace(/[·․…\-–—_]{3,}.*$/, '')
    .replace(/\s*\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,)\]]+$/, '')
    .trim();
}

/** 서식 번호로 정렬 (4호 < 4-1호 < 5호) */
function compareFormNo_(a, b) {
  var pa = String(a).split('-').map(Number);
  var pb = String(b).split('-').map(Number);
  return (pa[0] - pb[0]) || ((pa[1] || 0) - (pb[1] || 0));
}

/** 제안요청서 본문에서 [서식 N호] 목록을 뽑는다 */
function extractFormIndex_(text) {
  if (!text) return [];
  var out = [], seen = {};

  FORM_INDEX_PATTERNS.forEach(function (re) {
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      var no = String(m[1]).trim();
      var name = cleanFormName_(m[2]);
      if (name.length < 2 || name.length > 40) continue;

      var key = no + '|' + name.replace(/\s+/g, '');
      if (seen[key]) continue;
      seen[key] = true;

      var c = classifyFormName_(name);
      out.push({
        no: no,
        name: name,
        kind: c.kind,
        kindLabel: c.label,
        source: c.source,
        fillable: ['perf', 'hr', 'company'].indexOf(c.kind) > -1
      });
    }
  });

  out.sort(function (a, b) { return compareFormNo_(a.no, b.no); });
  return out;
}

// ─────────────────────────────────────────────────────────────
// 참가자격 · 실적요건 추출
//
// '유사용역 실적 최근 3년간 2건 이상' 같은 조건은 보통 입찰공고문에 있다.
// 어떤 실적을 낼지 고르기 전에 이 조건부터 봐야 하므로 따로 뽑아 보여준다.
// ─────────────────────────────────────────────────────────────

/** 자격 요건일 가능성이 높은 문장 (앞쪽일수록 중요) */
var QUALIFICATION_HINTS = [
  '유사용역', '유사실적', '동종용역', '수행실적', '납품실적', '실적이 있는',
  '참가자격', '참가 자격', '자격요건', '면허', '등록증', '제한경쟁',
  '지역제한', '소재', '중소기업', '여성기업', '장애인기업', '직접생산',
  '신용평가', '재무상태', '경영상태'
];

/** 수치 조건이 들어간 문장은 더 중요하다 */
var QUALIFICATION_NUMERIC = /(\d+)\s*(?:건|년|개월|억|천만|백만|%|퍼센트)\s*이상|이상의\s*실적/;

/**
 * 본문에서 참가자격·실적요건으로 보이는 문장을 뽑는다.
 * 반환: [{ text, numeric }]
 */
function extractQualifications_(text) {
  if (!text) return [];

  // 문장 단위로 자른다 (관공서 문서는 ○ ㅇ - 로 항목을 나누는 일이 많다)
  var chunks = String(text)
    .replace(/([.。])\s+/g, '$1\n')
    .split(/\n|[○ㅇ□▣◦·]\s|(?:^|\s)-\s/);

  var out = [], seen = {};
  chunks.forEach(function (raw) {
    var t = String(raw).replace(/\s+/g, ' ').trim();
    if (t.length < 10 || t.length > 160) return;

    var hit = QUALIFICATION_HINTS.some(function (w) { return t.indexOf(w) > -1; });
    if (!hit) return;

    // 목차 줄('참가자격 ······ 3')은 내용이 없다
    if (/[·․…]{3,}/.test(t)) return;

    var key = t.replace(/\s+/g, '');
    if (seen[key]) return;
    seen[key] = true;

    out.push({ text: t, numeric: QUALIFICATION_NUMERIC.test(t) });
  });

  // 수치 조건이 있는 문장을 위로
  out.sort(function (a, b) { return (b.numeric ? 1 : 0) - (a.numeric ? 1 : 0); });
  return out.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// 제안서 쓰기 — 화면이 쓰는 한 방 호출
// ─────────────────────────────────────────────────────────────

/**
 * 제안서 작성에 필요한 것을 한 번에 돌려준다.
 *
 *   notice   나라장터 첨부 목록 (뭐가 있는지 알려주는 용도)
 *   uploads  사람이 올린 hwpx 들
 *   rfp      그중 '입찰 관련 서식' 목차가 가장 많이 잡힌 문서 = 제안요청서
 *   forms    그 목차에서 뽑아낸 제출 서식 목록
 *   tables   업로드 문서 안에서 찾은 채울 수 있는 표
 *
 * 나라장터 첨부는 hwp 가 대부분이라 자동 변환이 안 된다.
 * 그래서 제안요청서만큼은 사람이 hwpx 로 올리는 걸 전제로 한다.
 */
function getProposalPack(bidNo, bidOrd) {
  var bid = findBidRecord_(bidNo, bidOrd);

  // 나라장터 첨부 — 수집할 때 저장해둔 목록을 그대로 쓴다. API 호출도 파일 다운로드도 없다.
  var notice = (bid.attachments || []).map(function (d) {
    return { name: d.name, ext: d.ext, url: d.url, kindLabel: classifyFormName_(d.name).label };
  });

  return JSON.parse(JSON.stringify({
    bid: bid,
    notice: notice,
    noticeFromSheet: notice.length > 0,
    company: getCompanyInfo()
  }));
}

// ─────────────────────────────────────────────────────────────
// 올린 파일을 메모리에서 처리한다 (드라이브에 저장하지 않는다)
//
// 브라우저가 파일 내용을 base64 로 보내면, 여기서 읽거나 채운 뒤
// 결과를 다시 base64 로 돌려준다. 중간 산출물이 드라이브에 쌓이지 않는다.
// ─────────────────────────────────────────────────────────────

var UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

function blobFromUpload_(item) {
  var name = String(item && item.name || '').trim();
  if (!name) throw new Error('파일 이름이 없습니다.');

  var bytes = Utilities.base64Decode(String(item.dataBase64 || ''));
  if (bytes.length > UPLOAD_MAX_BYTES) {
    throw new Error(name + ' 은(는) 너무 큽니다 (' +
      Math.round(bytes.length / 1024 / 1024) + 'MB). 10MB 이하로 줄여주세요.');
  }
  return Utilities.newBlob(bytes, 'application/octet-stream', name);
}

/**
 * 올린 문서에서 서식 목차와 참가자격을 읽는다.
 * 글자만 뽑으므로 (hwpx 는 <hp:t> 정규식, pdf 는 변환) 표는 건드리지 않는다.
 */
function readDocsFromUploads(payload) {
  var files = (payload && payload.files) || [];
  if (!files.length) throw new Error('올린 문서가 없습니다.');

  var rfp = null, forms = [], quals = [], seen = {}, read = [];

  files.forEach(function (item) {
    var name = String(item.name || '');
    try {
      var blob = blobFromUpload_(item);
      var text = /\.pdf$/i.test(name) ? pdfBlobToText_(blob) : hwpxBlobToText_(blob);
      var idx = extractFormIndex_(text);

      extractQualifications_(text).forEach(function (q) {
        var k = q.text.replace(/\s+/g, '');
        if (seen[k]) return;
        seen[k] = true;
        q.from = name;
        quals.push(q);
      });

      if (idx.length > forms.length) { rfp = name; forms = idx; }
      read.push(name + ' (서식 ' + idx.length + '건)');
    } catch (e) {
      read.push(name + ' — ' + String(e.message || e).split('\n')[0]);
      Logger.log('문서 읽기 실패: ' + name + ' — ' + e);
    }
  });

  return JSON.parse(JSON.stringify({
    rfp: rfp,
    forms: forms,
    quals: quals.sort(function (a, b) { return (b.numeric ? 1 : 0) - (a.numeric ? 1 : 0); }),
    read: read
  }));
}

/**
 * 올린 hwpx 의 표를 채워 결과를 돌려준다.
 * 드라이브에 저장하지 않고 base64 로 반환하면 브라우저가 바로 내려받는다.
 */
function fillFormFromUpload(payload) {
  var name = String(payload && payload.name || '');
  if (!/\.hwpx$/i.test(name)) {
    throw new Error('hwpx 만 채울 수 있습니다: ' + name);
  }

  var perfRows = pickPerfRows_(payload.selection && payload.selection.perfKeys);
  var hrRows = pickHrRows_(payload.selection && payload.selection.hrNames);
  var company = getCompanyInfo();

  var parts = Utilities.unzip(blobFromUpload_(payload).setContentType('application/zip'));
  var report = { company: 0, perf: 0, hr: 0, tables: 0, unfilled: [], overflow: [] };
  var out = [];

  parts.forEach(function (part) {
    if (!HWPX_SECTION_RE.test(part.getName())) { out.push(part); return; }

    var doc = XmlService.parse(part.getDataAsString('UTF-8'));
    var tbls = [];
    collectTableElements_(doc.getRootElement(), tbls);
    tbls.forEach(function (tbl) {
      report.tables++;
      fillTable_(tbl, { company: company, perf: perfRows, hr: hrRows }, report);
    });

    out.push(Utilities.newBlob(XmlService.getRawFormat().format(doc),
      'application/xml', part.getName()));
  });

  // mimetype 엔트리를 맨 앞으로 (hwpx/OPC 규약)
  out.sort(function (a, b) {
    return (a.getName() === 'mimetype' ? 0 : 1) - (b.getName() === 'mimetype' ? 0 : 1);
  });

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  var outName = name.replace(/\.hwpx$/i, '') + '_작성_' + stamp + '.hwpx';

  return JSON.parse(JSON.stringify({
    name: outName,
    dataBase64: Utilities.base64Encode(Utilities.zip(out, outName).getBytes()),
    report: report,
    missing: company._missing || [],
    dummy: company._dummy || []
  }));
}

/** XML 이스케이프 되돌리기 (정규식으로 뽑은 텍스트용) */
function unescapeXml_(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** hwpx blob → 본문 텍스트 (글자는 <hp:t> 안에만 있다) */
function hwpxBlobToText_(blob) {
  var parts = Utilities.unzip(blob.setContentType('application/zip'));
  var texts = [];
  parts.forEach(function (b) {
    if (!HWPX_SECTION_RE.test(b.getName())) return;
    var xml = b.getDataAsString('UTF-8');
    var re = /<hp:t>([\s\S]*?)<\/hp:t>/g, m;
    while ((m = re.exec(xml)) !== null) texts.push(unescapeXml_(m[1]));
  });
  return texts.join(' ');
}

/** PDF blob → 텍스트 (드라이브에 구글 문서로 잠깐 올렸다가 지운다) */
function pdfBlobToText_(blob) {
  var token = ScriptApp.getOAuthToken();
  var boundary = 'bd' + Utilities.getUuid().replace(/-/g, '');
  var metadata = {
    name: 'tmp_read_' + Utilities.getUuid(),
    mimeType: 'application/vnd.google-apps.document'
  };

  var head = Utilities.newBlob(
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n--' + boundary +
    '\r\nContent-Type: application/pdf\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();

  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=ko',
    {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: head.concat(blob.getBytes()).concat(tail),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

  if (res.getResponseCode() !== 200) {
    throw new Error('PDF 변환 실패 HTTP ' + res.getResponseCode());
  }
  var docId = JSON.parse(res.getContentText()).id;
  try {
    return DocumentApp.openById(docId).getBody().getText();
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) { /* 무시 */ }
  }
}

/** 표 요소만 모은다 (표 안으로는 들어가지 않는다) */
function collectTableElements_(element, acc) {
  var children = element.getChildren();
  for (var i = 0; i < children.length; i++) {
    if (children[i].getName() === 'tbl') { acc.push(children[i]); continue; }
    collectTableElements_(children[i], acc);
  }
}



function formReason_(kind, ext) {
  if (kind === 'reference') return '내용 파악용 문서입니다 — 채우는 서식이 아닙니다';
  if (kind === 'holding') return '이미 보유한 서류입니다 — 입찰서류 탭에서 최신본을 받으세요';
  if (kind === 'writing') return '서술형 문서라 사람이 작성해야 합니다';
  if (kind === 'unknown') return '무엇을 채워야 할 서식인지 판단하지 못했습니다';
  if (ext === 'hwpx') return '표에 자동으로 채워 넣을 수 있습니다';
  if (ext === 'hwp') return 'hwpx 로 저장해 올리면 채울 수 있습니다';
  if (ext === 'pdf') return 'PDF 는 채울 수 없습니다 — hwpx 원본이 필요합니다';
  return '실물 서식이 없습니다';
}

// ─────────────────────────────────────────────────────────────
// hwpx 채우기
// ─────────────────────────────────────────────────────────────

/** 라벨 → 회사정보 필드 (라벨형 표에서 씀) */
var COMPANY_LABEL_MAP = {
  // 기본
  '업체명': 'name', '회사명': 'name', '상호': 'name', '법인명': 'name', '기업명': 'name',
  '제안사': 'name', '상호명': 'name', '업체': 'name', '신청인': 'name',
  '대표자': 'ceo', '대표이사': 'ceo', '대표자명': 'ceo', '성명': 'ceo', '대표자성명': 'ceo',
  '사업자등록번호': 'bizNo', '사업자번호': 'bizNo', '등록번호': 'bizNo',
  '법인등록번호': 'corpNo', '법인번호': 'corpNo',
  '설립일': 'foundedDate', '설립년월일': 'foundedDate', '설립일자': 'foundedDate',
  '창립일': 'foundedDate',
  '설립연도': 'foundedYear', '설립년도': 'foundedYear',

  // 연락처
  '소재지': 'address', '주소': 'address', '사업장소재지': 'address', '본사소재지': 'address',
  '본사주소': 'address', '회사주소': 'address',
  '우편번호': 'zipCode',
  '전화번호': 'tel', '연락처': 'tel', '대표전화': 'tel', '전화': 'tel',
  '팩스': 'fax', '팩스번호': 'fax', 'fax': 'fax',
  '이메일': 'email', '전자우편': 'email', 'e-mail': 'email',
  '홈페이지': 'homepage', '웹사이트': 'homepage',

  // 사업
  '업태': 'bizType', '종목': 'bizItem', '업종': 'bizItem',
  '주요사업': 'mainBiz', '주요업무': 'mainBiz', '주력분야': 'mainBiz', '사업분야': 'mainBiz',
  '조달청등록번호': 'g2bRegNo', '나라장터등록번호': 'g2bRegNo', '입찰참가자격등록번호': 'g2bRegNo',
  '등록업종': 'g2bLicense', '면허': 'g2bLicense', '보유면허': 'g2bLicense',

  // 규모
  '기업규모': 'companyScale', '기업구분': 'companyScale',
  '자본금': 'capital',
  '매출액': 'revenue', '연매출': 'revenue', '최근년도매출액': 'revenue', '전년도매출액': 'revenue',
  '최근3년평균매출액': 'revenue3y', '3년평균매출액': 'revenue3y',
  '총자산': 'totalAsset', '자산총계': 'totalAsset',
  '결산연도': 'revenueYear',

  // 인적구성
  '상시근로자수': 'employees', '직원수': 'employees', '종업원수': 'employees',
  '상시종업원수': 'employees', '근로자수': 'employees',
  '총인원': 'employeesAll', '총인원수': 'employeesAll', '임직원수': 'employeesAll',
  '인적구성': 'employeesAll', '정규직': 'employeesFull', '상근': 'employeesFull',
  '비상근': 'employeesPart', '비정규직': 'employeesPart',

  // 신인도
  '신용등급': 'creditGrade', '신용평가등급': 'creditGrade', '기업신용등급': 'creditGrade',
  '신용평가기관': 'creditAgency', '평가기관': 'creditAgency',
  '제재여부': 'sanctionYn', '부정당업자제재여부': 'sanctionYn', '입찰참가자격제한': 'sanctionYn',
  '제재기관': 'sanctionOrg', '처분기관': 'sanctionOrg',
  '제재기간': 'sanctionPeriod', '제한기간': 'sanctionPeriod',
  '제재사유': 'sanctionReason', '처분사유': 'sanctionReason',
  '산업재해율': 'accidentRate', '재해율': 'accidentRate',
  '보유인증': 'certifications', '인증현황': 'certifications', '인증': 'certifications',
  '여성기업': 'womanBiz', '여성기업여부': 'womanBiz',
  '장애인기업': 'disabledBiz', '장애인기업여부': 'disabledBiz',
  '사회적기업': 'socialBiz', '사회적기업여부': 'socialBiz',

  // 금융
  '주거래은행': 'bank', '거래은행': 'bank', '은행': 'bank',
  '계좌번호': 'accountNo', '예금주': 'accountHolder'
};

/** 반복형 표 머리글 → 실적 필드 */
var PERF_COLUMN_MAP = {
  '연번': '_index', '번호': '_index', '순번': '_index', 'no': '_index',
  '과업명': 'taskName', '사업명': 'taskName', '용역명': 'taskName', '계약건명': 'taskName',
  '실적명': 'taskName', '사업내용': 'taskName',
  '발주처': 'org', '발주기관': 'org', '수요기관': 'org', '계약기관': 'org', '발주자': 'org',
  '계약금액': 'amount', '계약액': 'amount', '사업비': 'amount', '용역비': 'amount', '금액': 'amount',
  '계약기간': 'period', '수행기간': 'period', '용역기간': 'period', '사업기간': 'period', '이행기간': 'period',
  '계약일자': 'contractDate', '계약일': 'contractDate',
  '용역개요': 'desc', '사업개요': 'desc', '주요내용': 'desc', '과업개요': 'desc', '비고': 'desc'
};

/** 반복형 표 머리글 → 인력 필드 */
var HR_COLUMN_MAP = {
  '연번': '_index', '번호': '_index', '순번': '_index', 'no': '_index',
  '성명': 'name', '이름': 'name', '참여자명': 'name', '인력명': 'name',
  '소속': 'dept', '부서': 'dept', '소속부서': 'dept',
  '직위': 'position', '직급': 'position', '직책': 'position',
  '생년월일': 'birthDate', '생년월': 'birthDate',
  '최종학력': 'edu', '학력': 'edu', '출신학교': 'eduSchool', '학교': 'eduSchool',
  '전공': 'eduMajor', '학과': 'eduMajor',
  '학위': 'eduDegree',
  '경력': 'career', '경력기간': 'career', '총경력': 'career', '실무경력': 'career',
  '담당업무': '_role', '역할': '_role', '참여분야': '_role', '담당분야': '_role',
  '입사일': 'joinDate', '입사년월일': 'joinDate'
};

function normLabel_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s()（）:：.\-]/g, '');
}

function isEmptyCell_(s) {
  return /^[\s\-–—_.·]*$/.test(String(s == null ? '' : s));
}

/** 표 하나를 채운다 — 반복형이면 목록을, 라벨형이면 회사정보를 */
function fillTable_(tbl, data, report) {
  var trs = tbl.getChildren().filter(function (c) { return c.getName() === 'tr'; });
  if (!trs.length) return;

  var grid = trs.map(function (tr) {
    return tr.getChildren().filter(function (c) { return c.getName() === 'tc'; });
  });

  var headerTexts = grid[0].map(function (tc) { return collectText_(tc); });

  var perfCols = mapColumns_(headerTexts, PERF_COLUMN_MAP);
  var hrCols = mapColumns_(headerTexts, HR_COLUMN_MAP);

  // 머리글의 절반 이상이 매핑되면 반복형 표로 본다
  var need = Math.max(2, Math.ceil(headerTexts.filter(function (t) { return t; }).length / 2));

  if (countMapped_(perfCols) >= need && data.perf.length) {
    fillRepeatTable_(grid, perfCols, data.perf, report, 'perf');
    return;
  }
  if (countMapped_(hrCols) >= need && data.hr.length) {
    fillRepeatTable_(grid, hrCols, data.hr, report, 'hr');
    return;
  }
  fillLabelTable_(grid, data.company, report);
}

function mapColumns_(headerTexts, map) {
  var cols = {};
  headerTexts.forEach(function (t, i) {
    var f = map[normLabel_(t)];
    if (f && cols[i] === undefined) cols[i] = f;
  });
  return cols;
}

function countMapped_(cols) {
  return Object.keys(cols).filter(function (k) { return cols[k] !== '_index'; }).length;
}

/** 머리글 아래 빈 행에 목록을 한 줄씩 채운다 */
function fillRepeatTable_(grid, cols, rows, report, kind) {
  var used = 0;

  for (var r = 1; r < grid.length && used < rows.length; r++) {
    var cells = grid[r];
    // 이미 값이 들어 있는 행은 건드리지 않는다 (예시 행이거나 기입된 행)
    var empty = cells.every(function (tc) { return isEmptyCell_(collectText_(tc)); });
    if (!empty) continue;

    var item = rows[used];
    var wrote = 0;
    Object.keys(cols).forEach(function (ci) {
      var idx = Number(ci);
      if (idx >= cells.length) return;
      var field = cols[ci];
      var value = (field === '_index') ? String(used + 1) : (item[field] || '');
      if (value !== '' && setCellText_(cells[idx], String(value))) wrote++;
    });
    if (!wrote) continue;      // 한 칸도 못 썼으면 이 행은 쓴 걸로 치지 않는다
    used++;
  }

  report[kind] += used;
  if (used < rows.length) {
    report.overflow.push({
      kind: kind,
      filled: used,
      total: rows.length
    });
  }
}

/** 라벨 오른쪽(없으면 아래) 빈 칸에 회사정보를 넣는다 */
function fillLabelTable_(grid, company, report) {
  for (var r = 0; r < grid.length; r++) {
    for (var c = 0; c < grid[r].length; c++) {
      var text = collectText_(grid[r][c]);
      if (!text) continue;

      var field = COMPANY_LABEL_MAP[normLabel_(text)];
      if (!field) continue;
      var value = company[field];
      if (!value) continue;

      // 오른쪽 칸
      if (c + 1 < grid[r].length && isEmptyCell_(collectText_(grid[r][c + 1]))) {
        if (setCellText_(grid[r][c + 1], String(value))) { report.company++; continue; }
      }
      // 아래 칸 (세로형 표)
      if (r + 1 < grid.length && c < grid[r + 1].length &&
          isEmptyCell_(collectText_(grid[r + 1][c]))) {
        if (setCellText_(grid[r + 1][c], String(value))) { report.company++; continue; }
      }
      report.unfilled.push(text);
    }
  }
}

/**
 * 셀의 텍스트를 바꾼다.
 *
 * ⚠ 빈 칸에는 <hp:t> 요소가 아예 없다. 값을 넣을 자리가 없으므로
 *   run 안에 <hp:t> 를 새로 만들어 붙여야 한다.
 *   (이걸 놓쳐서 '채웠다'고 보고하고도 실제로는 빈 문서가 나왔다)
 *
 * 글꼴·정렬은 문단/글자 속성에 있으므로 텍스트만 넣으면 서식은 유지된다.
 */
function setCellText_(tc, value) {
  var ts = findDescendants_(tc, 't');
  if (ts.length) {
    ts[0].setText(value);
    for (var i = 1; i < ts.length; i++) ts[i].setText('');
    return true;
  }

  var ns = tc.getNamespace();

  // run 은 있는데 t 만 없는 경우 — 가장 흔하다
  var runs = findDescendants_(tc, 'run');
  if (runs.length) {
    runs[0].addContent(XmlService.createElement('t', ns).setText(value));
    return true;
  }

  // 문단만 있는 경우 — run 까지 만들어 준다
  var ps = findDescendants_(tc, 'p');
  if (ps.length) {
    var run = XmlService.createElement('run', ns);
    run.setAttribute('charPrIDRef', '0');
    run.addContent(XmlService.createElement('t', ns).setText(value));
    ps[0].addContent(run);
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// 선택된 항목 → 채울 값
// ─────────────────────────────────────────────────────────────

function perfKey_(r) {
  return String(r.taskName || '').replace(/\s+/g, '') + '|' + (r.year || '');
}

function pickPerfRows_(keys) {
  if (!keys || !keys.length) return [];
  var want = {};
  keys.forEach(function (k) { want[k] = true; });

  return getPerformanceData()
    .filter(function (r) { return want[perfKey_(r)]; })
    .map(function (r) {
      return {
        taskName: r.taskName || '',
        org: r.org || '',
        amount: r.amount ? Number(r.amount).toLocaleString() : (r.amountRaw || ''),
        period: r.contractPeriod || r.contractDate || '',
        contractDate: r.contractDate || '',
        desc: r.desc || ''
      };
    });
}

function pickHrRows_(names) {
  if (!names || !names.length) return [];
  var want = {};
  names.forEach(function (n) { want[n] = true; });

  return getHRData()
    .filter(function (r) { return want[r.name]; })
    .map(function (r) {
      return {
        name: r.name || '',
        dept: r.dept || '',
        position: r.position || '',
        birthDate: r.birthDate || '',
        edu: [r.eduSchool, r.eduDegree].filter(Boolean).join(' '),
        eduSchool: r.eduSchool || '',
        eduMajor: r.eduMajor || '',
        eduDegree: r.eduDegree || '',
        career: r.career || '',
        joinDate: r.joinDate || ''
      };
    });
}

/**
 * 첨부 목록을 나라장터에서 다시 받아 시트에 채워 넣는다.
 * '첨부목록' 컬럼이 생기기 전에 수집된 공고를 위한 보정용.
 */
function refreshNoticeAttachments(bidNo, bidOrd) {
  var bid = findBidRecord_(bidNo, bidOrd);
  var items = fetchBidByNo_(bid.no);
  if (!items.length) throw new Error('나라장터에서 공고를 찾지 못했습니다: ' + bid.no);

  var docs = extractSpecDocs_(items[0]);
  var sheet = getBidSheet_();
  var values = sheet.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h == null ? '' : h).replace(/\s+/g, ''); });
  var noCol = head.indexOf('공고번호');
  var attCol = head.indexOf('첨부목록');
  if (noCol === -1 || attCol === -1) throw new Error('시트 머리글을 찾지 못했습니다.');

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][noCol]).trim() !== String(bid.no).trim()) continue;
    sheet.getRange(r + 1, attCol + 1).setValue(serializeSpecDocs_(docs));
    break;
  }
  return getProposalPack(bidNo, bidOrd);
}

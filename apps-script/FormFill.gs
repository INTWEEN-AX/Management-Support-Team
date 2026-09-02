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

/**
 * 표 검사 결과를 캐시한다.
 * 압축을 풀고 XML 을 파싱하는 비용이 커서 화면을 열 때마다 하면 몇 초씩 걸린다.
 * 파일 ID + 수정시각을 키로 쓰므로, 파일이 바뀌면 자동으로 다시 검사한다.
 */
function scanHwpxTablesCached_(file) {
  var key = 'tbl_' + file.getId() + '_' + file.getLastUpdated().getTime();
  var cache = CacheService.getScriptCache();

  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* 깨졌으면 다시 검사 */ }
  }

  var found = scanHwpxTables_(file);
  try {
    cache.put(key, JSON.stringify(found), 6 * 60 * 60);   // 6시간
  } catch (e) {
    Logger.log('표 검사 캐시 저장 실패(무시): ' + e);
  }
  return found;
}

/**
 * hwpx 안의 표를 실제로 열어보고 무엇을 채울 수 있는 서식인지 판정한다.
 *
 * 파일 이름만으로는 알 수 없다. 관공서 제안요청서는 본문 뒤에 [별지 서식]이
 * 붙어 있는 경우가 많아서, 이름이 '제안요청서' 여도 안에 실적표·인력표가 들어 있다.
 * 그래서 머리글을 직접 읽어 판정한다.
 */
function scanHwpxTables_(file) {
  var found = [];
  try {
    var entries = Utilities.unzip(file.getBlob().setContentType('application/zip'));

    entries.forEach(function (b) {
      if (!HWPX_SECTION_RE.test(b.getName())) return;
      var root = XmlService.parse(b.getDataAsString('UTF-8')).getRootElement();

      findDescendants_(root, 'tbl').forEach(function (tbl) {
        var trs = tbl.getChildren().filter(function (c) { return c.getName() === 'tr'; });
        if (trs.length < 2) return;

        var headers = trs[0].getChildren()
          .filter(function (c) { return c.getName() === 'tc'; })
          .map(function (tc) { return collectText_(tc); });
        if (headers.length < 2) return;

        var perfCols = mapColumns_(headers, PERF_COLUMN_MAP);
        var hrCols = mapColumns_(headers, HR_COLUMN_MAP);
        var labeled = headers.filter(function (t) { return t; }).length;
        var need = Math.max(2, Math.ceil(labeled / 2));

        var kind = '';
        if (countMapped_(perfCols) >= need) kind = 'perf';
        else if (countMapped_(hrCols) >= need) kind = 'hr';
        else if (countCompanyLabels_(trs) >= 3) kind = 'company';
        if (!kind) return;

        // 채울 수 있는 빈 행이 몇 개인지
        var emptyRows = 0;
        for (var r = 1; r < trs.length; r++) {
          var cells = trs[r].getChildren().filter(function (c) { return c.getName() === 'tc'; });
          if (cells.length && cells.every(function (tc) { return isEmptyCell_(collectText_(tc)); })) {
            emptyRows++;
          }
        }

        found.push({
          kind: kind,
          label: kind === 'perf' ? '실적표' : (kind === 'hr' ? '인력표' : '회사정보표'),
          rows: trs.length,
          emptyRows: emptyRows,
          headers: headers.filter(Boolean).slice(0, 8)
        });
      });
    });
  } catch (e) {
    Logger.log('hwpx 표 검사 실패(무시): ' + file.getName() + ' — ' + e);
  }
  return found;
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

/** 공고문 본문에서 제출서류·붙임 목차로 보이는 줄을 뽑는다 */
function extractFormMentions_(briefText) {
  if (!briefText) return [];
  var out = [], seen = {};

  // '붙임1. 과업지시서', '[서식 3] 참여인력 명부', '○ 사업자등록증 사본' 같은 줄
  var patterns = [
    /(?:붙임|별첨|첨부)\s*\d*\s*[.)]?\s*([^\n\r]{3,50})/g,
    /\[?\s*서식\s*\d*\s*[\]．.)]?\s*([^\n\r]{3,50})/g,
    /(?:제출서류|구비서류|제출자료)\s*[:：]?\s*([^\n\r]{3,80})/g
  ];

  patterns.forEach(function (re) {
    var m;
    while ((m = re.exec(briefText)) !== null) {
      var t = String(m[1])
        .replace(/[·․…\-–—_]{2,}.*$/, '')     // 목차 점선 뒤 페이지번호 제거
        .replace(/\s*\d+\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (t.length < 3 || t.length > 50) continue;

      // 목차가 아니라 본문 문장이 딸려 온 경우를 걸러낸다
      // 예) '산출내역서 첨부 방법 : 입찰→입찰진행/참가→투찰→…'
      if (/[→←:：]|하여|합니다|하시기|바랍니다|경우|또는/.test(t)) continue;
      var key = t.replace(/\s+/g, '');
      if (seen[key]) continue;
      seen[key] = true;
      out.push(t);
      if (out.length >= 30) return;
    }
  });
  return out;
}

/**
 * 공고에 필요한 서식 목록.
 * 첨부 파일 자체 + 공고문 목차를 합쳐서 낸다.
 */
function getRequiredForms(bidNo, bidOrd) {
  var info = getBidAttachmentInfo(bidNo, bidOrd);
  var items = [];

  // ① 첨부 파일 = 실물이 있는 서식
  //    hwpx 는 이름으로 짐작하지 않고 안의 표를 직접 열어본다
  (info.files || []).forEach(function (f) {
    var c = classifyFormName_(f.name);
    var fileId = extractDriveId_(f.url || '');
    var tables = [];

    if (f.ext === 'hwpx' && fileId) {
      try {
        tables = scanHwpxTablesCached_(DriveApp.getFileById(fileId));
      } catch (e) {
        Logger.log('표 검사 건너뜀: ' + f.name + ' — ' + e);
      }
    }

    // 표가 발견되면 이름 판정보다 우선한다
    var kind = c.kind, kindLabel = c.label, source = c.source;
    if (tables.length) {
      kind = tables[0].kind;
      kindLabel = { perf: '실적', hr: '인력', company: '회사정보' }[kind] || c.label;
      source = '문서 안의 표에서 확인';
    }

    items.push({
      name: f.name,
      from: 'attachment',
      ext: f.ext,
      kind: kind,
      kindLabel: kindLabel,
      source: source,
      tables: tables,
      fillable: tables.length > 0,
      reason: tables.length
        ? tables.map(function (t) {
            return t.label + ' (빈 행 ' + t.emptyRows + '개 · ' + t.headers.join(' / ') + ')';
          }).join(' · ')
        : formReason_(kind, f.ext),
      url: f.url,
      fileId: fileId
    });
  });

  // ② 공고문 목차 = 실물 없이 이름만 언급된 것
  //    (이미 뽑아둔 _본문.txt 가 있을 때만 본다 — 여기서 새로 추출하지 않는다)
  var brief = '';
  try {
    var bid = findBidRecord_(bidNo, bidOrd);
    var parent = getBidAttachFolder_();
    var it = parent.getFoldersByName(bidFolderName_(bid));
    if (it.hasNext()) {
      var cached = it.next().getFilesByName(BRIEF_CACHE_NAME);
      if (cached.hasNext()) brief = cached.next().getBlob().getDataAsString('UTF-8');
    }
  } catch (e) {
    Logger.log('본문 캐시 읽기 실패(무시): ' + e);
  }

  var known = {};
  items.forEach(function (i) { known[i.name.replace(/\s+/g, '')] = true; });

  extractFormMentions_(brief).forEach(function (t) {
    if (known[t.replace(/\s+/g, '')]) return;
    var c = classifyFormName_(t);
    if (c.kind === 'unknown') return;      // 목차에서 온 건 분류된 것만 신뢰한다
    items.push({
      name: t,
      from: 'brief',
      ext: '',
      kind: c.kind,
      kindLabel: c.label,
      source: c.source,
      fillable: false,
      reason: '공고문에 언급됨 — 실물 서식을 확보해야 채울 수 있습니다',
      url: '',
      fileId: ''
    });
  });

  // 채워야 하는 서식이 다 준비됐는지 — hwpx 로 올라왔는지 기준
  var needed = items.filter(function (i) {
    return ['perf', 'hr', 'company'].indexOf(i.kind) > -1;
  });
  var ready = needed.filter(function (i) { return i.fillable; });
  var pending = needed.filter(function (i) { return !i.fillable; });

  return JSON.parse(JSON.stringify({
    files: info.files || [],
    downloaded: info.downloaded,
    folderUrl: info.folderUrl,
    items: items,
    checklist: {
      needed: needed.length,
      ready: ready.length,
      pending: pending.map(function (i) {
        return { name: i.name, ext: i.ext, kindLabel: i.kindLabel, reason: i.reason };
      }),
      complete: needed.length > 0 && pending.length === 0
    },
    company: getCompanyInfo()
  }));
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
  var info = getBidAttachmentInfo(bidNo, bidOrd);

  var notice = [], uploads = [];
  (info.files || []).forEach(function (f) {
    var entry = {
      name: f.name,
      ext: f.ext,
      url: f.url,
      fileId: extractDriveId_(f.url || ''),
      kindLabel: classifyFormName_(f.name).label
    };
    if (f.ext === 'hwpx') uploads.push(entry);
    else notice.push(entry);
  });

  // 업로드된 hwpx 를 훑어 서식 목차가 가장 많이 나온 문서를 제안요청서로 본다
  var rfp = null, forms = [], tables = [];
  uploads.forEach(function (u) {
    if (!u.fileId) return;
    try {
      var file = DriveApp.getFileById(u.fileId);
      var text = hwpxToTextCached_(file);
      var idx = extractFormIndex_(text);
      var tbl = scanHwpxTablesCached_(file);

      u.formCount = idx.length;
      u.tableCount = tbl.length;

      if (!rfp || idx.length > forms.length) {
        rfp = u;
        forms = idx;
      }
      tbl.forEach(function (t) {
        t.fileId = u.fileId;
        t.fileName = u.name;
        tables.push(t);
      });
    } catch (e) {
      u.error = String(e.message || e).split('\n')[0];
      Logger.log('업로드 문서 분석 실패: ' + u.name + ' — ' + e);
    }
  });

  // 채워야 하는 서식 중 실제로 표가 잡힌 것
  var needPerf = forms.some(function (f) { return f.kind === 'perf'; });
  var needHr = forms.some(function (f) { return f.kind === 'hr'; });
  var hasPerfTable = tables.some(function (t) { return t.kind === 'perf'; });
  var hasHrTable = tables.some(function (t) { return t.kind === 'hr'; });

  return JSON.parse(JSON.stringify({
    bid: bid,
    notice: notice,
    uploads: uploads,
    downloaded: info.downloaded,
    folderUrl: info.folderUrl,
    rfp: rfp,
    forms: forms,
    tables: tables,
    summary: {
      total: forms.length,
      fillable: forms.filter(function (f) { return f.fillable; }).length,
      needPerf: needPerf, hasPerfTable: hasPerfTable,
      needHr: needHr, hasHrTable: hasHrTable
    }
  }));
}

/** hwpx 본문 텍스트 — 서식 목차를 읽기 위한 것 (캐시) */
function hwpxToTextCached_(file) {
  var key = 'txt_' + file.getId() + '_' + file.getLastUpdated().getTime();
  var cache = CacheService.getScriptCache();

  var hit = cache.get(key);
  if (hit) return hit;

  var text = hwpxToText_(file);
  try {
    // 캐시 항목 한도가 100KB 라 목차가 있을 만한 앞부분만 저장한다
    cache.put(key, text.slice(0, 90000), 6 * 60 * 60);
  } catch (e) {
    Logger.log('본문 캐시 저장 실패(무시): ' + e);
  }
  return text;
}

/**
 * 웹앱에서 사람이 직접 올린 서식을 공고 폴더에 저장한다.
 * @param {Object} payload { bidNo, bidOrd, name, mimeType, dataBase64 }
 */
function uploadFormFile(payload) {
  var name = String(payload && payload.name || '').trim();
  if (!name) throw new Error('파일 이름이 없습니다.');

  if (/\.hwp$/i.test(name)) {
    throw new Error(
      '구형 .hwp 는 채울 수 없습니다: ' + name + '\n\n' +
      '한컴오피스에서 [다른 이름으로 저장] → 파일 형식 hwpx 로 바꾼 뒤 올려주세요.');
  }

  var bid = findBidRecord_(payload.bidNo, payload.bidOrd);
  var parent = getBidAttachFolder_();
  var it = parent.getFoldersByName(bidFolderName_(bid));
  var folder = it.hasNext() ? it.next() : parent.createFolder(bidFolderName_(bid));

  var bytes = Utilities.base64Decode(String(payload.dataBase64 || ''));
  var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', name);

  // 같은 이름이 있으면 이전 것을 휴지통으로 (덮어쓰기)
  var dup = folder.getFilesByName(name);
  while (dup.hasNext()) dup.next().setTrashed(true);

  var file = folder.createFile(blob);
  return JSON.parse(JSON.stringify({
    name: file.getName(),
    url: file.getUrl(),
    folderUrl: folder.getUrl()
  }));
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
  '업체명': 'name', '회사명': 'name', '상호': 'name', '법인명': 'name', '기업명': 'name', '제안사': 'name',
  '대표자': 'ceo', '대표이사': 'ceo', '대표자명': 'ceo', '성명': 'ceo',
  '사업자등록번호': 'bizNo', '사업자번호': 'bizNo',
  '법인등록번호': 'corpNo',
  '소재지': 'address', '주소': 'address', '사업장소재지': 'address', '본사소재지': 'address',
  '우편번호': 'zipCode',
  '전화번호': 'tel', '연락처': 'tel', '대표전화': 'tel',
  '팩스': 'fax', '팩스번호': 'fax',
  '이메일': 'email', '전자우편': 'email',
  '홈페이지': 'homepage',
  '설립일': 'foundedDate', '설립년월일': 'foundedDate', '설립일자': 'foundedDate',
  '업태': 'bizType', '종목': 'bizItem',
  '상시근로자수': 'employees', '직원수': 'employees', '종업원수': 'employees',
  '기업규모': 'companyScale', '신용등급': 'creditGrade'
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

/**
 * 서식을 채워 새 hwpx 를 만든다.
 * @param {string} fileId    채울 hwpx 의 드라이브 파일 ID
 * @param {Object} selection { perfKeys: [...], hrNames: [...] }
 * @param {string} bidNo     결과 파일을 공고 폴더에 넣기 위한 공고번호
 */
function generateFilledForm(fileId, selection, bidNo, bidOrd) {
  var file = DriveApp.getFileById(fileId);
  if (!/\.hwpx$/i.test(file.getName())) {
    throw new Error(
      'hwpx 파일만 채울 수 있습니다: ' + file.getName() +
      '\n\n한컴오피스에서 [다른 이름으로 저장] → hwpx 로 바꾼 뒤 다시 시도해주세요.');
  }

  var perfRows = pickPerfRows_(selection && selection.perfKeys);
  var hrRows = pickHrRows_(selection && selection.hrNames);
  var company = getCompanyInfo();

  var parts = Utilities.unzip(file.getBlob().setContentType('application/zip'));
  var report = { company: 0, perf: 0, hr: 0, tables: 0, unfilled: [], overflow: [] };
  var out = [];

  parts.forEach(function (part) {
    if (!HWPX_SECTION_RE.test(part.getName())) { out.push(part); return; }

    var doc = XmlService.parse(part.getDataAsString('UTF-8'));
    var root = doc.getRootElement();

    findDescendants_(root, 'tbl').forEach(function (tbl) {
      report.tables++;
      fillTable_(tbl, { company: company, perf: perfRows, hr: hrRows }, report);
    });

    var xml = XmlService.getRawFormat().format(doc);
    out.push(Utilities.newBlob(xml, 'application/xml', part.getName()));
  });

  // mimetype 엔트리를 맨 앞으로 (hwpx/OPC 규약)
  out.sort(function (a, b) {
    return (a.getName() === 'mimetype' ? 0 : 1) - (b.getName() === 'mimetype' ? 0 : 1);
  });

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  var outName = file.getName().replace(/\.hwpx$/i, '') + '_작성_' + stamp + '.hwpx';
  var blob = Utilities.zip(out, outName).setName(outName);

  var folder = file.getParents().hasNext() ? file.getParents().next() : DriveApp.getRootFolder();
  var saved = folder.createFile(blob);

  return JSON.parse(JSON.stringify({
    name: outName,
    url: saved.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + saved.getId(),
    report: report,
    placeholders: company._placeholders || []
  }));
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

/**
 * Bid.gs — 나라장터(조달청) 입찰공고 자동 수집
 *
 * 하는 일:
 *   1) 공공데이터포털 '조달청_나라장터 입찰공고정보서비스' 를 매일 호출
 *   2) 공고명을 키워드로 걸러서 (MICE/행사/교육/창업 등) 우리 사업과 관련된 것만 추림
 *   3) 스프레드시트 '입찰공고' 탭에 누적 저장 (공고번호+차수로 중복 제거)
 *   4) 새로 들어온 건만 메일로 알림
 *   5) 포털 웹앱의 [입찰공고] 탭에 목록 제공
 *
 * 최초 1회 설정:
 *   ① https://www.data.go.kr/data/15129394/openapi.do 에서 활용신청 → 인증키 발급
 *   ② 스프레드시트 메뉴 [입찰공고] → [설정 (인증키/키워드)] 에서 인증키 입력
 *   ③ [API 연결 테스트] 로 통신 확인
 *   ④ [트리거 등록/재등록] 으로 매일 자동 수집 켜기
 *
 * ※ 메뉴 등록(onOpen)은 Menu.gs 에 있습니다.
 * ※ 실제 '투찰'은 공동인증서가 필요해 자동화 대상이 아닙니다. 이 코드는 공고 수집까지만 합니다.
 */

// ── 저장 위치 ────────────────────────────────────────────────
// BID_SHEET_ID 를 따로 지정하지 않으면 실적 스프레드시트(Dashboard.gs 의 SHEET_ID)에 탭을 만든다.
var BID_TAB_NAME = '입찰공고';

// ── API 엔드포인트 ───────────────────────────────────────────
// 조달청 API는 개편 이력이 있어 경로가 두 가지로 돌아다닌다.
// 처음 호출할 때 둘 다 시도해서 되는 쪽을 Script Properties 에 기억해둔다.
var G2B_BASE_CANDIDATES = [
  'https://apis.data.go.kr/1230000/ad/BidPublicInfoService',
  'https://apis.data.go.kr/1230000/BidPublicInfoService'
];

// 업무구분별로 오퍼레이션이 나뉘어 있다. 용역이 주력이라 용역을 먼저 본다.
var G2B_OPERATIONS = [
  { label: '용역', op: 'getBidPblancListInfoServc' },
  { label: '물품', op: 'getBidPblancListInfoThng' },
  { label: '공사', op: 'getBidPblancListInfoCnstwk' }
];

// ── 기본 필터 키워드 ─────────────────────────────────────────
// 설정 메뉴에서 바꿀 수 있고, 바꾸면 Script Properties 값이 우선한다.
var BID_DEFAULT_KEYWORDS = [
  '행사', '축제', '박람회', '전시', '컨퍼런스', '콘퍼런스', '포럼', '세미나', '워크숍',
  '국제회의', '페스티벌', 'MICE', '마이스', '운영대행', '기획운영', '대행용역',
  '홍보', '마케팅', '캠페인', '브랜딩', '콘텐츠',
  '창업', '스타트업', '액셀러레이팅', '보육', '기업지원',
  '교육과정', '교육운영', '연수', '아카데미',
  '상권', '골목', '지역활성화'
].join(',');

// 이름만 걸리고 실제로는 우리 일이 아닌 것들을 쳐낸다.
var BID_DEFAULT_EXCLUDE = [
  '청소', '경비', '급식', '시설관리', '차량임차', '방역', '소독',
  '건설', '토목', '전기공사', '통신공사', '설계용역', '감리'
].join(',');

var BID_LOOKBACK_DAYS = 2;   // 트리거가 한 번 걸러도 메우도록 이틀치를 본다
var BID_PAGE_SIZE = 300;
var BID_MAX_PAGES = 10;      // 안전장치 (업무구분당 최대 3,000건)

var BID_HEADERS = [
  '수집일시', '공고번호', '차수', '업무구분', '공고명', '공고기관', '수요기관',
  '계약방법', '입찰방식', '공고일시', '마감일시', '개찰일시',
  '배정예산', '추정가격', '매칭키워드', '공고URL'
];

// ─────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────

function bidProps_() {
  return PropertiesService.getScriptProperties();
}

function getBidServiceKey_() {
  var key = String(bidProps_().getProperty('G2B_SERVICE_KEY') || '').trim();
  if (!key) {
    throw new Error(
      '나라장터 인증키가 없습니다.\n' +
      '메뉴 [입찰공고] → [설정 (인증키/키워드)] 에서 먼저 입력해주세요.');
  }
  return key;
}

function getBidKeywords_() {
  return splitCsv_(bidProps_().getProperty('BID_KEYWORDS') || BID_DEFAULT_KEYWORDS);
}

function getBidExcludeKeywords_() {
  return splitCsv_(bidProps_().getProperty('BID_EXCLUDE_KEYWORDS') || BID_DEFAULT_EXCLUDE);
}

function splitCsv_(s) {
  return String(s || '').split(',')
    .map(function (t) { return t.trim(); })
    .filter(Boolean);
}

/** 메뉴: 인증키 / 키워드 설정 */
function showBidSettings() {
  var ui = SpreadsheetApp.getUi();
  var props = bidProps_();

  var cur = String(props.getProperty('G2B_SERVICE_KEY') || '');
  var res = ui.prompt(
    '나라장터 인증키',
    '공공데이터포털에서 발급받은 일반 인증키를 붙여넣으세요.\n' +
    '(Decoding / Encoding 어느 쪽이든 됩니다)\n\n' +
    '현재: ' + (cur ? maskKey_(cur) : '(미설정)') + '\n' +
    '비워두고 확인을 누르면 기존 값을 유지합니다.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  if (key) props.setProperty('G2B_SERVICE_KEY', key);

  var kw = ui.prompt(
    '수집 키워드',
    '공고명에 이 단어들 중 하나라도 들어가면 수집합니다. 쉼표로 구분하세요.\n\n' +
    '현재:\n' + getBidKeywords_().join(', ') + '\n\n' +
    '비워두고 확인을 누르면 유지합니다.',
    ui.ButtonSet.OK_CANCEL);
  if (kw.getSelectedButton() === ui.Button.OK) {
    var kwText = kw.getResponseText().trim();
    if (kwText) props.setProperty('BID_KEYWORDS', kwText);
  }

  var ex = ui.prompt(
    '제외 키워드',
    '위 키워드에 걸렸더라도 이 단어가 있으면 버립니다. 쉼표로 구분하세요.\n\n' +
    '현재:\n' + getBidExcludeKeywords_().join(', ') + '\n\n' +
    '비워두고 확인을 누르면 유지합니다.',
    ui.ButtonSet.OK_CANCEL);
  if (ex.getSelectedButton() === ui.Button.OK) {
    var exText = ex.getResponseText().trim();
    if (exText) props.setProperty('BID_EXCLUDE_KEYWORDS', exText);
  }

  var to = ui.prompt(
    '알림 수신자',
    '새 공고가 들어오면 메일을 받을 주소입니다. 쉼표로 여러 명 가능.\n\n' +
    '현재: ' + (props.getProperty('BID_NOTIFY_TO') || '(미설정 — 본인에게 발송)') + '\n\n' +
    '비워두고 확인을 누르면 유지합니다.',
    ui.ButtonSet.OK_CANCEL);
  if (to.getSelectedButton() === ui.Button.OK) {
    var toText = to.getResponseText().trim();
    if (toText) props.setProperty('BID_NOTIFY_TO', toText);
  }

  ui.alert('저장했습니다.\n\n다음으로 [API 연결 테스트] 를 실행해보세요.');
}

function maskKey_(k) {
  if (k.length <= 12) return k.slice(0, 3) + '…';
  return k.slice(0, 6) + '…' + k.slice(-4) + ' (' + k.length + '자)';
}

/** 메뉴: 현재 설정 확인 */
function checkBidSettings() {
  var props = bidProps_();
  var key = props.getProperty('G2B_SERVICE_KEY');
  SpreadsheetApp.getUi().alert(
    '입찰공고 설정\n\n' +
    '인증키: ' + (key ? maskKey_(key) : '(미설정)') + '\n' +
    '검증된 엔드포인트: ' + (props.getProperty('G2B_BASE_OK') || '(아직 없음)') + '\n' +
    '저장 위치: ' + getBidSheet_().getParent().getName() + ' / ' + BID_TAB_NAME + '\n' +
    '알림 수신자: ' + (props.getProperty('BID_NOTIFY_TO') || Session.getEffectiveUser().getEmail()) + '\n\n' +
    '수집 키워드 (' + getBidKeywords_().length + '개):\n' + getBidKeywords_().join(', ') + '\n\n' +
    '제외 키워드 (' + getBidExcludeKeywords_().length + '개):\n' + getBidExcludeKeywords_().join(', '));
}

// ─────────────────────────────────────────────────────────────
// 시트
// ─────────────────────────────────────────────────────────────

function getBidSheet_() {
  var id = String(bidProps_().getProperty('BID_SHEET_ID') || '').trim() || SHEET_ID;
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(BID_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BID_TAB_NAME);
    sheet.appendRow(BID_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, BID_HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

/** 이미 저장된 공고의 키(공고번호-차수) 집합 */
function loadExistingBidKeys_(sheet) {
  var last = sheet.getLastRow();
  var keys = {};
  if (last < 2) return keys;
  var values = sheet.getRange(2, 2, last - 1, 2).getValues(); // B: 공고번호, C: 차수
  values.forEach(function (r) {
    keys[bidKey_(r[0], r[1])] = true;
  });
  return keys;
}

function bidKey_(no, ord) {
  return String(no == null ? '' : no).trim() + '-' + String(ord == null ? '' : ord).trim();
}

// ─────────────────────────────────────────────────────────────
// API 호출
// ─────────────────────────────────────────────────────────────

/**
 * 인증키를 URL에 넣을 형태로 만든다.
 * 공공데이터포털은 Encoding/Decoding 두 벌을 주는데, 사용자가 어느 쪽을 붙여넣었는지
 * 알 수 없으므로 '%' 가 이미 들어있으면 인코딩된 키로 보고 그대로 쓴다.
 */
function encodeServiceKey_(key) {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

function buildBidUrl_(base, op, params) {
  var qs = Object.keys(params).map(function (k) {
    return k + '=' + encodeURIComponent(params[k]);
  }).join('&');
  return base + '/' + op + '?serviceKey=' + encodeServiceKey_(getBidServiceKey_()) + '&' + qs;
}

/**
 * 한 페이지 호출. 성공하면 {items, totalCount}, 실패하면 예외.
 * 엔드포인트가 두 가지라서, 검증된 게 없으면 후보를 차례로 시도하고 되는 쪽을 기억한다.
 */
function fetchBidPage_(op, params) {
  var props = bidProps_();
  var known = props.getProperty('G2B_BASE_OK');
  var bases = known ? [known].concat(G2B_BASE_CANDIDATES.filter(function (b) { return b !== known; }))
                    : G2B_BASE_CANDIDATES.slice();

  var lastErr = null;
  for (var i = 0; i < bases.length; i++) {
    try {
      var parsed = requestBidJson_(buildBidUrl_(bases[i], op, params));
      if (props.getProperty('G2B_BASE_OK') !== bases[i]) props.setProperty('G2B_BASE_OK', bases[i]);
      return parsed;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('입찰공고 API 호출에 실패했습니다.');
}

function requestBidJson_(url) {
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var code = resp.getResponseCode();
  var text = resp.getContentText();

  if (code !== 200) {
    throw new Error('HTTP ' + code + ' — ' + text.slice(0, 300));
  }
  // 인증키 오류 등은 200 으로 내려오면서 본문이 XML 인 경우가 많다
  if (text.trim().charAt(0) !== '{') {
    var msg = (text.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/) ||
               text.match(/<errMsg>([\s\S]*?)<\/errMsg>/) ||
               text.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/) || [])[1];
    throw new Error('JSON 이 아닌 응답: ' + (msg || text.slice(0, 300)));
  }

  var json = JSON.parse(text);
  var header = (json.response && json.response.header) || {};
  var resultCode = String(header.resultCode == null ? '' : header.resultCode);
  if (resultCode && resultCode !== '00' && resultCode !== '0') {
    throw new Error('API 오류 ' + resultCode + ' — ' + (header.resultMsg || ''));
  }

  var body = (json.response && json.response.body) || {};
  var items = body.items;
  // items 가 [] 이거나 {item:[...]} 이거나 단일 객체인 경우를 모두 흡수
  if (!items) items = [];
  else if (items.item) items = items.item;
  if (!Array.isArray(items)) items = [items];

  return { items: items, totalCount: Number(body.totalCount || items.length) };
}

/** 여러 필드명 후보 중 값이 있는 첫 번째를 반환 (조달청 응답 필드명이 오퍼레이션마다 조금씩 다름) */
function pick_(obj, names) {
  for (var i = 0; i < names.length; i++) {
    var v = obj[names[i]];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// 수집
// ─────────────────────────────────────────────────────────────

function fmtBidDt_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMddHHmm');
}

/**
 * 트리거 진입점. 최근 BID_LOOKBACK_DAYS 일치를 훑어서 새 공고만 시트에 추가하고 메일 발송.
 * 반환: { fetched, matched, added, errors }
 */
function collectBids() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('입찰공고 수집: 다른 실행이 진행 중이라 건너뜁니다.');
    return { fetched: 0, matched: 0, added: 0, errors: ['이미 실행 중'] };
  }

  try {
    var end = new Date();
    var bgn = new Date(end.getTime() - BID_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    var keywords = getBidKeywords_();
    var excludes = getBidExcludeKeywords_();
    var sheet = getBidSheet_();
    var existing = loadExistingBidKeys_(sheet);

    var stamp = Utilities.formatDate(end, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    var fetched = 0, matched = 0;
    var newRows = [], errors = [];

    G2B_OPERATIONS.forEach(function (spec) {
      try {
        var items = fetchAllBidPages_(spec.op, bgn, end);
        fetched += items.length;

        items.forEach(function (it) {
          var name = pick_(it, ['bidNtceNm']);
          if (!name) return;

          var hits = matchKeywords_(name, keywords);
          if (!hits.length) return;
          if (hasAnyKeyword_(name, excludes)) return;
          matched++;

          var no = pick_(it, ['bidNtceNo']);
          var ord = pick_(it, ['bidNtceOrd']);
          if (existing[bidKey_(no, ord)]) return;
          existing[bidKey_(no, ord)] = true;

          newRows.push([
            stamp,
            no,
            ord,
            spec.label,
            name,
            pick_(it, ['ntceInsttNm']),
            pick_(it, ['dminsttNm']),
            pick_(it, ['cntrctCnclsMthdNm']),
            pick_(it, ['bidMethdNm']),
            pick_(it, ['bidNtceDt', 'rgstDt']),
            pick_(it, ['bidClseDt']),
            pick_(it, ['opengDt']),
            toNumber_(pick_(it, ['asignBdgtAmt'])),
            toNumber_(pick_(it, ['presmptPrce'])),
            hits.join(' '),
            pick_(it, ['bidNtceDtlUrl', 'bidNtceUrl'])
          ]);
        });
      } catch (e) {
        errors.push(spec.label + ': ' + (e.message || e));
        Logger.log('입찰공고 수집 실패 (' + spec.label + '): ' + e);
      }
    });

    if (newRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, BID_HEADERS.length).setValues(newRows);
      notifyNewBids_(newRows);
    }

    Logger.log('입찰공고 수집: 조회 ' + fetched + ' / 키워드 일치 ' + matched + ' / 신규 ' + newRows.length);
    return { fetched: fetched, matched: matched, added: newRows.length, errors: errors };

  } finally {
    lock.releaseLock();
  }
}

function fetchAllBidPages_(op, bgn, end) {
  var all = [];
  for (var page = 1; page <= BID_MAX_PAGES; page++) {
    var res = fetchBidPage_(op, {
      pageNo: page,
      numOfRows: BID_PAGE_SIZE,
      inqryDiv: 1,                 // 1 = 공고게시일시 기준
      inqryBgnDt: fmtBidDt_(bgn),
      inqryEndDt: fmtBidDt_(end),
      type: 'json'
    });
    all = all.concat(res.items);
    if (res.items.length < BID_PAGE_SIZE) break;
    if (all.length >= res.totalCount) break;
  }
  return all;
}

/** 공고명에 걸린 키워드 목록 (없으면 빈 배열) */
function matchKeywords_(name, keywords) {
  var hay = String(name).toUpperCase().replace(/\s+/g, '');
  return keywords.filter(function (k) {
    return hay.indexOf(k.toUpperCase().replace(/\s+/g, '')) > -1;
  });
}

function hasAnyKeyword_(name, keywords) {
  return matchKeywords_(name, keywords).length > 0;
}

// ─────────────────────────────────────────────────────────────
// 알림 메일
// ─────────────────────────────────────────────────────────────

function notifyNewBids_(rows) {
  var to = String(bidProps_().getProperty('BID_NOTIFY_TO') || '').trim() ||
           Session.getEffectiveUser().getEmail();
  if (!to) return;

  var html = rows.map(function (r) {
    var url = r[15];
    var title = url
      ? '<a href="' + escapeAttr_(url) + '" style="color:#0b5cab;text-decoration:none">' + escapeHtml_(r[4]) + '</a>'
      : escapeHtml_(r[4]);
    var budget = r[12] ? Math.round(r[12] / 10000).toLocaleString() + '만원' : '-';
    return '<tr>' +
      '<td style="padding:10px 8px;border-bottom:1px solid #e6e8eb;font-size:14px">' +
        '<div style="font-weight:600;margin-bottom:4px">' + title + '</div>' +
        '<div style="color:#5c6673;font-size:12px">' +
          escapeHtml_(r[5]) + ' · ' + escapeHtml_(r[3]) + ' · 예산 ' + budget +
        '</div>' +
      '</td>' +
      '<td style="padding:10px 8px;border-bottom:1px solid #e6e8eb;font-size:12px;color:#5c6673;white-space:nowrap">' +
        '마감<br>' + escapeHtml_(formatBidDt_(r[10])) +
      '</td>' +
    '</tr>';
  }).join('');

  var body =
    '<div style="font-family:Pretendard,Apple SD Gothic Neo,sans-serif;max-width:720px">' +
      '<h2 style="font-size:18px;margin:0 0 4px">신규 입찰공고 ' + rows.length + '건</h2>' +
      '<p style="color:#5c6673;font-size:13px;margin:0 0 16px">나라장터에서 설정된 키워드에 맞는 공고가 새로 올라왔습니다.</p>' +
      '<table style="width:100%;border-collapse:collapse">' + html + '</table>' +
    '</div>';

  MailApp.sendEmail({
    to: to,
    subject: '[인트윈] 신규 입찰공고 ' + rows.length + '건',
    htmlBody: body,
    name: '인트윈 경영기획실'
  });
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr_(s) {
  return escapeHtml_(s).replace(/"/g, '&quot;');
}

/**
 * 어떤 모양으로 들어오든 'yyyy-MM-dd HH:mm' 로 통일한다.
 *
 * 시트에 '2026-08-31 18:00' 을 넣으면 스프레드시트가 이를 날짜로 자동 인식해
 * 다시 읽을 때 Date 객체로 돌아온다. 그대로 String() 하면
 * "Mon Aug 31 2026 18:00:00 GMT+0900" 이 되어 프론트엔드 파서가 못 읽고,
 * 결과적으로 D-day 가 전부 '–' 로 표시된다. 그래서 Date 를 먼저 처리한다.
 */
function formatBidDt_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }

  var s = String(v == null ? '' : v).trim();
  if (!s) return '';

  // '202608311800' / '20260831'
  var m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?$/);
  if (m) {
    return m[1] + '-' + m[2] + '-' + m[3] + (m[4] ? ' ' + m[4] + ':' + (m[5] || '00') : '');
  }

  // '2026-08-31 18:00' / '2026/08/31 18:00:00' → 구분자·초 단위를 정규화
  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    var pad = function (n) { return ('0' + n).slice(-2); };
    return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) +
           (m[4] ? ' ' + pad(m[4]) + ':' + m[5] : '');
  }

  return s;
}

// ─────────────────────────────────────────────────────────────
// 웹앱용 데이터
// ─────────────────────────────────────────────────────────────

/**
 * 포털 [입찰공고] 탭에서 호출.
 * 읽기 전용이라 탭이 없어도 만들지 않는다 — 웹앱 열람자에게 편집 권한이 없을 수 있다.
 */
function getBidData() {
  var id = String(bidProps_().getProperty('BID_SHEET_ID') || '').trim() || SHEET_ID;
  var sheet = SpreadsheetApp.openById(id).getSheetByName(BID_TAB_NAME);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var col = headerReader_(values[0]);
  var records = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = col(row, '공고명');
    if (!name) continue;

    records.push({
      collectedAt: formatHRDate(col(row, '수집일시'), 'yyyy-MM-dd HH:mm'),
      no: String(col(row, '공고번호') || ''),
      ord: String(col(row, '차수') || ''),
      kind: String(col(row, '업무구분') || ''),
      name: String(name),
      noticeOrg: String(col(row, '공고기관') || ''),
      demandOrg: String(col(row, '수요기관') || ''),
      method: String(col(row, '계약방법') || ''),
      bidMethod: String(col(row, '입찰방식') || ''),
      noticeDt: formatBidDt_(col(row, '공고일시')),
      closeDt: formatBidDt_(col(row, '마감일시')),
      openDt: formatBidDt_(col(row, '개찰일시')),
      budget: toNumber_(col(row, '배정예산')),
      estimate: toNumber_(col(row, '추정가격')),
      keywords: String(col(row, '매칭키워드') || ''),
      url: String(col(row, '공고URL') || '')
    });
  }

  Logger.log('불러온 입찰공고 건수: ' + records.length);
  return JSON.parse(JSON.stringify(records));
}

// ─────────────────────────────────────────────────────────────
// 트리거
// ─────────────────────────────────────────────────────────────

var BID_TRIGGER_FN = 'collectBids';
var BID_COLLECT_HOUR = 8;

function setupBidTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === BID_TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(BID_TRIGGER_FN)
    .timeBased()
    .atHour(BID_COLLECT_HOUR)
    .everyDays(1)
    .create();
  SpreadsheetApp.getUi().alert(
    '입찰공고 수집 트리거를 등록했습니다.\n\n매일 오전 ' + BID_COLLECT_HOUR + '시경 자동 실행됩니다.');
}

function showBidTriggers() {
  var lines = ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === BID_TRIGGER_FN; })
    .map(function (t) { return '  · ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')'; });
  SpreadsheetApp.getUi().alert(
    lines.length
      ? '등록된 입찰공고 트리거\n\n' + lines.join('\n')
      : '등록된 입찰공고 트리거가 없습니다.\n\n[트리거 등록/재등록] 을 실행해주세요.');
}

// ─────────────────────────────────────────────────────────────
// 메뉴 / 진단
// ─────────────────────────────────────────────────────────────

/** 메뉴: 지금 즉시 수집 */
function collectBidsManual() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = collectBids();
    ui.alert(
      '입찰공고 수집 완료\n\n' +
      '나라장터 조회: ' + r.fetched + '건\n' +
      '키워드 일치: ' + r.matched + '건\n' +
      '신규 저장: ' + r.added + '건' +
      (r.added ? ' (알림 메일 발송함)' : ' (새로운 공고 없음)') +
      (r.errors.length ? '\n\n⚠ 일부 실패:\n' + r.errors.join('\n') : ''));
  } catch (e) {
    ui.alert('수집 실패\n\n' + (e.message || e));
  }
}

/** 메뉴: API 연결 테스트 — 인증키/엔드포인트가 살아있는지만 확인 */
function testBidApi() {
  var ui = SpreadsheetApp.getUi();
  var end = new Date();
  var bgn = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  try {
    var res = fetchBidPage_('getBidPblancListInfoServc', {
      pageNo: 1,
      numOfRows: 5,
      inqryDiv: 1,
      inqryBgnDt: fmtBidDt_(bgn),
      inqryEndDt: fmtBidDt_(end),
      type: 'json'
    });
    var sample = res.items.length
      ? res.items.slice(0, 3).map(function (it) {
          return '  · ' + pick_(it, ['bidNtceNm']).slice(0, 40);
        }).join('\n')
      : '  (최근 24시간 용역공고 없음 — 통신은 정상)';

    ui.alert(
      '✅ 연결 성공\n\n' +
      '엔드포인트: ' + bidProps_().getProperty('G2B_BASE_OK') + '\n' +
      '최근 24시간 용역공고: ' + res.totalCount + '건\n\n' +
      '샘플:\n' + sample);
  } catch (e) {
    ui.alert(
      '❌ 연결 실패\n\n' + (e.message || e) + '\n\n' +
      '확인할 것:\n' +
      '  1. 공공데이터포털에서 활용신청이 승인됐는지\n' +
      '  2. 인증키를 정확히 붙여넣었는지\n' +
      '  3. 승인 직후라면 반영까지 최대 1시간 걸립니다');
  }
}

/** 메뉴: 파싱 점검 */
function debugBidData() {
  var rows = getBidData();
  var byKind = {};
  rows.forEach(function (r) { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
  var lines = Object.keys(byKind).map(function (k) { return '  ' + k + ': ' + byKind[k] + '건'; });
  var sample = rows.length ? JSON.stringify(rows[rows.length - 1], null, 1) : '(데이터 없음)';
  SpreadsheetApp.getUi().alert(
    '입찰공고 ' + rows.length + '건\n' + lines.join('\n') + '\n\n최근 행 샘플:\n' + sample);
}

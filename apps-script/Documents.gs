/**
 * Documents.gs — 입찰행정서류 유효기간 관리
 *
 * 경영기획실DB 의 '입찰행정서류' 탭을 읽어 포털 [입찰서류] 탭에 뿌린다.
 *
 * ⚠ 시트에도 '상태' / 'D-day' 컬럼이 있지만 그 값은 쓰지 않는다.
 *    시트에 적힌 값은 작성 시점에 굳은 숫자라 시간이 지나면 틀려진다.
 *    (예: 만료일 2026-08-31 인 서류에 'D-5' 가 적혀 있는 식)
 *    항상 '유효기간(만료일)' 에서 오늘 기준으로 다시 계산한다.
 *
 * ※ 메뉴 등록(onOpen)은 Menu.gs 에 있습니다.
 */

// 서류 시트를 따로 지정하지 않으면 인력현황과 같은 파일(경영기획실DB)을 본다
var DOC_TAB_FALLBACK = '입찰행정서류';

/** 만료까지 이 일수 이하로 남으면 '임박' */
var DOC_IMMINENT_DAYS = 60;

/** 비고에 이 말이 들어 있으면 별도 표시 */
var DOC_CHECK_TAG = '확인필요';

// ─────────────────────────────────────────────────────────────
// 시트 찾기
// ─────────────────────────────────────────────────────────────

function docProps_() {
  return PropertiesService.getScriptProperties();
}

/**
 * 서류 시트를 찾는다.
 * 탭 이름이 바뀔 수 있으므로, 이름으로 못 찾으면 머리글에
 * '서류명' 과 '유효기간' 이 있는 탭을 찾아서 쓴다. 찾은 이름은 기억해둔다.
 */
function getDocSheet_() {
  var props = docProps_();
  var id = String(props.getProperty('DOC_SHEET_ID') || '').trim() || HR_SHEET_ID;
  var ss = SpreadsheetApp.openById(id);

  var remembered = String(props.getProperty('DOC_TAB_NAME') || '').trim();
  if (remembered) {
    var byMemo = ss.getSheetByName(remembered);
    if (byMemo) return byMemo;
  }

  var byName = ss.getSheetByName(DOC_TAB_FALLBACK);
  if (byName) {
    props.setProperty('DOC_TAB_NAME', DOC_TAB_FALLBACK);
    return byName;
  }

  // 머리글로 탐색
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var lastCol = sheets[i].getLastColumn();
    if (lastCol < 2) continue;
    var header = sheets[i].getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h == null ? '' : h).replace(/\s+/g, ''); });
    var joined = header.join('|');
    if (joined.indexOf('서류명') > -1 && joined.indexOf('유효기간') > -1) {
      props.setProperty('DOC_TAB_NAME', sheets[i].getName());
      return sheets[i];
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 상태 계산
// ─────────────────────────────────────────────────────────────

/** 오늘부터 해당 날짜까지 남은 일수 (오늘이면 0, 지났으면 음수) */
function daysUntil_(dateObj) {
  var tz = Session.getScriptTimeZone();
  var today = new Date(Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd') + ' 00:00:00');
  var target = new Date(Utilities.formatDate(dateObj, tz, 'yyyy/MM/dd') + ' 00:00:00');
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/**
 * 만료일로부터 상태를 정한다.
 *   expired  = 만료 (빨강)
 *   imminent = 임박, 60일 이내 (주황)
 *   normal   = 정상 (초록)
 *   none     = 유효기간 없음 (회색)
 */
function docStatus_(dday) {
  if (dday === null) return 'none';
  if (dday < 0) return 'expired';
  if (dday <= DOC_IMMINENT_DAYS) return 'imminent';
  return 'normal';
}

// ─────────────────────────────────────────────────────────────
// 웹앱용 데이터
// ─────────────────────────────────────────────────────────────

/** 포털 [입찰서류] 탭에서 호출 */
function getDocumentData() {
  var sheet = getDocSheet_();
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var col = headerReader_(values[0]);
  var records = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = String(col(row, '서류명') || '').trim();
    if (!name) continue;

    var expiryRaw = col(row, '유효기간(만료일)');
    var expiryDate = parseHRDate(expiryRaw);
    var dday = expiryDate ? daysUntil_(expiryDate) : null;

    var url = String(col(row, '파일링크(Drive URL)') || '').trim();
    var note = String(col(row, '비고') || '').trim();

    records.push({
      name: name,
      org: String(col(row, '발급기관') || '').trim(),
      issuedDate: formatHRDate(col(row, '발급일'), 'yyyy-MM-dd'),
      expiryDate: expiryDate
        ? Utilities.formatDate(expiryDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : '',
      dday: dday,
      status: docStatus_(dday),
      url: url,
      fileId: extractDriveId_(url),
      note: note,
      needsCheck: note.indexOf(DOC_CHECK_TAG) > -1
    });
  }

  Logger.log('불러온 입찰행정서류 건수: ' + records.length);
  return JSON.parse(JSON.stringify(records));
}

/** 드라이브 URL 에서 파일 ID 추출 (다운로드 링크를 만들기 위해) */
function extractDriveId_(url) {
  var m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/) ||
          String(url || '').match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : '';
}

// ─────────────────────────────────────────────────────────────
// 진단
// ─────────────────────────────────────────────────────────────

/** 메뉴: 파싱 점검 */
function debugDocumentData() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getDocSheet_();
  if (!sheet) {
    ui.alert(
      '서류 시트를 찾지 못했습니다.\n\n' +
      "'" + DOC_TAB_FALLBACK + "' 이라는 이름의 탭이 있는지,\n" +
      "머리글에 '서류명' 과 '유효기간' 이 있는지 확인해주세요.");
    return;
  }

  var rows = getDocumentData();
  var byStatus = { expired: 0, imminent: 0, normal: 0, none: 0 };
  rows.forEach(function (r) { byStatus[r.status]++; });

  var label = { expired: '만료', imminent: '임박', normal: '정상', none: '유효기간 없음' };
  var lines = Object.keys(byStatus).map(function (k) {
    return '  ' + label[k] + ': ' + byStatus[k] + '건';
  });

  // 조치가 필요한 것부터 보여준다
  var urgent = rows
    .filter(function (r) { return r.status === 'expired' || r.status === 'imminent'; })
    .sort(function (a, b) { return a.dday - b.dday; })
    .map(function (r) {
      return '  · ' + (r.dday < 0 ? '만료 ' + (-r.dday) + '일 지남' : 'D-' + r.dday) +
             ' — ' + r.name;
    });

  ui.alert(
    '입찰행정서류 ' + rows.length + '건  (탭: ' + sheet.getName() + ')\n' +
    lines.join('\n') + '\n\n' +
    (urgent.length ? '재발급 필요:\n' + urgent.join('\n') : '재발급이 필요한 서류가 없습니다.') +
    '\n\n※ D-day 는 시트 값이 아니라 오늘(' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') +
    ') 기준으로 다시 계산한 값입니다.');
}

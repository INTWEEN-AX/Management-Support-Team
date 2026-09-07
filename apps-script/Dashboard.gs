/**
 * Dashboard.gs — 인트윈 실적검색 / 인력현황 대시보드 (웹앱 백엔드)
 *
 * 설정:
 * 1. SHEET_ID 에 실적 스프레드시트 URL의 ID 부분을 넣으세요.
 *    예) https://docs.google.com/spreadsheets/d/【이 부분】/edit
 * 2. SHEET_NAME 이 실제 시트 탭 이름과 다르면 맞게 수정하세요.
 *
 * ※ 메뉴 등록(onOpen)과 include() 는 Menu.gs 에 있습니다.
 */

// ── 실적 스프레드시트 ─────────────────────────────────────────
var SHEET_ID = '1CSq0xNbc8pg6l159FlxD2raoqqGImeEVu9Ex6JgShes';
var SHEET_NAME = '실적';

/** 과업명이 빈 행은 건너뛴다 */
var EXCLUDE_EMPTY_TASKNAME = true;

// ── 인력현황 스프레드시트 (탭 3개 = 재직상태 3종) ──────────────
var HR_SHEET_ID = '1zeVLhzKPU_oTaBrxHf7gB0EJSt8RcY9PpMInj44JKo8';
var HR_STATUS_TABS = ['재직(상근)', '재직(비상근)', '휴직'];

// ─────────────────────────────────────────────────────────────
// 웹앱 진입점
// ─────────────────────────────────────────────────────────────

function doGet() {
  // 명단에 없는 사람은 strict 모드일 때만 막는다.
  // open 모드에서는 기록만 남기고 그대로 보여준다 —
  // 명단이 검증되기 전에 잠그면 전원이 못 들어온다.
  var a = checkCurrentAccess_();
  if (!a.allowed && a.mode === 'strict') {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:system-ui;padding:48px;max-width:520px;margin:0 auto;' +
      'color:#1a1a1a;line-height:1.7">' +
      '<h2 style="margin:0 0 12px">접근 권한이 없습니다</h2>' +
      '<p style="color:#666">' + (a.email || '계정을 확인하지 못했습니다') +
      '<br>' + a.reason + '</p>' +
      '<p style="color:#666">사내 구성원이시라면 관리자에게 ' +
      '인력현황 시트에 이메일 등록을 요청해주세요.</p></div>')
      .setTitle('접근 권한 없음');
  }
  Logger.log('접속: ' + (a.email || '(미확인)') + ' / ' + a.reason + ' / ' + a.mode);

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('인트윈 대시보드')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─────────────────────────────────────────────────────────────
// 실적 데이터
// ─────────────────────────────────────────────────────────────

/**
 * 시트 데이터를 읽어서 프론트엔드에서 쓰기 좋은 JSON 배열로 변환.
 * 헤더 이름을 기준으로 컬럼을 찾기 때문에, 컬럼 순서가 바뀌어도 안전합니다.
 */
function getPerformanceData() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('시트를 찾을 수 없습니다: ' + SHEET_NAME);

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var col = headerReader_(values[0]);
  var records = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var taskName = col(row, '과업명');
    if (EXCLUDE_EMPTY_TASKNAME && !taskName) continue;

    // 금액: "199,986,000 (99.993%)" 같은 텍스트인 경우도 있어 숫자만 추출
    var rawAmount = col(row, '금액');

    var sharePct = col(row, '지분율(%)');
    sharePct = (typeof sharePct === 'number') ? sharePct : (parseFloat(sharePct) || 100);

    records.push({
      no: col(row, '순번'),
      status: col(row, '실적증명 발급 상태'),
      dept: col(row, '사업부서'),
      year: col(row, '연도'),
      taskName: taskName,
      desc: col(row, '용역 개요'),
      org: col(row, '발급기관'),
      amount: toNumber_(rawAmount),
      amountRaw: rawAmount,
      contractDate: formatHRDate(col(row, '계약일자'), 'yyyy-MM-dd'),
      contractPeriod: col(row, '계약기간'),
      field: col(row, '분야') || '미분류',
      isConsortium: String(col(row, '컨소시엄 여부') || '').trim().toUpperCase() === 'Y',
      sharePct: sharePct,
      totalAmount: toNumber_(col(row, '전체계약금액'))
    });
  }

  Logger.log('불러온 실적 건수: ' + records.length);
  return JSON.parse(JSON.stringify(records));
}

// ─────────────────────────────────────────────────────────────
// 인력현황 데이터
// ─────────────────────────────────────────────────────────────

/**
 * 인력현황 스프레드시트의 3개 탭(재직(상근)/재직(비상근)/휴직)을 모두 읽어
 * 하나의 배열로 합친다. 각 레코드에는 어느 탭 출신인지 나타내는 status 필드가 붙는다.
 */
function getHRData() {
  var ss = SpreadsheetApp.openById(HR_SHEET_ID);
  var records = [];

  HR_STATUS_TABS.forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return;

    var col = headerReader_(values[0]);

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var name = col(row, '이름');
      if (!name) continue;

      var joinDateRaw = col(row, '인트윈 입사년월일');

      var career = String(col(row, '경력 기간(인트윈 입사 기준)') || '').trim();
      if (!career) career = calcCareerPeriod(joinDateRaw);

      records.push({
        status: tabName,
        dept: col(row, '부서'),
        name: name,
        position: col(row, '직위'),
        age: col(row, '만 나이'),
        gender: col(row, '성별'),
        birthDate: formatHRDate(col(row, '생년월일'), 'yyyy-MM-dd'),
        eduSchool: col(row, '최종학력 학교'),
        eduMajor: col(row, '최종학력 전공'),
        eduDegree: col(row, '최종학력 학위'),
        eduGradYm: formatHRDate(col(row, '최종학력 졸업년월'), 'yyyy-MM'),
        address: col(row, '집주소'),
        email: col(row, '이메일 주소'),
        phone: col(row, '전화번호'),
        joinDate: formatHRDate(joinDateRaw, 'yyyy-MM-dd'),
        career: career
      });
    }
  });

  Logger.log('불러온 인력 건수: ' + records.length);
  return JSON.parse(JSON.stringify(records));
}

// ─────────────────────────────────────────────────────────────
// 공용 유틸
// ─────────────────────────────────────────────────────────────

/**
 * 머리글 행에서 컬럼 이름 → 값 조회 함수를 만든다.
 * 공백/줄바꿈을 무시하고 비교하므로 "경력 기간\n(인트윈 입사 기준)" 같은
 * 여러 줄 머리글도 '경력 기간(인트윈 입사 기준)' 으로 찾힌다.
 */
function headerReader_(headerRow) {
  var idx = {};
  headerRow.forEach(function (h, i) {
    var k = String(h == null ? '' : h).replace(/\s+/g, '');
    if (k && idx[k] === undefined) idx[k] = i;
  });
  return function (row, name) {
    var k = String(name).replace(/\s+/g, '');
    return idx[k] !== undefined ? row[idx[k]] : '';
  };
}

/** "199,986,000 (99.993%)" 같은 텍스트에서도 숫자만 뽑아낸다 */
function toNumber_(v) {
  if (typeof v === 'number') return v;
  var m = String(v == null ? '' : v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Date 객체면 지정한 패턴 문자열로, 아니면 원본 텍스트를 그대로 반환 */
function formatHRDate(value, pattern) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), pattern);
  }
  return value ? String(value).trim() : '';
}

/** 문자열/Date 어느 쪽이든 파싱해서 Date 객체로 (실패 시 null) */
function parseHRDate(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  if (!value) return null;
  var m = String(value).trim()
    .match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]?\s*(\d{1,2})?/);
  if (!m) return null;
  var dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, m[3] ? parseInt(m[3], 10) : 1);
  return isNaN(dt.getTime()) ? null : dt;
}

/** 입사년월일부터 오늘까지의 경력을 "n년 m개월" 형식으로 계산 */
function calcCareerPeriod(joinDateRaw) {
  var joinDate = parseHRDate(joinDateRaw);
  if (!joinDate) return '';

  var today = new Date();
  var months = (today.getFullYear() - joinDate.getFullYear()) * 12 +
               (today.getMonth() - joinDate.getMonth());
  if (today.getDate() < joinDate.getDate()) months -= 1;
  if (months < 0) months = 0;

  var years = Math.floor(months / 12);
  var rem = months % 12;
  if (years === 0) return rem + '개월';
  if (rem === 0) return years + '년';
  return years + '년 ' + rem + '개월';
}

// ─────────────────────────────────────────────────────────────
// 파싱 점검용 (메뉴 [대시보드] 에서 호출)
//
// 캐시를 비우거나 새로고침하는 기능이 아닙니다. 위 두 로더는 호출될 때마다
// 시트를 새로 읽으므로, 시트를 고치면 웹 페이지 새로고침만으로 반영됩니다.
// 이 함수들은 '컬럼이 제대로 매칭됐는지'를 눈으로 확인하는 용도입니다.
// ─────────────────────────────────────────────────────────────

function debugPerformanceData() {
  var rows = getPerformanceData();
  var sample = rows.length ? JSON.stringify(rows[0], null, 1) : '(데이터 없음)';
  SpreadsheetApp.getUi().alert('실적 ' + rows.length + '건\n\n첫 행 샘플:\n' + sample);
}

function debugHRData() {
  var rows = getHRData();
  var byStatus = {};
  rows.forEach(function (r) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  var lines = Object.keys(byStatus).map(function (k) { return '  ' + k + ': ' + byStatus[k] + '명'; });
  var sample = rows.length ? JSON.stringify(rows[0], null, 1) : '(데이터 없음)';
  SpreadsheetApp.getUi().alert(
    '인력 ' + rows.length + '명\n' + lines.join('\n') + '\n\n첫 행 샘플:\n' + sample);
}

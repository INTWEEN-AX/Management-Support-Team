/**
 * Leave.gs — 보상휴가 원장
 *
 * 정본은 다우오피스다. 결재도 거기서 하고 노동법상 기록도 거기다.
 * 여기는 '지금 며칠 남았고 언제 소멸되는지' 를 한눈에 보기 위한 사본이다.
 * 그래서 이 시스템은 차감을 결정하지 않는다 — 다우오피스에서 일어난 일을
 * 그대로 옮겨 적고 잔여를 다시 셀 뿐이다.
 *
 * 인트윈은 다우오피스 클라우드 스탠다드라 OpenAPI 를 쓸 수 없다
 * (OpenAPI 는 설치형·단독형·구축형 전용). 그래서 당장은 사람이 옮겨
 * 적거나 엑셀을 붙여넣고, 나중에 결재 완료 알림 메일을 파싱해 자동화한다.
 * 어느 쪽이든 아래 원장 형식은 같다.
 */

var LEAVE_SHEET_NAME = '보상휴가';

/** 원장 열 이름 — 시트에서 이 이름으로 찾는다 (열 순서가 바뀌어도 된다) */
var LEAVE_HEADERS = [
  '이름', '부서', '구분', '일자', '시간', '사유', '유효기한', '출처', '비고'
];

/**
 * 기본 규정값. 회사 규정이 다르면 스크립트 속성으로 덮어쓴다.
 *   LEAVE_MULTIPLIER  연장근로 1시간당 몇 시간의 휴가가 생기는가
 *   LEAVE_VALID_MONTHS 발생일로부터 몇 개월 안에 써야 하는가
 *   LEAVE_HOURS_PER_DAY 하루를 몇 시간으로 볼 것인가
 *
 * ⚠ 1.5 는 근로기준법상 연장·야간·휴일근로 가산(50%)을 반영한 값이다.
 *   인트윈 규정을 아직 확인하지 못했으므로 반드시 대조해야 한다.
 */
var LEAVE_DEFAULTS = { multiplier: 1.5, validMonths: 6, hoursPerDay: 8 };

function leaveConfig_() {
  var p = PropertiesService.getScriptProperties();
  var num = function (key, dflt) {
    var v = parseFloat(p.getProperty(key));
    return isNaN(v) ? dflt : v;
  };
  return {
    multiplier: num('LEAVE_MULTIPLIER', LEAVE_DEFAULTS.multiplier),
    validMonths: num('LEAVE_VALID_MONTHS', LEAVE_DEFAULTS.validMonths),
    hoursPerDay: num('LEAVE_HOURS_PER_DAY', LEAVE_DEFAULTS.hoursPerDay),
    fromDefaults: !p.getProperty('LEAVE_MULTIPLIER')
  };
}

// ── 시트 ──

function leaveSheet_() {
  var ss = SpreadsheetApp.openById(HR_SHEET_ID);
  return ss.getSheetByName(LEAVE_SHEET_NAME);
}

/** 원장 시트를 만든다 (메뉴에서 한 번만) */
function setupLeaveSheet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(HR_SHEET_ID);
  if (ss.getSheetByName(LEAVE_SHEET_NAME)) {
    ui.alert('보상휴가', '"' + LEAVE_SHEET_NAME + '" 시트가 이미 있습니다.', ui.ButtonSet.OK);
    return;
  }
  var sh = ss.insertSheet(LEAVE_SHEET_NAME);
  sh.getRange(1, 1, 1, LEAVE_HEADERS.length).setValues([LEAVE_HEADERS])
    .setFontWeight('bold').setBackground('#EFF5F2');
  sh.setFrozenRows(1);
  sh.getRange(2, 1, 2, LEAVE_HEADERS.length).setValues([
    ['홍길동', '사업1팀', '발생', '2026-03-14', 6, '3/14 연장근로 4시간 × 1.5', '', '다우오피스', ''],
    ['홍길동', '사업1팀', '사용', '2026-04-02', 8, '보상휴가 1일', '', '다우오피스', '']
  ]);
  sh.getRange('D2:D').setNumberFormat('yyyy-mm-dd');
  sh.getRange('G2:G').setNumberFormat('yyyy-mm-dd');
  sh.autoResizeColumns(1, LEAVE_HEADERS.length);

  ui.alert('보상휴가',
    '"' + LEAVE_SHEET_NAME + '" 시트를 만들었습니다. 예시 2줄은 지우고 쓰세요.\n\n' +
    '· 구분: 발생 / 사용\n' +
    '· 시간: 시간 단위 (1일 = ' + leaveConfig_().hoursPerDay + '시간)\n' +
    '· 유효기한: 비워두면 발생일 + ' + leaveConfig_().validMonths + '개월로 자동 계산합니다',
    ui.ButtonSet.OK);
}

// ── 계산 ──

function leaveDate_(v) {
  if (v === '' || v == null) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var s = String(v).trim().replace(/[.\/]/g, '-');
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addMonths_(d, n) {
  var x = new Date(d.getTime());
  var day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  // 말일 보정 — 8/31 + 6개월이 3/3 이 되지 않게
  x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return x;
}

function ymd_(d) {
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

function daysBetween_(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * 원장을 읽어 사람별 잔여를 낸다.
 *
 * 소멸 처리는 먼저 생긴 것부터 쓰는 방식이다 (FIFO). 그래야 유효기한이
 * 임박한 것이 먼저 소진되어 실제로 버려지는 시간이 줄어든다.
 */
function getLeaveData() {
  var sheet = leaveSheet_();
  if (!sheet) return { ok: false, reason: '"' + LEAVE_SHEET_NAME + '" 시트가 없습니다. 메뉴에서 먼저 만들어주세요.' };

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, people: [], config: leaveConfig_(), asOf: ymd_(new Date()) };

  var header = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  header.forEach(function (h, i) { idx[h] = i; });
  var col = function (row, name) {
    return idx[name] === undefined ? '' : row[idx[name]];
  };

  var cfg = leaveConfig_();
  var today = leaveDate_(ymd_(new Date()));
  var byPerson = {};

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = String(col(row, '이름') || '').trim();
    if (!name) continue;
    var kind = String(col(row, '구분') || '').trim();
    var date = leaveDate_(col(row, '일자'));
    var hours = parseFloat(col(row, '시간'));
    if (!date || isNaN(hours) || hours <= 0) continue;

    var p = byPerson[name] || (byPerson[name] = {
      name: name, dept: String(col(row, '부서') || '').trim(),
      grants: [], uses: [], rows: 0
    });
    p.rows++;
    if (!p.dept) p.dept = String(col(row, '부서') || '').trim();

    if (kind === '사용') {
      p.uses.push({ date: date, hours: hours, reason: String(col(row, '사유') || '') });
    } else if (kind === '발생') {
      var exp = leaveDate_(col(row, '유효기한')) || addMonths_(date, cfg.validMonths);
      p.grants.push({ date: date, hours: hours, left: hours, expiry: exp,
                      reason: String(col(row, '사유') || '') });
    }
  }

  var people = Object.keys(byPerson).map(function (name) {
    var p = byPerson[name];
    p.grants.sort(function (a, b) { return a.date - b.date; });
    p.uses.sort(function (a, b) { return a.date - b.date; });

    var over = 0;   // 남은 게 없는데 쓴 시간 — 원장이 틀렸다는 신호다
    p.uses.forEach(function (u) {
      var need = u.hours;
      for (var i = 0; i < p.grants.length && need > 0; i++) {
        var g = p.grants[i];
        if (g.left <= 0) continue;
        if (g.expiry < u.date) continue;          // 쓰는 시점에 이미 소멸한 것은 못 쓴다
        var take = Math.min(g.left, need);
        g.left -= take; need -= take;
      }
      if (need > 0) over += need;
    });

    var granted = 0, used = 0, expired = 0, left = 0, soon = 0, nextExpiry = null;
    p.grants.forEach(function (g) {
      granted += g.hours;
      if (g.left <= 0) return;
      if (g.expiry < today) { expired += g.left; return; }
      left += g.left;
      var d = daysBetween_(today, g.expiry);
      if (d <= 30) soon += g.left;
      if (!nextExpiry || g.expiry < nextExpiry) nextExpiry = g.expiry;
    });
    p.uses.forEach(function (u) { used += u.hours; });

    return {
      name: p.name, dept: p.dept, rows: p.rows,
      grantedHours: granted, usedHours: used,
      expiredHours: expired, leftHours: left,
      soonHours: soon, overHours: over,
      leftDays: Math.round(left / cfg.hoursPerDay * 10) / 10,
      nextExpiry: ymd_(nextExpiry),
      nextExpiryDays: nextExpiry ? daysBetween_(today, nextExpiry) : null
    };
  });

  people.sort(function (a, b) {
    if (b.soonHours !== a.soonHours) return b.soonHours - a.soonHours;   // 소멸 임박 먼저
    return b.leftHours - a.leftHours;
  });

  return {
    ok: true,
    asOf: ymd_(new Date()),
    config: cfg,
    people: people,
    totals: {
      people: people.length,
      leftHours: people.reduce(function (s, p) { return s + p.leftHours; }, 0),
      soonPeople: people.filter(function (p) { return p.soonHours > 0; }).length,
      expiredHours: people.reduce(function (s, p) { return s + p.expiredHours; }, 0),
      overPeople: people.filter(function (p) { return p.overHours > 0; }).length
    }
  };
}

/** 메뉴 — 원장이 제대로 읽히는지 본다 */
function debugLeaveData() {
  var ui = SpreadsheetApp.getUi();
  var d = getLeaveData();
  if (!d.ok) { ui.alert('보상휴가', d.reason, ui.ButtonSet.OK); return; }

  var out = [];
  out.push('기준일: ' + d.asOf);
  out.push('규정: 배수 ' + d.config.multiplier + '배 · 유효 ' + d.config.validMonths +
    '개월 · 1일 ' + d.config.hoursPerDay + '시간' +
    (d.config.fromDefaults ? '  ← 기본값. 회사 규정과 대조해주세요' : ''));
  out.push('');
  out.push('인원 ' + d.totals.people + '명 · 잔여 합계 ' + d.totals.leftHours + '시간');
  out.push('30일 내 소멸 예정: ' + d.totals.soonPeople + '명');
  if (d.totals.expiredHours) out.push('이미 소멸: ' + d.totals.expiredHours + '시간');
  if (d.totals.overPeople) out.push('발생보다 많이 쓴 사람: ' + d.totals.overPeople + '명 — 원장 확인 필요');
  out.push('');
  d.people.slice(0, 15).forEach(function (p) {
    out.push(p.name + ' (' + (p.dept || '-') + ') 잔여 ' + p.leftHours + '시간(' + p.leftDays + '일)' +
      (p.soonHours ? ' · ' + p.soonHours + '시간 ' + p.nextExpiryDays + '일 뒤 소멸' : '') +
      (p.overHours ? ' · 초과사용 ' + p.overHours + '시간' : ''));
  });
  if (d.people.length > 15) out.push('… 외 ' + (d.people.length - 15) + '명');

  ui.alert('보상휴가 원장 점검', out.join('\n'), ui.ButtonSet.OK);
}

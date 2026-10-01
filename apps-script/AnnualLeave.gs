/**
 * AnnualLeave.gs — 연차 소진 기한 알림 (담당자용)
 *
 * [왜 담당자에게만 보내는가]
 * '연차' 탭의 G열(현재 남은 연차)은 담당자가 다우오피스를 보고 손으로 적어 넣은 값이다.
 * 다우오피스 API 를 붙일 수 없어서, 알림이 나가는 시점에 그 숫자가 맞다는 보장이 없다.
 * 그래서 이 스크립트는 잔여 개수를 계산하지 않는다. "지금 확인할 때다" 를 담당자에게
 * 알려주는 데까지만 한다. 직원 본인에게 가는 독촉 메일은 담당자가 숫자를 갱신한 뒤에 붙인다.
 *
 * [시트 구조] '연차' 탭, 1행 머리글, 2행부터 사람
 *   A 이름 / B 입사일 / C 현재 연차 기간 / D 변경 연차 기간 / E 근속년수
 *   F 연차 개수 / G 현재 남은 연차 / H 조정 필요 / I 맞춰줄 연차 / J 비고
 *   ※ 아래쪽 '1년차 미만 사용 월차' 블록은 열 구조가 달라서 읽지 않는다.
 *
 * [알림 시점]
 *   소진 기한 = D열 '변경 연차 기간' 의 끝 날짜 (예: '현재부터 ~ 2027.05.01.' → 2027-05-01)
 *   기한 6개월 전 / 3개월 전 시점의 LEAVE_NOTICE_LEAD_DAYS 일 전에 한 번씩 보낸다.
 *   같은 사람의 같은 마일스톤은 한 번만 — 스크립트 속성에 기록을 남긴다.
 */

var LEAVE_TAB_NAME = '연차';

/** 위쪽 표의 마지막 행. 아래 월차 블록을 읽지 않으려고 명시한다 */
var LEAVE_LAST_ROW = 7;

/** 알림 받을 담당자. 여러 명이면 쉼표로 구분 */
var LEAVE_NOTICE_TO = 'junsulim@intw.co.kr,seongmin@intw.co.kr,tommy@intw.co.kr';

/** 기한 몇 개월 전을 마일스톤으로 볼 것인가 */
var LEAVE_NOTICE_MONTHS = [6, 3];

/** 마일스톤 며칠 전에 알릴 것인가 */
var LEAVE_NOTICE_LEAD_DAYS = 3;

/** 발송 기록 키 접두사 — 생일메일의 'sent_' 와 섞이지 않게 따로 쓴다 */
var LEAVE_NOTICE_PREFIX = 'leave_notice_';

// ─────────────────────────────────────────────────────────────
// 발송
// ─────────────────────────────────────────────────────────────

/** 트리거가 매일 부르는 함수 */
function sendAnnualLeaveNotices() {
  runAnnualLeaveNotice_(false);
}

/**
 * @param {boolean} dryRun            true 면 보내지 않고 대상만 돌려준다
 * @param {boolean=} ignoreSchedule   true 면 날짜/발송기록을 무시하고 전원을 대상으로 본다 (점검용)
 * @return {Array} 대상 목록
 */
function runAnnualLeaveNotice_(dryRun, ignoreSchedule) {
  var rows = readAnnualLeaveRows_();
  var tz = Session.getScriptTimeZone();
  var today = startOfDay_(new Date());
  var props = PropertiesService.getScriptProperties();

  var targets = [];

  rows.forEach(function (r) {
    LEAVE_NOTICE_MONTHS.forEach(function (months) {
      var milestone = annualAddMonths_(r.deadline, -months);
      var noticeDay = addDays_(milestone, -LEAVE_NOTICE_LEAD_DAYS);
      var key = LEAVE_NOTICE_PREFIX + r.name + '_' +
                Utilities.formatDate(milestone, tz, 'yyyyMMdd');

      if (!ignoreSchedule) {
        // 딱 그날에만 보낸다. 이미 지나간 시점은 보내지 않는다 —
        // 뒤늦은 알림이 한꺼번에 몰리면 읽는 쪽에서 오히려 걸러내기 어렵다.
        if (startOfDay_(noticeDay).getTime() !== today.getTime()) return;
        if (props.getProperty(key) === '1') {
          Logger.log('이미 알림함: ' + r.name + ' / ' + months + '개월 전');
          return;
        }
      }

      targets.push({
        name: r.name,
        months: months,
        deadline: r.deadline,
        milestone: milestone,
        remainInSheet: r.remain,
        granted: r.granted,
        key: key
      });
    });
  });

  // 점검용(ignoreSchedule)에서도 묶어준다 — 테스트 메일이 실제와 다른 모양이면 볼 이유가 없다
  targets = collapsePerPerson_(targets);

  if (!targets.length) {
    Logger.log('오늘 연차 알림 대상 없음');
    return targets;
  }

  if (!dryRun) {
    var body = buildAnnualLeaveMail_(targets, tz);
    MailApp.sendEmail(LEAVE_NOTICE_TO, '[연차] 소진 기한 확인이 필요한 ' + targets.length + '명', body, {
      name: SENDER_NAME
    });
    targets.forEach(function (t) {
      props.setProperty(t.key, '1');
      (t.skipKeys || []).forEach(function (k) { props.setProperty(k, '1'); });
    });
    Logger.log('연차 알림 발송: ' + LEAVE_NOTICE_TO + ' / ' + targets.length + '명');
  }

  return targets;
}

/**
 * 한 사람에게 여러 마일스톤이 한꺼번에 걸리면(=도입 전에 이미 지나간 경우)
 * 가장 급한 것 하나만 남긴다. 기한이 19일 남은 사람에게 '6개월 전입니다' 를
 * 같이 보내면 읽는 사람만 헷갈린다.
 * 남은 것들은 skipKeys 에 담아, 보낼 때 '이미 알림함' 으로 같이 기록한다.
 */
function collapsePerPerson_(targets) {
  var best = {};
  targets.forEach(function (t) {
    var cur = best[t.name];
    if (!cur || t.months < cur.months) best[t.name] = t;
  });

  var out = [];
  Object.keys(best).forEach(function (name) { out.push(best[name]); });

  out.forEach(function (t) {
    t.skipKeys = targets.filter(function (o) {
      return o.name === t.name && o.key !== t.key;
    }).map(function (o) { return o.key; });
  });

  return out;
}

/** 담당자에게 보낼 본문. 잔여 개수는 '시트에 적힌 값' 이라고 분명히 밝힌다 */
function buildAnnualLeaveMail_(targets, tz) {
  var today = startOfDay_(new Date());
  var lines = targets.map(function (t) {
    var dday = Math.round((startOfDay_(t.deadline) - today) / 86400000);
    var late = (startOfDay_(t.milestone) < today) ? ' ※ 이미 지난 시점입니다' : '';
    return '· ' + t.name + ' — 소진 기한 ' + fmtDate_(t.deadline, tz) +
           ' (D-' + dday + ')\n' +
           '    ' + t.months + '개월 전 시점: ' + fmtDate_(t.milestone, tz) + late + '\n' +
           '    연차 개수 ' + t.granted + ' / 시트에 적힌 남은 연차 ' + t.remainInSheet;
  });

  return '아래 직원의 연차 소진 기한이 다가옵니다.\n\n' +
         lines.join('\n\n') + '\n\n' +
         '다우오피스에서 실제 남은 연차를 확인한 뒤, 연차 시트의 "현재 남은 연차" 를 갱신해주세요.\n' +
         '위에 적힌 숫자는 시트에 현재 적혀 있는 값이라 실제와 다를 수 있습니다.\n\n' +
         'https://docs.google.com/spreadsheets/d/' + HR_SHEET_ID + '/edit\n';
}

// ─────────────────────────────────────────────────────────────
// 시트 읽기
// ─────────────────────────────────────────────────────────────

/** '연차' 탭 위쪽 표(2~LEAVE_LAST_ROW 행)를 읽는다 */
function readAnnualLeaveRows_() {
  var ss = SpreadsheetApp.openById(HR_SHEET_ID);
  var sheet = ss.getSheetByName(LEAVE_TAB_NAME);
  if (!sheet) {
    throw new Error('"' + LEAVE_TAB_NAME + '" 탭을 찾을 수 없습니다. 이 파일의 탭: ' +
      ss.getSheets().map(function (s) { return s.getName(); }).join(', '));
  }

  var values = sheet.getRange(1, 1, LEAVE_LAST_ROW, 10).getValues();
  var out = [];

  for (var i = 1; i < values.length; i++) {
    var name = String(values[i][0] || '').trim();
    if (!name) continue;

    var deadline = lastDateIn_(values[i][3]);   // D열 '변경 연차 기간'
    if (!deadline) {
      Logger.log('변경 연차 기간에서 날짜를 못 읽음: ' + name + ' (' + values[i][3] + ')');
      continue;
    }

    out.push({
      name: name,
      deadline: deadline,
      granted: values[i][5],
      remain: values[i][6]
    });
  }

  if (!out.length) {
    throw new Error('"' + LEAVE_TAB_NAME + '" 탭 2~' + LEAVE_LAST_ROW + '행에서 읽은 사람이 없습니다.');
  }
  return out;
}

/**
 * '현재부터 ~ 2027.05.01.' 처럼 글자가 섞인 칸에서 마지막 날짜를 꺼낸다.
 * 셀이 날짜 값이면 그대로 쓴다. 끝 점이 있든 없든, 구분자가 . - / 어느 쪽이든 읽는다.
 */
function lastDateIn_(cell) {
  if (cell instanceof Date) return startOfDay_(cell);

  var s = String(cell == null ? '' : cell);
  var re = /(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/g;
  var m, last = null;
  while ((m = re.exec(s)) !== null) {
    last = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return last;
}

// ─────────────────────────────────────────────────────────────
// 날짜 도우미
// ─────────────────────────────────────────────────────────────

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * 달을 더하거나 뺀다. 31일 → 짧은 달 같은 경우 말일로 맞춘다
 * (2027-05-31 의 3개월 전은 2027-02-28).
 */
function annualAddMonths_(d, n) {
  var y = d.getFullYear();
  var m = d.getMonth() + n;
  var day = d.getDate();
  var lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, lastDay));
}

function fmtDate_(d, tz) {
  return Utilities.formatDate(d, tz || Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ─────────────────────────────────────────────────────────────
// 메뉴에서 호출 (Menu.gs 의 [연차알림])
// ─────────────────────────────────────────────────────────────

/** 오늘 나갈 알림이 있는지 본다. 보내지 않는다 */
function showAnnualLeavePreview() {
  var ui = SpreadsheetApp.getUi();
  try {
    var targets = runAnnualLeaveNotice_(true);
    if (!targets.length) {
      ui.alert('연차 알림 미리보기', '오늘 알림 대상이 없습니다.\n(연차 탭은 정상적으로 읽혔습니다)', ui.ButtonSet.OK);
      return;
    }
    ui.alert('연차 알림 미리보기 — ' + targets.length + '건',
      buildAnnualLeaveMail_(targets, Session.getScriptTimeZone()), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('연차 알림 점검 실패', e.message, ui.ButtonSet.OK);
  }
}

/** 전원의 마일스톤 날짜를 한눈에 본다. 날짜 계산이 맞는지 확인할 때 쓴다 */
function showAnnualLeaveSchedule() {
  var ui = SpreadsheetApp.getUi();
  var tz = Session.getScriptTimeZone();
  try {
    var lines = readAnnualLeaveRows_().map(function (r) {
      var when = LEAVE_NOTICE_MONTHS.map(function (m) {
        var ms = annualAddMonths_(r.deadline, -m);
        return m + '개월 전 ' + fmtDate_(ms, tz) +
               ' (메일 ' + fmtDate_(addDays_(ms, -LEAVE_NOTICE_LEAD_DAYS), tz) + ')';
      }).join('\n    ');
      return '· ' + r.name + ' — 기한 ' + fmtDate_(r.deadline, tz) + '\n    ' + when;
    });
    ui.alert('연차 알림 일정', lines.join('\n\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('연차 탭 읽기 실패', e.message, ui.ButtonSet.OK);
  }
}

/** [테스트] 날짜와 발송 기록을 무시하고, 전원 기준으로 지금 한 통 보낸다 */
function sendAnnualLeaveTestMail() {
  var ui = SpreadsheetApp.getUi();
  try {
    var targets = runAnnualLeaveNotice_(true, true);
    var r = ui.alert('테스트 발송',
      LEAVE_NOTICE_TO + ' 로 지금 한 통 보냅니다.\n' +
      '날짜 조건을 무시하고 ' + targets.length + '건을 모두 담습니다.\n' +
      '발송 기록에는 남기지 않습니다.', ui.ButtonSet.OK_CANCEL);
    if (r !== ui.Button.OK) return;

    MailApp.sendEmail(LEAVE_NOTICE_TO, '[연차][테스트] 소진 기한 알림 미리보기',
      '※ 테스트 메일입니다. 날짜 조건을 무시하고 ' + targets.length + '명을 모두 담았습니다.\n' +
      '   실제 알림은 각자 시점이 됐을 때 해당하는 사람만 나갑니다.\n\n' +
      buildAnnualLeaveMail_(targets, Session.getScriptTimeZone()), { name: SENDER_NAME });
    ui.alert('완료', LEAVE_NOTICE_TO + ' 로 보냈습니다.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('테스트 발송 실패', e.message, ui.ButtonSet.OK);
  }
}

/** 매일 한 번 sendAnnualLeaveNotices 를 실행하는 트리거를 등록한다 */
function setupAnnualLeaveTrigger() {
  var ui = SpreadsheetApp.getUi();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAnnualLeaveNotices') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendAnnualLeaveNotices')
    .timeBased().atHour(SEND_HOUR).nearMinute(SEND_MINUTE).everyDays(1).create();

  ui.alert('완료', '매일 ' + SEND_HOUR + ':' + (SEND_MINUTE < 10 ? '0' : '') + SEND_MINUTE +
    ' 경 연차 알림을 점검합니다.', ui.ButtonSet.OK);
}

/**
 * Code.gs — 생일 축하 이메일 자동 발송 (HTML 템플릿 + CC + 발신주소 지정)
 *
 * [시트 컬럼 구조]
 * A열: 이름 / B열: 생년월일 / C열: 이메일 / D열: 비고 (건드리지 않음)
 * 1행은 머리글로 보고 건너뜁니다.
 *
 * [발송 규칙]
 * - 발신 주소: 이 스크립트를 실행(또는 트리거를 등록)한 구글 계정
 * - 항상 tommy@intw.co.kr, seongmin@intw.co.kr 를 CC로 넣되,
 *   생일 당사자 본인이 이 두 사람 중 하나면 그 사람은 CC에서 제외
 * - 발송 기록은 스크립트 속성(PropertiesService)에 'sent_<이메일>_<연도>' 로 저장
 *
 * ※ 이 스크립트는 원래 생일자 명단 스프레드시트에 단독으로 붙어 있었습니다.
 *   이 프로젝트로 합치면서 '활성 스프레드시트'가 달라졌기 때문에,
 *   명단 시트를 아래 BIRTHDAY_SHEET_ID 로 명시적으로 지정합니다.
 */

// ─────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────

/**
 * 생일자 명단 스프레드시트 ID.
 * 인력현황(Dashboard.gs 의 HR_SHEET_ID)과 같은 파일이지만, 탭이 다릅니다.
 * 나중에 명단만 다른 파일로 옮겨도 되도록 별도 상수로 둡니다.
 */
var BIRTHDAY_SHEET_ID = '1zeVLhzKPU_oTaBrxHf7gB0EJSt8RcY9PpMInj44JKo8';

/**
 * 명단 탭의 gid. URL 의 #gid=【이 숫자】
 * 탭 이름이 바뀌어도 gid 는 그대로라 이름보다 안전합니다.
 */
var BIRTHDAY_TAB_GID = 538640169;

/** gid 대신 탭 이름으로 찾고 싶을 때만 채우세요. 비워두면 gid 를 씁니다. */
var BIRTHDAY_TAB_NAME = '';

var SENDER_NAME = '인트윈 경영기획실';
var FIXED_CC_LIST = ['tommy@intw.co.kr', 'seongmin@intw.co.kr'];
var IMAGE_FILE_ID = '1GY2Rf1c0cjRd-S2niHZjK2KwGrvqSkUn';

/** 매일 발송 시각 (트리거는 지정 시각 기준 ±15분 오차가 있습니다) */
var SEND_HOUR = 9;
var SEND_MINUTE = 30;

/** 발송 기록 키 접두사 — 다른 기능의 스크립트 속성과 섞이지 않게 하는 구분자 */
var SENT_KEY_PREFIX = 'sent_';

// ─────────────────────────────────────────────────────────────
// 발송
// ─────────────────────────────────────────────────────────────

function sendBirthdayEmails() {
  runBirthday_(false);
}

/**
 * [점검용] 실제로 보내지 않고, 오늘 누구에게 발송될지만 로그로 보여줍니다.
 * 다른 시트에서 옮겨온 뒤 정상 동작하는지 확인할 때 먼저 이걸 실행하세요.
 */
function previewBirthdayToday() {
  runBirthday_(true);
}

/**
 * @param {boolean} dryRun  true 면 실제로 보내지 않는다
 * @param {string=} mmdd    'MM-dd'. 비우면 오늘 — 지난 생일자에게 뒤늦게 보낼 때만 넘긴다
 */
function runBirthday_(dryRun, mmdd) {
  var sheet = getBirthdaySheet_();
  var data = sheet.getDataRange().getValues();

  assertBirthdayColumns_(data, sheet);

  var tz = Session.getScriptTimeZone();
  var todayStr = mmdd || Utilities.formatDate(new Date(), tz, 'MM-dd');
  var currentYear = new Date().getFullYear();
  var props = PropertiesService.getScriptProperties();

  var rawTemplate = HtmlService.createHtmlOutputFromFile('birthday_template').getContent();
  var headerImageBlob = dryRun
    ? null
    : DriveApp.getFileById(IMAGE_FILE_ID).getBlob().setName('headerImage');

  var targets = [];

  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    var birthdayRaw = data[i][1];
    var email = data[i][2];

    if (!name || !birthdayRaw || !email) continue;

    var bDate = (birthdayRaw instanceof Date) ? birthdayRaw : new Date(birthdayRaw);
    if (isNaN(bDate.getTime())) {
      Logger.log('생년월일 형식을 읽을 수 없음: ' + name + ' (' + birthdayRaw + ')');
      continue;
    }

    if (Utilities.formatDate(bDate, tz, 'MM-dd') !== todayStr) continue;

    var propKey = SENT_KEY_PREFIX + email + '_' + currentYear;
    if (props.getProperty(propKey) === '1') {
      Logger.log('이미 발송함(올해): ' + name + ' (' + email + ')');
      continue;
    }

    // 생일 당사자가 CC 대상자 본인이면 그 사람만 CC에서 제외
    var ccList = FIXED_CC_LIST.filter(function (ccEmail) {
      return ccEmail.toLowerCase() !== String(email).toLowerCase();
    });

    targets.push({ name: name, email: email, cc: ccList, propKey: propKey });
  }

  if (!targets.length) {
    Logger.log('오늘(' + todayStr + ') 생일자 없음 — 발송 대상 0명');
    return targets;
  }

  targets.forEach(function (t) {
    if (dryRun) {
      Logger.log('[미리보기] ' + t.name + ' <' + t.email + '>, CC: ' + (t.cc.join(', ') || '없음'));
      return;
    }
    try {
      MailApp.sendEmail(t.email, '🎂 Happy Birthday, ' + t.name + '님!',
        t.name + '님, 생일을 진심으로 축하드립니다! (HTML 지원 클라이언트에서 보시면 더 예쁘게 보여요)', {
          htmlBody: rawTemplate.replace(/{{이름}}/g, t.name),
          name: SENDER_NAME,
          cc: t.cc.join(','),
          inlineImages: { headerImage: headerImageBlob }
        });
      props.setProperty(t.propKey, '1');
      Logger.log('발송 완료: ' + t.name + ' (' + t.email + '), CC: ' + (t.cc.join(', ') || '없음'));
    } catch (e) {
      Logger.log('발송 실패: ' + t.name + ' (' + t.email + ') - ' + e.message);
    }
  });

  return targets;
}

/**
 * 명단 시트를 가져온다.
 *
 * ⚠ 예전에는 SpreadsheetApp.getActiveSpreadsheet().getSheets()[0] 를 썼습니다.
 *   그때는 이 스크립트가 명단 시트에 단독으로 붙어 있고 탭도 하나뿐이라 맞았지만,
 *   지금 명단은 인력현황 스프레드시트의 여러 탭 중 하나입니다.
 *   그대로 뒀다면 '재직(상근)' 탭을 읽고 있었을 것입니다.
 */
function getBirthdaySheet_() {
  if (!BIRTHDAY_SHEET_ID) {
    throw new Error('Code.gs 상단의 BIRTHDAY_SHEET_ID 가 비어 있습니다.');
  }

  var ss = SpreadsheetApp.openById(BIRTHDAY_SHEET_ID);
  var sheet = null;

  if (BIRTHDAY_TAB_NAME) {
    sheet = ss.getSheetByName(BIRTHDAY_TAB_NAME);
    if (!sheet) throw new Error('명단 탭을 찾을 수 없습니다: ' + BIRTHDAY_TAB_NAME);
    return sheet;
  }

  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getSheetId() === BIRTHDAY_TAB_GID) return all[i];
  }

  throw new Error(
    'gid ' + BIRTHDAY_TAB_GID + ' 인 탭을 찾을 수 없습니다.\n' +
    '이 스프레드시트의 탭: ' + all.map(function (s) {
      return s.getName() + '(' + s.getSheetId() + ')';
    }).join(', '));
}

/**
 * A/B/C 열이 이름·생년월일·이메일이 맞는지 확인한다.
 * 엉뚱한 시트를 읽고 있으면 조용히 0명 발송으로 끝나 버리기 때문에,
 * 그런 상황에서는 아예 오류를 내서 알아차리게 한다.
 */
function assertBirthdayColumns_(data, sheet) {
  if (!data.length) {
    throw new Error('명단 시트가 비어 있습니다: ' + sheet.getName());
  }
  var head = data[0].slice(0, 3).map(function (h) {
    return String(h == null ? '' : h).replace(/\s+/g, '');
  });
  var ok = /이름|성명/.test(head[0]) &&
           /생년월일|생일/.test(head[1]) &&
           /이메일|메일|email/i.test(head[2]);

  if (!ok) {
    throw new Error(
      '명단 시트의 A·B·C 열이 예상과 다릅니다.\n' +
      '  기대: 이름 | 생년월일 | 이메일\n' +
      '  실제: ' + head.join(' | ') + '\n' +
      '  (시트: ' + sheet.getName() + ')\n' +
      'BIRTHDAY_SHEET_ID / BIRTHDAY_TAB_NAME 설정을 확인하세요.');
  }
}

// ─────────────────────────────────────────────────────────────
// 트리거
// ─────────────────────────────────────────────────────────────

/**
 * 매일 정해진 시각에 sendBirthdayEmails 를 실행하는 트리거를 등록한다.
 * 기존 트리거가 있으면 지우고 새로 만들므로 여러 번 실행해도 중복되지 않는다.
 *
 * ⚠ 트리거는 '코드'가 아니라 '프로젝트'에 붙습니다. 다른 프로젝트에서 옮겨왔다면
 *   옛 프로젝트의 트리거가 아직 살아 있을 수 있고, 그러면 메일이 두 번 갑니다.
 *   옛 프로젝트에서 트리거를 삭제했는지 반드시 확인하세요.
 */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendBirthdayEmails') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('sendBirthdayEmails')
    .timeBased()
    .atHour(SEND_HOUR)
    .nearMinute(SEND_MINUTE)
    .everyDays(1)
    .create();

  var msg = '트리거 등록 완료: 매일 ' + SEND_HOUR + ':' +
            (SEND_MINUTE < 10 ? '0' : '') + SEND_MINUTE + ' 경 sendBirthdayEmails 실행';
  Logger.log(msg);
  return msg;
}

/** 이 프로젝트에 등록된 트리거 목록을 확인한다. */
function listBirthdayTriggers() {
  var lines = ScriptApp.getProjectTriggers().map(function (t) {
    return '  · ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')';
  });
  var msg = lines.length
    ? '이 프로젝트의 트리거 ' + lines.length + '개\n' + lines.join('\n')
    : '이 프로젝트에 등록된 트리거가 없습니다.\nsetupDailyTrigger() 를 한 번 실행하세요.';
  Logger.log(msg);
  return msg;
}

// ─────────────────────────────────────────────────────────────
// 메뉴에서 호출 (Menu.gs 의 [생일메일])
// ─────────────────────────────────────────────────────────────

function showBirthdayPreview() {
  var ui = SpreadsheetApp.getUi();
  try {
    var targets = runBirthday_(true);
    if (!targets.length) {
      ui.alert('생일메일 미리보기', '오늘 발송 대상이 없습니다.\n(명단은 정상적으로 읽혔습니다)', ui.ButtonSet.OK);
      return;
    }
    var lines = targets.map(function (t) {
      return '· ' + t.name + ' <' + t.email + '>\n    CC: ' + (t.cc.join(', ') || '없음');
    });
    ui.alert('생일메일 미리보기 — ' + targets.length + '명',
      '실제로 발송하지 않았습니다.\n\n' + lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('생일메일 점검 실패', e.message, ui.ButtonSet.OK);
  }
}

/**
 * 지정한 날짜(MM-dd)가 생일인 사람에게 지금 바로 보낸다.
 * 트리거가 빠져서 못 보낸 날을 메울 때 쓴다. 올해 이미 보낸 사람은 건너뛴다.
 */
function sendBirthdayForDate() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('지난 생일자에게 발송',
    '생일 날짜를 MM-dd 형식으로 입력하세요 (예: 09-19)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var mmdd = res.getResponseText().trim();
  if (!/^\d{2}-\d{2}$/.test(mmdd)) {
    ui.alert('형식 오류', 'MM-dd 형식으로 입력하세요 (예: 09-19)', ui.ButtonSet.OK);
    return;
  }

  try {
    var targets = runBirthday_(true, mmdd);
    if (!targets.length) {
      ui.alert('발송 대상 없음', mmdd + ' 생일자가 없거나 올해 이미 발송했습니다.', ui.ButtonSet.OK);
      return;
    }
    var lines = targets.map(function (t) {
      return '· ' + t.name + ' <' + t.email + '>\n    CC: ' + (t.cc.join(', ') || '없음');
    });
    var ok = ui.alert(mmdd + ' 생일자 ' + targets.length + '명에게 지금 발송합니다',
      lines.join('\n'), ui.ButtonSet.OK_CANCEL);
    if (ok !== ui.Button.OK) return;

    runBirthday_(false, mmdd);
    ui.alert('완료', '발송했습니다. 결과는 실행 로그에서 확인할 수 있습니다.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('발송 실패', e.message, ui.ButtonSet.OK);
  }
}

function showBirthdayTriggers() {
  SpreadsheetApp.getUi().alert('생일메일 트리거', listBirthdayTriggers(), SpreadsheetApp.getUi().ButtonSet.OK);
}

function setupBirthdayTrigger() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('트리거 등록',
    '매일 ' + SEND_HOUR + ':' + (SEND_MINUTE < 10 ? '0' : '') + SEND_MINUTE +
    ' 경 자동 발송하도록 등록합니다.\n\n' +
    '⚠ 옛 프로젝트(생일자 명단 시트에 붙어 있던 스크립트)의 트리거를 먼저 지우셨나요?\n' +
    '남아 있으면 메일이 두 번 갑니다.', ui.ButtonSet.OK_CANCEL);
  if (r !== ui.Button.OK) return;
  ui.alert('완료', setupDailyTrigger(), ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────────
// 발송 기록 초기화 (테스트용)
// ─────────────────────────────────────────────────────────────

/**
 * [테스트용] 특정 이메일의 "올해 이미 보냈음" 기록을 지운다.
 * 아래 TEST_EMAIL 을 바꾼 뒤 이 함수만 실행하면 그 사람은 다시 발송 대상이 된다.
 */
function resetSentRecordFor() {
  var TEST_EMAIL = 'tommy@intw.co.kr'; // 여기를 초기화하고 싶은 이메일로 수정
  var propKey = SENT_KEY_PREFIX + TEST_EMAIL + '_' + new Date().getFullYear();
  PropertiesService.getScriptProperties().deleteProperty(propKey);
  Logger.log('초기화 완료: ' + TEST_EMAIL + ' → 다시 발송 가능 상태');
}

/**
 * [테스트용] 생일 발송 기록만 전부 지운다.
 *
 * ⚠ 예전에는 deleteAllProperties() 를 썼습니다. 이 스크립트가 단독 프로젝트일 때는
 *   문제가 없었지만, 지금은 스크립트 속성을 재직증명서 기능과 함께 씁니다.
 *   전체 삭제하면 재직증명서의 양식/폴더 설정까지 날아가므로,
 *   'sent_' 로 시작하는 키만 지웁니다.
 */
function resetAllSentRecords() {
  var props = PropertiesService.getScriptProperties();
  var removed = 0;
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf(SENT_KEY_PREFIX) === 0) { props.deleteProperty(k); removed++; }
  });
  Logger.log('생일 발송 기록 ' + removed + '건 삭제됨 (다른 설정은 유지)');
}

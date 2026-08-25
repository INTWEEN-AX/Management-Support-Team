/**
 * 생일 축하 이메일 자동 발송 스크립트 (HTML 템플릿 + CC + 발신주소 지정 버전)
 *
 * [시트 컬럼 구조]
 * A열: 이름 / B열: 생년월일 / C열: 이메일 / D열: 비고 (건드리지 않음)
 * 탭이 하나뿐이라고 가정하고 첫 번째 탭을 자동으로 사용한다.
 *
 * [발송 규칙]
 * - 발신 주소: 이 스크립트를 실행하는 구글 계정 그대로 (별도 지정 없음)
 * - 항상 tommy@intw.co.kr, seongmin@intw.co.kr 를 CC로 넣되,
 *   생일 당사자 본인이 이 두 사람 중 하나면 그 사람은 CC에서 제외
 * - 발송 기록은 스크립트 내부 저장소(PropertiesService)에 저장 → 시트 구조 변경 불필요
 *
 * [트리거 시간]
 * 매일 15:50 발송. 트리거 화면은 분 단위 설정이 안 되므로,
 * 아래 setupDailyTrigger() 함수를 "한 번" 실행해서 코드로 정확히 등록한다.
 */

const SENDER_NAME = "인트윈 경영기획실";
const FIXED_CC_LIST = ["tommy@intw.co.kr", "seongmin@intw.co.kr"];
const IMAGE_FILE_ID = "1GY2Rf1c0cjRd-S2niHZjK2KwGrvqSkUn"; // 예: 1AbCdEfGhIjKlmNoPQRstuVWxyz

function sendBirthdayEmails() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (!sheet) {
    Logger.log("시트를 찾을 수 없습니다.");
    return;
  }

  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(new Date(), tz, "MM-dd");
  const currentYear = new Date().getFullYear();
  const props = PropertiesService.getScriptProperties();

  const rawTemplate = HtmlService.createHtmlOutputFromFile('birthday_template').getContent();
  const headerImageBlob = DriveApp.getFileById(IMAGE_FILE_ID).getBlob().setName('headerImage');

  for (let i = 1; i < data.length; i++) {
    const name = data[i][0];
    const birthdayRaw = data[i][1];
    const email = data[i][2];

    if (!name || !birthdayRaw || !email) continue;

    const bDate = (birthdayRaw instanceof Date) ? birthdayRaw : new Date(birthdayRaw);
    if (isNaN(bDate.getTime())) {
      Logger.log(`생년월일 형식을 읽을 수 없음: ${name} (${birthdayRaw})`);
      continue;
    }

    const bStr = Utilities.formatDate(bDate, tz, "MM-dd");
    const isBirthdayToday = bStr === todayStr;

    const propKey = `sent_${email}_${currentYear}`;
    const alreadySent = props.getProperty(propKey) === "1";

    if (isBirthdayToday && !alreadySent) {
      const subject = `🎂 Happy Birthday, ${name}님!`;
      const htmlBody = rawTemplate.replace(/{{이름}}/g, name);
      const plainFallback = `${name}님, 생일을 진심으로 축하드립니다! (이 메일은 HTML 지원 클라이언트에서 보시면 더 예쁘게 보여요)`;

      // 생일 당사자가 CC 대상자 본인이면 그 사람만 CC에서 제외
      const ccList = FIXED_CC_LIST.filter(
        (ccEmail) => ccEmail.toLowerCase() !== String(email).toLowerCase()
      );

      try {
        MailApp.sendEmail(email, subject, plainFallback, {
          htmlBody: htmlBody,
          name: SENDER_NAME,
          cc: ccList.join(","),
          inlineImages: { headerImage: headerImageBlob }
        });
        props.setProperty(propKey, "1");
        Logger.log(`발송 완료: ${name} (${email}), CC: ${ccList.join(", ") || "없음"}`);
      } catch (e) {
        Logger.log(`발송 실패: ${name} (${email}) - ${e.message}`);
      }
    }
  }
}

/**
 * 트리거 등록용 함수. 이 함수는 딱 한 번만 실행하면 됨.
 * 기존에 sendBirthdayEmails 관련 트리거가 있으면 먼저 삭제한 뒤,
 * 매일 15:50 근처에 실행되는 트리거를 새로 만든다.
 * (Apps Script 시간 기반 트리거는 초 단위 정확도는 아니고, 지정 시각 기준 몇 분 내 오차가 있을 수 있음)
 */
function setupDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((t) => {
    if (t.getHandlerFunction() === "sendBirthdayEmails") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("sendBirthdayEmails")
    .timeBased()
    .atHour(09)
    .nearMinute(47)
    .everyDays(1)
    .create();

  Logger.log("트리거 등록 완료: 매일 09:50경 sendBirthdayEmails 실행");
}

/**
 * [테스트용] 특정 이메일의 "올해 이미 보냈음" 기록을 지운다.
 * 아래 TEST_EMAIL 값을 지우고 싶은 사람 이메일로 바꾼 뒤 이 함수만 실행하면,
 * 그 사람은 다시 "미발송" 상태가 되어 sendBirthdayEmails 실행 시 재발송된다.
 */
function resetSentRecordFor() {
  const TEST_EMAIL = "tommy@intw.co.kr"; // 여기를 초기화하고 싶은 이메일로 수정
  const currentYear = new Date().getFullYear();
  const propKey = `sent_${TEST_EMAIL}_${currentYear}`;
  PropertiesService.getScriptProperties().deleteProperty(propKey);
  Logger.log(`초기화 완료: ${TEST_EMAIL} → 다시 발송 가능 상태`);
}

/**
 * [테스트용] 모든 "이미 보냈음" 기록을 한꺼번에 지운다.
 * 여러 명을 한 번에 재테스트하고 싶을 때 사용. 운영 중에는 신중하게 사용할 것
 * (실행 즉시 다음 자동/수동 실행 때 올해 생일 지난 사람 전원이 재발송 대상이 됨).
 */
function resetAllSentRecords() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log("전체 초기화 완료: 모든 발송 기록 삭제됨");
}
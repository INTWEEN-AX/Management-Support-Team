/**
 * Menu.gs — 스프레드시트 상단 메뉴 등록
 *
 * ⚠ onOpen 은 프로젝트 전체에서 딱 한 번만 정의해야 합니다.
 *    Certificate.gs / Dashboard.gs 에는 onOpen 을 두지 마세요.
 *    (여러 개 있으면 마지막에 로드된 것 하나만 동작합니다)
 *
 * 최상위 메뉴는 3개로 묶어둡니다. 10개까지 늘었더니 구글 시트가 뒤쪽
 * 메뉴를 '»' 안으로 접어버려서 '생일메일' 이 아예 안 보였습니다.
 *
 * 자주 쓰는 동작은 최상위에 그대로 두고, 설정·진단처럼 가끔 쓰는 것만
 * 하위 메뉴로 넣었습니다. 기능을 추가할 때는 성격에 맞는 하위 메뉴에
 * 한 줄 늘리세요 — 최상위를 늘리면 같은 문제가 다시 생깁니다.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();

  // ── 입찰 ──────────────────────────────────────────────
  ui.createMenu('입찰')
    .addItem('지금 공고 수집', 'collectBidsManual')
    .addItem('공고 첨부파일 받기', 'fetchBidAttachments')
    .addItem('입찰서류 유효기간 점검', 'debugDocumentData')
    .addSeparator()
    .addSubMenu(ui.createMenu('회사정보')
      .addItem('회사정보 시트 만들기', 'setupCompanySheet')
      .addItem('보유 서류에서 가져오기', 'importCompanyFromDocuments')
      .addItem('회사정보 확인', 'checkCompanyInfo'))
    .addSubMenu(ui.createMenu('제안서 PPT')
      .addItem('OpenAI 연결 확인', 'checkOpenAI')
      .addSeparator()
      .addItem('템플릿 등록 (pptx)', 'setupPptTemplate')
      .addItem('템플릿 진단', 'diagnosePptTemplate')
      .addItem('실적 반영 PPT 생성', 'generatePerfPpt'))
    .addSubMenu(ui.createMenu('설정')
      .addItem('인증키 / 키워드', 'showBidSettings')
      .addItem('현재 설정 확인', 'checkBidSettings')
      .addSeparator()
      .addItem('트리거 확인', 'showBidTriggers')
      .addItem('트리거 등록 / 재등록', 'setupBidTrigger'))
    .addSubMenu(ui.createMenu('진단')
      .addItem('API 연결 테스트', 'testBidApi')
      .addItem('수집 데이터 파싱 점검', 'debugBidData')
      .addItem('마감일시 필드 진단', 'debugBidRaw')
      .addSeparator()
      .addItem('실적 매칭 시험', 'testBidMatching')
      .addItem('공고문 본문 추출 시험', 'testBidBrief')
      .addItem('hwpx 서식 구조 분석', 'analyzeHwpxForm'))
    .addToUi();

  // ── 인사·총무 ─────────────────────────────────────────
  ui.createMenu('인사·총무')
    .addItem('재직증명서 발급 (선택한 행)', 'issueSelected')
    .addSeparator()
    .addSubMenu(ui.createMenu('생일메일')
      .addItem('오늘 발송 대상 미리보기 (실제 발송 안 함)', 'showBirthdayPreview')
      .addItem('지난 생일자에게 발송 (날짜 지정)', 'sendBirthdayForDate')
      .addSeparator()
      .addItem('트리거 확인', 'showBirthdayTriggers')
      .addItem('트리거 등록 / 재등록', 'setupBirthdayTrigger'))
    .addSubMenu(ui.createMenu('연차알림')
      .addItem('오늘 알림 대상 미리보기 (실제 발송 안 함)', 'showAnnualLeavePreview')
      .addItem('전원 알림 일정 보기', 'showAnnualLeaveSchedule')
      .addSeparator()
      .addItem('테스트 메일 보내기 (담당자에게)', 'sendAnnualLeaveTestMail')
      .addItem('트리거 등록 / 재등록', 'setupAnnualLeaveTrigger'))
    .addSubMenu(ui.createMenu('보상휴가')
      .addItem('원장 시트 만들기', 'setupLeaveSheet')
      .addItem('원장 점검', 'debugLeaveData'))
    .addSubMenu(ui.createMenu('법인카드')
      .addItem('지출 시트 만들기', 'setupExpenseSheet')
      .addItem('영수증 인식 비교 (OCR vs AI)', 'compareReceiptMethods'))
    .addSubMenu(ui.createMenu('재직증명서 설정')
      .addItem('양식 / 폴더 지정', 'showSettings')
      .addItem('현재 설정 확인', 'checkSettings')
      .addItem('컬럼 인식 진단', 'diagnoseColumns'))
    .addToUi();

  // ── 점검 ──────────────────────────────────────────────
  // 웹앱은 캐시 없이 매번 시트를 새로 읽습니다. 시트를 고쳤으면 웹 페이지를
  // 새로고침(F5)하는 것만으로 반영되므로, 아래는 '새로고침' 이 아니라
  // 값이 제대로 읽히는지 보는 파싱 점검용입니다.
  ui.createMenu('점검')
    .addItem('실적 데이터 파싱 점검', 'debugPerformanceData')
    .addItem('인력현황 데이터 파싱 점검', 'debugHRData')
    .addSeparator()
    .addItem('누가 들어올 수 있나 점검', 'checkAccessList')
    .addToUi();
}

/** HTML 템플릿에서 다른 파일을 끼워 넣을 때 사용 (Index.html 등) */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

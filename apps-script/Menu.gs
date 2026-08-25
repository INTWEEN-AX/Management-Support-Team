/**
 * Menu.gs — 스프레드시트 상단 메뉴 등록
 *
 * ⚠ onOpen 은 프로젝트 전체에서 딱 한 번만 정의해야 합니다.
 *    Certificate.gs / Dashboard.gs 에는 onOpen 을 두지 마세요.
 *    (여러 개 있으면 마지막에 로드된 것 하나만 동작합니다)
 *
 * 기능을 추가할 때는 여기에 메뉴 항목만 한 줄 늘리면 됩니다.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu('재직증명서')
    .addItem('선택한 행 발급', 'issueSelected')
    .addSeparator()
    .addItem('설정 (양식/폴더 지정)', 'showSettings')
    .addItem('현재 설정 확인', 'checkSettings')
    .addItem('컬럼 인식 진단', 'diagnoseColumns')
    .addToUi();

  // 아래 두 항목은 '새로고침'이 아니라 파싱 점검용입니다.
  // 웹앱은 캐시 없이 매번 시트를 새로 읽으므로, 시트를 고치면
  // 웹 페이지를 새로고침(F5)하는 것만으로 반영됩니다.
  ui.createMenu('대시보드')
    .addItem('실적 데이터 파싱 점검', 'debugPerformanceData')
    .addItem('인력현황 데이터 파싱 점검', 'debugHRData')
    .addToUi();

  ui.createMenu('생일메일')
    .addItem('오늘 발송 대상 미리보기 (실제 발송 안 함)', 'showBirthdayPreview')
    .addSeparator()
    .addItem('트리거 확인', 'showBirthdayTriggers')
    .addItem('트리거 등록/재등록', 'setupBirthdayTrigger')
    .addToUi();
}

/** HTML 템플릿에서 다른 파일을 끼워 넣을 때 사용 (Index.html 등) */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

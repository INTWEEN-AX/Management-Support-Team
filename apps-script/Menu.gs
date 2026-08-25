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

  ui.createMenu('대시보드')
    .addItem('실적 데이터 새로고침 확인', 'debugPerformanceData')
    .addItem('인력현황 데이터 새로고침 확인', 'debugHRData')
    .addToUi();
}

/** HTML 템플릿에서 다른 파일을 끼워 넣을 때 사용 (Index.html 등) */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

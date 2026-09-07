/**
 * Expense.gs — 법인카드 영수증
 *
 * 카드 결제 내역 자체는 어차피 카드사에서 온다(월말 CSV든 뭐든).
 * 사람만 아는 건 "이 결제가 뭐였는지" 다 — 어느 사업 비용인지, 누구와
 * 썼는지. 그게 안 적혀서 월말에 내역 보며 되짚는 게 시간을 잡아먹는다.
 * 그래서 결제 직후에 찍고 용도 한 줄 적는 데 초점을 맞춘다.
 *
 * 읽은 값은 반드시 사람이 확인한 뒤 저장한다. 금액을 잘못 읽으면
 * 회계 사고이므로 자동 저장하지 않는다.
 *
 * 영수증 이미지는 증빙 원본이라 드라이브에 남긴다. 글자만 뽑고 버리면
 * 나중에 소명할 수가 없다.
 */

var EXPENSE_SS_PROP = 'EXPENSE_SHEET_ID';
var EXPENSE_FOLDER_PROP = 'EXPENSE_FOLDER_ID';
var EXPENSE_TAB = '지출';

var EXPENSE_HEADERS = [
  '등록일시', '사용일자', '상호', '금액', '결제수단',
  '사업명', '사유·참석자', '계정과목', '등록자', '영수증', '비고'
];

// 브라우저에서 1400px 로 줄여 보낸다. 그래도 큰 건 막는다
var RECEIPT_MAX_BYTES = 4 * 1024 * 1024;

// ── 시트 / 폴더 ──

function setupExpenseSheet() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var existing = props.getProperty(EXPENSE_SS_PROP);
  if (existing) {
    try {
      var ss0 = SpreadsheetApp.openById(existing);
      ui.alert('법인카드 지출',
        '이미 만들어져 있습니다.\n\n' + ss0.getName() + '\n' + ss0.getUrl(),
        ui.ButtonSet.OK);
      return;
    } catch (e) { /* 지워졌으면 새로 만든다 */ }
  }

  var ss = SpreadsheetApp.create('인트윈 법인카드 지출 (임시)');
  var sh = ss.getSheets()[0].setName(EXPENSE_TAB);
  sh.getRange(1, 1, 1, EXPENSE_HEADERS.length).setValues([EXPENSE_HEADERS])
    .setFontWeight('bold').setBackground('#EFF5F2');
  sh.setFrozenRows(1);
  sh.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange('B2:B').setNumberFormat('yyyy-mm-dd');
  sh.getRange('D2:D').setNumberFormat('#,##0');
  sh.setColumnWidth(3, 180);
  sh.setColumnWidth(7, 260);

  var folder = DriveApp.createFolder('법인카드 영수증');

  props.setProperty(EXPENSE_SS_PROP, ss.getId());
  props.setProperty(EXPENSE_FOLDER_PROP, folder.getId());

  ui.alert('법인카드 지출',
    '만들었습니다.\n\n' +
    '시트: ' + ss.getUrl() + '\n\n' +
    '영수증 이미지 폴더: ' + folder.getUrl() + '\n\n' +
    '임시로 쓰는 새 시트입니다. 기존에 쓰시던 양식이 있으면 알려주세요 — ' +
    '컬럼을 그쪽에 맞추겠습니다.',
    ui.ButtonSet.OK);
}

function expenseSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(EXPENSE_SS_PROP);
  if (!id) throw new Error('지출 시트가 없습니다.\n메뉴 → 법인카드 → 지출 시트 만들기 를 먼저 실행해주세요.');
  var sh = SpreadsheetApp.openById(id).getSheetByName(EXPENSE_TAB);
  if (!sh) throw new Error('"' + EXPENSE_TAB + '" 탭을 찾을 수 없습니다.');
  return sh;
}

function expenseFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty(EXPENSE_FOLDER_PROP);
  return id ? DriveApp.getFolderById(id) : DriveApp.getRootFolder();
}

// ── 영수증 읽기 ──

var RECEIPT_PROMPT =
  '이 사진이 영수증(또는 카드 매출전표)인지 먼저 판단하고, 맞으면 값을 읽어라.\n' +
  '아래 JSON 으로만 답하라. 설명을 덧붙이지 마라.\n' +
  '{"isReceipt":true|false,"kind":"무엇이 찍혔는지 15자 이내",' +
  '"date":"YYYY-MM-DD","store":"상호","amount":숫자,"card":"카드 끝 4자리",' +
  '"items":"주요 품목 요약 40자 이내","confidence":"high|low"}\n' +
  '규칙:\n' +
  '- 영수증이 아니면 isReceipt 를 false 로 하고 kind 에 무엇인지 적어라 ' +
  '(예: 풍경 사진, 명함, 사람 얼굴, 화면 캡처). 나머지는 비워라.\n' +
  '- amount 는 총 결제금액(합계)이다. 부가세·공급가액·받은금액·거스름돈이 아니라 ' +
  '실제 결제한 금액이다.\n' +
  '- 숫자만 넣어라. 쉼표나 원 표시를 넣지 마라.\n' +
  '- 읽을 수 없는 항목은 빈 문자열, amount 는 0 으로 둬라. 추측해서 지어내지 마라.\n' +
  '- 흐릿하거나 일부만 보이면 confidence 를 low 로 하라.';

/**
 * 영수증 사진에서 값을 뽑는다. 저장하지 않는다 — 사람이 확인해야 한다.
 * @param {Object} payload { dataBase64, mimeType, name }
 */
function readReceipt(payload) {
  assertAccess_('영수증 읽기');

  var b64 = String((payload && payload.dataBase64) || '');
  if (!b64) throw new Error('사진이 비어 있습니다.');
  // base64 는 원본의 약 4/3 크기다
  if (b64.length * 3 / 4 > RECEIPT_MAX_BYTES) {
    throw new Error('사진이 너무 큽니다 (' + Math.round(b64.length * 3 / 4 / 1e6) + 'MB). 8MB 이하로 찍어주세요.');
  }
  var mime = String((payload && payload.mimeType) || 'image/jpeg');

  var res = callOpenAI_([{
    role: 'user',
    content: [
      { type: 'text', text: RECEIPT_PROMPT },
      { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } }
    ]
  }], { json: true, temperature: 0, maxTokens: 400 });

  var v;
  try {
    v = JSON.parse(res.text);
  } catch (e) {
    throw new Error('영수증을 읽지 못했습니다. 다시 찍어주세요.');
  }

  if (v.isReceipt === false) {
    throw new Error('영수증으로 보이지 않습니다' +
      (v.kind ? ' (' + v.kind + ')' : '') + '. 영수증을 다시 찍어주세요.');
  }

  return {
    date: String(v.date || ''),
    store: String(v.store || ''),
    amount: Number(v.amount) || 0,
    card: String(v.card || ''),
    items: String(v.items || ''),
    confidence: v.confidence === 'low' ? 'low' : 'high',
    cost: res.cost,
    tokens: res.usage.total
  };
}

// ── OCR 경로 (비교용) ──
//
// "AI 를 꼭 써야 하나, OCR 로는 안 되나" 는 의견이 아니라 재봐야 답이 나온다.
// 구글 드라이브 OCR 은 공짜다. 대신 글자만 나오므로 어느 숫자가 결제금액인지는
// 따로 골라야 하고, 영수증 양식이 가게마다 달라 규칙이 계속 늘어난다.
// 아래 둘을 같은 사진에 돌려 비교할 수 있게 해뒀다.

/** 드라이브 OCR 로 이미지에서 글자만 뽑는다. 임시 파일은 지운다 */
function imageToText_(blob) {
  var token = ScriptApp.getOAuthToken();
  var boundary = 'bd' + Utilities.getUuid().replace(/-/g, '');
  var metadata = {
    name: 'tmp_receipt_' + Utilities.getUuid(),
    mimeType: 'application/vnd.google-apps.document'
  };
  var head = Utilities.newBlob(
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + blob.getContentType() + '\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();

  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files' +
    '?uploadType=multipart&ocrLanguage=ko&supportsAllDrives=true',
    { method: 'post', contentType: 'multipart/related; boundary=' + boundary,
      payload: head.concat(blob.getBytes()).concat(tail),
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });

  if (res.getResponseCode() !== 200) {
    throw new Error('OCR 실패 HTTP ' + res.getResponseCode());
  }
  var docId = JSON.parse(res.getContentText()).id;
  try {
    return DocumentApp.openById(docId).getBody().getText();
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) { /* 무시 */ }
  }
}

/** OCR 로 뽑은 글자에서 규칙으로 값을 찾아본다 — 이게 어디까지 되는지 보려는 것 */
function parseReceiptText_(text) {
  var lines = String(text || '').split(/\r?\n/)
    .map(function (l) { return l.trim(); }).filter(Boolean);

  // 금액: '합계/총액/결제금액/승인금액' 이 있는 줄의 숫자를 먼저 본다.
  // 받은금액·거스름돈·부가세·공급가액은 결제금액이 아니므로 제외한다.
  var amount = 0;
  var GOOD = /(합\s*계|총\s*액|결제\s*금액|승인\s*금액|총\s*구매액|판매\s*금액)/;
  var BAD = /(받은|거스름|부가|공급가|면세|과세물품)/;
  lines.forEach(function (l) {
    if (!GOOD.test(l) || BAD.test(l)) return;
    var nums = l.replace(/[^0-9,]/g, ' ').split(/\s+/)
      .map(function (n) { return Number(n.replace(/,/g, '')); })
      .filter(function (n) { return n >= 100; });
    nums.forEach(function (n) { if (n > amount) amount = n; });
  });

  var m = String(text).match(/(20\d{2})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})/);
  var date = m ? [m[1], ('0' + m[2]).slice(-2), ('0' + m[3]).slice(-2)].join('-') : '';

  var card = '';
  var cm = String(text).match(/\d{4}[-*\s]+\*{2,}[-*\s]*\d{0,4}[-*\s]*(\d{4})/);
  if (cm) card = cm[1];

  return {
    date: date, amount: amount, card: card,
    store: lines.length ? lines[0] : '',    // 보통 맨 윗줄이 상호다
    lines: lines.length,
    chars: String(text || '').length
  };
}

/**
 * 같은 영수증에 두 방법을 다 돌려 결과를 나란히 본다.
 * 드라이브 '법인카드 영수증' 폴더의 가장 최근 이미지를 쓴다.
 */
function compareReceiptMethods() {
  var ui = SpreadsheetApp.getUi();
  var out = [];
  try {
    var files = expenseFolder_().getFiles();
    var newest = null;
    while (files.hasNext()) {
      var f = files.next();
      if (f.getMimeType().indexOf('image/') !== 0) continue;
      if (!newest || f.getDateCreated() > newest.getDateCreated()) newest = f;
    }
    if (!newest) {
      ui.alert('영수증 인식 비교',
        '드라이브 "법인카드 영수증" 폴더에 이미지가 없습니다.\n' +
        '포털에서 영수증을 한 장 등록한 뒤 다시 실행해주세요.', ui.ButtonSet.OK);
      return;
    }
    out.push('대상: ' + newest.getName());
    out.push('');

    var t0 = new Date().getTime();
    var text = imageToText_(newest.getBlob());
    var ocr = parseReceiptText_(text);
    var t1 = new Date().getTime();

    out.push('[구글 드라이브 OCR + 규칙]  ' + ((t1 - t0) / 1000).toFixed(1) + '초 · 비용 0원');
    out.push('  글자 ' + ocr.chars + '자 / ' + ocr.lines + '줄');
    out.push('  상호: ' + (ocr.store || '(못 찾음)'));
    out.push('  날짜: ' + (ocr.date || '(못 찾음)'));
    out.push('  금액: ' + (ocr.amount ? ocr.amount.toLocaleString() : '(못 찾음)'));
    out.push('  카드: ' + (ocr.card || '(못 찾음)'));
    out.push('');

    t0 = new Date().getTime();
    var ai = readReceipt({
      dataBase64: Utilities.base64Encode(newest.getBlob().getBytes()),
      mimeType: newest.getMimeType()
    });
    t1 = new Date().getTime();

    out.push('[비전 모델]  ' + ((t1 - t0) / 1000).toFixed(1) + '초 · 약 ' +
      (ai.cost == null ? '?' : Math.round(ai.cost * 1400) + '원'));
    out.push('  상호: ' + (ai.store || '(못 찾음)'));
    out.push('  날짜: ' + (ai.date || '(못 찾음)'));
    out.push('  금액: ' + (ai.amount ? ai.amount.toLocaleString() : '(못 찾음)'));
    out.push('  카드: ' + (ai.card || '(못 찾음)'));
    out.push('  신뢰도: ' + ai.confidence);
    out.push('');
    out.push('영수증 여러 장으로 돌려보고 정하세요. OCR 이 충분하면 비용이 0 입니다.');
  } catch (e) {
    out.push('');
    out.push('실패: ' + e.message);
  }
  ui.alert('영수증 인식 비교', out.join('\n'), ui.ButtonSet.OK);
}

// ── 저장 ──

/**
 * 확인을 마친 값을 시트에 적고 영수증 이미지를 드라이브에 남긴다.
 * @param {Object} payload { date, store, amount, card, project, purpose,
 *                           account, note, dataBase64, mimeType, name }
 */
function saveExpense(payload) {
  var who = assertAccess_('지출 등록');
  payload = payload || {};

  var amount = Number(payload.amount);
  if (!amount || amount <= 0) throw new Error('금액을 확인해주세요.');
  if (!payload.date) throw new Error('사용일자를 확인해주세요.');
  if (!String(payload.purpose || '').trim()) {
    throw new Error('사유·참석자를 적어주세요. 나중에 이걸 되짚는 데 시간이 가장 많이 듭니다.');
  }

  // 영수증 이미지 — 증빙 원본이라 반드시 남긴다
  var link = '';
  if (payload.dataBase64) {
    var mime = String(payload.mimeType || 'image/jpeg');
    var ext = mime.indexOf('png') > -1 ? 'png' : 'jpg';
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    var fname = [payload.date, String(payload.store || '영수증').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 30),
                 amount, stamp].join('_') + '.' + ext;
    var blob = Utilities.newBlob(Utilities.base64Decode(payload.dataBase64), mime, fname);
    var file = expenseFolder_().createFile(blob);
    link = file.getUrl();
  }

  var sheet = expenseSheet_();
  sheet.appendRow([
    new Date(),
    payload.date,
    String(payload.store || ''),
    amount,
    String(payload.card ? '법인카드 ' + payload.card : '법인카드'),
    String(payload.project || ''),
    String(payload.purpose || ''),
    String(payload.account || ''),
    who.email || '',
    link,
    String(payload.note || '')
  ]);

  return { ok: true, link: link };
}

/** 최근 등록분 — 방금 올린 게 제대로 들어갔는지 보여주기 위한 것 */
function getRecentExpenses(limit) {
  assertAccess_('지출 조회');
  var sheet = expenseSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var n = Math.min(limit || 15, last - 1);
  var rows = sheet.getRange(last - n + 1, 1, n, EXPENSE_HEADERS.length).getValues();
  var fmt = function (d) {
    return Object.prototype.toString.call(d) === '[object Date]'
      ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(d || '');
  };

  return rows.map(function (r) {
    return {
      at: fmt(r[0]), date: fmt(r[1]), store: String(r[2] || ''),
      amount: Number(r[3]) || 0, method: String(r[4] || ''),
      project: String(r[5] || ''), purpose: String(r[6] || ''),
      account: String(r[7] || ''), by: String(r[8] || ''), link: String(r[9] || '')
    };
  }).reverse();
}

/** 웹 화면이 시트 링크를 안내할 수 있게 */
function getExpenseInfo() {
  var id = PropertiesService.getScriptProperties().getProperty(EXPENSE_SS_PROP);
  if (!id) return { ok: false, reason: '지출 시트가 아직 없습니다. 관리자가 메뉴에서 만들어야 합니다.' };
  try {
    var ss = SpreadsheetApp.openById(id);
    return { ok: true, name: ss.getName(), url: ss.getUrl() };
  } catch (e) {
    return { ok: false, reason: '지출 시트를 열지 못했습니다: ' + e.message };
  }
}

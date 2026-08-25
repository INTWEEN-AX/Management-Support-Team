/**
 * Certificate.gs — 재직증명서 자동 발급
 *
 * 동작: 시트에서 행 선택 → 메뉴 [재직증명서] → 양식 hwpx의 텍스트만 치환 →
 *       드라이브에 저장 → 다운로드 링크 팝업
 *
 * 최초 1회: 메뉴 [재직증명서] > [설정] 에서 양식 파일 ID와 저장 폴더 ID를 넣으세요.
 *
 * ※ 메뉴 등록(onOpen)은 Menu.gs 에 있습니다. 이 파일에는 두지 마세요.
 */

// ─────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────

/** 성명을 "홍 길 동" 처럼 한 글자씩 띄울지 (양식 원본 스타일) */
var SPACE_NAME = true;

/** 표 캡션에 박힌 비즈폼 워터마크 텍스트 제거 */
var REMOVE_WATERMARK = true;

/** 시트 컬럼명 → 내부 키. 배열은 별칭(앞에서부터 먼저 찾히는 것 사용) */
var COLUMN_ALIASES = {
  name:      ['이름', '성명'],
  dept:      ['부서', '소속'],
  title:     ['직위', '직급'],
  birth:     ['생년월일', '생일'],
  gender:    ['성별'],
  rrn:       ['주민등록번호', '주민번호'],
  address:   ['집주소', '주소'],
  hireDate:  ['인트윈 입사년월일', '입사년월일', '입사일']
};

/** 양식 hwpx 안의 '원본 문자열' — 이 값을 기준으로 치환한다. 양식을 수정하면 여기도 고칠 것. */
var TPL = {
  name:     '김 신 우',
  rrn:      '961002-1******',
  address:  '서울특별시 마포구 성미산로26길 38 삼화빌 202호',
  dept:     '경영기획실',
  title:    '매니저',
  period:   '2026년 3월 16일 ~ 2026년 현재',
  sentence: '상기인은 2026년 3월 16일 당사에 입사하여 현재 재직중에 있음을 증명합니다.',
  issued:   '2026년 06월 18일',
  watermark:'문서서식포탈비즈폼'
};

var SECTION_PATH = 'Contents/section0.xml';
var PRVTEXT_PATH = 'Preview/PrvText.txt';

// ─────────────────────────────────────────────────────────────
// 설정 화면 (메뉴에서 호출)
// ─────────────────────────────────────────────────────────────

function showSettings() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var r1 = ui.prompt(
    '양식 파일 ID',
    '드라이브에 올린 "재직증명서_양식.hwpx"의 파일 ID를 붙여넣으세요.\n' +
    '(파일 공유 링크 .../file/d/[여기]/view 부분, 링크 전체를 붙여넣어도 됩니다)',
    ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('TEMPLATE_FILE_ID', extractId_(r1.getResponseText()));

  var r2 = ui.prompt(
    '저장 폴더 ID',
    '생성된 재직증명서를 저장할 드라이브 폴더 ID(또는 폴더 링크)를 붙여넣으세요.\n' +
    '비워두면 내 드라이브 최상위에 저장됩니다.',
    ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('OUTPUT_FOLDER_ID', extractId_(r2.getResponseText()));

  ui.alert('저장되었습니다.');
}

function checkSettings() {
  var props = PropertiesService.getScriptProperties();
  var tid = props.getProperty('TEMPLATE_FILE_ID') || '(미설정)';
  var fid = props.getProperty('OUTPUT_FOLDER_ID') || '(내 드라이브 최상위)';
  var tname = '(확인 불가)';
  try { tname = DriveApp.getFileById(tid).getName(); } catch (e) {}
  SpreadsheetApp.getUi().alert(
    '양식 파일: ' + tid + '\n  → ' + tname + '\n\n저장 폴더: ' + fid);
}

// ─────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────

function issueSelected() {
  var ui = SpreadsheetApp.getUi();
  try {
    var sheet = SpreadsheetApp.getActiveSheet();
    var rows = selectedDataRows_(sheet);
    if (!rows.length) {
      ui.alert('발급할 행을 먼저 선택하세요. (머리글 아래 데이터 행)');
      return;
    }
    if (rows.length > 20) {
      ui.alert('한 번에 최대 20명까지 발급합니다. 선택: ' + rows.length + '행');
      return;
    }

    var head = findHeader_(sheet);
    var cols = resolveColumns_(head.labels);
    var missing = requiredMissing_(cols);
    if (missing.length) {
      ui.alert('시트에서 다음 컬럼을 찾지 못했습니다:\n\n  ' + missing.join(', ') +
               '\n\n머리글 이름을 확인하거나 COLUMN_ALIASES에 별칭을 추가하세요.');
      return;
    }

    var template = loadTemplateBlob_();
    var folder = outputFolder_();
    var today = new Date();

    var results = [];
    for (var i = 0; i < rows.length; i++) {
      var values = sheet.getRange(rows[i], 1, 1, sheet.getLastColumn()).getValues()[0];
      var person = buildPerson_(values, cols, today);
      if (!person.name) { results.push({ error: rows[i] + '행: 이름이 비어 있습니다.' }); continue; }
      var blob = renderHwpx_(template, person);
      var file = folder.createFile(blob);
      results.push({ name: person.name, url: file.getUrl(), id: file.getId(), warn: person.warn });
    }

    showResult_(results);

  } catch (e) {
    ui.alert('오류가 발생했습니다.\n\n' + (e && e.message ? e.message : e));
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────
// hwpx 렌더링
// ─────────────────────────────────────────────────────────────

/**
 * 양식 hwpx의 압축을 풀어 section0.xml의 텍스트 조각만 치환하고 다시 묶는다.
 * 서식/표/글꼴은 건드리지 않으므로 원본 레이아웃이 그대로 유지된다.
 */
function renderHwpx_(templateBlob, p) {
  var map = {};
  map[TPL.name]     = SPACE_NAME ? spaceOut_(p.name) : p.name;
  map[TPL.rrn]      = p.rrn;
  map[TPL.address]  = p.address;
  map[TPL.dept]     = p.dept;
  map[TPL.title]    = p.title;
  map[TPL.period]   = p.period;
  map[TPL.sentence] = '상기인은 ' + p.hireText + ' 당사에 입사하여 현재 재직중에 있음을 증명합니다.';
  map[TPL.issued]   = p.issuedText;
  if (REMOVE_WATERMARK) map[TPL.watermark] = '';

  var parts = Utilities.unzip(templateBlob.setContentType('application/zip'));
  var out = [];
  var patchedSection = false;

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var name = part.getName();

    if (name === SECTION_PATH) {
      var xml = part.getDataAsString('UTF-8');
      var res = replaceRuns_(xml, map);
      if (!res.hitCount) {
        throw new Error('양식에서 치환 대상 문자열을 하나도 찾지 못했습니다. ' +
                        '양식 파일이 바뀐 경우 스크립트 상단 TPL 값을 갱신하세요.');
      }
      out.push(Utilities.newBlob(res.xml, 'application/xml', name));
      patchedSection = true;

    } else if (name === PRVTEXT_PATH) {
      // 미리보기 텍스트도 같이 갱신 (안 해도 문서 내용에는 영향 없음)
      var txt = part.getDataAsString('UTF-8');
      for (var k in map) txt = txt.split(k).join(map[k]);
      out.push(Utilities.newBlob(txt, 'text/plain', name));

    } else {
      out.push(part);
    }
  }

  if (!patchedSection) throw new Error('양식 안에서 ' + SECTION_PATH + ' 을 찾지 못했습니다.');

  // mimetype 엔트리를 맨 앞으로 정렬 (hwpx/OPC 규약)
  out.sort(function (a, b) {
    return (a.getName() === 'mimetype' ? 0 : 1) - (b.getName() === 'mimetype' ? 0 : 1);
  });

  var fileName = '재직증명서_' + p.name + '_' + p.issuedStamp + '.hwpx';
  return Utilities.zip(out, fileName).setName(fileName);
}

/** <hp:t>…</hp:t> 텍스트 조각 단위로만 치환한다 (XML 태그 손상 방지) */
function replaceRuns_(xml, map) {
  var hit = 0;
  var patched = xml.replace(/<hp:t>([\s\S]*?)<\/hp:t>/g, function (whole, body) {
    if (Object.prototype.hasOwnProperty.call(map, body)) {
      hit++;
      return '<hp:t>' + xmlEscape_(map[body]) + '</hp:t>';
    }
    return whole;
  });
  return { xml: patched, hitCount: hit };
}

function xmlEscape_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────
// 시트 읽기
// ─────────────────────────────────────────────────────────────

/**
 * 머리글 행을 찾는다. 이 시트는 '최종학력'이 병합된 2단 머리글이라
 * 상위 5행을 훑어 '이름'이 있는 행을 머리글로 본다.
 */
function findHeader_(sheet) {
  var scan = Math.min(5, sheet.getLastRow());
  var grid = sheet.getRange(1, 1, scan, sheet.getLastColumn()).getDisplayValues();
  for (var r = 0; r < scan; r++) {
    for (var c = 0; c < grid[r].length; c++) {
      if (key_(grid[r][c]) === '이름' || key_(grid[r][c]) === '성명') {
        return { row: r + 1, labels: grid[r].map(norm_) };
      }
    }
  }
  throw new Error("머리글 행을 찾지 못했습니다. 상위 5행 안에 '이름' 컬럼이 있어야 합니다.");
}

/** 선택 영역에서 머리글보다 아래에 있는, 비어 있지 않은 행 번호들 */
function selectedDataRows_(sheet) {
  var head = findHeader_(sheet);
  var ranges = sheet.getActiveRangeList()
    ? sheet.getActiveRangeList().getRanges()
    : [sheet.getActiveRange()];

  var seen = {}, rows = [];
  for (var i = 0; i < ranges.length; i++) {
    var rg = ranges[i];
    for (var r = rg.getRow(); r < rg.getRow() + rg.getNumRows(); r++) {
      if (r <= head.row) continue;
      if (seen[r]) continue;
      if (!sheet.getRange(r, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].join('').trim()) continue;
      seen[r] = true;
      rows.push(r);
    }
  }
  rows.sort(function (a, b) { return a - b; });
  return rows;
}

function resolveColumns_(labels) {
  // 공백을 모두 제거하고 비교한다 ("성 별", "집 주소", 줄바꿈 머리글도 인식)
  var keys = labels.map(key_);
  var cols = {};
  for (var k in COLUMN_ALIASES) {
    var aliases = COLUMN_ALIASES[k];
    for (var a = 0; a < aliases.length && cols[k] === undefined; a++) {
      var idx = keys.indexOf(key_(aliases[a]));
      if (idx >= 0) cols[k] = idx;
    }
  }
  return cols;
}

/** 머리글/별칭 비교용 정규화: 공백·줄바꿈 전부 제거 */
function key_(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }

/**
 * 왜 값이 안 채워지는지 눈으로 확인하는 진단.
 * 머리글로 인식한 행, 컬럼별 매칭 결과, 선택한 행의 실제 값을 한 번에 보여준다.
 */
function diagnoseColumns() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();
  var out = [];

  try {
    var head = findHeader_(sheet);
    out.push('■ 머리글로 인식한 행: ' + head.row + '행');
    out.push('   ' + head.labels.map(function (v, i) {
      return colLetter_(i + 1) + '=' + (v || '(빈칸)');
    }).join(' | '));
    out.push('');

    var cols = resolveColumns_(head.labels);
    var labelOf = { name: '성명', dept: '소속', title: '직위', birth: '생년월일',
                    gender: '성별', rrn: '주민등록번호', address: '주소', hireDate: '입사일' };

    var row = selectedDataRows_(sheet)[0];
    var values = row ? sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0] : null;

    out.push('■ 컬럼 매칭 결과' + (row ? ' (선택한 ' + row + '행 값 포함)' : ''));
    for (var k in COLUMN_ALIASES) {
      var line = '   ' + labelOf[k] + ': ';
      if (cols[k] === undefined) {
        line += '✗ 못 찾음  (찾는 머리글: ' + COLUMN_ALIASES[k].join(' / ') + ')';
      } else {
        line += '✓ ' + colLetter_(cols[k] + 1) + '열 "' + head.labels[cols[k]] + '"';
        if (values) line += '  →  값: [' + String(values[cols[k]]) + ']';
      }
      out.push(line);
    }

    if (values) {
      out.push('');
      var warn = [];
      var rrn = buildRrn_(cols.rrn === undefined ? '' : values[cols.rrn],
                          cols.birth === undefined ? '' : values[cols.birth],
                          cols.gender === undefined ? '' : values[cols.gender], warn);
      out.push('■ 생성될 주민등록번호: ' + (rrn || '(빈칸)'));
      for (var w = 0; w < warn.length; w++) out.push('   ⚠ ' + warn[w]);
    } else {
      out.push('');
      out.push('※ 데이터 행을 선택하고 다시 실행하면 실제 값까지 확인됩니다.');
    }

  } catch (e) {
    out.push('오류: ' + (e && e.message ? e.message : e));
  }

  ui.alert('컬럼 인식 진단', out.join('\n'), ui.ButtonSet.OK);
}

function colLetter_(n) {
  var s = '';
  while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

function requiredMissing_(cols) {
  var required = { name: '이름', dept: '부서', title: '직위', address: '집주소', hireDate: '인트윈 입사년월일' };
  var missing = [];
  for (var k in required) if (cols[k] === undefined) missing.push(required[k]);
  return missing;
}

function buildPerson_(values, cols, today) {
  function get(key) { return cols[key] === undefined ? '' : values[cols[key]]; }

  var warn = [];
  var hire = toDate_(get('hireDate'));
  if (!hire) warn.push('입사일을 날짜로 해석하지 못해 시트 값을 그대로 넣었습니다.');

  var hireText = hire ? ymdKorean_(hire) : String(get('hireDate')).trim();
  var startYear = hire ? hire.getFullYear() : today.getFullYear();

  var rrn = buildRrn_(get('rrn'), get('birth'), get('gender'), warn);

  return {
    name:       String(get('name')).trim(),
    dept:       String(get('dept')).trim(),
    title:      String(get('title')).trim(),
    address:    String(get('address')).trim(),
    rrn:        rrn,
    hireText:   hireText,
    period:     hireText + ' ~ ' + today.getFullYear() + '년 현재',
    issuedText: today.getFullYear() + '년 ' + pad2_(today.getMonth() + 1) + '월 ' + pad2_(today.getDate()) + '일',
    issuedStamp: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd'),
    warn:       warn
  };
}

/**
 * 주민등록번호를 만든다.
 *  1순위: 시트에 '주민등록번호' 컬럼이 있으면 그 값을 마스킹해서 사용
 *  2순위: 생년월일 + 성별로 'YYMMDD-N******' 생성
 *  둘 다 없으면 'YYMMDD-*******'
 */
function buildRrn_(raw, birth, gender, warn) {
  var digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (digits.length >= 7) {
    return digits.substring(0, 6) + '-' + digits.charAt(6) + '******';
  }

  var d = toDate_(birth);
  if (!d) {
    warn.push('생년월일을 해석하지 못해 주민등록번호를 채우지 못했습니다.');
    return '';
  }
  var front = pad2_(d.getFullYear() % 100) + pad2_(d.getMonth() + 1) + pad2_(d.getDate());

  // '남', '남자', 'M', '1' 등 웬만한 표기를 모두 받아준다
  var g = String(gender == null ? '' : gender).replace(/\s+/g, '').toUpperCase();
  var isFemale = /여|F|W|2|4/.test(g);
  var isMale   = /남|M|1|3/.test(g);
  var before2000 = d.getFullYear() < 2000;

  var code = '';
  if (isFemale)   code = before2000 ? '2' : '4';
  else if (isMale) code = before2000 ? '1' : '3';

  if (!code) {
    warn.push(g
      ? "성별 값 '" + gender + "' 을(를) 해석하지 못했습니다. 남/여 로 입력하거나 '주민등록번호' 컬럼을 사용하세요."
      : "성별 칸이 비어 있어 주민번호 뒷자리 첫 숫자를 '*'로 처리했습니다. " +
        "시트에 '성별' 머리글이 있는지, 해당 행에 값이 채워져 있는지 확인하세요.");
    code = '*';
  }
  return front + '-' + code + '******';
}

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────

function toDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;

  var m = s.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  var d8 = s.replace(/\D/g, '');
  if (d8.length === 8) {
    return new Date(Number(d8.substring(0, 4)), Number(d8.substring(4, 6)) - 1, Number(d8.substring(6, 8)));
  }
  if (d8.length === 6) { // 생년월일 YYMMDD
    var yy = Number(d8.substring(0, 2));
    var year = yy > (new Date().getFullYear() % 100) ? 1900 + yy : 2000 + yy;
    return new Date(year, Number(d8.substring(2, 4)) - 1, Number(d8.substring(4, 6)));
  }
  return null;
}

function ymdKorean_(d) {
  return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function spaceOut_(name) {
  return String(name).replace(/\s+/g, '').split('').join(' ');
}

function norm_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function extractId_(input) {
  var s = String(input || '').trim();
  var m = s.match(/[-\w]{25,}/);
  return m ? m[0] : s;
}

function loadTemplateBlob_() {
  var id = PropertiesService.getScriptProperties().getProperty('TEMPLATE_FILE_ID');
  if (!id) throw new Error('양식 파일이 설정되지 않았습니다. 메뉴 [재직증명서] > [설정]을 먼저 실행하세요.');
  return DriveApp.getFileById(id).getBlob();
}

function outputFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('OUTPUT_FOLDER_ID');
  if (!id) return DriveApp.getRootFolder();
  return DriveApp.getFolderById(id);
}

function showResult_(results) {
  var html = ['<style>body{font-family:-apple-system,"Malgun Gothic",sans-serif;font-size:13px;line-height:1.7;padding:4px}',
              'a{color:#1a73e8}.w{color:#b06000;font-size:12px}.e{color:#c5221f}</style>'];
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.error) { html.push('<div class="e">⚠ ' + r.error + '</div>'); continue; }
    html.push('<div><b>' + r.name + '</b> — ' +
      '<a href="https://drive.google.com/uc?export=download&id=' + r.id + '" target="_blank">다운로드</a>' +
      ' · <a href="' + r.url + '" target="_blank">드라이브에서 보기</a></div>');
    if (r.warn && r.warn.length) {
      for (var w = 0; w < r.warn.length; w++) html.push('<div class="w">↳ ' + r.warn[w] + '</div>');
    }
  }
  var out = HtmlService.createHtmlOutput(html.join('')).setWidth(520).setHeight(120 + results.length * 46);
  SpreadsheetApp.getUi().showModalDialog(out, '발급 완료');
}

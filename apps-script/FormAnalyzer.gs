/**
 * FormAnalyzer.gs — hwpx 서식 구조 분석
 *
 * 서식 자동 채우기를 만들기 전에, 실제 서식이 어떤 구조인지 측정하는 도구.
 * "라벨이 반복될 것"이라는 가정이 맞는지 숫자로 확인하는 게 목적이다.
 *
 * 하는 일:
 *   1) 드라이브의 hwpx 를 풀어 Contents/section*.xml 을 XmlService 로 파싱
 *   2) 표(hp:tbl) 를 찾아 행×열 격자와 셀 텍스트를 뽑는다
 *   3) 셀 텍스트를 라벨 사전과 대조해 표준 필드로 매핑되는 비율을 센다
 *   4) 결과를 구글 문서로 저장 (사람이 읽고, 그대로 공유 가능)
 *
 * ※ hwpx 는 ZIP+XML 이라 파싱이 되지만, 구형 hwp(바이너리)는 불가능하다.
 *   한컴에서 '다른 이름으로 저장 → hwpx' 를 먼저 거쳐야 한다.
 */

// OWPML 문단 네임스페이스 — 표/문단/텍스트가 모두 여기 속한다
var HWPX_SECTION_RE = /^Contents\/section\d+\.xml$/;

/**
 * 라벨 사전: 서식에 적힌 말 → 우리 DB 표준 필드
 * 새 서식에서 못 알아본 라벨이 나오면 여기에 동의어를 추가하면 된다.
 */
var LABEL_DICT = [
  // ── 회사 ──
  { field: 'company.name',    labels: ['업체명', '회사명', '상호', '법인명', '기업명', '제안사', '입찰자'] },
  { field: 'company.bizNo',   labels: ['사업자등록번호', '사업자번호', '등록번호'] },
  { field: 'company.ceo',     labels: ['대표자', '대표이사', '대표자명', '성명(대표자)'] },
  { field: 'company.address', labels: ['소재지', '주소', '사업장소재지', '본사주소'] },
  { field: 'company.tel',     labels: ['전화번호', '연락처', '대표전화'] },

  // ── 인력 ──
  { field: 'person.name',     labels: ['성명', '이름', '참여자명', '인력명', '참여인력', '담당자'] },
  { field: 'person.birth',    labels: ['생년월일', '생년월', '주민등록번호', '생일'] },
  { field: 'person.dept',     labels: ['소속', '부서', '소속부서', '근무처', '소속사'] },
  { field: 'person.title',    labels: ['직위', '직급', '직책'] },
  { field: 'person.edu',      labels: ['최종학력', '학력', '출신학교', '학교'] },
  { field: 'person.major',    labels: ['전공', '학과', '전공분야'] },
  { field: 'person.degree',   labels: ['학위'] },
  { field: 'person.career',   labels: ['경력', '경력기간', '총경력', '실무경력', '경력년수'] },
  { field: 'person.role',     labels: ['담당업무', '역할', '참여분야', '담당분야', '수행업무'] },
  { field: 'person.joinDate', labels: ['입사일', '입사년월일', '입사일자'] },

  // ── 실적 ──
  { field: 'perf.taskName',   labels: ['과업명', '사업명', '용역명', '계약건명', '사업내용', '용역과업명', '실적명'] },
  { field: 'perf.org',        labels: ['발주처', '발주기관', '수요기관', '계약기관', '발주자', '주관기관'] },
  { field: 'perf.amount',     labels: ['계약금액', '계약액', '사업비', '용역비', '금액', '수행금액'] },
  { field: 'perf.period',     labels: ['계약기간', '수행기간', '용역기간', '사업기간', '이행기간'] },
  { field: 'perf.date',       labels: ['계약일자', '계약일', '착수일'] },
  { field: 'perf.desc',       labels: ['용역개요', '사업개요', '과업개요', '주요내용', '수행내용'] },
  { field: 'perf.share',      labels: ['지분율', '참여지분', '분담비율'] },

  // ── 문서 공통 ──
  { field: 'doc.date',        labels: ['작성일', '작성일자', '제출일', '신청일', '년월일'] },
  { field: 'doc.signature',   labels: ['서명', '날인', '인', '(인)'] }
];

/** 값이 들어갈 자리로 보이는 빈 칸 표시들 */
var BLANK_PATTERNS = /^[\s\-–—_.·]*$/;

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

/** 메뉴: 서식 구조 분석 */
function analyzeHwpxForm() {
  var ui = SpreadsheetApp.getUi();

  var res = ui.prompt(
    'hwpx 서식 분석',
    '분석할 hwpx 파일의 드라이브 링크 또는 파일 ID를 붙여넣으세요.\n\n' +
    '※ .hwp 는 분석할 수 없습니다.\n' +
    '   한컴에서 [다른 이름으로 저장] → hwpx 로 바꾼 뒤 올려주세요.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = res.getResponseText().trim();
  var fileId = extractDriveId_(input) || input;
  if (!fileId) return;

  try {
    var report = buildFormReport_(fileId);
    ui.alert(
      '분석 완료\n\n' +
      '파일: ' + report.fileName + '\n' +
      '표: ' + report.tableCount + '개\n' +
      '텍스트가 있는 셀: ' + report.filledCells + '개\n' +
      '빈 셀(채울 자리 후보): ' + report.blankCells + '개\n' +
      '인식된 라벨: ' + report.matchedLabels + '개 (' + report.matchRate + '%)\n\n' +
      '상세 보고서:\n' + report.docUrl);
  } catch (e) {
    ui.alert('분석 실패\n\n' + (e.message || e));
  }
}

// ─────────────────────────────────────────────────────────────
// hwpx 파싱
// ─────────────────────────────────────────────────────────────

/** hwpx 를 풀어 section*.xml 문자열 배열로 */
function readHwpxSections_(fileId) {
  var file = DriveApp.getFileById(fileId);
  var name = file.getName();
  if (!/\.hwpx$/i.test(name)) {
    throw new Error(
      'hwpx 파일이 아닙니다: ' + name + '\n\n' +
      '구형 .hwp 는 바이너리라 읽을 수 없습니다.\n' +
      '한컴오피스에서 [다른 이름으로 저장] → hwpx 로 저장한 뒤 다시 시도해주세요.');
  }

  var entries = Utilities.unzip(file.getBlob().setContentType('application/zip'));
  var sections = [];
  entries.forEach(function (b) {
    if (HWPX_SECTION_RE.test(b.getName())) {
      sections.push({ name: b.getName(), xml: b.getDataAsString('UTF-8') });
    }
  });
  sections.sort(function (a, b) { return a.name.localeCompare(b.name); });

  if (!sections.length) throw new Error('본문(Contents/section0.xml)을 찾지 못했습니다.');
  return { fileName: name, sections: sections };
}

/** 이름이 일치하는 자손 요소를 모두 찾는다 (네임스페이스 무시) */
function findDescendants_(element, localName, acc) {
  acc = acc || [];
  var children = element.getChildren();
  for (var i = 0; i < children.length; i++) {
    if (children[i].getName() === localName) acc.push(children[i]);
    findDescendants_(children[i], localName, acc);
  }
  return acc;
}

/** 요소 아래의 모든 텍스트(hp:t)를 이어붙인다 */
function collectText_(element) {
  return findDescendants_(element, 't')
    .map(function (t) { return t.getText(); })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 표 하나를 격자로 읽는다.
 * 반환: { rows: [[cellText, ...], ...], rowCount, colCount }
 */
function parseTable_(tbl) {
  var grid = [];
  var trs = tbl.getChildren().filter(function (c) { return c.getName() === 'tr'; });

  trs.forEach(function (tr) {
    var row = [];
    tr.getChildren().forEach(function (tc) {
      if (tc.getName() !== 'tc') return;
      row.push(collectText_(tc));
    });
    if (row.length) grid.push(row);
  });

  var colCount = 0;
  grid.forEach(function (r) { if (r.length > colCount) colCount = r.length; });
  return { rows: grid, rowCount: grid.length, colCount: colCount };
}

// ─────────────────────────────────────────────────────────────
// 라벨 매칭
// ─────────────────────────────────────────────────────────────

/** 셀 텍스트가 어떤 표준 필드에 해당하는지 (없으면 null) */
function matchLabel_(text) {
  var key = String(text || '').replace(/[\s()（）:：]/g, '');
  if (!key) return null;

  for (var i = 0; i < LABEL_DICT.length; i++) {
    var entry = LABEL_DICT[i];
    for (var j = 0; j < entry.labels.length; j++) {
      var label = entry.labels[j].replace(/[\s()（）:：]/g, '');
      if (!label) continue;
      // 완전일치 우선, 아니면 라벨을 포함하는 짧은 셀만 인정
      if (key === label) return { field: entry.field, label: entry.labels[j], exact: true };
      if (key.length <= label.length + 4 && key.indexOf(label) > -1) {
        return { field: entry.field, label: entry.labels[j], exact: false };
      }
    }
  }
  return null;
}

function isBlankCell_(text) {
  return BLANK_PATTERNS.test(String(text || ''));
}

/**
 * 표의 형태를 판정한다.
 *   header  = 첫 행이 대부분 라벨 → 아래로 반복되는 데이터 표
 *   pairs   = 라벨/값이 좌우로 번갈아 → 항목 나열형
 *   unknown = 판정 불가
 */
function classifyTable_(table) {
  if (!table.rowCount) return 'unknown';

  var first = table.rows[0] || [];
  var firstLabels = first.filter(function (c) { return matchLabel_(c); }).length;
  if (first.length >= 2 && firstLabels >= Math.ceil(first.length / 2)) return 'header';

  var pairHits = 0, pairTries = 0;
  table.rows.forEach(function (row) {
    for (var c = 0; c + 1 < row.length; c += 2) {
      pairTries++;
      if (matchLabel_(row[c]) && isBlankCell_(row[c + 1])) pairHits++;
    }
  });
  if (pairTries && pairHits >= Math.ceil(pairTries / 3)) return 'pairs';

  return 'unknown';
}

// ─────────────────────────────────────────────────────────────
// 보고서
// ─────────────────────────────────────────────────────────────

var FORM_REPORT_MAX_TABLES = 40;
var FORM_REPORT_MAX_ROWS = 40;

function buildFormReport_(fileId) {
  var parsed = readHwpxSections_(fileId);

  var tables = [];
  parsed.sections.forEach(function (sec) {
    var root = XmlService.parse(sec.xml).getRootElement();
    findDescendants_(root, 'tbl').forEach(function (tbl) {
      tables.push(parseTable_(tbl));
    });
  });

  var doc = DocumentApp.create('서식분석_' + parsed.fileName.replace(/\.hwpx$/i, ''));
  var body = doc.getBody();

  body.appendParagraph('hwpx 서식 구조 분석').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('파일: ' + parsed.fileName);
  body.appendParagraph('분석일: ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));

  var filledCells = 0, blankCells = 0, labelCells = 0, matchedLabels = 0;
  var fieldHits = {};
  var shapeCount = { header: 0, pairs: 0, unknown: 0 };
  var unknownLabels = {};

  tables.forEach(function (t) {
    shapeCount[classifyTable_(t)]++;
    t.rows.forEach(function (row) {
      row.forEach(function (cell) {
        if (isBlankCell_(cell)) { blankCells++; return; }
        filledCells++;
        // 짧은 텍스트만 라벨 후보로 본다 (긴 문장은 본문)
        if (cell.length <= 20) {
          labelCells++;
          var m = matchLabel_(cell);
          if (m) {
            matchedLabels++;
            fieldHits[m.field] = (fieldHits[m.field] || 0) + 1;
          } else {
            unknownLabels[cell] = (unknownLabels[cell] || 0) + 1;
          }
        }
      });
    });
  });

  var matchRate = labelCells ? Math.round(matchedLabels / labelCells * 100) : 0;

  body.appendParagraph('요약').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('표 ' + tables.length + '개');
  body.appendParagraph('  · 헤더형(반복 데이터 표): ' + shapeCount.header);
  body.appendParagraph('  · 라벨/값 쌍형: ' + shapeCount.pairs);
  body.appendParagraph('  · 판정 불가: ' + shapeCount.unknown);
  body.appendParagraph('텍스트 있는 셀 ' + filledCells + ' / 빈 셀 ' + blankCells);
  body.appendParagraph('라벨 후보 ' + labelCells + '개 중 ' + matchedLabels +
                       '개 인식 (' + matchRate + '%)');

  body.appendParagraph('인식된 표준 필드').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var fieldKeys = Object.keys(fieldHits).sort(function (a, b) { return fieldHits[b] - fieldHits[a]; });
  if (fieldKeys.length) {
    fieldKeys.forEach(function (f) { body.appendListItem(f + ' — ' + fieldHits[f] + '회'); });
  } else {
    body.appendParagraph('(없음)');
  }

  body.appendParagraph('사전에 없는 짧은 텍스트 (라벨 후보)')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('※ 이 중 실제 라벨인 것을 LABEL_DICT 에 추가하면 인식률이 올라갑니다.');
  var unknownKeys = Object.keys(unknownLabels)
    .sort(function (a, b) { return unknownLabels[b] - unknownLabels[a]; })
    .slice(0, 80);
  if (unknownKeys.length) {
    unknownKeys.forEach(function (k) { body.appendListItem(k + ' — ' + unknownLabels[k] + '회'); });
  } else {
    body.appendParagraph('(없음)');
  }

  body.appendParagraph('표 상세').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  tables.slice(0, FORM_REPORT_MAX_TABLES).forEach(function (t, i) {
    body.appendParagraph(
      '표 ' + (i + 1) + ' — ' + t.rowCount + '행 × ' + t.colCount + '열  [' + classifyTable_(t) + ']'
    ).setHeading(DocumentApp.ParagraphHeading.HEADING3);

    t.rows.slice(0, FORM_REPORT_MAX_ROWS).forEach(function (row) {
      var line = row.map(function (c) {
        var text = isBlankCell_(c) ? '␣' : c.slice(0, 24);
        var m = isBlankCell_(c) ? null : matchLabel_(c);
        return text + (m ? ' «' + m.field + '»' : '');
      }).join(' | ');
      body.appendParagraph(line).setFontFamily('Consolas').setFontSize(8);
    });

    if (t.rowCount > FORM_REPORT_MAX_ROWS) {
      body.appendParagraph('… 이하 ' + (t.rowCount - FORM_REPORT_MAX_ROWS) + '행 생략').setFontSize(8);
    }
  });

  if (tables.length > FORM_REPORT_MAX_TABLES) {
    body.appendParagraph('… 이하 ' + (tables.length - FORM_REPORT_MAX_TABLES) + '개 표 생략');
  }

  doc.saveAndClose();

  // 원본과 같은 폴더로 옮겨둔다
  try {
    var src = DriveApp.getFileById(fileId);
    var parents = src.getParents();
    if (parents.hasNext()) {
      var folder = parents.next();
      var reportFile = DriveApp.getFileById(doc.getId());
      folder.addFile(reportFile);
      DriveApp.getRootFolder().removeFile(reportFile);
    }
  } catch (e) {
    Logger.log('보고서 이동 실패(무시): ' + e);
  }

  return {
    fileName: parsed.fileName,
    tableCount: tables.length,
    filledCells: filledCells,
    blankCells: blankCells,
    matchedLabels: matchedLabels,
    matchRate: matchRate,
    docUrl: doc.getUrl()
  };
}

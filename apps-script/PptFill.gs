/**
 * PptFill.gs — 제안서 pptx 를 열고 채우는 부분
 *
 * pptx 는 hwpx 와 똑같이 ZIP + XML 입니다. 다른 점은 크기입니다.
 * 실물 제안서는 200MB 가 넘어서 Apps Script 가 아예 못 엽니다
 * (Blob 한계 50MB). 그래서 이미지를 줄인 경량 템플릿을 씁니다.
 *
 * 아직 채우기는 붙지 않았습니다. 지금은 '이 크기를 정말 다룰 수 있는가'
 * 를 재는 진단만 들어 있습니다. 이게 안 되면 나머지 계획이 전부
 * 바뀌므로 제일 먼저 확인합니다.
 *
 * 템플릿 파일 ID 는 스크립트 속성 PPT_TEMPLATE_ID 에 둡니다.
 */

var PPT_TEMPLATE_PROP = 'PPT_TEMPLATE_ID';

/** 슬라이드 XML 만 골라내는 정규식 — 미디어는 손대지 않는다 */
var PPT_SLIDE_RE = /^ppt\/slides\/slide\d+\.xml$/;

// ── 템플릿 등록 ──

/**
 * 드라이브에서 파일명으로 템플릿을 찾아 ID 를 저장한다.
 * ID 를 손으로 복사하지 않아도 되게 한다.
 */
function setupPptTemplate() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt(
    '제안서 템플릿 등록',
    '드라이브에 올려둔 pptx 파일명을 넣어주세요.\n' +
    '(예: 제안서_템플릿_경량화.pptx)',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  var name = r.getResponseText().trim();
  if (!name) return;

  var it = DriveApp.getFilesByName(name);
  var found = [];
  while (it.hasNext() && found.length < 10) found.push(it.next());

  if (!found.length) {
    ui.alert('템플릿 등록',
      '"' + name + '" 을 드라이브에서 찾지 못했습니다.\n' +
      '파일명이 정확한지, 이 계정 드라이브에 있는지 확인해주세요.',
      ui.ButtonSet.OK);
    return;
  }

  // 같은 이름이 여러 개면 제일 최근 것을 쓴다
  found.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
  var f = found[0];

  PropertiesService.getScriptProperties().setProperty(PPT_TEMPLATE_PROP, f.getId());
  ui.alert('템플릿 등록',
    '등록했습니다.\n\n' +
    '이름: ' + f.getName() + '\n' +
    '크기: ' + (f.getSize() / 1e6).toFixed(1) + 'MB\n' +
    '수정: ' + Utilities.formatDate(f.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') +
    (found.length > 1 ? '\n\n같은 이름이 ' + found.length + '개라 가장 최근 것을 골랐습니다.' : ''),
    ui.ButtonSet.OK);
}

function getPptTemplateId_() {
  var id = PropertiesService.getScriptProperties().getProperty(PPT_TEMPLATE_PROP);
  if (!id) {
    throw new Error('템플릿이 등록되지 않았습니다.\n메뉴 → 제안서 → 템플릿 등록 을 먼저 실행해주세요.');
  }
  return id;
}

// ── 진단 (이게 되는지부터 확인한다) ──

/**
 * 템플릿을 열고 → 슬라이드 XML 을 하나 건드리고 → 다시 압축까지 해본다.
 * 각 단계 소요 시간과 크기를 보고한다. 6분 제한과 메모리 한계에
 * 걸리는지가 여기서 드러난다.
 */
function diagnosePptTemplate() {
  var ui = SpreadsheetApp.getUi();
  var out = [];
  var t0 = new Date().getTime();
  var lap = function (label) {
    var t = new Date().getTime();
    out.push('  ' + label + ': ' + ((t - t0) / 1000).toFixed(1) + '초');
    t0 = t;
  };

  try {
    var id = getPptTemplateId_();
    var file = DriveApp.getFileById(id);
    out.push('파일: ' + file.getName());
    out.push('크기: ' + (file.getSize() / 1e6).toFixed(1) + 'MB');
    out.push('');

    t0 = new Date().getTime();
    // unzip 은 ContentType 이 application/zip 이 아니면 거부한다.
    // 드라이브가 붙여준 pptx MIME 을 갈아끼워야 한다 (hwpx 쪽도 같은 처리)
    var blob = file.getBlob().setContentType('application/zip');
    lap('드라이브에서 읽기');

    var parts = Utilities.unzip(blob);
    lap('압축 해제 (' + parts.length + '개 항목)');

    var slides = [], media = 0, xmlBytes = 0, mediaBytes = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = parts[i].getName();
      var sz = parts[i].getBytes().length;
      if (PPT_SLIDE_RE.test(n)) { slides.push(n); xmlBytes += sz; }
      else if (n.indexOf('ppt/media/') === 0) { media++; mediaBytes += sz; }
      else if (n.slice(-4) === '.xml' || n.slice(-5) === '.rels') xmlBytes += sz;
    }
    lap('항목 훑기');

    out.push('  슬라이드 ' + slides.length + '장');
    out.push('  미디어 ' + media + '개 (' + (mediaBytes / 1e6).toFixed(1) + 'MB)');
    out.push('  XML 합계 ' + (xmlBytes / 1e6).toFixed(1) + 'MB');
    out.push('');

    // 슬라이드 XML 을 실제로 열어 글자를 세어본다 — 파싱이 되는지 확인
    var texts = 0, sampled = 0;
    for (var j = 0; j < parts.length && sampled < 5; j++) {
      if (!PPT_SLIDE_RE.test(parts[j].getName())) continue;
      var xml = parts[j].getDataAsString('UTF-8');
      var m = xml.match(/<a:t>/g);
      texts += m ? m.length : 0;
      sampled++;
    }
    lap('슬라이드 5장 텍스트 읽기 (<a:t> ' + texts + '개)');

    // 다시 압축 — 여기가 제일 위험하다
    var rezipped = Utilities.zip(parts, 'test.pptx');
    lap('재압축 (' + (rezipped.getBytes().length / 1e6).toFixed(1) + 'MB)');

    out.push('');
    out.push('전 과정 통과. 채우기를 붙여도 됩니다.');
  } catch (e) {
    out.push('');
    out.push('실패: ' + e.message);
    out.push('');
    out.push('여기서 막히면 템플릿을 더 줄여야 합니다 —');
    out.push('사진을 빼고 레이아웃과 표지·간지만 남긴 판을 씁니다.');
  }

  ui.alert('pptx 템플릿 진단', out.join('\n'), ui.ButtonSet.OK);
}

// ── 실적 채우기 ──
//
// 대상은 '주요사업 실적' 슬라이드다. 구조가 이렇게 되어 있다:
//   연도 라벨 도형(14pt, 글자가 "2025" 또는 "2022~2023")
//   바로 아래 목록 도형(10pt, 문단 여러 줄)
// 라벨을 찾고 -> 같은 열에서 바로 아래 있는 목록 도형을 찾아 -> 줄을 갈아끼운다.

var PPT_SP_RE   = /<p:sp>[\s\S]*?<\/p:sp>/g;
var PPT_XFRM_RE = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/;
var PPT_PARA_RE = /<a:p>[\s\S]*?<\/a:p>/g;
var PPT_T_RE    = /(<a:t>)([\s\S]*?)(<\/a:t>)/g;
var PPT_YEAR_RE = /^20\d\d(\s*[~\-]\s*20\d\d)?$/;
var EMU_PER_PT  = 9525;

function escapeXml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 도형/문단 안의 글자를 모두 이어붙인다 */
function pptText_(frag) {
  var out = '', m;
  PPT_T_RE.lastIndex = 0;
  while ((m = PPT_T_RE.exec(frag)) !== null) out += m[2];
  return out.replace(/\s+/g, ' ').trim();
}

/** 문단의 첫 <a:t> 에 값을 넣고 나머지는 비운다. 서식은 첫 조각 것으로 통일된다 */
function setParaText_(para, value) {
  var first = true;
  return para.replace(PPT_T_RE, function (all, open, mid, close) {
    if (first) { first = false; return open + escapeXml_(value) + close; }
    return open + close;
  });
}

/**
 * 실적 시트를 연도별 줄 목록으로 바꾼다.
 * 한 줄은 "발급기관 + 과업명" 이다 - 템플릿의 기존 줄이 그 형태였다.
 */
function perfLinesByYear_() {
  var recs = getPerformanceData();
  var by = {};
  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    var y = String(r.year == null ? '' : r.year).replace(/[^0-9]/g, '').slice(0, 4);
    if (!y) continue;
    var org = String(r.org || '').trim();
    var task = String(r.taskName || '').trim();
    if (!task) continue;
    // 과업명이 이미 기관명으로 시작하면 겹쳐 쓰지 않는다
    var line = (org && task.indexOf(org) !== 0) ? (org + ' ' + task) : task;
    if (!by[y]) by[y] = [];
    by[y].push({ line: line, amount: r.amount || 0 });
  }
  // 연도 안에서는 계약금액 큰 것부터 - 지면이 모자라면 큰 사업이 남게
  var out = {};
  Object.keys(by).forEach(function (y) {
    out[y] = by[y].sort(function (a, b) { return b.amount - a.amount; })
                  .map(function (o) { return o.line; });
  });
  return out;
}

/** 연도 라벨에 해당하는 실적 줄들 ('2022~2023' 이면 두 해를 합친다) */
function linesForLabel_(label, byYear) {
  var key = label.replace(/\s/g, '');
  if (byYear[key]) return byYear[key].slice();
  var yrs = key.match(/20\d\d/g);
  if (yrs && yrs.length === 2) {
    var a = Number(yrs[0]), b = Number(yrs[1]);
    var lo = Math.min(a, b), hi = Math.max(a, b), acc = [];
    for (var y = hi; y >= lo; y--) acc = acc.concat(byYear[String(y)] || []);  // 최신 연도부터
    return acc;
  }
  return [];
}

/**
 * 슬라이드 XML 하나를 채운다.
 * @return {Object} { xml, report, changed }
 */
function fillPerfSlideXml_(xml, byYear) {
  var shapes = [], m;
  PPT_SP_RE.lastIndex = 0;
  while ((m = PPT_SP_RE.exec(xml)) !== null) {
    var sh = m[0];
    var pos = PPT_XFRM_RE.exec(sh);
    if (!pos) continue;
    shapes.push({
      start: m.index, end: m.index + sh.length, sh: sh,
      x: Math.round(Number(pos[1]) / EMU_PER_PT),
      y: Math.round(Number(pos[2]) / EMU_PER_PT),
      txt: pptText_(sh)
    });
  }

  var labels = shapes.filter(function (b) { return PPT_YEAR_RE.test(b.txt); });
  var edits = [], report = [];

  labels.forEach(function (lab) {
    // 같은 열(x 가 40pt 이내)에서 바로 아래 있는, 문단이 2줄 이상인 도형
    var cands = shapes.filter(function (b) {
      if (b === lab || Math.abs(b.x - lab.x) >= 40 || b.y <= lab.y) return false;
      var ps = b.sh.match(PPT_PARA_RE);
      return ps && ps.length >= 2;
    });
    if (!cands.length) { report.push(lab.txt + ': 아래 목록 도형을 못 찾음'); return; }

    var target = null;
    cands.forEach(function (b) {
      if (target === null || (b.y - lab.y) < (target.y - lab.y)) target = b;
    });

    var items = linesForLabel_(lab.txt, byYear);
    if (!items.length) { report.push(lab.txt + ': 해당 연도 실적 없음'); return; }

    var paras = target.sh.match(PPT_PARA_RE) || [];
    var cap = paras.length;          // 박스 높이가 고정이라 원래 줄 수를 넘길 수 없다
    var use = items.slice(0, cap);
    var newSh = target.sh;
    for (var i = 0; i < paras.length; i++) {
      // 남는 문단은 비우지 말고 없앤다 - 빈 <a:p> 는 빈 줄로 남는다
      newSh = newSh.replace(paras[i], i < use.length ? setParaText_(paras[i], use[i]) : '');
    }
    edits.push({ start: target.start, end: target.end, sh: newSh });
    report.push(lab.txt + ': ' + use.length + '건 채움 (' + cap + '줄 자리, 보유 ' +
      items.length + '건)' +
      (items.length > cap ? ' - ' + (items.length - cap) + '건 지면 부족으로 뺌' : ''));
  });

  edits.sort(function (a, b) { return b.start - a.start; });
  edits.forEach(function (e) { xml = xml.slice(0, e.start) + e.sh + xml.slice(e.end); });
  return { xml: xml, report: report, changed: edits.length > 0 };
}

/**
 * 템플릿의 '주요사업 실적' 슬라이드를 우리 실적으로 채운 pptx 를 만든다.
 * 결과는 드라이브에 새 파일로 저장한다 (템플릿은 건드리지 않는다).
 */
function generatePerfPpt() {
  var ui = SpreadsheetApp.getUi();
  var log = [];
  try {
    var byYear = perfLinesByYear_();
    var years = Object.keys(byYear).sort().reverse();
    log.push('실적 시트: ' + years.length + '개 연도 (' + years.join(', ') + ')');
    log.push('');

    var file = DriveApp.getFileById(getPptTemplateId_());
    var parts = Utilities.unzip(file.getBlob().setContentType('application/zip'));

    var filled = 0;
    for (var i = 0; i < parts.length; i++) {
      var name = parts[i].getName();
      if (!PPT_SLIDE_RE.test(name)) continue;    // 미디어는 건드리지 않는다 (느려진다)
      var xml = parts[i].getDataAsString('UTF-8');
      if (xml.indexOf('주요사업 실적') === -1) continue;

      var res = fillPerfSlideXml_(xml, byYear);
      if (!res.changed) continue;                // 목차 슬라이드도 이 글자를 갖고 있다
      parts[i] = Utilities.newBlob(res.xml, 'application/xml', name);
      filled++;
      log.push(name.replace('ppt/slides/', ''));
      res.report.forEach(function (r) { log.push('  - ' + r); });
    }

    if (!filled) {
      log.push('채운 슬라이드가 없습니다. 템플릿에 연도 라벨이 있는지 확인해주세요.');
      ui.alert('실적 PPT 생성', log.join('\n'), ui.ButtonSet.OK);
      return;
    }

    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
    var outName = '제안서_실적반영_' + stamp + '.pptx';
    var out = Utilities.zip(parts, outName)
      .setContentType('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    var made = DriveApp.createFile(out);

    log.push('');
    log.push('만들었습니다: ' + made.getName());
    log.push(made.getUrl());
  } catch (e) {
    log.push('');
    log.push('실패: ' + e.message);
  }
  ui.alert('실적 PPT 생성', log.join('\n'), ui.ButtonSet.OK);
}

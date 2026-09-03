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
    var blob = file.getBlob();
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

/**
 * PptCompose.gs — 공고에 맞춰 제안서 덱을 조립한다
 *
 * 핵심은 LLM 에게 좌표를 맡기지 않는 것이다. 좌표를 만들게 하면
 * 정렬 어긋난 'AI 티 나는' 장표가 나온다. 화면을 볼 수 없으니 고칠 수도 없다.
 *
 * 그래서 이렇게 나눈다:
 *   LLM  — 어떤 유형의 슬라이드를 몇 장 쓸지 고르고, 슬롯에 넣을 문구를 쓴다
 *   코드 — 그 슬라이드를 템플릿에서 복제해 붙이고 글자만 갈아끼운다
 * 배치는 사람(디자이너)이 잡아둔 것을 그대로 쓴다.
 *
 * 한계가 있다. 템플릿에서 재사용할 수 있는 본문 레이아웃은 9종뿐이다.
 * 나머지는 그 사업 사진이 화면 절반을 차지해서 다른 공고에 못 쓴다.
 * 새 레이아웃을 만들어내지는 못한다.
 */

var CT_SLIDE_XML = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
var REL_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
var REL_NOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

var PPT_PIC_RE = /<p:pic>/g;
var PAGE_NO_RE = /^Page\s*\d+$/;

/** 사진이 이보다 많으면 그 사업 전용 이미지로 본다 — 다른 공고에 못 쓴다 */
var MAX_PICS_FOR_REUSE = 4;

// ─────────────────────────────────────────────────────────────
// 슬라이드 한 장의 '슬롯' 읽기
// ─────────────────────────────────────────────────────────────

/**
 * 글자가 든 도형을 위치·크기와 함께 뽑는다.
 * PptFill.gs 의 정규식을 그대로 쓴다 (같은 파일 형식이므로).
 */
function pptShapes_(xml) {
  var shapes = [], m;
  PPT_SP_RE.lastIndex = 0;
  while ((m = PPT_SP_RE.exec(xml)) !== null) {
    var sh = m[0];
    var txt = pptText_(sh);
    if (!txt) continue;
    var pos = PPT_XFRM_RE.exec(sh);
    if (!pos) continue;
    var sizes = sh.match(/sz="(\d+)"/g) || [];
    var maxSz = 0;
    sizes.forEach(function (s) { maxSz = Math.max(maxSz, Number(s.replace(/\D/g, ''))); });
    shapes.push({
      start: m.index, end: m.index + sh.length, sh: sh, txt: txt,
      x: Math.round(Number(pos[1]) / EMU_PER_PT),
      y: Math.round(Number(pos[2]) / EMU_PER_PT),
      sz: Math.round(maxSz / 100) || 12
    });
  }
  return shapes;
}

/**
 * 슬라이드를 슬롯으로 해석한다.
 *   chapter  좌상단 장 표시 (예: '02 추진계획')
 *   subtitle 그 아래 소제목
 *   headline 본문에서 글자가 제일 큰 것 — 핵심 메시지 한 줄
 *   items    같은 글자 크기로 3개 이상 반복되는 도형들 (읽는 순서로 정렬)
 */
function slideSlots_(xml) {
  var shapes = pptShapes_(xml);
  var head = [], body = [];
  shapes.forEach(function (s) {
    if (PAGE_NO_RE.test(s.txt)) return;                 // 페이지 번호는 따로 다룬다
    if (s.y < 90 && s.sz <= 20) head.push(s); else body.push(s);
  });
  head.sort(function (a, b) { return a.y - b.y; });

  var headline = null;
  body.forEach(function (s) { if (!headline || s.sz > headline.sz) headline = s; });
  if (headline && headline.sz < 16) headline = null;    // 너무 작으면 메시지 자리가 아니다

  // 같은 크기로 3개 이상 — 그중 글자가 제일 큰 무리를 항목 슬롯으로 본다
  var bySz = {};
  body.forEach(function (s) {
    if (s === headline) return;
    (bySz[s.sz] = bySz[s.sz] || []).push(s);
  });
  var items = [];
  Object.keys(bySz).map(Number).sort(function (a, b) { return b - a; })
    .some(function (sz) {
      if (bySz[sz].length >= 3) { items = bySz[sz]; return true; }
      return false;
    });
  items.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });

  return {
    chapter: head[0] || null,
    subtitle: head[1] || null,
    headline: headline,
    items: items,
    pics: (xml.match(PPT_PIC_RE) || []).length
  };
}

/** 도형 하나의 글자를 통째로 갈아끼운다 (첫 문단에 넣고 나머지 문단은 없앤다) */
function replaceShapeText_(sh, value) {
  var paras = sh.match(PPT_PARA_RE);
  if (!paras || !paras.length) return sh;
  var out = sh.replace(paras[0], setParaText_(paras[0], value));
  for (var i = 1; i < paras.length; i++) out = out.replace(paras[i], '');
  return out;
}

/**
 * 계획대로 슬라이드 하나를 채운다.
 * plan: { chapter, subtitle, headline, items:[..] } — 없는 항목은 건드리지 않는다
 */
function fillSlideByPlan_(xml, plan, pageNo) {
  var slots = slideSlots_(xml);
  var edits = [];

  var put = function (slot, value) {
    if (!slot || value == null || value === '') return;
    edits.push({ start: slot.start, end: slot.end, sh: replaceShapeText_(slot.sh, value) });
  };

  put(slots.chapter, plan.chapter);
  put(slots.subtitle, plan.subtitle);
  put(slots.headline, plan.headline);

  var items = plan.items || [];
  for (var i = 0; i < slots.items.length; i++) {
    // 남는 슬롯은 지우지 않는다 — 도형(배경 박스)이 통째로 사라지면 화면이 빈다.
    // 대신 글자만 비운다.
    put(slots.items[i], i < items.length ? items[i] : ' ');
  }

  edits.sort(function (a, b) { return b.start - a.start; });
  edits.forEach(function (e) { xml = xml.slice(0, e.start) + e.sh + xml.slice(e.end); });

  return pageNo ? renumberPage_(xml, pageNo) : xml;
}

/** 슬라이드에 글자로 박혀 있는 'Page 18' 을 새 순서로 고친다 */
function renumberPage_(xml, pageNo) {
  var shapes = pptShapes_(xml);
  for (var i = 0; i < shapes.length; i++) {
    if (!PAGE_NO_RE.test(shapes[i].txt)) continue;
    var sh = replaceShapeText_(shapes[i].sh, 'Page ' + pageNo);
    return xml.slice(0, shapes[i].start) + sh + xml.slice(shapes[i].end);
  }
  return xml;
}

// ─────────────────────────────────────────────────────────────
// 유형 메뉴판 — LLM 에게 "이 중에 고르라" 고 줄 목록
// ─────────────────────────────────────────────────────────────

/**
 * 템플릿을 훑어 재사용 가능한 슬라이드를 유형으로 정리한다.
 * 사진이 많은 슬라이드는 뺀다 — 그 사업 전용 이미지라 다른 공고에 못 쓴다.
 */
function buildSlideMenu_(parts) {
  var cover = null, divider = null, closing = null, body = [];

  for (var i = 0; i < parts.length; i++) {
    var name = parts[i].getName();
    if (!PPT_SLIDE_RE.test(name)) continue;
    var no = Number(name.replace(/\D/g, ''));
    var xml = parts[i].getDataAsString('UTF-8');
    var s = slideSlots_(xml);

    var bodyCount = s.items.length + (s.headline ? 1 : 0);

    if (no === 1) { cover = no; continue; }
    // 간지: 큰 글자 몇 개뿐이고 소제목이 없다
    if (!s.subtitle && s.headline && s.headline.sz >= 30 && bodyCount <= 4) {
      if (divider === null) divider = no;
      closing = no;                       // 마지막 것을 마무리 장으로 쓴다
      continue;
    }
    if (s.pics > MAX_PICS_FOR_REUSE) continue;
    if (s.items.length < 3) continue;

    body.push({
      no: no,
      subtitle: s.subtitle ? s.subtitle.txt : '',
      headline: s.headline ? s.headline.txt : '',
      items: s.items.length,
      pics: s.pics
    });
  }
  return { cover: cover, divider: divider, closing: closing, body: body };
}

// ─────────────────────────────────────────────────────────────
// 덱 조립 — 고른 슬라이드로 새 pptx 를 만든다
// ─────────────────────────────────────────────────────────────

/**
 * @param {Array} parts  unzip 한 원본 조각들
 * @param {Array} plan   [{ src: 원본슬라이드번호, fill: {...} }, ...] 순서대로
 * @return {Array} 새 조각 배열
 */
function assembleDeck_(parts, plan) {
  var byName = {};
  parts.forEach(function (p) { byName[p.getName()] = p; });

  var pres = byName['ppt/presentation.xml'].getDataAsString('UTF-8');
  var prels = byName['ppt/_rels/presentation.xml.rels'].getDataAsString('UTF-8');
  var ct = byName['[Content_Types].xml'].getDataAsString('UTF-8');

  // 기존 슬라이드 관계와 Override 를 걷어내고 새로 넣는다
  prels = prels.replace(
    new RegExp('<Relationship[^>]*Type="' + REL_SLIDE.replace(/[/.]/g, '\\$&') + '"[^>]*/>', 'g'), '');
  ct = ct.replace(/<Override PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, '');

  var used = (prels.match(/Id="rId(\d+)"/g) || [])
    .map(function (s) { return Number(s.replace(/\D/g, '')); });
  var nextId = (used.length ? Math.max.apply(null, used) : 0) + 1;

  var out = [], relsXml = [], ctXml = [], sldIds = [];

  for (var i = 0; i < plan.length; i++) {
    var srcName = 'ppt/slides/slide' + plan[i].src + '.xml';
    var src = byName[srcName];
    if (!src) throw new Error('템플릿에 ' + srcName + ' 이 없습니다');

    var pos = i + 1;
    var dstName = 'ppt/slides/slide' + pos + '.xml';
    var xml = fillSlideByPlan_(src.getDataAsString('UTF-8'), plan[i].fill || {}, pos);
    out.push(Utilities.newBlob(xml, 'application/xml', dstName));

    var srcRels = byName['ppt/slides/_rels/slide' + plan[i].src + '.xml.rels'];
    if (srcRels) {
      // 복제본이 같은 노트를 가리키면 파일이 깨진다 — 노트 관계는 뺀다
      var rx = srcRels.getDataAsString('UTF-8').replace(
        new RegExp('<Relationship[^>]*Type="' + REL_NOTES.replace(/[/.]/g, '\\$&') + '"[^>]*/>', 'g'), '');
      out.push(Utilities.newBlob(rx, 'application/xml',
        'ppt/slides/_rels/slide' + pos + '.xml.rels'));
    }

    var rid = 'rId' + (nextId++);
    relsXml.push('<Relationship Id="' + rid + '" Type="' + REL_SLIDE +
                 '" Target="slides/slide' + pos + '.xml"/>');
    ctXml.push('<Override PartName="/' + dstName + '" ContentType="' + CT_SLIDE_XML + '"/>');
    sldIds.push('<p:sldId id="' + (255 + pos) + '" r:id="' + rid + '"/>');
  }

  if (pres.indexOf('<p:sldIdLst>') === -1) throw new Error('presentation.xml 에 sldIdLst 가 없습니다');
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
                      '<p:sldIdLst>' + sldIds.join('') + '</p:sldIdLst>');
  prels = prels.replace('</Relationships>', relsXml.join('') + '</Relationships>');
  ct = ct.replace('</Types>', ctXml.join('') + '</Types>');

  out.push(Utilities.newBlob(pres, 'application/xml', 'ppt/presentation.xml'));
  out.push(Utilities.newBlob(prels, 'application/xml', 'ppt/_rels/presentation.xml.rels'));
  out.push(Utilities.newBlob(ct, 'application/xml', '[Content_Types].xml'));

  // 나머지(레이아웃·마스터·미디어)는 그대로. 원본 슬라이드는 버린다.
  var skip = /^(ppt\/slides\/(_rels\/)?slide\d+\.xml(\.rels)?|ppt\/presentation\.xml|ppt\/_rels\/presentation\.xml\.rels|\[Content_Types\]\.xml)$/;
  parts.forEach(function (p) { if (!skip.test(p.getName())) out.push(p); });
  return out;
}


// ─────────────────────────────────────────────────────────────
// LLM 기획 — 유형을 고르고 슬롯 문구를 쓴다 (좌표는 만지지 않는다)
// ─────────────────────────────────────────────────────────────

/** 제안요청서 본문이 길면 앞부분만 쓴다. 토큰값이 여기서 결정된다 */
var RFP_MAX_CHARS = 12000;

function buildPlanPrompt_(bid, menu, rfpText) {
  var lines = [];
  lines.push('# 공고');
  lines.push('사업명: ' + bid.name);
  lines.push('발주기관: ' + (bid.noticeOrg || '미상'));
  if (bid.budget) lines.push('배정예산: ' + Math.round(bid.budget / 10000).toLocaleString() + '만원');
  if (bid.method) lines.push('업무구분: ' + bid.method);
  lines.push('');

  if (rfpText) {
    lines.push('# 제안요청서 발췌');
    lines.push(String(rfpText).slice(0, RFP_MAX_CHARS));
    lines.push('');
  }

  lines.push('# 쓸 수 있는 슬라이드 유형');
  lines.push('아래 유형만 쓸 수 있다. 각 유형은 items 칸 수가 정해져 있고 그보다 많이 쓸 수 없다.');
  menu.body.forEach(function (b) {
    lines.push('- type ' + b.no + ' : items ' + b.items + '칸' +
      (b.subtitle ? ' (원래 쓰임: ' + b.subtitle + ')' : ''));
  });
  return lines.join('\n');
}

var PLAN_SCHEMA_NOTE =
  '아래 JSON 형식으로만 답하라. 설명 문장을 덧붙이지 마라.\n' +
  '{\n' +
  '  "chapters": [\n' +
  '    { "no": "01", "title": "제안개요",\n' +
  '      "slides": [\n' +
  '        { "type": 4, "subtitle": "제안배경 및 목적",\n' +
  '          "headline": "한 줄짜리 핵심 메시지",\n' +
  '          "items": ["항목1", "항목2", "항목3"] }\n' +
  '      ] }\n' +
  '  ]\n' +
  '}\n' +
  '규칙:\n' +
  '- type 은 반드시 위 목록에 있는 번호여야 한다.\n' +
  '- items 개수는 그 type 의 칸 수를 넘지 않는다. 모자라면 적게 써도 된다.\n' +
  '- 장(chapter)은 3~5개, 각 장에 슬라이드 2~4장.\n' +
  '- headline 은 40자 이내, items 는 각 30자 이내. 도형 안에 들어가야 한다.\n' +
  '- 이 공고의 과업 내용에 맞는 구체적인 말을 써라. 일반론을 쓰지 마라.';

/**
 * 공고를 읽고 덱 구성을 짠다.
 * @return {Object} { chapters:[...], usage, cost }
 */
function planDeck_(bid, menu, rfpText) {
  if (!menu.body.length) throw new Error('템플릿에서 재사용할 수 있는 본문 슬라이드를 찾지 못했습니다.');

  var res = callOpenAI_([
    { role: 'system', content:
        '너는 공공 입찰 제안서를 기획하는 사람이다. 주어진 슬라이드 유형 안에서만 구성을 짠다. ' +
        '레이아웃이나 좌표는 정하지 않는다. 글자 수 제한을 반드시 지킨다.' },
    { role: 'user', content: buildPlanPrompt_(bid, menu, rfpText) + '\n\n' + PLAN_SCHEMA_NOTE }
  ], { json: true, temperature: 0.5, maxTokens: 3000 });

  var parsed;
  try {
    parsed = JSON.parse(res.text);
  } catch (e) {
    throw new Error('LLM 응답을 JSON 으로 읽지 못했습니다: ' + res.text.slice(0, 200));
  }
  parsed._usage = res.usage;
  parsed._cost = res.cost;
  parsed._model = res.model;
  return parsed;
}

/** 계획을 실제 슬라이드 순서로 편다. 유형 번호가 메뉴에 없으면 가장 가까운 것으로 바꾼다 */
function planToDeck_(plan, menu) {
  var valid = {}, fallback = null;
  menu.body.forEach(function (b) { valid[b.no] = b; if (!fallback) fallback = b; });

  var deck = [], warn = [];
  if (menu.cover) deck.push({ src: menu.cover, fill: {} });   // 표지는 뒤에서 따로 채운다

  (plan.chapters || []).forEach(function (ch, ci) {
    var no = ch.no || String(ci + 1);
    if (menu.divider) {
      deck.push({ src: menu.divider, fill: { headline: no + '. ' + (ch.title || '') } });
    }
    (ch.slides || []).forEach(function (sl) {
      var t = valid[sl.type];
      if (!t) {
        warn.push('유형 ' + sl.type + ' 은 템플릿에 없어 ' + fallback.no + ' 으로 바꿨습니다');
        t = fallback;
      }
      var items = (sl.items || []).slice(0, t.items);
      if ((sl.items || []).length > t.items) {
        warn.push(no + '장: 항목 ' + sl.items.length + '개 중 ' + t.items + '개만 넣었습니다 (칸 수 제한)');
      }
      deck.push({
        src: t.no,
        fill: {
          chapter: no + ' ' + (ch.title || ''),
          subtitle: sl.subtitle || '',
          headline: sl.headline || '',
          items: items
        }
      });
    });
  });

  if (menu.closing) deck.push({ src: menu.closing, fill: {} });
  return { deck: deck, warn: warn };
}

/**
 * 공고 하나로 제안서 초안 덱을 만든다. 웹에서 부른다.
 * @param {string} bidNo, bidOrd
 * @param {string} rfpText  업로드한 제안요청서 본문 (없으면 공고 정보만으로 짠다)
 */
function composeProposalPpt(bidNo, bidOrd, rfpText) {
  var bid = findBidRecord_(bidNo, bidOrd);
  var report = [];

  var file = DriveApp.getFileById(getPptTemplateId_());
  var parts = Utilities.unzip(file.getBlob().setContentType('application/zip'));

  var menu = buildSlideMenu_(parts);
  report.push('쓸 수 있는 본문 유형 ' + menu.body.length + '종');

  var plan = planDeck_(bid, menu, rfpText);
  report.push('기획: ' + (plan.chapters || []).length + '개 장 · ' +
    plan._model + ' · 토큰 ' + plan._usage.total +
    (plan._cost == null ? '' : ' · 약 $' + plan._cost.toFixed(4)));

  var built = planToDeck_(plan, menu);
  built.warn.forEach(function (w) { report.push(w); });

  // 표지와 실적은 우리가 아는 사실로 채운다 — LLM 이 지어내게 두지 않는다
  var byYear = perfLinesForBid_(bid.name);
  var newParts = assembleDeck_(parts, built.deck);
  for (var i = 0; i < newParts.length; i++) {
    var name = newParts[i].getName();
    if (name !== 'ppt/slides/slide1.xml') continue;
    var c = fillCoverSlideXml_(newParts[i].getDataAsString('UTF-8'), bid.name);
    if (c.changed) {
      newParts[i] = Utilities.newBlob(c.xml, 'application/xml', name);
      report.push('표지: 사업명 교체');
    }
    break;
  }

  var safe = String(bid.name || '제안서').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 50).trim();
  var outName = safe + '_제안서초안.pptx';
  var zipped = Utilities.zip(newParts, outName);

  report.push('완성: ' + built.deck.length + '장');
  return {
    name: outName,
    dataBase64: Utilities.base64Encode(zipped.getBytes()),
    report: report,
    slides: built.deck.length
  };
}

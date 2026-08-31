/**
 * Recommend.gs — 공고에 맞는 수행실적 추천
 *
 * 공고명·수요기관을 우리 실적 DB(과업명·용역개요·발주처)와 대조해
 * 비슷한 실적을 점수순으로 뽑는다. 제안서에 넣을 실적을 고르는 시간을 줄이는 게 목적.
 *
 * 방식: TF-IDF 코사인 유사도
 *   한국어 형태소 분석기가 없으므로 (어절 + 2글자 n-gram) 을 색인 단위로 쓴다.
 *   '용역', '사업', '운영' 처럼 어디에나 나오는 말은 IDF 가 알아서 눌러주므로
 *   불용어 목록을 손으로 관리할 필요가 없다.
 *
 * ⚠ 이 점수는 '후보를 위로 올려주는' 장치일 뿐이다.
 *    실제 제출 실적은 공고의 자격요건(유사용역 실적 금액·건수)에 달렸고,
 *    그건 사람이 공고문을 읽고 판단해야 한다. 자동 선택은 하지 않는다.
 */

var MATCH_TOP_N = 20;

/** 발주처가 같으면 주는 가산점 (같은 기관 실적은 실제로 강력한 근거다) */
var MATCH_ORG_BONUS = 0.15;

/** 최근 실적일수록 주는 가산점 (최대치) */
var MATCH_RECENCY_BONUS = 0.10;
var MATCH_RECENCY_SPAN_YEARS = 8;

// ─────────────────────────────────────────────────────────────
// 색인
// ─────────────────────────────────────────────────────────────

/**
 * 문자열을 검색 단위(term)의 배열로 쪼갠다.
 *   1) 공백/기호로 끊은 어절 (2글자 이상)
 *   2) 한글만 남긴 뒤 2글자 n-gram — 조사·어미가 붙어도 걸리게
 */
function tokenize_(text) {
  var s = String(text == null ? '' : text).toLowerCase();
  var terms = wordTokens_(s);

  var hangul = s.replace(/[^가-힣]/g, '');
  for (var i = 0; i + 2 <= hangul.length; i++) {
    terms.push(hangul.substr(i, 2));
  }
  return terms;
}

/**
 * 어절만 뽑는다 (n-gram 제외).
 * 점수 계산은 n-gram 까지 쓰지만, 사용자에게 보여줄 '근거'는
 * 사람이 읽을 수 있는 어절이어야 하므로 따로 관리한다.
 */
function wordTokens_(text) {
  var out = [];
  String(text == null ? '' : text).toLowerCase()
    .split(/[^0-9a-z가-힣]+/)
    .forEach(function (w) { if (w.length >= 2) out.push(w); });
  return out;
}

/** term → 등장 횟수 */
function termFreq_(terms) {
  var tf = {};
  terms.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
  return tf;
}

/**
 * 실적 전체로 IDF 표를 만든다.
 * 반환: { idf: {term: 값}, docs: [{record, tf, norm}] }
 */
function buildPerfIndex_(records) {
  var docs = records.map(function (r) {
    var text = [r.taskName, r.desc, r.org, r.field].filter(Boolean).join(' ');
    return { record: r, text: text.toLowerCase(), tf: termFreq_(tokenize_(text)) };
  });

  var df = {};
  docs.forEach(function (d) {
    Object.keys(d.tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
  });

  var n = docs.length || 1;
  var idf = {};
  Object.keys(df).forEach(function (t) {
    idf[t] = Math.log(1 + n / (1 + df[t]));
  });

  // 문서 벡터 길이 미리 계산 (코사인 분모)
  docs.forEach(function (d) {
    var sum = 0;
    Object.keys(d.tf).forEach(function (t) {
      var w = (1 + Math.log(d.tf[t])) * (idf[t] || 0);
      d.tf[t] = w;
      sum += w * w;
    });
    d.norm = Math.sqrt(sum) || 1;
  });

  return { idf: idf, df: df, docCount: n, docs: docs };
}

var EVIDENCE_MAX = 4;
var EVIDENCE_MAX_LEN = 14;

/**
 * 공고명과 실적에 공통으로 나오는 '구절'을 뽑아 근거로 쓴다.
 *
 * 점수는 n-gram 까지 써서 계산하지만, n-gram 조각('스포', '포츠')을 그대로
 * 보여주면 사람이 읽을 수 없다. 그래서 근거는 두 문장에 실제로 함께 등장하는
 * 가장 긴 구절로 따로 뽑는다. ('스포츠', '창업기업', '투자연계' 처럼)
 *
 * 실적 5건 중 1건 넘게 나오는 흔한 말('용역', '운영')은 어느 공고에나 걸리므로
 * 근거가 못 된다 — 코퍼스 빈도로 걸러낸다.
 */
function commonPhrases_(query, docText, corpusTexts) {
  var q = String(query || '').toLowerCase().replace(/\s+/g, ' ');
  var doc = String(docText || '');
  var limit = Math.max(2, Math.floor(corpusTexts.length * 0.2));
  var found = [];

  for (var len = Math.min(EVIDENCE_MAX_LEN, q.length); len >= 2; len--) {
    for (var i = 0; i + len <= q.length; i++) {
      var sub = trimFragment_(q.substr(i, len));
      if (!sub) continue;
      if (doc.indexOf(sub) === -1) continue;

      var covered = false;
      for (var k = 0; k < found.length; k++) {
        if (found[k].indexOf(sub) > -1) { covered = true; break; }
      }
      if (covered) continue;

      var df = 0;
      for (var c = 0; c < corpusTexts.length; c++) {
        if (corpusTexts[c].indexOf(sub) > -1 && ++df > limit) break;
      }
      if (df > limit) continue;

      found.push(sub);
      if (found.length >= EVIDENCE_MAX) return found;
    }
  }
  return found;
}

/**
 * 구절 앞뒤에 붙은 의미 없는 조각을 떼어낸다.
 * '2026년 스포츠' → '스포츠', '및 창업' → '창업'
 * 너무 짧아지면(한글 3자 미만) 근거로 쓰지 않는다.
 */
function trimFragment_(s) {
  var out = String(s)
    .replace(/^[\s0-9년월일제차회및외등의를을이가와과]+/, '')
    .replace(/[\s0-9년월일및외등의를을이가와과]+$/, '')
    .trim();
  if (!out) return '';

  // 공백을 가로지른 구절은 양 끝의 잘린 어절을 버린다.
  // '용역 서'(서원대학교의 앞글자) 같은 조각이 근거로 올라오는 걸 막는다.
  if (out.indexOf(' ') > -1) {
    var parts = out.split(' ');
    while (parts.length > 1 && parts[0].length < 2) parts.shift();
    while (parts.length > 1 && parts[parts.length - 1].length < 2) parts.pop();
    out = parts.join(' ').trim();
    if (!out) return '';
  }

  if (/^[0-9a-z]+$/.test(out)) return out.length >= 2 ? out : '';
  return out.replace(/\s/g, '').length >= 3 ? out : '';
}

// ─────────────────────────────────────────────────────────────
// 매칭
// ─────────────────────────────────────────────────────────────

/**
 * 공고 하나에 대해 유사 실적을 점수순으로 반환.
 * @param {string} bidNo  공고번호
 * @param {string} bidOrd 차수 (없으면 번호만으로 찾는다)
 */
function getBidMatches(bidNo, bidOrd) {
  var bids = getBidData();
  var key = String(bidNo || '').trim();
  var ord = String(bidOrd == null ? '' : bidOrd).trim();

  var bid = null;
  for (var i = 0; i < bids.length; i++) {
    if (String(bids[i].no).trim() !== key) continue;
    if (ord && String(bids[i].ord).trim() !== ord) continue;
    bid = bids[i];
    break;
  }
  if (!bid) throw new Error('공고를 찾지 못했습니다: ' + key);

  return JSON.parse(JSON.stringify({
    bid: bid,
    matches: matchPerformance_(bid)
  }));
}

/** 임의의 텍스트로 실적을 검색 (공고가 시트에 없을 때도 쓸 수 있게) */
function getMatchesByText(text) {
  return JSON.parse(JSON.stringify({
    bid: { name: String(text || ''), noticeOrg: '', demandOrg: '', budget: null },
    matches: matchPerformance_({ name: String(text || ''), noticeOrg: '', demandOrg: '' })
  }));
}

function matchPerformance_(bid) {
  var records = getPerformanceData();
  if (!records.length) return [];

  var index = buildPerfIndex_(records);
  var idf = index.idf;

  var queryText = [bid.name, bid.demandOrg, bid.noticeOrg].filter(Boolean).join(' ');
  var qtf = termFreq_(tokenize_(queryText));

  var qWeights = {}, qSum = 0;
  Object.keys(qtf).forEach(function (t) {
    var w = (1 + Math.log(qtf[t])) * (idf[t] || 0);
    if (!w) return;
    qWeights[t] = w;
    qSum += w * w;
  });
  var qNorm = Math.sqrt(qSum) || 1;

  var orgs = [bid.demandOrg, bid.noticeOrg]
    .map(function (o) { return normalizeOrg_(o); })
    .filter(Boolean);

  var corpusTexts = index.docs.map(function (d) { return d.text; });

  var scored = index.docs.map(function (d) {
    var dot = 0;

    Object.keys(qWeights).forEach(function (t) {
      var dw = d.tf[t];
      if (dw) dot += qWeights[t] * dw;
    });

    var cosine = dot / (qNorm * d.norm);
    var hits = cosine > 0 ? commonPhrases_(queryText, d.text, corpusTexts) : [];

    var orgBonus = 0;
    var docOrg = normalizeOrg_(d.record.org);
    if (docOrg && orgs.some(function (o) { return o === docOrg; })) {
      orgBonus = MATCH_ORG_BONUS;
    }

    var recency = 0;
    var year = Number(d.record.year);
    if (year) {
      var age = new Date().getFullYear() - year;
      if (age >= 0) {
        recency = MATCH_RECENCY_BONUS *
          Math.max(0, (MATCH_RECENCY_SPAN_YEARS - age) / MATCH_RECENCY_SPAN_YEARS);
      }
    }

    return {
      record: d.record,
      score: cosine + orgBonus + recency,
      cosine: cosine,
      sameOrg: orgBonus > 0,
      hits: hits
    };
  });

  scored.sort(function (a, b) { return b.score - a.score; });

  // 같은 과업이 여러 행으로 중복 등록된 경우가 있어 과업명 기준으로 한 번 걸러낸다
  var seen = {}, out = [];
  for (var i = 0; i < scored.length && out.length < MATCH_TOP_N; i++) {
    var s = scored[i];
    if (s.score <= 0) break;
    var dupKey = String(s.record.taskName || '').replace(/\s+/g, '') + '|' + s.record.year;
    if (seen[dupKey]) continue;
    seen[dupKey] = true;
    s.scorePct = Math.round(Math.min(1, s.score) * 100);
    out.push(s);
  }
  return out;
}

/** 기관명 비교용 정규화 — (재), 재단법인, 주식회사 등 껍데기를 벗긴다 */
function normalizeOrg_(org) {
  return String(org == null ? '' : org)
    .replace(/\(재\)|\(사\)|\(주\)|재단법인|사단법인|주식회사|특수법인/g, '')
    .replace(/\s+/g, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// 진단
// ─────────────────────────────────────────────────────────────

/** 메뉴: 매칭 시험 — 임의 문구로 실적이 잘 뽑히는지 확인 */
function testBidMatching() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    '실적 매칭 시험',
    '공고명을 입력하면 유사 실적을 뽑아봅니다.\n' +
    '예) 창업기업 액셀러레이팅 프로그램 운영 용역',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var text = res.getResponseText().trim();
  if (!text) return;

  try {
    var out = getMatchesByText(text);
    if (!out.matches.length) {
      ui.alert('일치하는 실적이 없습니다.');
      return;
    }
    var lines = out.matches.slice(0, 10).map(function (m, i) {
      return (i + 1) + '. [' + m.scorePct + '%] ' +
        String(m.record.taskName).slice(0, 42) +
        '\n     ' + m.record.year + ' · ' + String(m.record.org).slice(0, 24) +
        (m.sameOrg ? ' · 같은 발주처' : '') +
        '\n     근거: ' + m.hits.join(', ');
    });
    ui.alert('유사 실적 상위 10건\n\n' + lines.join('\n\n'));
  } catch (e) {
    ui.alert('매칭 실패\n\n' + (e.message || e));
  }
}

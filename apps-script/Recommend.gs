/**
 * Recommend.gs — 공고에 맞는 수행실적 / 참여인력 추천
 *
 * ■ 실적: 공고명 ↔ 과업명, 제목끼리만 비교한다
 *   용역개요나 공고문 본문을 넣으면 '지속가능한', '프로그램' 같은 계약 일반문구가
 *   근거로 잡혀 엉뚱한 실적이 올라온다. 실제로 물품구매 공고에 협력사 행동규범의
 *   문장이 근거로 붙는 걸 확인했다. 제목만 보는 게 단순하고 정확하다.
 *
 * ■ 인력: 지금 시트에 매칭에 쓸 만한 값이 경력 연차뿐이다.
 *   그래서 연차만으로 추천한다. 공고문에 '경력 5년 이상' 같은 요건이 있으면
 *   그걸 읽어 충족 여부를 표시한다.
 */

var MATCH_TOP_N = 20;
var MATCH_MIN_SCORE = 8;      // 이보다 낮으면 유사하다고 보지 않는다

/** 제목에서 지우는 말 — 어느 공고에나 있어서 유사도에 방해만 된다 */
var TITLE_NOISE = [
  '용역', '사업', '운영', '대행', '위탁', '구매', '계약', '공고', '입찰', '제안',
  '지원', '관련', '기획', '실시', '추진', '수행', '선정', '업체', '제작', '물품',
  '및', '등', '에', '대한', '위한', '통한'
];

var MATCH_FIELD_BONUS = 10;   // 분야가 같으면
var MATCH_ORG_BONUS = 8;      // 발주처가 같으면
var MATCH_RECENCY_BONUS = 6;  // 최근 실적이면
var MATCH_RECENCY_SPAN_YEARS = 8;

// ─────────────────────────────────────────────────────────────
// 제목 유사도
// ─────────────────────────────────────────────────────────────

/** 연도·회차·기호·흔한 말을 걷어내고 비교용 문자열만 남긴다 */
function normTitle_(s) {
  var t = String(s == null ? '' : s).toLowerCase();
  t = t.replace(/20\d{2}\s*년?도?/g, ' ')
       .replace(/제?\s*\d+\s*[회차]/g, ' ')
       .replace(/[^0-9a-z가-힣]+/g, ' ');
  TITLE_NOISE.forEach(function (w) { t = t.split(w).join(' '); });
  return t.replace(/\s+/g, '');
}

function bigrams_(s) {
  var set = {}, n = 0;
  for (var i = 0; i + 2 <= s.length; i++) {
    if (!set[s.substr(i, 2)]) { set[s.substr(i, 2)] = true; n++; }
  }
  return { set: set, size: n };
}

/** Dice 계수 — 두 제목이 얼마나 겹치는가 (0~1) */
function diceSim_(a, b) {
  if (!a.size || !b.size) return 0;
  var common = 0;
  Object.keys(a.set).forEach(function (g) { if (b.set[g]) common++; });
  return 2 * common / (a.size + b.size);
}

/** 두 제목에 공통으로 나오는 가장 긴 조각들 (근거 표시용) */
function titleOverlaps_(bidName, taskName) {
  var q = String(bidName || '').toLowerCase().replace(/\s+/g, ' ');
  var d = String(taskName || '').toLowerCase();
  var found = [];

  for (var len = Math.min(12, q.length); len >= 2; len--) {
    for (var i = 0; i + len <= q.length; i++) {
      var sub = q.substr(i, len).trim();
      if (sub.length < 2 || /^\d+$/.test(sub)) continue;
      if (TITLE_NOISE.indexOf(sub) > -1) continue;
      if (d.indexOf(sub) === -1) continue;
      var covered = found.some(function (f) { return f.indexOf(sub) > -1; });
      if (covered) continue;
      found.push(sub);
      if (found.length >= 3) return found;
    }
  }
  return found;
}

// ─────────────────────────────────────────────────────────────
// 분야 (보조 신호)
// ─────────────────────────────────────────────────────────────

var FIELD_KEYWORDS = {
  '행사 기획·운영': ['박람회', '컨퍼런스', '콘퍼런스', '포럼', '개막식', '시상식', '페스티벌',
    '축제', '전시', '행사', '세미나', '워크숍', '국제회의', 'mice', '경진대회', '공모전',
    '데모데이', '설명회', '발표회'],
  '스타트업 지원': ['창업', '스타트업', '액셀러레이팅', '보육', '크라우드펀딩', '투자연계',
    '투자유치', 'ir', '사업화', '판로', '기업지원', '스케일업', '오픈이노베이션', '벤처'],
  '교육': ['교육', '연수', '아카데미', '커리큘럼', '강의', '특강', '양성', '역량강화',
    '진로', '체험', '캠프', '멘토링'],
  '홍보/마케팅': ['홍보', '마케팅', '캠페인', '광고', '영상', '콘텐츠', 'sns', '미디어', '브랜딩'],
  'IT 플랫폼 운영': ['플랫폼', '시스템', '웹사이트', '홈페이지', '온라인채널', '앱', '데이터',
    '디지털', '고도화'],
  '지역 브랜딩/상권활성화': ['상권', '전통시장', '골목', '소상공인', '도시재생', '지역활성화',
    '관광', '마을', '점포']
};

/** 공고명에서 분야를 판정한다 (실적 필터가 아니라 가산점용) */
function decideField(text) {
  var hay = String(text || '').toLowerCase();
  var best = '', bestScore = 0, bestHits = [];

  Object.keys(FIELD_KEYWORDS).forEach(function (field) {
    var kws = FIELD_KEYWORDS[field], score = 0, hits = [];
    kws.forEach(function (kw, i) {
      if (hay.indexOf(kw) === -1) return;
      score += Math.max(1, kws.length - i);
      hits.push(kw);
    });
    if (score > bestScore) { best = field; bestScore = score; bestHits = hits; }
  });

  return { field: best, hits: bestHits };
}

// ─────────────────────────────────────────────────────────────
// 실적 매칭
// ─────────────────────────────────────────────────────────────

function getBidMatches(bidNo, bidOrd) {
  var bid = findBidRecord_(bidNo, bidOrd);
  return JSON.parse(JSON.stringify(buildMatchResult_(bid)));
}

function getMatchesByText(text) {
  return JSON.parse(JSON.stringify(buildMatchResult_({
    name: String(text || ''), noticeOrg: '', demandOrg: ''
  })));
}

function findBidRecord_(bidNo, bidOrd) {
  var bids = getBidData();
  var key = String(bidNo || '').trim();
  var ord = String(bidOrd == null ? '' : bidOrd).trim();
  for (var i = 0; i < bids.length; i++) {
    if (String(bids[i].no).trim() !== key) continue;
    if (ord && String(bids[i].ord).trim() !== ord) continue;
    return bids[i];
  }
  throw new Error('공고를 찾지 못했습니다: ' + key);
}

function buildMatchResult_(bid) {
  var decision = decideField(bid.name);
  return { bid: bid, field: decision, matches: matchByTitle_(bid, decision) };
}

function matchByTitle_(bid, decision) {
  var records = getPerformanceData();
  if (!records.length) return [];

  var q = bigrams_(normTitle_(bid.name));
  var thisYear = new Date().getFullYear();
  var orgs = [bid.demandOrg, bid.noticeOrg]
    .map(function (o) { return normalizeOrg_(o); }).filter(Boolean);

  var scored = [];
  records.forEach(function (r) {
    if (!r.taskName) return;

    // ── 제목끼리만 비교한다 ──
    var sim = diceSim_(q, bigrams_(normTitle_(r.taskName)));
    var score = sim * 100;
    if (score < 1) return;

    var sameField = decision.field && r.field === decision.field;
    if (sameField) score += MATCH_FIELD_BONUS;

    var sameOrg = orgs.length > 0 && orgs.indexOf(normalizeOrg_(r.org)) > -1;
    if (sameOrg) score += MATCH_ORG_BONUS;

    var year = Number(r.year);
    if (year && thisYear - year >= 0) {
      score += MATCH_RECENCY_BONUS *
        Math.max(0, (MATCH_RECENCY_SPAN_YEARS - (thisYear - year)) / MATCH_RECENCY_SPAN_YEARS);
    }

    if (score < MATCH_MIN_SCORE) return;

    scored.push({
      record: r,
      scorePct: Math.min(100, Math.round(score)),
      titleSim: Math.round(sim * 100),
      sameField: !!sameField,
      sameOrg: sameOrg,
      hits: titleOverlaps_(bid.name, r.taskName)
    });
  });

  scored.sort(function (a, b) {
    return b.scorePct - a.scorePct || (Number(b.record.year) || 0) - (Number(a.record.year) || 0);
  });

  var seen = {}, out = [];
  for (var i = 0; i < scored.length && out.length < MATCH_TOP_N; i++) {
    var key = String(scored[i].record.taskName || '').replace(/\s+/g, '') + '|' + scored[i].record.year;
    if (seen[key]) continue;
    seen[key] = true;
    out.push(scored[i]);
  }
  return out;
}

function normalizeOrg_(org) {
  return String(org == null ? '' : org)
    .replace(/\(재\)|\(사\)|\(주\)|재단법인|사단법인|주식회사|특수법인/g, '')
    .replace(/\s+/g, '').trim();
}

// ─────────────────────────────────────────────────────────────
// 인력 추천 (연차 기준)
// ─────────────────────────────────────────────────────────────

/** '5년 4개월' / '0년 6개월' → 개월 수 */
function careerMonths_(text) {
  var s = String(text == null ? '' : text);
  var y = s.match(/(\d+)\s*년/);
  var m = s.match(/(\d+)\s*개?월/);
  if (!y && !m) return null;
  var months = (y ? parseInt(y[1], 10) * 12 : 0) + (m ? parseInt(m[1], 10) : 0);
  // 시트에 '126년 8개월' 같은 계산 오류가 있다. 사람 경력으로 불가능한 값은 버린다
  if (months > 60 * 12) return null;
  return months;
}

/** 공고문에서 요구 경력을 찾는다 — 없으면 null */
function extractCareerRequirement_(briefText) {
  if (!briefText) return null;
  var pats = [
    /(?:경력|실무경력|동종업계)[^\n]{0,20}?(\d+)\s*년\s*이상/,
    /(\d+)\s*년\s*이상[^\n]{0,10}?경력/
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = String(briefText).match(pats[i]);
    if (m) return { years: parseInt(m[1], 10), text: m[0].replace(/\s+/g, ' ').trim() };
  }
  return null;
}

/**
 * 참여인력 추천 — 연차 순.
 * @param {string} briefText 공고문 본문 (있으면 요구 경력을 읽는다)
 */
function recommendPeople(briefText) {
  var req = extractCareerRequirement_(briefText);
  var minMonths = req ? req.years * 12 : 0;

  var people = getHRData()
    .filter(function (r) { return String(r.status || '').indexOf('재직') === 0; })
    .map(function (r) {
      var months = careerMonths_(r.career);
      return {
        name: r.name,
        dept: r.dept,
        position: r.position,
        career: r.career,
        joinDate: r.joinDate,
        months: months,
        meets: months !== null && months >= minMonths
      };
    })
    .sort(function (a, b) {
      if (a.months === null && b.months === null) return 0;
      if (a.months === null) return 1;
      if (b.months === null) return -1;
      return b.months - a.months;
    });

  return JSON.parse(JSON.stringify({
    requirement: req,
    people: people
  }));
}

// ─────────────────────────────────────────────────────────────
// 진단
// ─────────────────────────────────────────────────────────────

/** 메뉴: 제목 매칭 시험 */
function testBidMatching() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    '실적 매칭 시험 (제목 기준)',
    '공고명을 입력하세요.\n예) 창업기업 투자연계 활성화 사업 운영 용역',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var text = res.getResponseText().trim();
  if (!text) return;

  try {
    var out = getMatchesByText(text);
    if (!out.matches.length) {
      ui.alert(
        '유사한 실적이 없습니다.\n\n' +
        '판정 분야: ' + (out.field.field || '(없음)') + '\n\n' +
        '제목이 겹치는 실적이 없다는 뜻입니다.\n' +
        '우리가 해본 적 없는 분야의 공고일 수 있습니다.');
      return;
    }
    var lines = out.matches.slice(0, 10).map(function (m, i) {
      return (i + 1) + '. [' + m.scorePct + '] ' + String(m.record.taskName).slice(0, 42) +
             '\n     제목유사 ' + m.titleSim + ' · ' + m.record.year + ' · ' + m.record.field +
             (m.sameOrg ? ' · 같은 발주처' : '') +
             '\n     겹친 말: ' + (m.hits.join(', ') || '-');
    });
    ui.alert(
      '판정 분야: ' + (out.field.field || '(없음)') + '\n\n' +
      '상위 ' + Math.min(10, out.matches.length) + '건\n' + lines.join('\n'));
  } catch (e) {
    ui.alert('매칭 실패\n\n' + (e.message || e));
  }
}

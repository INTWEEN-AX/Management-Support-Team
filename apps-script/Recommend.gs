/**
 * Recommend.gs — 공고에 맞는 수행실적 추천 (분야 기준)
 *
 * 실적을 고르는 실제 기준은 '분야' 다. 공고가 행사면 행사 실적을,
 * 창업지원이면 창업지원 실적을 낸다. 문장 유사도로 재는 것보다
 * 분야를 판정해서 묶어주는 쪽이 실무와 맞고, 왜 뽑혔는지도 명확하다.
 *
 * 흐름:
 *   1) 공고명에서 분야를 판정한다 (키워드 사전)
 *   2) 그 분야 실적을 최신순으로 낸다
 *   3) 인접 분야 실적을 그 아래에 붙인다
 *
 * 공고문 본문 없이 공고명만으로 동작한다.
 */

var MATCH_TOP_N = 30;

/**
 * 분야 판정 키워드.
 * 실적 시트의 '분야' 값과 이름이 같아야 한다.
 * 앞쪽 키워드일수록 그 분야를 강하게 가리킨다.
 */
var FIELD_KEYWORDS = {
  '행사 기획·운영': [
    '박람회', '컨퍼런스', '콘퍼런스', '포럼', '개막식', '시상식', '페스티벌', '축제',
    '전시', '행사', '세미나', '워크숍', '국제회의', 'mice', '마이스', '경진대회',
    '공모전', '데모데이', '설명회', '발표회', '운영대행', '기획운영', '대행용역'
  ],
  '스타트업 지원': [
    '창업', '스타트업', '액셀러레이팅', '보육', '크라우드펀딩', '투자연계', '투자유치',
    'ir', '사업화', '판로', '기업지원', '스케일업', '오픈이노베이션', '벤처'
  ],
  '교육': [
    '교육', '연수', '아카데미', '커리큘럼', '강의', '특강', '양성', '역량강화',
    '진로', '체험', '캠프', '멘토링', '컨설팅'
  ],
  '홍보/마케팅': [
    '홍보', '마케팅', '캠페인', '광고', '영상', '콘텐츠', 'sns', '미디어',
    '브랜딩', '디자인', '제작'
  ],
  'IT 플랫폼 운영': [
    '플랫폼', '시스템', '웹사이트', '홈페이지', '온라인채널', '앱', '데이터',
    '디지털', '구축', '고도화', '운영관리'
  ],
  '지역 브랜딩/상권활성화': [
    '상권', '전통시장', '골목', '소상공인', '도시재생', '지역활성화', '관광',
    '지역', '마을', '점포'
  ]
};

/** 인접 분야 — 주 분야 실적이 모자랄 때 함께 보여준다 */
var FIELD_NEIGHBORS = {
  '행사 기획·운영': ['홍보/마케팅', '스타트업 지원'],
  '스타트업 지원': ['교육', '행사 기획·운영'],
  '교육': ['스타트업 지원', '행사 기획·운영'],
  '홍보/마케팅': ['행사 기획·운영', 'IT 플랫폼 운영'],
  'IT 플랫폼 운영': ['홍보/마케팅', '스타트업 지원'],
  '지역 브랜딩/상권활성화': ['행사 기획·운영', '스타트업 지원']
};

/** 같은 발주처면 위로 올린다 */
var MATCH_ORG_BONUS = 12;
var MATCH_RECENCY_SPAN_YEARS = 8;

// ─────────────────────────────────────────────────────────────
// 분야 판정
// ─────────────────────────────────────────────────────────────

/**
 * 공고명에서 분야를 판정한다.
 * 반환: { field, hits, scores, alternatives }
 */
function decideField(text) {
  var hay = String(text || '').toLowerCase();
  var scores = {}, hitMap = {};

  Object.keys(FIELD_KEYWORDS).forEach(function (field) {
    var kws = FIELD_KEYWORDS[field];
    var score = 0, hits = [];
    kws.forEach(function (kw, i) {
      if (hay.indexOf(kw) === -1) return;
      // 앞쪽 키워드일수록 그 분야를 강하게 가리킨다
      score += Math.max(1, kws.length - i);
      hits.push(kw);
    });
    scores[field] = score;
    hitMap[field] = hits;
  });

  var ranked = Object.keys(scores)
    .filter(function (f) { return scores[f] > 0; })
    .sort(function (a, b) { return scores[b] - scores[a]; });

  if (!ranked.length) {
    return { field: '', hits: [], scores: scores, alternatives: [] };
  }

  var top = ranked[0];
  return {
    field: top,
    hits: hitMap[top],
    scores: scores,
    // 점수가 주 분야의 절반을 넘으면 함께 볼 만하다
    alternatives: ranked.slice(1).filter(function (f) {
      return scores[f] >= scores[top] * 0.5;
    })
  };
}

// ─────────────────────────────────────────────────────────────
// 매칭
// ─────────────────────────────────────────────────────────────

/** 공고번호로 매칭 */
function getBidMatches(bidNo, bidOrd) {
  var bid = findBidRecord_(bidNo, bidOrd);
  return JSON.parse(JSON.stringify(buildMatchResult_(bid)));
}

/** 임의 문구로 매칭 (시험용) */
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
  return {
    bid: bid,
    field: decision,
    matches: matchByField_(bid, decision)
  };
}

function matchByField_(bid, decision) {
  var records = getPerformanceData();
  if (!records.length) return [];

  var thisYear = new Date().getFullYear();
  var orgs = [bid.demandOrg, bid.noticeOrg]
    .map(function (o) { return normalizeOrg_(o); })
    .filter(Boolean);

  var neighbors = decision.field ? (FIELD_NEIGHBORS[decision.field] || []) : [];
  var alternatives = decision.alternatives || [];

  var scored = [];
  records.forEach(function (r) {
    var field = String(r.field || '미분류');
    var tier, base;

    if (decision.field && field === decision.field) { tier = 1; base = 90; }
    else if (alternatives.indexOf(field) > -1)      { tier = 2; base = 70; }
    else if (neighbors.indexOf(field) > -1)         { tier = 3; base = 50; }
    else if (!decision.field)                       { tier = 4; base = 40; }
    else return;                                    // 무관한 분야는 아예 뺀다

    var recency = 0;
    var year = Number(r.year);
    if (year) {
      var age = thisYear - year;
      if (age >= 0) {
        recency = 10 * Math.max(0, (MATCH_RECENCY_SPAN_YEARS - age) / MATCH_RECENCY_SPAN_YEARS);
      }
    }

    var sameOrg = orgs.length > 0 && orgs.indexOf(normalizeOrg_(r.org)) > -1;

    scored.push({
      record: r,
      tier: tier,
      sameOrg: sameOrg,
      scorePct: Math.min(100, Math.round(base + recency + (sameOrg ? MATCH_ORG_BONUS : 0))),
      hits: fieldHitsIn_(r, decision.field)
    });
  });

  scored.sort(function (a, b) {
    return b.scorePct - a.scorePct ||
           (Number(b.record.year) || 0) - (Number(a.record.year) || 0) ||
           (Number(b.record.amount) || 0) - (Number(a.record.amount) || 0);
  });

  // 같은 과업이 여러 행으로 중복 등록된 경우가 있다
  var seen = {}, out = [];
  for (var i = 0; i < scored.length && out.length < MATCH_TOP_N; i++) {
    var key = String(scored[i].record.taskName || '').replace(/\s+/g, '') + '|' + scored[i].record.year;
    if (seen[key]) continue;
    seen[key] = true;
    out.push(scored[i]);
  }
  return out;
}

/** 이 실적의 어느 말이 해당 분야를 가리키는지 (근거 표시용) */
function fieldHitsIn_(record, field) {
  if (!field || !FIELD_KEYWORDS[field]) return [];
  var hay = [record.taskName, record.desc].filter(Boolean).join(' ').toLowerCase();
  return FIELD_KEYWORDS[field]
    .filter(function (kw) { return hay.indexOf(kw) > -1; })
    .slice(0, 4);
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

/** 메뉴: 분야 판정 + 실적 매칭 시험 */
function testBidMatching() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    '분야 판정 / 실적 매칭 시험',
    '공고명을 입력하세요.\n예) 창업기업 액셀러레이팅 프로그램 운영 용역',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var text = res.getResponseText().trim();
  if (!text) return;

  try {
    var out = getMatchesByText(text);
    var d = out.field;
    var head = d.field
      ? '판정 분야: ' + d.field + '\n걸린 키워드: ' + d.hits.join(', ') +
        (d.alternatives.length ? '\n함께 볼 분야: ' + d.alternatives.join(', ') : '')
      : '분야를 판정하지 못했습니다 (키워드 없음) — 전체 실적을 최신순으로 냅니다.';

    var lines = out.matches.slice(0, 10).map(function (m, i) {
      return (i + 1) + '. [' + m.scorePct + '] ' + String(m.record.taskName).slice(0, 40) +
             '\n     ' + m.record.year + ' · ' + m.record.field +
             (m.sameOrg ? ' · 같은 발주처' : '');
    });

    ui.alert(head + '\n\n상위 10건\n' + lines.join('\n'));
  } catch (e) {
    ui.alert('매칭 실패\n\n' + (e.message || e));
  }
}

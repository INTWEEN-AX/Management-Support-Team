/**
 * Proposal.gs — 기술 제안서(PPT) 초안 생성의 OpenAI 연결부
 *
 * 아직 생성 기능은 붙어 있지 않습니다. 지금 들어 있는 것은
 *   1) 키를 읽고 호출하는 공통 배관
 *   2) 하루 호출 상한 (웹앱이 ANYONE 공개라 남이 눌러도 과금됩니다)
 *   3) 메뉴에서 돌려보는 연결 확인
 * 세 가지입니다.
 *
 * 키는 코드에 두지 않습니다. 프로젝트 설정 → 스크립트 속성에
 *   OPENAI_API_KEY   (필수)
 *   OPENAI_MODEL     (선택, 기본값은 아래 DEFAULT_MODEL)
 * 로 넣어주세요.
 */

var OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
var OPENAI_MODELS_ENDPOINT = 'https://api.openai.com/v1/models';

/** 스크립트 속성에 OPENAI_MODEL 이 없을 때 쓰는 값 */
var DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * 하루 호출 상한.
 * 웹앱이 "access": "ANYONE" 이라 URL 을 아는 사람은 누구나 생성 버튼을
 * 누를 수 있고, 그 비용은 키 주인에게 청구됩니다. 접근 제어를 걸기
 * 전까지의 안전망입니다.
 */
var DAILY_CALL_LIMIT = 100;

/**
 * 참고용 단가 (USD / 100만 토큰).
 * ⚠ OpenAI 가 값을 바꾸면 여기도 같이 고쳐야 합니다. 청구 금액이 아니라
 *   "이번 호출이 대충 얼마짜리였나" 를 감으로 보기 위한 수치입니다.
 */
var PRICE_TABLE = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o':      { input: 2.50, output: 10.00 },
  'gpt-4.1-mini':{ input: 0.40, output: 1.60 },
  'gpt-4.1':     { input: 2.00, output: 8.00 }
};

// ── 설정 읽기 ──

function getOpenAIKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!key) {
    throw new Error(
      'OPENAI_API_KEY 가 없습니다.\n' +
      'Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에 추가해주세요.');
  }
  return key.trim();
}

function getOpenAIModel_() {
  var m = PropertiesService.getScriptProperties().getProperty('OPENAI_MODEL');
  return (m && m.trim()) || DEFAULT_MODEL;
}

// ── 하루 상한 ──

/**
 * 오늘 호출 수를 하나 올리고, 상한을 넘으면 던진다.
 * 자정에 알아서 0 으로 돌아가도록 날짜를 키에 넣는다.
 */
function countOpenAICall_() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var key = 'OPENAI_CALLS_' + today;

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var n = Number(props.getProperty(key) || 0) + 1;
    if (n > DAILY_CALL_LIMIT) {
      throw new Error(
        '오늘 OpenAI 호출이 상한(' + DAILY_CALL_LIMIT + '회)에 닿았습니다.\n' +
        '의도한 사용이라면 Proposal.gs 의 DAILY_CALL_LIMIT 를 올려주세요.');
    }
    props.setProperty(key, String(n));
    return n;
  } finally {
    lock.releaseLock();
  }
}

/** 오늘 몇 번 썼는지 (상한을 올리지 않고 보기만) */
function todayOpenAICalls_() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  return Number(PropertiesService.getScriptProperties()
    .getProperty('OPENAI_CALLS_' + today) || 0);
}

// ── 호출 ──

/**
 * Chat Completions 한 번.
 *
 * @param {Array}  messages  [{role, content}, ...]
 * @param {Object} opts      { model, temperature, maxTokens, json }
 *                           json: true 면 응답을 JSON 객체로 강제한다
 * @return {Object} { text, usage:{prompt,completion,total}, model, cost }
 */
function callOpenAI_(messages, opts) {
  opts = opts || {};
  assertAccess_('OpenAI 호출');   // 누르는 만큼 비용이 나간다
  countOpenAICall_();

  var model = opts.model || getOpenAIModel_();
  var payload = {
    model: model,
    messages: messages,
    temperature: opts.temperature == null ? 0.4 : opts.temperature
  };
  if (opts.maxTokens) payload.max_tokens = opts.maxTokens;
  if (opts.json) payload.response_format = { type: 'json_object' };

  var res = UrlFetchApp.fetch(OPENAI_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getOpenAIKey_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();

  if (code !== 200) {
    // 키가 그대로 로그에 남지 않도록 응답 본문만 옮긴다
    var msg = body;
    try { msg = JSON.parse(body).error.message; } catch (e) { /* 원문 그대로 */ }
    throw new Error('OpenAI 오류 (' + code + '): ' + msg);
  }

  var data = JSON.parse(body);
  var usage = data.usage || {};
  return {
    text: data.choices && data.choices[0] ? data.choices[0].message.content : '',
    model: data.model || model,
    usage: {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
      total: usage.total_tokens || 0
    },
    cost: estimateCost_(model, usage.prompt_tokens || 0, usage.completion_tokens || 0)
  };
}

/** 대략의 비용(USD). 단가표에 없는 모델이면 null 을 준다 — 모르면 모른다고 한다 */
function estimateCost_(model, inTok, outTok) {
  var p = PRICE_TABLE[model];
  if (!p) {
    // 'gpt-4o-mini-2024-07-18' 처럼 날짜가 붙은 이름 처리
    var base = Object.keys(PRICE_TABLE).filter(function (k) {
      return model.indexOf(k) === 0;
    }).sort(function (a, b) { return b.length - a.length; })[0];
    p = base ? PRICE_TABLE[base] : null;
  }
  if (!p) return null;
  return (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
}

// ── 메뉴: 연결 확인 ──

/**
 * 키가 살아 있는지, 어떤 모델을 쓸 수 있는지 한 번에 본다.
 * 아주 짧은 호출 하나만 보내므로 비용은 사실상 0 이다.
 */
function checkOpenAI() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];

  var key;
  try {
    key = getOpenAIKey_();
  } catch (e) {
    ui.alert('OpenAI 연결 확인', e.message, ui.ButtonSet.OK);
    return;
  }

  lines.push('키: 등록됨 (' + key.length + '자, ' + key.slice(0, 7) + '…)');
  lines.push('설정된 모델: ' + getOpenAIModel_() +
    (PropertiesService.getScriptProperties().getProperty('OPENAI_MODEL')
      ? '' : ' (기본값 — OPENAI_MODEL 속성 없음)'));
  lines.push('오늘 호출 수: ' + todayOpenAICalls_() + ' / ' + DAILY_CALL_LIMIT);
  lines.push('');

  // 1) 이 키로 쓸 수 있는 모델 목록 — 이름을 추측하지 않기 위해 직접 물어본다
  try {
    var mres = UrlFetchApp.fetch(OPENAI_MODELS_ENDPOINT, {
      headers: { Authorization: 'Bearer ' + key },
      muteHttpExceptions: true
    });
    if (mres.getResponseCode() === 200) {
      var all = JSON.parse(mres.getContentText()).data.map(function (m) { return m.id; });
      var chat = all.filter(function (id) { return /^(gpt|o\d)/.test(id); });

      // 'gpt-4o-2024-08-06' 같은 날짜 붙은 변형은 접는다 — 고를 때 방해만 된다
      var base = chat.filter(function (id) {
        return !/-\d{4}(-\d{2}-\d{2})?$/.test(id);
      }).sort();

      lines.push('쓸 수 있는 모델 ' + chat.length + '종 ' +
        '(날짜 변형 제외 ' + base.length + '종):');
      lines.push('  ' + base.join(', '));
    } else {
      lines.push('모델 목록 조회 실패 (' + mres.getResponseCode() + ')');
    }
  } catch (e) {
    lines.push('모델 목록 조회 실패: ' + e.message);
  }
  lines.push('');

  // 2) 실제로 한 번 호출해본다
  var t0 = new Date().getTime();
  try {
    var r = callOpenAI_(
      [{ role: 'user', content: '연결 확인. "정상" 두 글자만 답하세요.' }],
      { temperature: 0, maxTokens: 10 });
    var ms = new Date().getTime() - t0;

    lines.push('호출 성공 (' + ms + 'ms)');
    lines.push('  응답 모델: ' + r.model);
    lines.push('  응답: ' + r.text.trim());
    lines.push('  토큰: 입력 ' + r.usage.prompt + ' / 출력 ' + r.usage.completion);
    lines.push('  비용: ' + (r.cost == null
      ? '단가표에 없는 모델이라 계산 못 함'
      : '$' + r.cost.toFixed(6)));
  } catch (e) {
    lines.push('호출 실패: ' + e.message);
  }

  ui.alert('OpenAI 연결 확인', lines.join('\n'), ui.ButtonSet.OK);
}

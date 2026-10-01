/**
 * Access.gs — 누가 이 포털을 열 수 있는가
 *
 * 지금까지는 URL 만 알면 누구나 열렸다("access": "ANYONE"). 조회만 할 때는
 * 넘어갈 수 있었지만, 앞으로 붙일 것들은 그러면 안 된다:
 *   · 보상휴가 사용 등록 — 남의 이름으로 차감을 넣을 수 있다
 *   · 법인카드 영수증 — 재무 정보다
 *   · OpenAI 호출 — 누르는 만큼 회사 카드에서 나간다
 *
 * 지메일 계정이라 도메인 제한("access": "DOMAIN")은 못 쓴다. 그래서
 * 접속한 사람의 계정을 확인해 인력 시트에 있는 사람만 통과시킨다.
 *
 * ⚠ 잠그자마자 전원이 못 들어오는 사고를 막기 위해 두 단계로 나눴다.
 *   ACCESS_MODE = 'open'   (기본) 막지 않는다. 누가 통과/차단될지 기록만 한다
 *   ACCESS_MODE = 'strict'        실제로 막는다
 * 'open' 으로 며칠 돌려 명단이 맞는지 확인한 뒤 'strict' 로 바꾼다.
 */

var ACCESS_MODE_PROP = 'ACCESS_MODE';
var ADMIN_EMAILS_PROP = 'ADMIN_EMAILS';

/**
 * 접속한 사람의 구글 계정. 확인이 안 되면 빈 문자열.
 *
 * ⚠ executeAs 를 USER_DEPLOYING 으로 바꾼 뒤부터는 getEffectiveUser() 가
 *   접속자가 아니라 '배포한 계정' 을 돌려준다. 그걸 쓰면 누가 들어와도
 *   소유자로 보여서 명단 검사가 통째로 무력해진다. 그래서 접속자를 알려주는
 *   getActiveUser() 만 쓴다 — 외부 지메일 계정이면 빈 문자열이 나오는데,
 *   그건 '모르는 사람' 이 맞으므로 그대로 둔다.
 */
function currentUserEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (err) {
    return '';
  }
}

function accessMode_() {
  var m = PropertiesService.getScriptProperties().getProperty(ACCESS_MODE_PROP);
  return (m === 'strict') ? 'strict' : 'open';
}

/** 스크립트 속성에 적어둔 관리자. 명단이 비어도 이 사람들은 항상 통과한다 */
function adminEmails_() {
  var raw = PropertiesService.getScriptProperties().getProperty(ADMIN_EMAILS_PROP) || '';
  var list = raw.split(/[,\s;]+/).map(function (s) { return s.trim().toLowerCase(); })
                .filter(Boolean);
  // 이 스크립트를 소유한 계정은 무슨 일이 있어도 잠기면 안 된다
  try {
    var owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (owner && list.indexOf(owner) === -1 && !list.length) list.push(owner);
  } catch (e) { /* 무시 */ }
  return list;
}

/**
 * 인력 시트의 '이메일 주소' 를 명단으로 쓴다.
 * 사람이 따로 관리하는 명단을 하나 더 만들면 반드시 어긋난다 —
 * 입퇴사가 이미 반영되는 곳을 그대로 쓴다.
 */
function allowedEmails_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('allow_emails');
  if (hit) return JSON.parse(hit);

  var out = [];
  try {
    getHRData().forEach(function (p) {
      var e = String(p.email || '').trim().toLowerCase();
      if (e && e.indexOf('@') > 0) out.push(e);
    });
  } catch (e) { /* 시트를 못 읽으면 관리자만 통과시킨다 */ }

  cache.put('allow_emails', JSON.stringify(out), 600);   // 10분
  return out;
}

/**
 * @return {Object} { email, allowed, reason, mode }
 *   allowed 는 'strict' 일 때만 실제 차단에 쓴다.
 */
function checkCurrentAccess_() {
  var email = currentUserEmail_();
  var mode = accessMode_();
  var admins = adminEmails_();

  if (!email) {
    return { email: '', allowed: false, mode: mode,
             reason: '구글 계정을 확인할 수 없습니다' };
  }
  if (admins.indexOf(email) > -1) {
    return { email: email, allowed: true, mode: mode, reason: '관리자' };
  }
  var list = allowedEmails_();
  if (!list.length) {
    return { email: email, allowed: false, mode: mode,
             reason: '인력 시트에서 이메일 명단을 읽지 못했습니다' };
  }
  if (list.indexOf(email) > -1) {
    return { email: email, allowed: true, mode: mode, reason: '재직자 명단' };
  }
  return { email: email, allowed: false, mode: mode, reason: '명단에 없습니다' };
}

/**
 * 민감한 서버 함수 앞에 세운다.
 * 'open' 모드에서는 막지 않고 기록만 남긴다 — 명단이 아직 검증 전이므로.
 */
function assertAccess_(what) {
  var a = checkCurrentAccess_();
  if (!a.allowed) {
    Logger.log('접근 거절 대상: ' + (a.email || '(계정 미확인)') +
               ' / ' + what + ' / ' + a.reason + ' / mode=' + a.mode);
    if (a.mode === 'strict') {
      throw new Error('이 기능을 쓸 권한이 없습니다. (' + (a.email || '계정 미확인') + ')\n' +
                      '관리자에게 문의해주세요.');
    }
  }
  return a;
}

/** 화면이 현재 로그인 상태를 보여줄 수 있게 */
function getAccessInfo() {
  var a = checkCurrentAccess_();
  return { email: a.email, allowed: a.allowed, mode: a.mode, reason: a.reason };
}

// ── 메뉴 ──

/**
 * 잠그기 전에 누가 통과하고 누가 막히는지 미리 본다.
 * 이걸 확인하지 않고 strict 로 바꾸면 전원이 못 들어올 수 있다.
 */
function checkAccessList() {
  var ui = SpreadsheetApp.getUi();
  var out = [];
  var mode = accessMode_();
  var admins = adminEmails_();

  out.push('현재 모드: ' + mode +
    (mode === 'open' ? '  (아직 막지 않습니다 — 기록만)' : '  (실제로 막습니다)'));
  out.push('관리자: ' + (admins.length ? admins.join(', ') : '(없음)'));
  out.push('');

  var withMail = [], without = [];
  try {
    getHRData().forEach(function (p) {
      var e = String(p.email || '').trim();
      if (e && e.indexOf('@') > 0) withMail.push(p.name + ' <' + e + '>');
      else without.push(p.name + ' (' + (p.dept || '-') + ')');
    });
  } catch (e) {
    out.push('인력 시트를 읽지 못했습니다: ' + e.message);
    ui.alert('접근 권한 점검', out.join('\n'), ui.ButtonSet.OK);
    return;
  }

  out.push('통과할 사람 ' + withMail.length + '명');
  withMail.slice(0, 25).forEach(function (s) { out.push('  · ' + s); });
  if (withMail.length > 25) out.push('  … 외 ' + (withMail.length - 25) + '명');

  if (without.length) {
    out.push('');
    out.push('막힐 사람 ' + without.length + '명 — 인력 시트에 이메일이 없습니다');
    without.slice(0, 20).forEach(function (s) { out.push('  · ' + s); });
    out.push('');
    out.push('이 분들 이메일을 시트에 채운 뒤 strict 로 바꾸세요.');
  }

  out.push('');
  out.push('잠그려면 스크립트 속성에 ACCESS_MODE = strict 를 넣으세요.');
  out.push('풀려면 그 값을 open 으로 바꾸거나 지우면 됩니다.');

  ui.alert('접근 권한 점검', out.join('\n'), ui.ButtonSet.OK);
}

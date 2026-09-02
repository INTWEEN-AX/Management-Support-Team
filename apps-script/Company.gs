/**
 * Company.gs — 회사 기본정보 (서식 자동 채우기의 원천 데이터)
 *
 * 제안요청서 서식이 요구하는 값은 생각보다 많다.
 *   일반현황      설립연도 · 자본금 · 매출액 · 인적구성 · 업태/종목 …
 *   신인도 평가   제재이력 · 제재기관 · 각종 인증 보유 여부 …
 *   참가신청서    사업자번호 · 법인번호 · 조달청 등록번호 …
 *
 * 이 값들이 시트에 없으면 사람이 매번 손으로 채워야 한다.
 * 그래서 '회사정보' 탭 하나에 모아두고, 서식은 그걸 읽어 쓴다.
 *
 * 시트가 없으면 메뉴 [입찰공고] → [회사정보 시트 만들기] 로 항목을 깔아준다.
 * 사람은 값만 채우면 되고, 코드는 건드릴 필요가 없다.
 */

var COMPANY_TAB = '회사정보';

/**
 * 서식에 들어가는 회사 표준 필드.
 *   key    코드에서 쓰는 이름
 *   label  시트 A열에 적히는 항목명 (서식 라벨과 맞춘다)
 *   group  시트에서 묶어 보여줄 구분
 *   auto   다른 데이터에서 자동 계산되는 값 (사람이 안 채워도 됨)
 */
var COMPANY_FIELDS = [
  // ── 기본 ──
  { key: 'name',        label: '회사명',            group: '기본',   sample: '주식회사 인트윈' },
  { key: 'nameShort',   label: '약칭',              group: '기본',   sample: '㈜인트윈' },
  { key: 'ceo',         label: '대표자',            group: '기본',   sample: '최세헌' },
  { key: 'bizNo',       label: '사업자등록번호',     group: '기본',   sample: '000-00-00000' },
  { key: 'corpNo',      label: '법인등록번호',       group: '기본',   sample: '000000-0000000' },
  { key: 'foundedDate', label: '설립일',            group: '기본',   sample: '2014-07-10' },
  { key: 'foundedYear', label: '설립연도',          group: '기본',   auto: true },

  // ── 연락처 ──
  { key: 'zipCode',     label: '우편번호',          group: '연락처', sample: '07217' },
  { key: 'address',     label: '주소',              group: '연락처', sample: '서울특별시 영등포구 …' },
  { key: 'tel',         label: '전화번호',          group: '연락처', sample: '02-0000-0000' },
  { key: 'fax',         label: '팩스',              group: '연락처', sample: '02-0000-0000' },
  { key: 'email',       label: '이메일',            group: '연락처', sample: 'contact@intw.co.kr' },
  { key: 'homepage',    label: '홈페이지',          group: '연락처', sample: 'https://www.intw.co.kr' },

  // ── 사업 ──
  { key: 'bizType',     label: '업태',              group: '사업',   sample: '서비스업' },
  { key: 'bizItem',     label: '종목',              group: '사업',   sample: '행사기획, 광고대행' },
  { key: 'mainBiz',     label: '주요사업',          group: '사업',   sample: 'MICE 행사 기획·운영' },
  { key: 'g2bRegNo',    label: '조달청 등록번호',    group: '사업',   sample: '' ,
    note: '경쟁입찰참가자격 등록증에 적힌 번호' },
  { key: 'g2bLicense',  label: '조달청 등록 업종',   group: '사업',   sample: '용역-행사대행' },

  // ── 규모 ──
  { key: 'companyScale', label: '기업규모',         group: '규모',   sample: '중소기업(중기업)' },
  { key: 'capital',      label: '자본금',           group: '규모',   sample: '' },
  { key: 'revenueYear',  label: '최근 결산연도',     group: '규모',   sample: '2025' },
  { key: 'revenue',      label: '최근년도 매출액',   group: '규모',   sample: '' },
  { key: 'revenue3y',    label: '최근 3년 평균 매출액', group: '규모', sample: '' },
  { key: 'totalAsset',   label: '총자산',           group: '규모',   sample: '' },

  // ── 인적구성 (인력현황 시트에서 자동 계산) ──
  { key: 'employees',    label: '상시근로자수',      group: '인적구성', auto: true },
  { key: 'employeesAll', label: '총 인원',          group: '인적구성', auto: true },
  { key: 'employeesFull',label: '정규직(상근)',      group: '인적구성', auto: true },
  { key: 'employeesPart',label: '비상근',           group: '인적구성', auto: true },

  // ── 신인도 · 인증 ──
  { key: 'creditGrade',  label: '신용평가등급',      group: '신인도', sample: 'e-50(BB0)' },
  { key: 'creditAgency', label: '신용평가기관',      group: '신인도', sample: '(주)나이스디앤비' },
  { key: 'sanctionYn',   label: '부정당업자 제재 여부', group: '신인도', sample: '없음',
    note: '없음 / 있음' },
  { key: 'sanctionOrg',  label: '제재기관',          group: '신인도', sample: '',
    note: '제재가 있을 때만' },
  { key: 'sanctionPeriod', label: '제재기간',        group: '신인도', sample: '' },
  { key: 'sanctionReason', label: '제재사유',        group: '신인도', sample: '' },
  { key: 'accidentRate', label: '산업재해율',        group: '신인도', sample: '' },
  { key: 'certifications', label: '보유 인증',       group: '신인도', sample: '',
    note: 'ISO, 벤처기업, 이노비즈 등 쉼표로' },
  { key: 'womanBiz',     label: '여성기업 여부',     group: '신인도', sample: '해당없음' },
  { key: 'disabledBiz',  label: '장애인기업 여부',   group: '신인도', sample: '해당없음' },
  { key: 'socialBiz',    label: '사회적기업 여부',   group: '신인도', sample: '해당없음' },

  // ── 금융 ──
  { key: 'bank',         label: '주거래은행',        group: '금융',   sample: 'KB국민은행' },
  { key: 'accountNo',    label: '계좌번호',          group: '금융',   sample: '' },
  { key: 'accountHolder',label: '예금주',           group: '금융',   sample: '주식회사 인트윈' }
];

/** 0 이 반복되는 값은 아직 실제 값이 아니라고 본다 */
function isDummyValue_(v) {
  return /0{3,}/.test(String(v || ''));
}

/**
 * 서식 채우기에 쓰는 회사 정보.
 * 시트 값이 우선이고, 없으면 비어 있다. 인적구성·설립연도는 자동 계산한다.
 */
function getCompanyInfo() {
  var sheet = readCompanySheet_();
  var info = {};

  COMPANY_FIELDS.forEach(function (f) {
    info[f.key] = sheet[f.label] || '';
  });

  // ── 자동 계산 ──
  if (!info.foundedYear && info.foundedDate) {
    var m = String(info.foundedDate).match(/(\d{4})/);
    if (m) info.foundedYear = m[1];
  }

  try {
    var hr = getHRData();
    var full = hr.filter(function (r) { return r.status === '재직(상근)'; }).length;
    var part = hr.filter(function (r) { return r.status === '재직(비상근)'; }).length;
    var all = hr.filter(function (r) { return String(r.status || '').indexOf('재직') === 0; }).length;

    if (!info.employees)     info.employees = String(full) + '명';
    if (!info.employeesFull) info.employeesFull = String(full) + '명';
    if (!info.employeesPart) info.employeesPart = String(part) + '명';
    if (!info.employeesAll)  info.employeesAll = String(all) + '명';
  } catch (e) {
    Logger.log('인적구성 계산 실패(무시): ' + e);
  }

  // 아직 못 채운 항목 — 화면과 생성 결과에서 경고로 쓴다
  info._missing = COMPANY_FIELDS
    .filter(function (f) { return !f.auto && !String(info[f.key] || '').trim(); })
    .map(function (f) { return f.label; });

  info._dummy = COMPANY_FIELDS
    .filter(function (f) { return isDummyValue_(info[f.key]); })
    .map(function (f) { return f.label; });

  return info;
}

/** '회사정보' 탭을 항목명 → 값 으로 읽는다 */
function readCompanySheet_() {
  var out = {};
  try {
    var id = String(PropertiesService.getScriptProperties()
      .getProperty('COMPANY_SHEET_ID') || '').trim() || HR_SHEET_ID;
    var sheet = SpreadsheetApp.openById(id).getSheetByName(COMPANY_TAB);
    if (!sheet) return out;

    sheet.getDataRange().getValues().forEach(function (row) {
      var label = String(row[0] == null ? '' : row[0]).trim();
      var value = row[1] == null ? '' : row[1];
      if (!label) return;
      if (Object.prototype.toString.call(value) === '[object Date]') {
        value = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      if (String(value).trim()) out[label] = String(value).trim();
    });
  } catch (e) {
    Logger.log('회사정보 시트 읽기 실패(무시): ' + e);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 메뉴
// ─────────────────────────────────────────────────────────────

/**
 * 메뉴: 회사정보 시트 만들기
 * 항목을 미리 깔아두고 사람은 값만 채우게 한다. 기존 값은 지우지 않는다.
 */
function setupCompanySheet() {
  var ui = SpreadsheetApp.getUi();
  var id = String(PropertiesService.getScriptProperties()
    .getProperty('COMPANY_SHEET_ID') || '').trim() || HR_SHEET_ID;
  var ss = SpreadsheetApp.openById(id);

  var sheet = ss.getSheetByName(COMPANY_TAB);
  var existing = readCompanySheet_();

  if (!sheet) sheet = ss.insertSheet(COMPANY_TAB);
  else sheet.clear();

  var rows = [['항목', '값', '구분', '비고']];
  var lastGroup = '';
  COMPANY_FIELDS.forEach(function (f) {
    if (f.group !== lastGroup) {
      rows.push(['── ' + f.group + ' ──', '', '', '']);
      lastGroup = f.group;
    }
    rows.push([
      f.label,
      existing[f.label] || '',
      f.group,
      f.auto ? '자동 계산 (비워두세요)' : (f.note || '')
    ]);
  });

  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 260);

  // 구분 머리줄을 회색으로
  rows.forEach(function (r, i) {
    if (String(r[0]).indexOf('──') === 0) {
      sheet.getRange(i + 1, 1, 1, 4).setBackground('#F1F3F4').setFontWeight('bold');
    }
  });

  ui.alert(
    "'" + COMPANY_TAB + "' 탭을 준비했습니다.\n\n" +
    'B열에 값을 채워주세요. 기존에 적어두신 값은 그대로 남겼습니다.\n\n' +
    '자동 계산 항목(상시근로자수, 설립연도 등)은 비워두시면\n' +
    '인력현황 시트에서 자동으로 채워집니다.');
}

/** 메뉴: 회사정보 확인 — 무엇이 비어 있는지 알려준다 */
function checkCompanyInfo() {
  var info = getCompanyInfo();
  var missing = info._missing || [];
  var dummy = info._dummy || [];

  var filled = COMPANY_FIELDS.filter(function (f) {
    return String(info[f.key] || '').trim();
  }).length;

  SpreadsheetApp.getUi().alert(
    '회사 기본정보  ' + filled + ' / ' + COMPANY_FIELDS.length + '개 채워짐\n\n' +
    (missing.length
      ? '비어 있는 항목 (' + missing.length + '개)\n  ' + missing.join(', ') + '\n\n'
      : '모든 항목이 채워져 있습니다.\n\n') +
    (dummy.length ? '⚠ 아직 자리표시 값으로 보이는 항목\n  ' + dummy.join(', ') + '\n\n' : '') +
    "값은 '" + COMPANY_TAB + "' 탭에서 수정하세요.\n" +
    '탭이 없으면 [회사정보 시트 만들기] 를 먼저 실행해주세요.');
}

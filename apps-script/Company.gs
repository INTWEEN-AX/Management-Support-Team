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
 *   seed   회사 보유 서류에서 확인한 값. 시트를 만들 때 미리 채워 넣는다.
 *          출처: 사업자등록증(2026-06-02), 중소기업확인서(2026-03-27),
 *                기업신용평가등급확인서(2026-06-26, 나이스디앤비)
 *          시트에 적힌 값이 항상 우선하므로 나중에 고치면 그쪽이 이긴다.
 */
var COMPANY_FIELDS = [
  // ── 기본 ──
  { key: 'name',        label: '회사명',        group: '기본', seed: '주식회사 인트윈' },
  { key: 'nameShort',   label: '약칭',          group: '기본', seed: '㈜인트윈' },
  { key: 'ceo',         label: '대표자',        group: '기본', seed: '최세헌' },
  { key: 'bizNo',       label: '사업자등록번호', group: '기본', seed: '486-87-00976' },
  { key: 'corpNo',      label: '법인등록번호',   group: '기본', seed: '110111-6648187' },
  { key: 'foundedDate', label: '설립일',        group: '기본', seed: '2018-02-22',
    note: '사업자등록증 개업연월일' },
  { key: 'foundedYear', label: '설립연도',      group: '기본', auto: true },

  // ── 연락처 ──
  { key: 'zipCode',     label: '우편번호',      group: '연락처', seed: '07217' },
  { key: 'address',     label: '주소',          group: '연락처',
    seed: '서울특별시 영등포구 당산로41길 11, 이동 1002호(당산동4가, 당산 SK V1 center)' },
  { key: 'tel',         label: '전화번호',      group: '연락처', seed: '02-6949-5988' },
  { key: 'fax',         label: '팩스',          group: '연락처', seed: '02-6280-5955' },
  { key: 'email',       label: '이메일',        group: '연락처' },
  { key: 'homepage',    label: '홈페이지',      group: '연락처' },

  // ── 사업 ──
  { key: 'bizType',  label: '업태', group: '사업',
    seed: '정보통신업, 서비스업, 사업시설관리·사업지원 및 임대 서비스업' },
  { key: 'bizItem',  label: '종목', group: '사업',
    seed: '포털 및 기타 인터넷 정보 매개 서비스업, 소프트웨어 개발 및 공급, 학술연구용역, ' +
          '광고 및 프로모션 대행, 영상촬영 및 제작, 전시·컨벤션 및 행사 대행업, ' +
          '국제회의 기획업, 디자인 제작, 광고영화 및 비디오물 제작업, 교육컨설팅' },
  { key: 'mainBiz',    label: '주요사업',        group: '사업',
    note: '서식에 한 줄로 적을 대표 문구' },
  { key: 'g2bRegNo',   label: '조달청 등록번호', group: '사업', seed: '486-87-00976',
    note: '경쟁입찰참가자격 등록은 사업자등록번호로 관리됨 (등록 2018-04-20, 갱신 2026-03-19)' },
  { key: 'g2bLicense', label: '조달청 등록 업종', group: '사업',
    seed: '학술·연구용역(1169), 소프트웨어사업자(1469), 비디오물제작업(3244), ' +
          '국제회의기획업(5720), 기타이러닝업(6530), 행사대행업(9901), 광고대행업(9902)',
    note: '등록물품: 기타행사기획및대행서비스(8014199001)' },

  // ── 규모 ──
  { key: 'companyScale', label: '기업규모', group: '규모', seed: '중소기업(중기업)',
    note: '중소기업확인서 유효기간 2026-04-01 ~ 2027-03-31' },
  { key: 'capital',      label: '자본금',   group: '규모', seed: '61,000,000원' },
  { key: 'revenueYear',  label: '최근 결산연도', group: '규모', seed: '2025' },
  { key: 'revenue',      label: '최근년도 매출액', group: '규모', seed: '4,755,000,000원' },
  { key: 'revenue3y',    label: '최근 3년 평균 매출액', group: '규모', seed: '5,691,000,000원',
    note: '2023~2025 평균' },
  { key: 'totalAsset',   label: '총자산',   group: '규모', seed: '5,939,000,000원' },

  // ── 인적구성 (인력현황 시트에서 자동 계산) ──
  { key: 'employees',     label: '상시근로자수', group: '인적구성', auto: true },
  { key: 'employeesAll',  label: '총 인원',     group: '인적구성', auto: true },
  { key: 'employeesFull', label: '정규직(상근)', group: '인적구성', auto: true },
  { key: 'employeesPart', label: '비상근',      group: '인적구성', auto: true },

  // ── 신인도 · 인증 ──
  { key: 'creditGrade',  label: '신용평가등급', group: '신인도', seed: 'e-50(BB0)',
    note: '유효기간 2027-06-25' },
  { key: 'creditAgency', label: '신용평가기관', group: '신인도', seed: '(주)나이스디앤비' },
  { key: 'sanctionYn',   label: '부정당업자 제재 여부', group: '신인도', seed: '없음',
    note: "경쟁입찰참가자격등록증상 '정상업체' (2026-03-23 기준). " +
          '제재가 생기면 있음 으로 바꾸고 아래 3칸을 채우세요' },
  { key: 'sanctionOrg',    label: '제재기관', group: '신인도' },
  { key: 'sanctionPeriod', label: '제재기간', group: '신인도' },
  { key: 'sanctionReason', label: '제재사유', group: '신인도' },
  { key: 'accidentRate',   label: '산업재해율', group: '신인도', seed: '0.00%',
    note: '2023~2025 3년 평균 (동종동규모 평균 0.29%). 사고사망만인율 0.00' },
  { key: 'certifications', label: '보유 인증', group: '신인도',
    note: 'ISO, 벤처기업, 이노비즈 등 쉼표로' },
  { key: 'patents',        label: '특허 보유',  group: '신인도',
    seed: '특허 2건 (PD-231201, PD-231202)', note: '신인도 평가 가점 자료' },
  { key: 'womanBiz',    label: '여성기업 여부',   group: '신인도', seed: '해당없음' },
  { key: 'disabledBiz', label: '장애인기업 여부', group: '신인도', seed: '해당없음' },
  { key: 'socialBiz',   label: '사회적기업 여부', group: '신인도', seed: '해당없음' },

  // ── 금융 ──
  { key: 'bank',          label: '주거래은행', group: '금융', seed: 'KB국민은행' },
  { key: 'accountNo',     label: '계좌번호',   group: '금융' },
  { key: 'accountHolder', label: '예금주',     group: '금융', seed: '주식회사 인트윈' }
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
      existing[f.label] || f.seed || '',
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

// ─────────────────────────────────────────────────────────────
// 보유 서류에서 회사정보 자동 추출
//
// 사업자등록증·중소기업확인서·신용평가등급확인서에 대부분의 값이 이미 있다.
// 사람이 옮겨 적을 이유가 없으므로 문서를 읽어 시트를 채운다.
// ─────────────────────────────────────────────────────────────

/** 어떤 서류에서 무엇을 뽑을지 */
var COMPANY_SOURCES = [
  { match: ['사업자등록증'],            parse: 'parseBizLicense_' },
  { match: ['중소기업확인', '중기업'],   parse: 'parseSmeCert_' },
  { match: ['신용평가', '신용등급'],     parse: 'parseCreditReport_' }
];

/** 사업자등록증 */
function parseBizLicense_(t) {
  var out = {};
  var m;

  if ((m = t.match(/등록번호\s*[:：]?\s*(\d{3}-\d{2}-\d{5})/))) out['사업자등록번호'] = m[1];
  if ((m = t.match(/법인등록번호\s*[:：]?\s*(\d{6}-\d{7})/)))   out['법인등록번호'] = m[1];
  if ((m = t.match(/법인명\(단체명\)\s*[:：]?\s*([^\n]{2,40})/))) out['회사명'] = m[1].trim();

  // '개 업 연 월 일 : 2018 년 02 월 22 일' — 글자 사이 공백이 흔하다
  if ((m = t.match(/개\s*업\s*연\s*월\s*일\s*[:：]?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) {
    out['설립일'] = m[1] + '-' + padNum_(m[2]) + '-' + padNum_(m[3]);
  }

  if ((m = t.match(/사\s*업\s*장\s*소\s*재\s*지\s*[:：]?\s*([\s\S]{5,140}?)(?:본\s*점|사\s*업\s*의)/))) {
    out['주소'] = m[1].replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** 중소기업 확인서 */
function parseSmeCert_(t) {
  var out = {};
  var m;
  if ((m = t.match(/중소기업\s*확인서\s*\[\s*([^\]]{2,10})\s*\]/))) {
    out['기업규모'] = '중소기업(' + m[1].trim() + ')';
  }
  if (!out['기업규모'] && /중소기업/.test(t)) out['기업규모'] = '중소기업';
  if ((m = t.match(/사업자등록번호\s*[:：]?\s*(\d{3}-\d{2}-\d{5})/))) out['사업자등록번호'] = m[1];
  if ((m = t.match(/법인등록번호\s*[:：]?\s*(\d{6}-\d{7})/)))       out['법인등록번호'] = m[1];
  if ((m = t.match(/대표자명?\s*[:：]?\s*([가-힣]{2,5})/)))          out['대표자'] = m[1];
  return out;
}

/** 기업신용평가등급 확인서 — 등급과 재무까지 나온다 */
function parseCreditReport_(t) {
  var out = {};
  var m;

  var grade = t.match(/\b(e-\d{1,2})\b/);
  var band = t.match(/\b(AAA|AA|BBB|BB0|BB|CCC|CC|A|B|C|D)\b/);
  if (grade) out['신용평가등급'] = grade[1] + (band ? '(' + band[1] + ')' : '');
  if (/나이스디앤비/.test(t)) out['신용평가기관'] = '(주)나이스디앤비';
  if ((m = t.match(/종업원\s*(\d+)\s*명/))) out['상시근로자수'] = m[1] + '명';
  if ((m = t.match(/대표자\s*([가-힣]{2,5})/))) out['대표자'] = m[1];
  if ((m = t.match(/(?:법인설립일|사업시작일)\s*(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/))) {
    out['설립일'] = m[1] + '-' + padNum_(m[2]) + '-' + padNum_(m[3]);
  }

  // 연도별 재무 (단위: 백만원)
  //   2025/12  총자산 자본금 자기자본 매출액 영업이익 당기순이익
  var re = /(\d{4})\/(\d{2})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)/g;
  var rows = [], r;
  while ((r = re.exec(t)) !== null) {
    rows.push({
      year: r[1],
      asset: num_(r[3]), capital: num_(r[4]),
      equity: num_(r[5]), revenue: num_(r[6])
    });
  }
  if (rows.length) {
    rows.sort(function (a, b) { return Number(b.year) - Number(a.year); });
    var latest = rows[0];
    out['최근 결산연도'] = latest.year;
    out['최근년도 매출액'] = million_(latest.revenue);
    out['총자산'] = million_(latest.asset);
    out['자본금'] = million_(latest.capital);

    var take = rows.slice(0, 3);
    var avg = take.reduce(function (s, x) { return s + x.revenue; }, 0) / take.length;
    out['최근 3년 평균 매출액'] = million_(Math.round(avg));
  }
  return out;
}

/** 파서 이름으로 분기 — 전역 참조(this/globalThis)는 Apps Script 에서 불안정하다 */
function runCompanyParser_(name, text) {
  if (name === 'parseBizLicense_')   return parseBizLicense_(text);
  if (name === 'parseSmeCert_')      return parseSmeCert_(text);
  if (name === 'parseCreditReport_') return parseCreditReport_(text);
  return {};
}

function padNum_(v) { return ('0' + v).slice(-2); }
function num_(s) { return Number(String(s).replace(/,/g, '')) || 0; }

/** 백만원 단위 숫자를 읽기 좋은 원 단위 문자열로 */
function million_(v) {
  var won = v * 1000000;
  return won.toLocaleString() + '원';
}

/**
 * 메뉴: 보유 서류에서 회사정보 가져오기
 * 입찰서류 탭에 등록된 PDF 를 읽어 '회사정보' 탭의 빈 칸을 채운다.
 * 사람이 적어둔 값은 덮어쓰지 않는다.
 */
function importCompanyFromDocuments() {
  var ui = SpreadsheetApp.getUi();

  var docs;
  try {
    docs = getDocumentData();
  } catch (e) {
    ui.alert('입찰서류 목록을 읽지 못했습니다.\n\n' + (e.message || e));
    return;
  }
  if (!docs.length) {
    ui.alert('입찰서류 탭에 등록된 서류가 없습니다.');
    return;
  }

  var found = {}, used = [], failed = [];

  COMPANY_SOURCES.forEach(function (src) {
    var doc = null;
    for (var i = 0; i < docs.length; i++) {
      var name = String(docs[i].name || '').replace(/\s+/g, '');
      if (src.match.some(function (w) { return name.indexOf(w) > -1; })) { doc = docs[i]; break; }
    }
    if (!doc || !doc.fileId) return;

    try {
      var text = pdfToText_(DriveApp.getFileById(doc.fileId));
      var parsed = runCompanyParser_(src.parse, text);
      var got = 0;
      Object.keys(parsed).forEach(function (k) {
        if (!parsed[k]) return;
        if (found[k]) return;         // 먼저 읽은 문서를 우선한다
        found[k] = parsed[k];
        got++;
      });
      used.push(doc.name + ' (' + got + '개)');
    } catch (e) {
      failed.push(doc.name + ' — ' + String(e.message || e).split('\n')[0]);
    }
  });

  if (!Object.keys(found).length) {
    ui.alert(
      '서류에서 값을 읽어내지 못했습니다.\n\n' +
      (failed.length ? '실패:\n' + failed.join('\n') : '대상 서류를 찾지 못했습니다.'));
    return;
  }

  var preview = Object.keys(found).map(function (k) { return '  ' + k + ': ' + found[k]; });
  var res = ui.alert(
    '서류에서 읽은 값',
    used.join('\n') + '\n\n' + preview.join('\n') +
    (failed.length ? '\n\n읽지 못한 서류:\n' + failed.join('\n') : '') +
    '\n\n비어 있는 항목만 채웁니다. 직접 적어두신 값은 그대로 둡니다.\n적용할까요?',
    ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  var written = writeCompanyValues_(found);
  ui.alert(
    '회사정보 ' + written.length + '개 항목을 채웠습니다.\n\n' +
    (written.length ? written.join('\n') : '') +
    '\n\n나머지는 회사정보 탭에서 직접 채워주세요.');
}

/** 회사정보 탭의 빈 칸만 채운다 */
function writeCompanyValues_(values) {
  var id = String(PropertiesService.getScriptProperties()
    .getProperty('COMPANY_SHEET_ID') || '').trim() || HR_SHEET_ID;
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(COMPANY_TAB);
  if (!sheet) { setupCompanySheet(); sheet = ss.getSheetByName(COMPANY_TAB); }

  var range = sheet.getDataRange();
  var rows = range.getValues();
  var written = [];

  for (var r = 0; r < rows.length; r++) {
    var label = String(rows[r][0] == null ? '' : rows[r][0]).trim();
    if (!label || !values[label]) continue;
    if (String(rows[r][1] == null ? '' : rows[r][1]).trim()) continue;  // 이미 적혀 있으면 둔다
    rows[r][1] = values[label];
    written.push('  ' + label + ': ' + values[label]);
  }

  if (written.length) range.setValues(rows);
  return written;
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

/**
 * Company.gs — 회사 기본정보
 *
 * ⚠ 지금 값은 전부 자리표시용 더미입니다. 실제 값이 아닙니다.
 *    입찰 서식에 그대로 넣으면 안 됩니다.
 *
 * 나중에 시트로 옮길 때는 COMPANY_SHEET_ID / COMPANY_TAB 만 채우면
 * 시트 값이 우선 적용되고, 없으면 아래 더미가 쓰입니다.
 * (서식 채우기 코드는 getCompanyInfo() 만 보므로 바꿀 게 없습니다)
 */

var COMPANY_TAB = '회사정보';

/** 실제 값이 확인되기 전까지 쓰는 자리표시 값 */
var COMPANY_PLACEHOLDER = {
  name:        '주식회사 인트윈',
  nameShort:   '㈜인트윈',
  ceo:         '최세헌',
  bizNo:       '000-00-00000',        // 더미
  corpNo:      '000000-0000000',      // 더미
  address:     '서울특별시 영등포구 당산로 41길 11, SK V1 센터',
  zipCode:     '07217',
  tel:         '02-0000-0000',        // 더미
  fax:         '02-0000-0000',        // 더미
  email:       'contact@intw.co.kr',
  homepage:    'https://www.intw.co.kr',
  foundedDate: '2014-07-10',
  bizType:     '서비스업',
  bizItem:     '행사기획, 광고대행, 소프트웨어 개발',
  employees:   '',                    // 인력현황에서 자동 계산
  companyScale:'중소기업(중기업)',
  creditGrade: 'e-50(BB0)'
};

/**
 * 서식 채우기에 쓰는 회사 표준 필드.
 * 재직 인원수는 인력현황 시트에서 실제로 세어 넣는다.
 */
function getCompanyInfo() {
  var info = {};
  Object.keys(COMPANY_PLACEHOLDER).forEach(function (k) {
    info[k] = COMPANY_PLACEHOLDER[k];
  });

  var fromSheet = readCompanySheet_();
  Object.keys(fromSheet).forEach(function (k) {
    if (String(fromSheet[k]).trim()) info[k] = fromSheet[k];
  });

  if (!info.employees) {
    try {
      var hr = getHRData();
      info.employees = String(hr.filter(function (r) {
        return String(r.status || '').indexOf('재직') === 0;
      }).length) + '명';
    } catch (e) {
      info.employees = '';
    }
  }

  // 어떤 값이 아직 더미인지 화면에서 표시하기 위한 목록
  info._placeholders = Object.keys(COMPANY_PLACEHOLDER).filter(function (k) {
    return !String(fromSheet[k] || '').trim() && isDummyValue_(COMPANY_PLACEHOLDER[k]);
  });

  return info;
}

/** 0 이 반복되는 값은 더미로 본다 */
function isDummyValue_(v) {
  return /0{3,}/.test(String(v || ''));
}

/**
 * '회사정보' 탭이 있으면 읽는다. (A열=항목, B열=값)
 * 없으면 빈 객체 — 더미가 그대로 쓰인다.
 */
function readCompanySheet_() {
  var out = {};
  try {
    var id = String(PropertiesService.getScriptProperties()
      .getProperty('COMPANY_SHEET_ID') || '').trim() || HR_SHEET_ID;
    var sheet = SpreadsheetApp.openById(id).getSheetByName(COMPANY_TAB);
    if (!sheet) return out;

    var map = {
      '회사명': 'name', '상호': 'name', '법인명': 'name',
      '약칭': 'nameShort',
      '대표자': 'ceo', '대표이사': 'ceo',
      '사업자등록번호': 'bizNo', '사업자번호': 'bizNo',
      '법인등록번호': 'corpNo',
      '주소': 'address', '소재지': 'address',
      '우편번호': 'zipCode',
      '전화번호': 'tel', '대표전화': 'tel',
      '팩스': 'fax',
      '이메일': 'email',
      '홈페이지': 'homepage',
      '설립일': 'foundedDate', '설립년월일': 'foundedDate',
      '업태': 'bizType',
      '종목': 'bizItem',
      '상시근로자수': 'employees', '직원수': 'employees',
      '기업규모': 'companyScale',
      '신용등급': 'creditGrade'
    };

    sheet.getDataRange().getValues().forEach(function (row) {
      var key = String(row[0] == null ? '' : row[0]).replace(/\s+/g, '');
      var field = map[key];
      if (field && row[1] != null && String(row[1]).trim()) {
        out[field] = String(row[1]).trim();
      }
    });
  } catch (e) {
    Logger.log('회사정보 시트 읽기 실패(무시): ' + e);
  }
  return out;
}

/** 메뉴: 회사정보 확인 — 어떤 값이 아직 더미인지 알려준다 */
function checkCompanyInfo() {
  var info = getCompanyInfo();
  var dummy = info._placeholders || [];
  var lines = Object.keys(info)
    .filter(function (k) { return k.charAt(0) !== '_'; })
    .map(function (k) {
      return '  ' + k + ': ' + (info[k] || '(비어있음)') +
             (dummy.indexOf(k) > -1 ? '   ⚠ 더미' : '');
    });

  SpreadsheetApp.getUi().alert(
    '회사 기본정보\n\n' + lines.join('\n') +
    '\n\n⚠ 표시된 항목은 아직 실제 값이 아닙니다.\n' +
    "경영기획실DB에 '" + COMPANY_TAB + "' 탭을 만들고\n" +
    'A열에 항목명, B열에 값을 넣으면 그 값이 우선 적용됩니다.');
}

/**
 * Curated public-link RFP examples from the user's shared Drive folder.
 * These files are already shared as "anyone with the link can view".
 * A user click reads one allowlisted file into browser memory; it is not copied to Drive.
 */
var RFP_DRIVE_EXAMPLES = {
  moi_startup: { id: '1J79DPokYExYexeYn95l1GjHiVzyTuxH5', name: '(붙임2) 제안요청서_모두의창업 2차(경기지역) 통합 홍보 용역.hwp', label: '모두의 창업 2차(경기지역) 통합 홍보 용역' },
  specialty_tour: { id: '1FhLZPn-KPFC100acb_U-VyEBHn9jLEuT', name: '(재공고)제안요청서_특화상품 개발 및 맛집투어가이드.hwp', label: '특화상품 개발 및 맛집투어 가이드 (재공고)' },
  future_health: { id: '1Z6VG18xhwQxM4c08q0XpK1XMlmBLkCHe', name: '1774396283206-제안요청서(2026년 미래 건강전략 포럼 행사 및 건강도시 캠페인 운영)_수정.hwpx', label: '2026 미래 건강전략 포럼 행사 및 건강도시 캠페인 운영' },
  notice_2026_145: { id: '1jFZTKEAG_2BVlKotkGJnTNc-prtGgMxw', name: '2026-145 제안요청서.hwpx', label: '2026-145 제안요청서' },
  seoul_mice: { id: '1qBPODsyziHzN3fRluOMZbRVS-25o6qtZ', name: '3. 제안요청서_2026 서울MICE얼라이언스 활성화 행사 기획 및 운영 용역.hwp', label: '서울 MICE 얼라이언스 활성화 행사 기획·운영 용역' },
  science_league: { id: '1I8Psi6VZ0jo5WBSIocoYeKx0AGMRqCcu', name: '붙임2. 4대 과학기술원 창업리그 통합 결선 용역 제안요청서.hwp', label: '4대 과학기술원 창업리그 통합 결선 용역' },
  kict_center: { id: '1LGAIK7V6OkcBvlPF9eGaitlPyvnlRL-y', name: '붙임3. 제안요청서_2026년 K-ICT창업멘토링센터 성과공유회 위탁운영 용역.hwp', label: 'K-ICT 창업멘토링센터 성과공유회 위탁운영 용역' },
  alley_project: { id: '1CP7NBpFE9USaI5AeqSOyNSbhQ5oeNTD-', name: '유망골목상권 제안요청서_상권특화 및 창업육성사업_1102(재공고).hwpx', label: '유망골목상권 특화 및 창업육성사업 (재공고)' },
  generic_rfp: { id: '1AK38HIhwpfzz7XESKsGVz_-lAiwmrcdt', name: '제안요청서.hwp', label: '제안요청서 (일반 양식)' },
  digital_sprout: { id: '1hIZU5BK11sT95ZQ39B9-YpYQeRSO4mdE', name: '제안요청서=디지털새싹 5개년 통합 성과확산 대행.hwp', label: '디지털새싹 5개년 통합 성과확산 대행' }
};

function getDriveProposalExample(key) {
  key = String(key || '');
  var item = RFP_DRIVE_EXAMPLES[key];
  if (!item) throw new Error('목록에 있는 예시 파일만 불러올 수 있습니다.');
  var url = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(item.id);
  var response = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
  var status = response.getResponseCode();
  if (status !== 200) throw new Error('Drive 예시 파일을 가져오지 못했습니다 (HTTP ' + status + ').');
  var bytes = response.getContent();
  if (!bytes || !bytes.length || bytes.length > 10 * 1024 * 1024) {
    throw new Error('예시 파일 크기가 제한(10MB)을 벗어났습니다.');
  }
  var head = bytes.slice(0, 8).map(function (value) { return (value + 256) % 256; }).join(',');
  var isHwp = /\.hwp$/i.test(item.name);
  var validHeader = isHwp
    ? head === '208,207,17,224,161,177,26,225'
    : head.indexOf('80,75,3,4') === 0;
  if (!validHeader) throw new Error('Drive가 파일 대신 오류 페이지를 반환했습니다. 링크 권한을 확인해 주세요.');
  return {
    name: item.name,
    label: item.label,
    size: bytes.length,
    mimeType: isHwp ? 'application/x-hwp' : 'application/zip',
    dataBase64: Utilities.base64Encode(bytes)
  };
}

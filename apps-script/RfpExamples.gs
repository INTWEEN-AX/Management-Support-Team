/**
 * Curated public-link RFP examples from the user's shared Drive folder.
 * These files are already shared as "anyone with the link can view".
 * A user click reads one allowlisted file into browser memory; it is not copied to Drive.
 */
var RFP_DRIVE_EXAMPLES = {
  moi_startup: { id: '1J79DPokYExYexeYn95l1GjHiVzyTuxH5', label: '모두의 창업 2차(경기지역) 통합 홍보 용역' },
  specialty_tour: { id: '1FhLZPn-KPFC100acb_U-VyEBHn9jLEuT', label: '특화상품 개발 및 맛집투어 가이드 (재공고)' },
  future_health: { id: '1Z6VG18xhwQxM4c08q0XpK1XMlmBLkCHe', label: '2026 미래 건강전략 포럼 행사 및 건강도시 캠페인 운영' },
  notice_2026_145: { id: '1jFZTKEAG_2BVlKotkGJnTNc-prtGgMxw', label: '2026-145 제안요청서' },
  seoul_mice: { id: '1qBPODsyziHzN3fRluOMZbRVS-25o6qtZ', label: '서울 MICE 얼라이언스 활성화 행사 기획·운영 용역' },
  science_league: { id: '1I8Psi6VZ0jo5WBSIocoYeKx0AGMRqCcu', label: '4대 과학기술원 창업리그 통합 결선 용역' },
  kict_center: { id: '1LGAIK7V6OkcBvlPF9eGaitlPyvnlRL-y', label: 'K-ICT 창업멘토링센터 성과공유회 위탁운영 용역' },
  alley_project: { id: '1CP7NBpFE9USaI5AeqSOyNSbhQ5oeNTD-', label: '유망골목상권 특화 및 창업육성사업 (재공고)' },
  generic_rfp: { id: '1AK38HIhwpfzz7XESKsGVz_-lAiwmrcdt', label: '제안요청서 (일반 양식)' },
  digital_sprout: { id: '1hIZU5BK11sT95ZQ39B9-YpYQeRSO4mdE', label: '디지털새싹 5개년 통합 성과확산 대행' }
};

function getDriveProposalExample(key) {
  key = String(key || '');
  var item = RFP_DRIVE_EXAMPLES[key];
  if (!item) throw new Error('목록에 있는 예시 파일만 불러올 수 있습니다.');
  var file = DriveApp.getFileById(item.id);
  var blob = file.getBlob();
  var bytes = blob.getBytes();
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    throw new Error('예시 파일 크기가 제한(10MB)을 벗어났습니다.');
  }
  return {
    name: file.getName(),
    label: item.label,
    size: bytes.length,
    mimeType: blob.getContentType() || 'application/octet-stream',
    dataBase64: Utilities.base64Encode(bytes)
  };
}

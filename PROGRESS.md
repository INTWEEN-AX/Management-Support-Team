# P2 AX — 진행 기록 (2026-11-17)

## 1. 조사 완료

- 대상은 Management-Support-Team이며 기존 intw-ax는 수정 금지다. 시작 HEAD 71361b6, 작업 트리는 깨끗했다. AGENTS.md는 발견되지 않았다.
- README·Apps Script FormFill.gs/FormAnalyzer.gs와 화면 흐름을 확인했다. 원본 Apps Script·배포·권한·Git 원격은 변경하지 않았다.
- HWPX 서버 샘플 3개를 로컬 읽기로 조사했다. 1~5 section, 37~59 전체 표의 서로 다른 구조다. 자동 분류는 인력·실적 여러 표를 찾았으며 중첩표는 자동 채움에서 제외한다. 원문·샘플은 저장소에 복사하지 않았다.
- Google Sheet는 탭/머리글만 읽었다. 인력/실적/매핑규칙/입찰공고의 열 구조를 확인했고 실제 직원·실적 행은 가져오지 않았다. Apps Script 웹 URL은 읽기 도구에서 접근되지 않아 원본 코드 기준으로 흐름을 재사용했다.
- AX Supabase oancjcvjtpbipodewjki는 Healthy이며 public 업무 테이블은 아직 없다. APFS와 데이터/환경변수를 공유하지 않는다.

## 2. 독립 MVP 구현 완료 — web/

- React/JSX Next.js 앱: 이메일 로그인/승인 상태 → 공고 선택 → HWPX 구조/제출요건 분석 → 인력/실적 검색·다중선택 → 실제 반영 미리보기 → 새 HWPX 생성/다운로드.
- HWPX는 브라우저 메모리에서만 처리한다. 원본 ZIP entry·스타일·section·표를 보존하며 빈 칸만 채운다. profile별 자동 분류 및 수동 열/라벨 매핑을 제공한다. HWP 바이너리/PDF는 직접 채우지 않는다.
- 산출물을 다시 열어 기입한 모든 cell 기대값을 검사한다. 성명/사업명이 실제 반영되어야 선택 건을 완료로 인정하고 누락 선택 건은 다운로드를 차단한다.
- AX 전용 서버 API와 staff/performance/participation/bid/mapping/generation/Auth/RLS SQL 초안, 안전 import 도구를 준비했다. 승인 사용자 bearer만 사용하며 service key가 없다. 스키마·환경변수 미설정은 명확한 설정 안내로 표시하고 가짜 업무 데이터를 만들지 않는다.
- 생성시점 선택 자료의 확인상태·출처는 DB트리거가 비공개 snapshot으로 보존하도록 설계했고 감사 로그는 ID/동작/건수만 기록한다.

## 3. 검증 및 문서화

- 서로 다른 합성 인력/실적 서식의 생성→재열기→선택값·표·스타일·section 일치, 입력/압축/XML 거부, 셀불일치 거부 검증을 실행했다.
- PGlite 실제 PostgreSQL에서 approved/pending/inactive/admin/editor/viewer CRUD/RLS, 경력근거, generation 불변성·snapshot, metadata 감사 검증을 실행했다.
- 최종 테스트 수·빌드·HTTP 결과는 web/README.md에 기록한다. 실제 개인정보 fixture는 없다. 실제 한컴의 렌더링/인쇄 결과는 미검증이다.

## 4. 마지막 연결 단계 — 아직 실행하지 않음

- AX 전용 초기 SQL을 검토 적용하고 Auth에서 확인한 첫 계정 UUID를 admin으로 지정한다. 기존 객체가 생겼다면 초기 SQL을 그대로 재실행하지 않는다.
- 프로젝트 URL·publishable key를 web 런타임에 직접 설정한다. Google OAuth 비밀값은 공급자 콘솔에서만 설정한다.
- 허용 열만 비공개 원본에서 import하고 출처/경력·증빙을 담당자가 확인한다. 기본 import는 dry-run이며 출력은 개수뿐이다. 기존 source_ref는 덮어쓰지 않는다.
- 운영 JWT 및 승인된 합성계정 검증·배포 공개는 위 설정과 승인 이후다. 현재 DB apply/import·계정생성·clasp/Git push·배포·서비스/요금제/터널 변경은 하지 않았다.


## 최종 외부 상태 재확인 — 초기 SQL 재실행 금지

작업 시작의 읽기 전용 조회에서는 AX public 업무 테이블이 없었으나 최종 조회에서는 `ax_proposal_mvp` migration(version `20261117080248`)과 RLS가 켜진 `ax_*` 테이블 8개가 발견됐다. 이 작업 세션/병행 에이전트는 운영 migration·SQL 쓰기를 호출하지 않았다. 변경 주체는 확인하지 않았으며 외부 작업을 되돌리지 않는다. profiles/staff/performance/participation/bid/mapping/generation 건수는 모두 0이다. 실제 행은 조회하지 않았다.

현행 컬럼·RLS 이름은 새 앱 계약과 맞지만 함수 메타데이터상 통합 학력 `education` 매핑과 신규 생성의 활성 인력 검사 보완이 필요하다. `001_ax_schema.sql`은 빈 프로젝트용 참고본이므로 **현재 프로젝트에 다시 적용하지 않는다**. 기존 함수 정의/권한을 비공개로 보관하고 `003_existing_schema_alignment.sql`의 두 함수만 실제 정의와 비교한 뒤 승인 적용한다. 이 파일은 행·Auth bootstrap·다른 함수·기존 테이블을 삭제하거나 덮어쓰지 않는다. 실패 전에는 transaction rollback, 적용 후에는 보관한 두 함수 정의로만 되돌리며 기존 데이터/감사 이력은 보존한다.

현재 마지막 단계는 초기 SQL 일괄 실행이 아니라 기존 migration 출처/상태 확인 → 차이 SQL 검토 → 초기 승인 계정/환경변수/허용 열 import → 실제 JWT 검증이다. 운영 상태와 로컬 검증을 구분한다.

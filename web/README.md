# AX 제안 서식 작성 — 독립 React 앱

기존 `apps-script/`를 유지한 채 추가한 Next.js + React + JavaScript/JSX 앱이다. 기존 `intw-ax`는 수정하지 않는다. P1 농금원 DB·환경변수·배포와 분리한다. 새 앱은 아직 Git push·배포하지 않았으며 실제 AX DB 스키마·인력/실적 import도 적용 전이다.

## 설치와 실행

```bash
cd /home/adelie/.authentic_alpha/01_users/01_adelie/01_projects/02_intween_proj/Management-Support-Team/web
npm ci
npm test
npm run build
npm run dev
```

Node.js 22 이상, 로컬 주소 `http://127.0.0.1:3002`. Production 로컬 실행은 빌드 후 `npm run start`. 다른 기존 서비스가 포트를 쓰면 중지하지 말고 Next CLI에 별도 loopback 포트를 지정한다. 외부 공개·Funnel·방화벽·DNS 설정은 하지 않는다.

### 환경변수

`web/.env.example`에는 이름·설명만 있다. 실제 값은 Git에서 제외되는 런타임 환경에 직접 설정한다.

| 변수 | 용도 |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | 정확히 AX 프로젝트 `https://oancjcvjtpbipodewjki.supabase.co` |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 같은 프로젝트 publishable key. `sb_publishable_` 형식만 허용 |
| NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED | Google 공급자/redirect 설정 확인 후에만 true. 기본 false |

Service role/secret key·DB password·Git/Vercel token은 이 앱에서 사용하지 않는다. 잘못된 프로젝트나 미설정 연결은 설정 화면으로 표시하며 가짜 직원/실적을 만들지 않는다. 인증 세션은 브라우저 메모리만 사용해 새로고침 뒤 로그인이 다시 필요할 수 있다. Google Client ID/Secret은 Supabase 콘솔에서만 설정하며 브라우저 변수에 넣지 않는다.

## 빠른 업무 흐름

1. **공고 선택:** 승인된 DB 입찰공고를 고르거나 공고 미연결로 시작한다. 공고 관리/허용 열 import가 있다. 기존 Apps Script URL을 자동 호출하거나 공유 권한을 바꾸지 않는다.
2. **HWPX 업로드:** 10MB 이하 공고/RFP의 ZIP/XML을 브라우저 메모리에서 분석한다. 제출 서식·필수요건 후보는 원문에서 찾고 section/문단 위치를 붙인다. 후보가 없으면 확인 필요로 남긴다. AI 추론이나 모든 제출요건 추출을 보장하지 않는다. 파일 원문은 서버·Drive·모델에 보내거나 저장하지 않는다.
3. **형식별 매핑:** 표마다 staff/performance/제외, 반복형/라벨형, 머리글 행과 열 필드를 확인한다. 자동 판정 실패 시 수동으로 설정한다. 매핑은 원본 SHA-256과 연결해 DB에 저장한다. 다른 원본 해시에는 자동 적용하지 않는다.
4. **인력·실적 선택:** 검색·부서/분야 필터·검증 자료 필터·다중선택·해제를 제공한다. 학력·직위·경력·출처·증빙 확인 상태를 미리 본다. 입사일 기준 근속과 검증된 총 경력은 구분하며 총 경력을 자동 추정하지 않는다.
5. **미리보기·생성:** 선택한 실제 DB 값을 새 HWPX의 빈 칸에 채운다. 검증 경력은 기간과 근거가 모두 확인된 경우만 쓴다. 모르는 필드·학력 세부항목은 확인 필요로 남긴다. 생성 ZIP을 다시 열어 모든 기입 cell의 기대값을 비교한다. 이름/사업명이 실제 반영되지 않은 선택 건은 다운로드를 차단한다.
6. **다운로드:** 선택 ID·원본 해시·숫자 요약을 DB에 저장한 뒤 새 이름으로 내려받는다. 서버 DB 트리거가 생성 당시 선택 자료·출처·확인상태를 비공개 snapshot에 보존한다. UI의 숫자 요약은 사용자 브라우저가 제출한 처리결과이며 서버가 HWPX 원문까지 재생성·검증한 증명은 아니다. 제출 전 한컴에서 직접 검토한다.

### 수동 매핑 방법

- 반복표: 해당 표를 펼쳐 종류와 머리글 행(1부터)을 선택한다. 열마다 이름·직위·학력·검증 경력 또는 사업명·발주처·금액 등을 지정한다. 생년월일/주민번호/주소/연락처 필드는 목록에 없다. 반영하지 않을 열은 비워 둔다.
- 라벨형: 표 채움 방식을 라벨형으로 선택하고 라벨 위치와 값을 넣을 대상 행/열(1부터), 허용 필드를 지정한다. 자동 쌍은 수정·제거하고 새 쌍을 추가할 수 있다. 단일 이력서에 여러 명이 선택되어 공간이 부족하면 초과로 알린다.
- 기존 기입/예시 행은 보존하고 완전히 빈 행만 채운다. 데이터 행의 병합이나 열 수가 다르면 위치를 추측하지 않고 미반영으로 알린다. 원본에 빈 행을 준비하거나 지원되는 개별 서식으로 나누어 다시 올린다.
- 생성 결과에는 선택 건 coverage·누락 필드·초과/미반영 수를 표시한다. coverage는 성명/사업명 실제 기입 기준이며 모든 학력/경력 칼럼의 존재를 뜻하지 않는다. 미매핑 필드는 profile을 보완하거나 별도 이력서로 제출한다.

## 원본 Apps Script 재사용과 보존

`FormFill.gs`/`FormAnalyzer.gs`의 서식 이름 분류, 머리글 별칭 정규화, 반복표·라벨형 구분, 빈 행만 채움, `<hp:t>` 없는 셀 생성, overflow 감지를 별도 `lib/hwpx.js` 및 `lib/requirements.js`로 옮겼다. 원본 `.gs`·기존 웹앱·OAuth·공유 권한은 변경하지 않았다. 원본의 개인정보·회사 계좌·생년월일 매핑과 Drive PDF 변환·외부 AI 호출은 가져오지 않았다.

`web/`와 `tools/`는 `.claspignore`로 제외했다. 이 앱 때문에 clasp push를 수행할 필요가 없다. 기존 Apps Script의 수정·배포는 별도 작업이다.

## 지원 범위와 HWPX 제약

- HWPX의 기존 ZIP entry·헤더/스타일·section·표·행·열 구조를 유지하고 셀 텍스트만 변경한다. 원본은 덮어쓰지 않는다. 기존 이미지·Preview는 그대로이므로 Drive 썸네일은 이전 내용일 수 있다.
- HWP 바이너리 직접 편집, PDF 채움/변환, 임의 문장 재작성, 서명 유지, 모든 병합/중첩표 자동 채움은 미지원이다. `.hwp`는 한컴의 다른 이름으로 저장에서 `.hwpx`로 변환한다. 확장자만 바꾸지 않는다.
- 문서마다 다른 열 순서·제목 행·section을 profile로 처리한다. 고정 한 표를 가정하지 않는다. 자동 검사는 XML 구조와 값 일치이며 실제 한컴 글꼴·쪽 나눔·줄 넘침·인쇄 렌더링 검증은 아니다.
- ZIP 해제 총 40MB, 항목당 12MB, 최대 1024항목, 압축비 200, 표 500개/셀 30,000개 제한. 암호화/ZIP64/실행코드/서명·임베디드 객체/외부 관계/DTD/entity/잘못된 XML·경로·CRC는 거부한다.
- 금지 개인정보 label의 기존 값이 있는 서식은 출력하지 않는다. 빈 서식을 사용한다. 자동 감지는 모든 자유문장 속 개인정보를 식별하는 DLP가 아니므로 실제 직원의 금지 필드를 파일에 넣지 않는다.

## 데이터·권한·출처·감사

AX 프로젝트 `oancjcvjtpbipodewjki`에만 연결한다. `supabase/001_ax_schema.sql`은 **미적용 초기 SQL 초안**이다. 적용 영향·초기 관리자·비파괴 롤백은 [002_ax_rollback.md](supabase/002_ax_rollback.md)에 있다.

- `ax_profiles`: admin/editor/viewer, 승인·활성. 신규는 pending viewer. 초기 admin은 이메일 문자열로 자동 승격하지 않고 Auth 콘솔에서 소유자를 확인한 UUID로 지정한다.
- `ax_staff`: 부서·이름·직위·학교·전공·학위·졸업연도·입사일·고용유형·활성·검증된 경력/근거·출처.
- `ax_performances`: 사업명·요약·발주처·연도·금액·기간·분야·증빙확인·지분·출처.
- `ax_participations`: 인력/실적 UUID·역할·연결확인·출처.
- `ax_bids`, `ax_template_mappings`, `ax_generations`, `ax_audit_events`: 공고, 허용 필드/좌표만의 profile, 선택/생성 이력, ID·동작·건수만의 감사.
- 나이·생년월일·주소·개인연락처·개인이메일·성별·주민번호·첨부 URL/파일을 적재하지 않는다. 허용 텍스트에 연락처·이메일·URL이 있으면 거부한다. 원본 IR/HR/시트 행은 Git·로그·fixture에 넣지 않는다.
- 승인된 활성 사용자만 RLS로 읽는다. viewer는 읽기, editor는 자료 CRUD/생성, admin은 추가로 사용자 승인·권한 관리. API도 Auth getUser와 같은 역할·승인 검사를 수행하고 동일 사용자 bearer로 RLS 쿼리한다.
- 생성 이력은 불변이며 참조 자료 삭제를 막는다. 생성 당시 안전한 자료 snapshot은 비공개 DB에만 있다. 감사 로그에 이름·원문·토큰을 남기지 않는다. 실제 문서 파일은 DB에 저장하지 않는다.
- `/api/v1/me`와 `/api/v1/{resource}[/{id}]`를 사용한다. 요청은 JSON 64KB, ID/필드/enum/숫자/profile 제한, no-store 응답, 일반화된 오류만 제공한다. 외부 모델·유료 API·public bucket은 없다. 분산 rate limit·배포 접근 보호는 운영 전 별도 확정한다.

## 시트 가져오기 — 실제 행 미반입

탭과 첫 행 헤더만 확인했다. `재직(상근)`/`재직(비상근)`의 허용 열, `실적`, `입찰공고` 열에 맞춘 안전 도구가 저장소 루트 `tools/import-safe.mjs`에 있다.

```bash
# 원본은 저장소 밖 private 경로에서만 다룹니다. 기본 동작은 DB를 쓰지 않습니다.
cd ..
node tools/import-safe.mjs --input /private/approved-sheet.json --resource staff --tab '재직(상근)'
```

입력은 `{headers,rows}` JSON 또는 stdin, 출력은 행/열 개수뿐이다. 금지/미지원 열·첨부 JSON은 버리고 승인된 열만 메모리에서 투영한다. 인력의 입사일 기준 경력열을 총 경력으로 가져오지 않으며 경력/증빙 확인은 항상 미확인으로 시작한다. 실적의 참여인력 JSON도 그대로 적재하지 않는다. 인력·실적 연결은 확인한 UUID로 별도 관리한다.

실제 저장은 `--apply`와 `AX_IMPORT_ACCESS_TOKEN`(승인된 admin/editor의 단기 사용자 토큰)을 안전하게 런타임 주입한 경우만 수행한다. 이 도구는 service key나 `.env`를 읽지 않는다. 토큰을 CLI 인자·파일·기록·대화에 넣지 않는다. 기존 source_ref는 덮어쓰지 않고 제외한다. 여러 시트의 source_ref 충돌을 피하도록 고정된 비개인정보 탭 식별자를 사용한다. 상세 허용 범위·배치 실패/재실행 절차는 스키마 적용 문서를 따른다.

## 검증 결과 (2026-11-17)

- 최종 `npm test`: **63/63 통과**. HWPX 13, 제출요건 2, API/검증 19, 카탈로그/import 11, PostgreSQL RLS/CRUD 18개다.
- 서로 다른 합성 표 형식 최소 2개를 생성→다시 열어 이름·학교/전공/학위·직위·검증 경력·선택 실적의 값을 확인했다. section·스타일 참조·비본문 ZIP entry 보존, identity coverage, 셀 값 불일치 거부, 비정상/미지원 입력도 확인했다. 테스트 fixture는 모두 창작한 합성값이다.
- 실제 서버 HWPX 3개는 원문 반출 없이 로컬 읽기/구조 분석에 성공했다. 실제 문서 산출물을 저장소에 만들거나 실제 직원값으로 채우지 않았다.
- PGlite 실제 PostgreSQL에 초안 SQL을 적용해 pending/inactive/viewer/editor/admin CRUD/RLS, 경력 근거, generation source snapshot·불변성·감사 접근을 확인했다. 운영 Supabase Auth/JWT 검증을 대신하지 않는다.
- `npm run build` 성공. localhost HTTP 루트 200, 연결 미설정 API 503, 잘못된 리소스 404 확인. 연결된 브라우저가 없어 화면 조작·한컴 렌더링은 미검증이다.
- 실제 AX 환경변수·schema·초기 승인 계정·인력/실적 import가 아직 없으므로 운영 DB 왕복 성공·실데이터 일치·실제 OAuth 성공을 주장하지 않는다.

## 배포와 마지막 설정

Vercel에 배포할 경우 Root Directory를 **web**, Framework Next.js, Build `npm run build`, Output `.next`로 설정한다. 기존 Apps Script와 다른 프로젝트로 구성한다. 기존 `intw-ax` 저장소/프로젝트를 수정하거나 연결 대상을 바꾸지 않는다. Production 도메인은 실제 배포 뒤 확인한다. Hobby 내부 비상업 범위와 무료 한도·접근 통제를 먼저 확인하며 유료 add-on/업그레이드는 사용하지 않는다.

alphagpu에서는 이 디렉터리에서 loopback 개발/Production 서버를 실행한다. 장시간 worker·문서 업로드 서버·큐·GPU·도메인·터널은 이번 MVP에 필요하지 않아 추가하지 않는다. 외부 HTTPS 공개는 별도 승인 대상이다.

남은 마지막 단계는 AX 스키마 적용/초기 admin UUID 지정, publishable 환경변수·Auth redirect 설정, 허용 필드만의 비공개 import, 승인된 합성 계정의 실제 JWT 검증이다. 기존 2개 Free 프로젝트를 유지하며 새 프로젝트 생성·정지·삭제·요금제 변경을 하지 않는다. 현재 commit/push/PR/clasp push/배포/DB apply/import는 수행하지 않았다.


## 최종 외부 상태 재확인 — 초기 SQL 재실행 금지

작업 시작의 읽기 전용 조회에서는 AX public 업무 테이블이 없었으나 최종 조회에서는 `ax_proposal_mvp` migration(version `20261117080248`)과 RLS가 켜진 `ax_*` 테이블 8개가 발견됐다. 이 작업 세션/병행 에이전트는 운영 migration·SQL 쓰기를 호출하지 않았다. 변경 주체는 확인하지 않았으며 외부 작업을 되돌리지 않는다. profiles/staff/performance/participation/bid/mapping/generation 건수는 모두 0이다. 실제 행은 조회하지 않았다.

현행 컬럼·RLS 이름은 새 앱 계약과 맞지만 함수 메타데이터상 통합 학력 `education` 매핑과 신규 생성의 활성 인력 검사 보완이 필요하다. `001_ax_schema.sql`은 빈 프로젝트용 참고본이므로 **현재 프로젝트에 다시 적용하지 않는다**. 기존 함수 정의/권한을 비공개로 보관하고 `003_existing_schema_alignment.sql`의 두 함수만 실제 정의와 비교한 뒤 승인 적용한다. 이 파일은 행·Auth bootstrap·다른 함수·기존 테이블을 삭제하거나 덮어쓰지 않는다. 실패 전에는 transaction rollback, 적용 후에는 보관한 두 함수 정의로만 되돌리며 기존 데이터/감사 이력은 보존한다.

현재 마지막 단계는 초기 SQL 일괄 실행이 아니라 기존 migration 출처/상태 확인 → 차이 SQL 검토 → 초기 승인 계정/환경변수/허용 열 import → 실제 JWT 검증이다. 운영 상태와 로컬 검증을 구분한다.

### Public synthetic demo

Open `/demo` to try the staff and performance HWPX forms without signing in or configuring Supabase. All records on this route are synthetic and stay in the browser; the download action does not write audit rows. Use **참여인력 예시 양식 불러오기** or **수행실적 예시 양식 불러오기**.

### HWP conversion

The app reads and fills HWPX files locally in the browser. It does not convert binary HWP files. Open a `.hwp` in Hancom Office and use **File → Save As → HWPX Document (*.hwpx)**, then upload that output. Server-side conversion requires a licensed Hancom conversion engine/API; no such engine or license is configured in this deployment.

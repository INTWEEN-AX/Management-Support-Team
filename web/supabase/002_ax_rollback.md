# AX 스키마 적용·초기 관리자·롤백 절차

상태: `001_ax_schema.sql`은 **로컬 초안**이며 운영 Supabase에 적용하지 않았다. 대상은 AX 전용 프로젝트 `oancjcvjtpbipodewjki`이다. APFS 프로젝트나 다른 기존 업무 DB에는 적용하지 않는다.

## 적용 직전 확인

1. 콘솔에 로그인한 계정·조직·프로젝트 ref가 AX 대상인지 확인한다. 무료 프로젝트를 추가·중지·삭제하거나 요금제를 변경하지 않는다.
2. public 스키마의 `ax_*` 객체가 아직 없는지 확인한다. 이미 있는 객체가 있으면 이 빈 프로젝트용 초기 스키마를 실행하지 않고 실제 스키마와 차이를 먼저 비교한다.
3. 기존 객체·데이터가 있다면 해당 서비스의 정상 백업 절차로 복원 지점을 확보한다. 개인정보 원문·DB password·service role key를 저장소나 대화에 복사하지 않는다.
4. SQL 변경 범위는 `ax_*` 테이블, `private.ax_*` 함수, Auth 신규 사용자 프로필 트리거, RLS 정책이다. 기존 테이블과 행을 삭제하지 않는다. Supabase SQL Editor에서 검토한 동일한 SQL만 실행하며 인증·콘솔 승인이 필요한 마지막 단계는 사용자가 수행한다.
5. 파일 전체는 한 트랜잭션이다. 오류 시 일부 문장만 건너뛰어 계속하지 않고 트랜잭션을 취소한다. 실패 후에는 실제 객체 생성 여부부터 확인한다.

## 초기 관리자 지정

이메일 주소에 따라 자동 관리자 권한을 주지 않는다. 모든 신규 가입은 `viewer / approved=false / active=true`이며, 관리자 승인 전 업무자료를 읽거나 쓸 수 없다.

첫 계정을 가입·이메일 확인한 뒤 Supabase Auth 콘솔에서 **그 사용자 UUID와 계정 소유자를 직접 대조**한다. 아래 자리표시자를 확인한 UUID로 바꿔 SQL Editor에서 실행한다. UUID는 인증 비밀이 아니지만 실제 관리자 식별값을 저장소에 기록하지 않는다. 이름·이메일·토큰은 SQL에 넣지 않는다.

```sql
begin;
-- 먼저 Auth 콘솔에서 대조한 UUID인지 확인한다. 존재하지 않으면 0행이다.
insert into public.ax_profiles(id)
select id from auth.users where id = 'CONFIRMED_USER_UUID'::uuid
on conflict(id) do nothing;

update public.ax_profiles
set role='admin', approved=true, active=true
where id='CONFIRMED_USER_UUID'::uuid;

-- 출력은 UUID·권한·상태만 확인한다.
select id,role,approved,active
from public.ax_profiles where id='CONFIRMED_USER_UUID'::uuid;
commit;
```

자리표시자 상태로 실행하면 UUID 변환에 실패하므로 적용되지 않는다. 관리자 지정 후 로그아웃·재로그인하고 관리자 화면을 확인한다. 이후 신규 계정은 관리자 화면에서 승인·역할·활성 여부를 지정한다. API와 RLS 모두 관리자의 자기 권한 해제를 막는다.

## 적용 후 검증

실제 업무자료를 쓰기 전에 별도로 승인된 합성 계정·합성 행으로 승인대기 차단, 비활성 차단, viewer 쓰기 차단, editor CRUD, admin 승인, 직접 REST 경유 RLS 우회 차단을 확인한다. 이번 로컬 검증은 PGlite 안의 합성 역할·합성 행으로만 수행했으며 운영 Auth/DB 검증을 대신하지 않는다.

```bash
cd web
node --test tests/rls.test.js tests/catalog.test.js
```

`tests/rls.test.js`는 실제 PostgreSQL 실행 엔진(PGlite)에 초안 SQL을 적용하고 `anon`/`authenticated`, `auth.uid()`를 합성으로 구성한다. PGlite의 내장 `gen_random_uuid()`를 사용하므로 테스트에서만 `pgcrypto` 확장 선언을 생략한다. 운영 프로젝트 연결·파일·사용자 자료를 사용하지 않는다.

## 안전한 자료 가져오기

서버의 승인된 비공개 JSON `{headers,rows}`를 `tools/import-safe.mjs`로 처리한다. 개인정보 제외는 내보낸 시트를 저장소로 복사한 뒤 지우는 방식이 아니라, 메모리에서 허용된 열만 투영하는 방식이다. JSON 원본은 저장소 밖에 두며 stdin도 지원한다.

```bash
# 저장소 루트에서 실행. 기본은 dry-run이며 출력은 행·열 개수뿐이다.
node tools/import-safe.mjs --input /private/approved-sheet.json --resource staff --tab '재직(상근)'
```

허용 리소스는 `staff`, `performances`, `bids`이다. 원본의 주소·생년월일·연락처·개인이메일·첨부·미지원 열은 결과에 남기지 않는다. 허용 열 안에 연락처·이메일·URL처럼 금지한 값이 있으면 전체 입력을 거부한다. 인력 경력은 자동으로 검증하지 않으며 항상 미검증으로 들어간다. 실적 증빙도 기본 미확인이다.

실제 DB 저장은 추가 `--apply` 플래그가 있을 때만 수행한다. 런타임 환경에 다음 이름을 안전하게 공급해야 한다. 토큰 값은 명령 인자·기록·파일·대화에 넣지 않는다. 이 도구는 `.env`를 읽지 않는다.

- `NEXT_PUBLIC_SUPABASE_URL`: 위 AX 프로젝트의 정확한 URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: 해당 프로젝트의 publishable key
- `AX_IMPORT_ACCESS_TOKEN`: 승인·활성 상태인 `admin` 또는 `editor`의 사용자 access token. Service role·DB password를 사용하지 않는다.

`auth.getUser`와 AX 프로필 승인·활성·역할을 확인한 후 같은 bearer/RLS로 저장한다. 기존 `source_ref`는 건너뛰며 덮어쓰지 않는다. `source_ref`는 `탭식별자!row:행번호`이며 시트가 여러 개이면 각 시트를 구별하는 비개인정보 탭식별자를 일관되게 사용한다. 최대 입력 10MiB/10,000행/200열, DB 쓰기는 100행 단위다. 중간 실패 시 일부 배치가 이미 저장됐을 수 있다. 삭제로 원복하지 말고 개수와 `source_ref` 기준으로 확인하고 재실행한다. 출력과 오류에는 원본 행·이름·탭명·자격증명을 쓰지 않는다.

## 롤백 원칙

- 적용 전 단계라면 새 로컬 SQL·도구·테스트만 검토 대상으로 되돌리고 기존 사용자 코드는 보존한다.
- SQL 트랜잭션이 실패했다면 `rollback;`으로 취소하고 실제 상태를 재확인한다. 자동 drop 또는 재생성으로 진행하지 않는다.
- 적용 후 문제가 생기면 먼저 새 앱의 쓰기·공개 전환을 중단하고 이전 앱 버전으로 복귀한다. `ax_*` 데이터와 감사 이력은 유지한다.
- 이미 저장된 자료가 있는 경우 `drop schema`, `drop table`, `truncate`, 일괄 `delete`는 롤백 기본 절차가 아니다. 필요한 데이터·권한 복원 범위를 산정하고 승인된 백업/복원 계획을 따로 마련한다.
- 이 스키마는 생성 이력을 수정·삭제할 수 없게 하고 그 이력이 참조한 자료의 삭제도 막는다. 생성 시점의 선택 인력·실적·검증 상태·출처는 DB 트리거가 비공개 `selection_snapshot`에 직접 보존한다. 클라이언트가 전달한 스냅샷은 무시하며 이후 원본 수정도 과거 스냅샷을 바꾸지 않는다. API 일반 목록과 감사 로그에는 스냅샷 원문을 반환하지 않는다. 잘못된 자료는 새 버전으로 정정하고 인력은 `active=false`로 관리할 수 있다. 삭제 제약을 해제해 우회하지 않는다.
- Auth 트리거를 되돌려야 하는 경우 새 가입 흐름에 미치는 영향과 기존 프로필·자료 보존을 먼저 확인한다. 초기 관리자·RLS 정책 변경 역시 별도 콘솔 승인이 필요한 마지막 단계다.

이 문서에는 destructive down migration을 제공하지 않는다. 데이터 보존이 확인되지 않은 상태에서 자동 삭제를 실행하지 않도록 하기 위함이다.


## 최종 외부 상태 재확인 — 초기 SQL 재실행 금지

작업 시작의 읽기 전용 조회에서는 AX public 업무 테이블이 없었으나 최종 조회에서는 `ax_proposal_mvp` migration(version `20261117080248`)과 RLS가 켜진 `ax_*` 테이블 8개가 발견됐다. 이 작업 세션/병행 에이전트는 운영 migration·SQL 쓰기를 호출하지 않았다. 변경 주체는 확인하지 않았으며 외부 작업을 되돌리지 않는다. profiles/staff/performance/participation/bid/mapping/generation 건수는 모두 0이다. 실제 행은 조회하지 않았다.

현행 컬럼·RLS 이름은 새 앱 계약과 맞지만 함수 메타데이터상 통합 학력 `education` 매핑과 신규 생성의 활성 인력 검사 보완이 필요하다. `001_ax_schema.sql`은 빈 프로젝트용 참고본이므로 **현재 프로젝트에 다시 적용하지 않는다**. 기존 함수 정의/권한을 비공개로 보관하고 `003_existing_schema_alignment.sql`의 두 함수만 실제 정의와 비교한 뒤 승인 적용한다. 이 파일은 행·Auth bootstrap·다른 함수·기존 테이블을 삭제하거나 덮어쓰지 않는다. 실패 전에는 transaction rollback, 적용 후에는 보관한 두 함수 정의로만 되돌리며 기존 데이터/감사 이력은 보존한다.

현재 마지막 단계는 초기 SQL 일괄 실행이 아니라 기존 migration 출처/상태 확인 → 차이 SQL 검토 → 초기 승인 계정/환경변수/허용 열 import → 실제 JWT 검증이다. 운영 상태와 로컬 검증을 구분한다.

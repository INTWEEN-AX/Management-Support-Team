import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const ids = {
  admin:'10000000-0000-4000-8000-000000000001',editor:'10000000-0000-4000-8000-000000000002',viewer:'10000000-0000-4000-8000-000000000003',pending:'10000000-0000-4000-8000-000000000004',inactive:'10000000-0000-4000-8000-000000000005',
  staff:'20000000-0000-4000-8000-000000000001',performance:'20000000-0000-4000-8000-000000000002',mapping:'20000000-0000-4000-8000-000000000003',bid:'20000000-0000-4000-8000-000000000004',generation:'20000000-0000-4000-8000-000000000005',
};
const hash='a'.repeat(64), report={filledCells:2,filledRows:1,overflowCount:0,unfilledCount:1};
async function as(user, fn) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  try { return await fn(); } finally { await db.exec('reset role'); }
}
async function count(table) { return Number((await db.query(`select count(*) as n from public.${table}`)).rows[0].n); }
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  // PGlite has gen_random_uuid built in; Supabase's extension declaration is not required in the in-memory host.
  const sql = (await readFile(new URL('../supabase/001_ax_schema.sql', import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', '');
  await db.exec(sql);
  await db.exec(await readFile(new URL('../supabase/003_existing_schema_alignment.sql', import.meta.url), 'utf8'));
  for (const id of [ids.admin,ids.editor,ids.viewer,ids.pending,ids.inactive]) await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query("update public.ax_profiles set role='admin',approved=true where id=$1",[ids.admin]);
  await db.query("update public.ax_profiles set role='editor',approved=true where id=$1",[ids.editor]);
  await db.query("update public.ax_profiles set approved=true where id=$1",[ids.viewer]);
  await db.query("update public.ax_profiles set role='editor',approved=true,active=false where id=$1",[ids.inactive]);
  await as(ids.editor, async () => {
    await db.query('insert into public.ax_staff(id,name,career_years,career_verified,career_source,source_ref) values($1,$2,3,true,$3,$4)',[ids.staff,'합성 인력 A','합성 경력 확인서','재직(상근)!row:2']);
    await db.query('insert into public.ax_performances(id,task_name,evidence_verified) values($1,$2,true)',[ids.performance,'합성 수행사례']);
    await db.query('insert into public.ax_template_mappings(id,name,template_hash,profile) values($1,$2,$3,$4)',[ids.mapping,'합성 매핑',hash,JSON.stringify([])]);
    await db.query('insert into public.ax_bids(id,title) values($1,$2)',[ids.bid,'합성 입찰']);
  });
});
after(async () => { if (db) await db.close(); });

test('new auth users are pending viewers without email-based administrator bootstrap', async () => {
  const { rows }=await db.query('select role,approved,active from public.ax_profiles where id=$1',[ids.pending]);
  assert.deepEqual(rows[0],{role:'viewer',approved:false,active:true});
});
test('anonymous has no business-data table privilege',async()=>{await as(null,async()=>{await assert.rejects(db.query('select * from public.ax_staff'),{code:'42501'});});});
test('pending user can inspect own profile but cannot read business records',async()=>{await as(ids.pending,async()=>{assert.equal(await count('ax_profiles'),1);assert.equal(await count('ax_staff'),0);await assert.rejects(db.query("insert into public.ax_staff(name) values('합성 미승인 자료')"));});});
test('inactive user has no business records and cannot mutate',async()=>{await as(ids.inactive,async()=>{assert.equal(await count('ax_staff'),0);await assert.rejects(db.query("insert into public.ax_bids(title) values('합성 비활성 자료')"));});});
test('approved viewer reads records but cannot create, change, or delete them',async()=>{await as(ids.viewer,async()=>{assert.equal(await count('ax_staff'),1);await assert.rejects(db.query("insert into public.ax_staff(name) values('합성 조회자 자료')"));const updated=await db.query("update public.ax_staff set position='변경금지' where id=$1 returning id",[ids.staff]);assert.equal(updated.rows.length,0);const deleted=await db.query('delete from public.ax_staff where id=$1 returning id',[ids.staff]);assert.equal(deleted.rows.length,0);});});
test('editor cannot read other profiles, approve own account, or grant administrator role',async()=>{await as(ids.editor,async()=>{assert.equal(await count('ax_profiles'),1);const {rows}=await db.query("update public.ax_profiles set role='admin' where id=$1 returning id",[ids.editor]);assert.equal(rows.length,0);});});
test('admin can approve pending account and restore pending state without deleting data',async()=>{await as(ids.admin,async()=>{assert.equal(await count('ax_profiles'),5);assert.equal((await db.query('update public.ax_profiles set approved=true where id=$1 returning id',[ids.pending])).rows.length,1);await db.query('update public.ax_profiles set approved=false where id=$1',[ids.pending]);});});
test('administrator cannot remove own role, approval, or active state',async()=>{await as(ids.admin,async()=>{for(const change of ["role='viewer'",'approved=false','active=false'])await assert.rejects(db.query(`update public.ax_profiles set ${change} where id=$1`,[ids.admin]),{code:'42501'});});});
test('editor CRUD enforces immutable IDs and created_by identity',async()=>{await as(ids.editor,async()=>{const {rows}=await db.query("insert into public.ax_bids(title,source_ref) values('합성 CRUD','입찰!row:99') returning id,created_by");assert.equal(rows[0].created_by,ids.editor);await db.query("update public.ax_bids set title='합성 수정' where id=$1",[rows[0].id]);await assert.rejects(db.query('update public.ax_bids set created_by=$1 where id=$2',[ids.admin,rows[0].id]),{code:'42501'});await assert.rejects(db.query("insert into public.ax_bids(title,created_by) values('합성 위조',$1)",[ids.admin]),{code:'42501'});assert.equal((await db.query('delete from public.ax_bids where id=$1 returning id',[rows[0].id])).rows.length,1);});});
test('verified career requires both numeric years and a nonblank source',async()=>{await as(ids.editor,async()=>{await assert.rejects(db.query("insert into public.ax_staff(name,career_verified,career_years) values('합성 미확인 경력',true,3)"),{code:'23514'});await assert.rejects(db.query("update public.ax_staff set career_source='' where id=$1",[ids.staff]),{code:'23514'});});});
test('database rejects forbidden contact values and undeclared private-data columns',async()=>{await as(ids.editor,async()=>{await assert.rejects(db.query("insert into public.ax_staff(name) values('demo@example.invalid')"),{code:'23514'});await assert.rejects(db.query("insert into public.ax_staff(name,phone) values('합성 인력','synthetic')"),{code:'42703'});});});
test('source_ref uniqueness prevents duplicate imports without changing existing record',async()=>{await as(ids.editor,async()=>{await assert.rejects(db.query("insert into public.ax_staff(name,source_ref) values('합성 중복','재직(상근)!row:2')"),{code:'23505'});assert.equal((await db.query('select name from public.ax_staff where id=$1',[ids.staff])).rows[0].name,'합성 인력 A');});});
test('participation requires existing staff and performance references',async()=>{await as(ids.editor,async()=>{await db.query("insert into public.ax_participations(staff_id,performance_id,role,verified) values($1,$2,'합성 업무',true)",[ids.staff,ids.performance]);await assert.rejects(db.query("insert into public.ax_participations(staff_id,performance_id) values('99999999-0000-4000-8000-000000000001',$1)",[ids.performance]),{code:'23503'});});});
test('mapping JSON stores supported coordinates and fields only',async()=>{await as(ids.editor,async()=>{const invalid=[{tableId:'section0/table1',kind:'staff',mode:'repeat',headerRow:0,columns:{0:'phone'},pairs:[]}];await assert.rejects(db.query("insert into public.ax_template_mappings(name,template_hash,profile) values('합성 금지 매핑',$1,$2)",[hash,JSON.stringify(invalid)]),{code:'23514'});});});
test('generation verifies selected membership, duplicate IDs, mapping hash, and count-only report',async()=>{await as(ids.editor,async()=>{const insert=(staffIds,templateHash=hash,result=report)=>db.query('insert into public.ax_generations(template_hash,staff_ids,performance_ids,mapping_id,report) values($1,$2,$3,$4,$5)',[templateHash,staffIds,[ids.performance],ids.mapping,JSON.stringify(result)]);await assert.rejects(insert(['99999999-0000-4000-8000-000000000001']),{code:'23514'});await assert.rejects(insert([ids.staff,ids.staff]),{code:'23514'});await assert.rejects(insert([ids.staff],'b'.repeat(64)),{code:'23514'});await assert.rejects(insert([ids.staff],hash,{...report,rawText:'금지'}),{code:'23514'});await db.query('insert into public.ax_generations(id,bid_id,template_hash,staff_ids,performance_ids,mapping_id,report,selection_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8)',[ids.generation,ids.bid,hash,[ids.staff],[ids.performance],ids.mapping,JSON.stringify(report),JSON.stringify({clientText:'ignored'})]);});});
test('generation trigger preserves verified facts and sources even after source records change',async()=>{await as(ids.editor,async()=>{const before=(await db.query('select selection_snapshot from public.ax_generations where id=$1',[ids.generation])).rows[0].selection_snapshot;assert.equal(before.clientText,undefined);assert.equal(before.staff[0].name,'합성 인력 A');assert.equal(before.staff[0].career_verified,true);assert.equal(before.staff[0].career_source,'합성 경력 확인서');assert.equal(before.staff[0].source_ref,'재직(상근)!row:2');assert.equal(before.performances[0].task_name,'합성 수행사례');await db.query("update public.ax_staff set career_years=4,career_source='합성 변경 확인서' where id=$1",[ids.staff]);await db.query("update public.ax_performances set task_name='합성 수정 수행사례' where id=$1",[ids.performance]);const after=(await db.query('select selection_snapshot from public.ax_generations where id=$1',[ids.generation])).rows[0].selection_snapshot;assert.deepEqual(after,before);});});
test('generation records are immutable and their source IDs cannot be deleted',async()=>{await as(ids.editor,async()=>{await assert.rejects(db.query('update public.ax_generations set report=$1 where id=$2',[JSON.stringify(report),ids.generation]),{code:'42501'});await assert.rejects(db.query('delete from public.ax_generations where id=$1',[ids.generation]),{code:'42501'});await assert.rejects(db.query('delete from public.ax_staff where id=$1',[ids.staff]));await assert.rejects(db.query('delete from public.ax_performances where id=$1',[ids.performance]));});});
test('audit events are generated by triggers, contain only metadata, and are admin-readable',async()=>{
 await as(ids.editor,async()=>{assert.equal(await count('ax_audit_events'),0);await assert.rejects(db.query("insert into public.ax_audit_events(entity_type,entity_id,action) values('ax_staff',$1,'INSERT')",[ids.staff]),{code:'42501'});});
 await as(ids.admin,async()=>{const {rows}=await db.query('select entity_type,entity_id,action,metadata from public.ax_audit_events order by id');assert.ok(rows.length>10);assert.ok(rows.every(row=>['INSERT','UPDATE','DELETE'].includes(row.action)));assert.ok(rows.every(row=>Object.keys(row.metadata).every(key=>['staffCount','performanceCount'].includes(key))));assert.equal(JSON.stringify(rows).includes('합성 인력 A'),false);assert.equal(JSON.stringify(rows).includes('합성 수행사례'),false);});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateRecord, projectSheetRows, cleanMapping, toEngineStaff } from '../lib/catalog.js';
import { parseArgs, prepareImport } from '../../tools/import-safe.mjs';

test('safe projection strips unlisted birth/address/contact/attachment columns before validation',()=>{
 const headers=['부서','이름','직위','최종학력 학교','최종학력 전공','최종학력 학위','최종학력 졸업년월','인트윈 입사년월일','생년월일','주소','휴대전화','개인이메일','첨부'];
 const rows=[['합성 부서','합성 인력','합성 직위','합성 학교','합성 전공','합성 학위','2020.02','2024. 1. 2','000000','synthetic-private-address','010-0000-0000','synthetic@example.invalid','https://example.invalid/private']];
 const {records,summary}=prepareImport({headers,rows},{resource:'staff',tab:'재직(상근)'});
 assert.equal(records.length,1);assert.equal(records[0].joined_on,'2024-01-02');assert.equal(records[0].graduation_year,2020);assert.equal(records[0].employment_type,'상근');assert.equal(records[0].career_verified,false);assert.equal(records[0].source_ref,'재직(상근)!row:2');assert.equal(summary.excludedColumns,5);
 const serialized=JSON.stringify(records);for(const blocked of ['000000','synthetic-private-address','010-0000-0000','synthetic@example.invalid','https://example.invalid/private'])assert.equal(serialized.includes(blocked),false);
});
test('part-time tab is distinguished without changing career evidence',()=>{const {records}=prepareImport({headers:['이름'],rows:[['합성 비상근']]},{resource:'staff',tab:'재직(비상근)'});assert.equal(records[0].employment_type,'비상근');assert.equal(records[0].career_verified,false);assert.equal(toEngineStaff(records[0]).careerVerified,false);});
test('blank identity rows are skipped without copying unrelated values',()=>{assert.equal(projectSheetRows('staff',['이름','주소'],[['','합성 제외 자료']]).length,0);});
test('header normalization handles spaces while duplicate aliases are rejected',()=>{assert.equal(prepareImport({headers:['이 름'],rows:[['합성 인력']]}).records[0].name,'합성 인력');assert.throws(()=>prepareImport({headers:['이름','이 름'],rows:[['합성 A','합성 B']]}));});
test('imported performance evidence is unverified and source is row-addressable',()=>{const {records}=prepareImport({headers:['과업명','금액','연도','지분율(%)'],rows:[['합성 과업','1,200','2025','50']]},{resource:'performances',tab:'승인실적'});assert.equal(records[0].amount,1200);assert.equal(records[0].year,2025);assert.equal(records[0].share,50);assert.equal(records[0].evidence_verified,false);assert.equal(records[0].source_ref,'승인실적!row:2');});
test('record validator rejects personal fields, private strings, unsafe values, and unsupported resources',()=>{for(const input of [{name:'합성',phone:'excluded'},{name:'demo@example.invalid'},{name:'010-0000-0000'},{name:'합성',career_years:-1},{name:'합성',career_verified:true}])assert.throws(()=>validateRecord('staff',input));assert.throws(()=>validateRecord('unsupported',{}));});
test('mapping validator rejects forbidden target fields and returns only declared cell keys',()=>{assert.throws(()=>cleanMapping([{tableId:'section0/table1',kind:'staff',headerRow:0,columns:{0:'phone'}}]));const mapping=cleanMapping([{tableId:'section0/table1',kind:'staff',headerRow:0,columns:{0:'name'},discard:'excluded',pairs:[]}]);assert.equal('discard' in mapping[0],false);});
test('generation reports retain numeric summary only and reject duplicate selected IDs',()=>{const id='10000000-0000-4000-8000-000000000001',hash='a'.repeat(64);const record={template_hash:hash,staff_ids:[id],performance_ids:[],report:{filledCells:1,filledRows:1,overflowCount:0,unfilledCount:0,rawText:'excluded'}};const clean=validateRecord('generations',record);assert.equal('rawText' in clean.report,false);assert.throws(()=>validateRecord('generations',{...record,staff_ids:[id,id]}));});
test('CLI defaults to dry-run and rejects credential arguments without echoing values',()=>{assert.equal(parseArgs([]).apply,false);assert.throws(()=>parseArgs(['--token','synthetic-token']));assert.throws(()=>parseArgs(['--resource','profiles']));assert.throws(()=>parseArgs(['--tab','contact@example.invalid']));});
test('dry-run stdout contains counts only and does not expose input rows or excluded columns',()=>{
 const run=spawnSync(process.execPath,['tools/import-safe.mjs','--input','-','--resource','staff','--tab','재직(상근)'],{cwd:new URL('../../',import.meta.url),input:JSON.stringify({headers:['이름','개인이메일','주소'],rows:[['합성 비공개 인력','contact@example.invalid','비공개 주소']]}),encoding:'utf8'});
 assert.equal(run.status,0);assert.deepEqual(JSON.parse(run.stdout),{dryRun:true,totalRows:1,acceptedRows:1,skippedRows:0,excludedColumns:2});assert.equal(run.stderr,'');for(const value of ['합성 비공개 인력','contact@example.invalid','비공개 주소','재직(상근)'])assert.equal(run.stdout.includes(value),false);
});
test('invalid CLI input produces generic failure without printing payload',()=>{const run=spawnSync(process.execPath,['tools/import-safe.mjs'],{cwd:new URL('../../',import.meta.url),input:'not-json-with-private-value',encoding:'utf8'});assert.equal(run.status,1);assert.equal((run.stdout+run.stderr).includes('private-value'),false);});

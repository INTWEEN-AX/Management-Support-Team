import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { analyzeHwpx, fillHwpx, readHwpxArchive, HWPX_FIELDS, verifyHwpxOutputCells } from '../lib/hwpx.js';
import { archive, cell, table, staffFixture, performanceFixture, unknownFixture } from './hwpx-fixtures.js';
const staff=[{id:'staff-a',educationSchool:'합성 대학교',educationDegree:'합성 학위',name:'합성 참여인력 A',position:'합성 직위',careerYears:7,careerVerified:true,careerSource:'합성 승인 경력증빙',joinDate:'합성 입사일',birthDate:'FORBIDDEN_BIRTH',phone:'FORBIDDEN_PHONE'}, {id:'staff-b',name:'합성 참여인력 B',position:'합성 보조',careerYears:10,careerVerified:false,careerSource:'',joinDate:''}];
const performance=[{id:'perf-a',taskName:'합성 행사 운영',client:'합성 발주기관',amount:12345,period:'합성 수행기간'}, {id:'perf-b',taskName:'합성 행사 초과',client:'합성 기관',amount:6789,period:'합성 기간'}];
function documentText(bytes,section='Contents/section0.xml'){return strFromU8(readHwpxArchive(bytes).files.get(section));}
function assertPreserved(before,after){
 const a=readHwpxArchive(before),b=readHwpxArchive(after);
 assert.deepEqual([...a.files.keys()],[...b.files.keys()]);
 for(const [name,bytes]of a.files){if(!/^Contents\/section\d+\.xml$/.test(name))assert.deepEqual(b.files.get(name),bytes,`${name} must remain byte-identical`);}
 for(const name of a.sections){const old=strFromU8(a.files.get(name)),now=strFromU8(b.files.get(name));for(const attr of ['paraPrIDRef="23"','charPrIDRef="17"','styleIDRef="8"','borderFillIDRef="7"'])assert.equal((now.match(new RegExp(attr,'g'))||[]).length,(old.match(new RegExp(attr,'g'))||[]).length,`${name} ${attr}`);assert.equal((now.match(/<hp:tbl /g)||[]).length,(old.match(/<hp:tbl /g)||[]).length);}
 assert.equal(new DataView(after.buffer,after.byteOffset,after.byteLength).getUint16(8,true),0,'mimetype first entry must be uncompressed');
}
test('staff profile: reopens filled XML, keeps style/layout/example rows, creates hp:t, verified career only',()=>{
 const source=staffFixture(),analysis=analyzeHwpx(source,{fileName:'합성_인력.hwpx'});
 assert.equal(analysis.tables[0].kind,'staff');assert.equal(analysis.tables[0].headerRow,0);
 const result=fillHwpx(source,{fileName:'합성_인력.hwpx',staff});
 assertPreserved(source,result.bytes);
 const xml=documentText(result.bytes);assert.match(xml,/합성 참여인력 A/);assert.match(xml,/합성 참여인력 B/);assert.match(xml,/7년 \(검증됨\)/);assert.doesNotMatch(xml,/10년/);assert.match(xml,/확인 필요/);assert.match(xml,/합성 기존값/);assert.doesNotMatch(xml,/FORBIDDEN/);assert.equal(result.report.staff,2);assert.equal(result.report.overflow.length,0);assert.notEqual(result.fileName,'합성_인력.hwpx');assert.deepEqual(result.report.verification.matchedStaffIds,['staff-a','staff-b']);assert.deepEqual(result.report.verification.missingStaffIds,[]);assert.equal(result.report.verification.checkedCells,10);assert.ok(result.report.verification.missingFields.some(item=>item.id==='staff-a'&&item.fields.includes('educationSchool')));assert.doesNotMatch(JSON.stringify(result.report.verification),/합성 참여인력|합성 대학교|7년/);
});
test('second profile: reordered performance columns, merged title row, sections preserved, overflow + pair style',()=>{
 const source=performanceFixture(),analysis=analyzeHwpx(source,{fileName:'합성_실적.hwpx'});
 assert.equal(analysis.sections.length,2);assert.equal(analysis.tables[0].kind,'performance');assert.equal(analysis.tables[0].headerRow,1);assert.equal(analysis.tables[0].columns[0],'client');assert.equal(analysis.tables[0].columns[2],'taskName');assert.equal(analysis.tables[1].mode,'pairs');
 const result=fillHwpx(source,{fileName:'합성_실적.hwpx',staff:[{id:'staff-c',name:'합성 인력 C',role:'합성 기획'}],performance});
 assertPreserved(source,result.bytes);const filled=analyzeHwpx(result.bytes);
 assert.deepEqual(filled.tables[0].rows[2].map(c=>c.text),['합성 발주기관','12345','합성 행사 운영','합성 수행기간']);
 assert.equal(filled.tables[1].rows[0][1].text,'합성 인력 C');assert.equal(filled.tables[1].rows[0][3].text,'합성 기획');assert.deepEqual(result.report.overflow,[{tableId:'Contents/section0.xml#0',kind:'performance',filled:1,total:2}]);assert.deepEqual(result.report.verification.matchedStaffIds,['staff-c']);assert.deepEqual(result.report.verification.matchedPerformanceIds,['perf-a']);assert.deepEqual(result.report.verification.missingPerformanceIds,['perf-b']);assert.equal(result.report.verification.checkedCells,6);
});
test('unknown profile can be explicitly mapped; unmapped/forbidden field rejected',()=>{
 const bytes=unknownFixture(),analysis=analyzeHwpx(bytes);assert.equal(analysis.tables[0].kind,'unknown');assert.throws(()=>fillHwpx(bytes,{staff}),/빈 칸/);
 const map={tableId:analysis.tables[0].id,kind:'staff',mode:'repeat',headerRow:0,columns:{0:'name',1:'position'}};
 assert.match(documentText(fillHwpx(bytes,{staff:[staff[0]],mappings:[map]}).bytes),/합성 참여인력 A/);
 assert.throws(()=>fillHwpx(bytes,{staff,mappings:[{...map,columns:{0:'birthDate'}}]}),/필드 매핑/);
});
test('private field columns stay blank, private existing values are redacted in analysis and rejected for output',()=>{
 const blank=archive([table([['성명','직위','생년월일'],[null,null,null]])]);
 const result=fillHwpx(blank,{staff:[staff[0]]});assert.deepEqual(analyzeHwpx(result.bytes).tables[0].rows[1].map(c=>c.text),['합성 참여인력 A','합성 직위','']);
 const populated=archive([table([['성명','직위','생년월일'],['합성 인력','합성 직위','PRIVATE_SENTINEL']])]);
 assert.doesNotMatch(JSON.stringify(analyzeHwpx(populated)),/PRIVATE_SENTINEL/);assert.throws(()=>fillHwpx(populated,{staff}),/금지 개인정보/);
});
test('malformed XML / non-HWPX / oversized / active code / traversal / invalid ZIP are refused',()=>{
 assert.throws(()=>analyzeHwpx(staffFixture(),{fileName:'원본.hwp'}),/HWPX/);
 assert.throws(()=>analyzeHwpx(new Uint8Array(10*1024*1024+1)),/10MB/);
 assert.throws(()=>analyzeHwpx(new Uint8Array([1,2,3,4])),/서명/);
 assert.throws(()=>analyzeHwpx(archive([table([['성명','직위'],['','']])],{'Contents/section0.xml':strToU8('<bad><mismatch></bad>')})),/XML/);
 assert.throws(()=>analyzeHwpx(archive([table([['성명','직위'],['','']])],{'Scripts/source.js':strToU8('throw new Error()')})),/실행 코드/);
 assert.throws(()=>analyzeHwpx(archive([table([['성명','직위'],['','']])],{'../escape.txt':strToU8('x')})),/경로/);
 assert.throws(()=>analyzeHwpx(archive([table([['성명','직위'],['','']])],{'Contents/evil.xml':strToU8('<!DOCTYPE x [<!ENTITY e "x">]><x>&e;</x>')})),/DTD/);
 const broken=staffFixture();broken[50]^=1;assert.throws(()=>analyzeHwpx(broken),/ZIP|CRC|압축|파일 이름/);
});
test('ZIP expansion limits reject high ratio before decompression',()=>{
 const bomb=zipSync({mimetype:strToU8('application/hwp+zip'),'Contents/section0.xml':strToU8('x'.repeat(1024*1024))});
 assert.throws(()=>analyzeHwpx(bomb),/압축 비율/);
});
test('nonblank rows remain unchanged and merged data rows are not guessed',()=>{
 const bytes=archive([table([['성명','직위'],['기입된 합성 이름','기입된 합성 직위'],[{text:'',colSpan:2}],['','']])]);
 const result=fillHwpx(bytes,{staff:[staff[0]]});const parsed=analyzeHwpx(result.bytes);
 assert.deepEqual(parsed.tables[0].rows[1].map(c=>c.text),['기입된 합성 이름','기입된 합성 직위']);assert.equal(parsed.tables[0].rows[2][0].text,'');assert.equal(parsed.tables[0].rows[3][0].text,'합성 참여인력 A');assert.ok(result.report.unfilled.some(item=>item.reason.includes('병합')));
});
test('public mapping field dictionary never includes private field targets',()=>{for(const values of Object.values(HWPX_FIELDS))for(const item of values)assert.doesNotMatch(item.value,/birth|phone|address|salary|account|email/i);});

test('identity must actually be inserted; counts alone cannot mark a record reflected',()=>{
 const bytes=archive([table([['직위','경력'],[null,null]])]);
 const result=fillHwpx(bytes,{staff:[staff[0]]});assert.equal(result.report.staff,1);assert.deepEqual(result.report.verification.matchedStaffIds,[]);assert.deepEqual(result.report.verification.missingStaffIds,['staff-a']);assert.equal(result.report.verification.checkedCells,2);
});
test('coverage across tables succeeds when one overflows but another includes all selected identities',()=>{
 const bytes=archive([table([['성명','직위'],[null,null]],'911')+table([['성명','직위'],[null,null],[null,null]],'912')]);
 const result=fillHwpx(bytes,{staff});assert.equal(result.report.overflow.length,1);assert.deepEqual(result.report.verification.matchedStaffIds,['staff-a','staff-b']);assert.deepEqual(result.report.verification.missingStaffIds,[]);assert.equal(result.report.verification.checkedCells,6);
});
test('mapped education, position and verified career read back exactly; no private values are placed in verification report',()=>{
 const bytes=archive([table([['성명','최종학력','직위','경력'],[null,null,null,null]])]);
 const result=fillHwpx(bytes,{staff:[staff[0]]});const values=analyzeHwpx(result.bytes).tables[0].rows[1].map(cell=>cell.text);
 assert.deepEqual(values,['합성 참여인력 A','학교: 합성 대학교 · 전공: 확인 필요 · 학위: 합성 학위','합성 직위','7년 (검증됨)']);assert.equal(result.report.verification.checkedCells,4);assert.deepEqual(result.report.verification.missingStaffIds,[]);assert.doesNotMatch(JSON.stringify(result.report.verification),/합성 대학교|합성 참여인력|7년/);
});
test('serialized readback mismatch rejects a wrong expected value and missing cell before download',()=>{
 const bytes=fillHwpx(staffFixture(),{staff:[staff[0]]}).bytes;
 const location={sectionName:'Contents/section0.xml',tableIndex:0,row:2,column:1};
 assert.equal(verifyHwpxOutputCells(bytes,[{...location,value:'합성 참여인력 A'}]),1);
 assert.throws(()=>verifyHwpxOutputCells(bytes,[{...location,value:'합성 다른 인력'}]),/재열기 검증 실패/);
 assert.throws(()=>verifyHwpxOutputCells(bytes,[{...location,row:999,value:'합성 참여인력 A'}]),/재열기 검증 실패/);
});

test('combined education aliases cover school, major, degree and unknown components explicitly',()=>{
 assert.ok(HWPX_FIELDS.staff.some(field=>field.value==='education'));
 for(const label of ['최종학력','학력','학력사항']){
  const bytes=archive([table([['성명',label,'직위','경력'],[null,null,null,null]])]);
  assert.equal(analyzeHwpx(bytes).tables[0].columns[1],'education');
  const record={...staff[0],educationMajor:'합성 전공'};
  const filled=fillHwpx(bytes,{staff:[record]});
  assert.equal(analyzeHwpx(filled.bytes).tables[0].rows[1][1].text,'학교: 합성 대학교 · 전공: 합성 전공 · 학위: 합성 학위');
  assert.deepEqual(filled.report.verification.missingStaffIds,[]);
  assert.ok(!filled.report.verification.missingFields.some(item=>item.fields.some(field=>['educationSchool','educationMajor','educationDegree'].includes(field))));
 }
 const bytes=archive([table([['성명','학력사항'],[null,null]])]);
 const unknown=fillHwpx(bytes,{staff:[{id:'unknown-education',name:'합성 미확인 인력'}]});
 assert.equal(analyzeHwpx(unknown.bytes).tables[0].rows[1][1].text,'학교: 확인 필요 · 전공: 확인 필요 · 학위: 확인 필요');
 assert.equal(unknown.report.verification.checkedCells,2);
});

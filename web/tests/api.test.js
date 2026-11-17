import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText,cleanMapping,validateRecord,projectSheetRows,toEngineStaff} from '../lib/catalog.js';
import {body,context,checked,allowWrite,failure,ApiError,tableFor} from '../lib/api-server.js';
import {GET as list,POST as create} from '../app/api/v1/[resource]/route.js';
import {PATCH as patch} from '../app/api/v1/[resource]/[id]/route.js';
import {GET as me} from '../app/api/v1/me/route.js';

const userId='10000000-0000-4000-8000-000000000001';
const sourceId='20000000-0000-4000-8000-000000000001';
const token='synthetic-user-access-token';
const apiUrl='https://oancjcvjtpbipodewjki.supabase.co';
const hash='a'.repeat(64);
const report={filledCells:1,filledRows:1,overflowCount:0,unfilledCount:0};
function request(path,{method='GET',json,headers={}}={}){return new Request(`http://localhost/api/v1${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(json===undefined?{}:{'Content-Type':'application/json'}),...headers},...(json===undefined?{}:{body:JSON.stringify(json)})});}
async function environment(fn){
 const priorUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,priorKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 process.env.NEXT_PUBLIC_SUPABASE_URL=apiUrl;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic_only';
 try{return await fn();}finally{if(priorUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=priorUrl;if(priorKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=priorKey;}
}
async function fakeBackend(profile,fn,{authError=false,selection=[]}={}){
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url);calls.push({path:url.pathname,method:init.method||'GET'});
  if(url.origin!==apiUrl)throw new Error('Test refused non-synthetic network destination');
  if(url.pathname==='/auth/v1/user')return Response.json(authError?{msg:'private raw auth detail'}:{id:userId,aud:'authenticated',role:'authenticated',email:'synthetic@invalid.example'},{status:authError?401:200});
  if(url.pathname==='/rest/v1/ax_profiles')return Response.json([profile]);
  if(url.pathname==='/rest/v1/ax_staff'&&(!init.method||init.method==='GET'))return Response.json(selection);
  throw new Error('Unexpected backend request; no network was performed');
 };
 try{return await environment(()=>fn(calls));}finally{globalThis.fetch=previous;}
}
const approved=(role='editor')=>({id:userId,role,approved:true,active:true,display_name:'합성 업무 계정'});

test('private contact, identity number and URLs rejected before API persistence',()=>{
 for(const value of ['synthetic@invalid.example','010-0000-0000','900101-1000000','https://invalid.example/attachment'])assert.throws(()=>cleanText(value));
 assert.equal(cleanText('합성 출처 문서 2쪽'),'합성 출처 문서 2쪽');
});
test('unknown and private fields rejected including arbitrary source payload',()=>{
 for(const key of ['phone','email','address','source_payload','attachments','birth_date'])assert.throws(()=>validateRecord('staff',{name:'합성 직원',[key]:'blocked'}));
});
test('staff verified career needs declared evidence and numeric value',()=>{
 assert.throws(()=>validateRecord('staff',{name:'합성 직원',career_verified:true}));
 assert.equal(validateRecord('staff',{name:'합성 직원',career_verified:true,career_years:3,career_source:'합성 경력증명 1쪽'}).career_verified,true);
});
test('generation selections prohibit duplicates and oversized ID arrays',()=>{
 assert.throws(()=>validateRecord('generations',{template_hash:hash,staff_ids:[sourceId,sourceId],performance_ids:[],report}));
 assert.throws(()=>validateRecord('generations',{template_hash:hash,staff_ids:Array(101).fill(sourceId),performance_ids:[],report}));
});
test('generation reports persist only numeric counts, never arbitrary client text',()=>{
 const record=validateRecord('generations',{template_hash:hash,staff_ids:[sourceId],performance_ids:[],report:{...report,rawText:'not retained'}});
 assert.deepEqual(record.report,report);
 assert.throws(()=>validateRecord('generations',{template_hash:hash,staff_ids:[],performance_ids:[],report:{...report,filledCells:-1}}));
});
test('mapping schema rejects forbidden contact fields',()=>{
 assert.throws(()=>cleanMapping([{tableId:'Contents/section0.xml:0',kind:'staff',mode:'repeat',headerRow:0,columns:{0:'phone'},pairs:[]} ]));
 const mapping=cleanMapping([{tableId:'Contents/section0.xml:0',kind:'staff',mode:'repeat',headerRow:0,columns:{0:'name'},pairs:[]}]);
 assert.equal(mapping[0].columns[0],'name');
});
test('sheet projection drops unknown/private headers before retaining values',()=>{
 const projected=projectSheetRows('staff',['이름','부서','연락처','주소','첨부파일'],[['합성 직원','합성 부서','discard-me','discard-me','discard-me']]);
 assert.equal(projected.length,1);assert.equal(projected[0].name,'합성 직원');
 assert.equal(JSON.stringify(projected).includes('discard-me'),false);
 assert.equal(projected[0].career_verified,false);
});
test('engine projection does not expose unlisted source fields',()=>{
 const projected=toEngineStaff({id:sourceId,name:'합성 직원',phone:'discard',birth_date:'discard',career_verified:false});
 assert.equal('phone' in projected,false);assert.equal('birth_date' in projected,false);
});
test('body parser rejects oversized and malformed JSON without retaining it',async()=>{
 await assert.rejects(body(new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(65537)})),error=>error.status===413);
 await assert.rejects(body(new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})),error=>error.status===400);
});
test('failure normalizes raw server and database details',async()=>{
 const response=failure(new Error('synthetic private DB statement should not escape'));
 assert.equal(response.status,500);assert.equal((await response.text()).includes('synthetic private'),false);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('write permissions do not treat viewer as editor or editor as admin',()=>{
 assert.throws(()=>allowWrite(approved('viewer'),'staff'),error=>error.status===403);
 assert.throws(()=>allowWrite(approved('editor'),'profiles'),error=>error.status===403);
 assert.doesNotThrow(()=>allowWrite(approved('admin'),'profiles'));
 assert.throws(()=>checked('staff',{phone:'blocked'}),error=>error.status===400&&error.code==='INVALID_RECORD');
});
test('missing bearer rejected without any backend request',async()=>{
 await environment(async()=>{await assert.rejects(context(new Request('http://localhost/api/v1/me')),error=>error instanceof ApiError&&error.status===401);});
});
test('Auth is verified and pending user can only read own me, not catalog',async()=>{
 await fakeBackend({...approved('viewer'),approved:false},async(calls)=>{
  const own=await me(request('/me'));assert.equal(own.status,200);assert.equal((await own.json()).data.approved,false);
  const denied=await list(request('/staff'),{params:Promise.resolve({resource:'staff'})});assert.equal(denied.status,403);
  assert.equal(calls.some(c=>c.path==='/rest/v1/ax_staff'),false);
 });
});
test('raw authentication error details are not returned',async()=>{
 await fakeBackend(approved(),async()=>{const response=await me(request('/me'));assert.equal(response.status,401);assert.equal((await response.text()).includes('private raw'),false);},{authError:true});
});
test('editor cannot list profiles or post a data mutation as viewer',async()=>{
 await fakeBackend(approved('editor'),async()=>{const response=await list(request('/profiles'),{params:Promise.resolve({resource:'profiles'})});assert.equal(response.status,403);});
 await fakeBackend(approved('viewer'),async(calls)=>{const response=await create(request('/staff',{method:'POST',json:{name:'합성'}}),{params:Promise.resolve({resource:'staff'})});assert.equal(response.status,403);assert.equal(calls.some(c=>c.method==='POST'),false);});
});
test('selected generation source ID must be visible in database',async()=>{
 await fakeBackend(approved(),async()=>{const response=await create(request('/generations',{method:'POST',json:{template_hash:hash,staff_ids:[sourceId],performance_ids:[],report}}),{params:Promise.resolve({resource:'generations'})});assert.equal(response.status,403);assert.equal((await response.json()).error.code,'SELECTION_DENIED');},{selection:[]});
});
test('immutable generations cannot be patched through API',async()=>{
 await fakeBackend(approved(),async()=>{const response=await patch(request(`/generations/${sourceId}`,{method:'PATCH',json:{report}}),{params:Promise.resolve({resource:'generations',id:sourceId})});assert.equal(response.status,405);});
});

test('mutation origin is checked and inherited resource names are not accepted',async()=>{
  await assert.rejects(context(new Request('http://local/api/v1/staff',{method:'POST',headers:{origin:'https://outside.invalid'}})),error=>error.status===403);
  for(const name of ['constructor','toString','__proto__'])assert.throws(()=>tableFor(name),error=>error.status===404);
});
test('impossible calendar date is rejected before reaching the database',()=>{
  assert.throws(()=>validateRecord('staff',{name:'합성 직원',joined_on:'2026-02-30'}));
  assert.equal(validateRecord('staff',{name:'합성 직원',joined_on:'2026-02-28'}).joined_on,'2026-02-28');
});

// Source allowlists are shared by API validation and the private import utility.
export const RESOURCE_TABLES = Object.freeze({ staff: 'ax_staff', performances: 'ax_performances', participations: 'ax_participations', bids: 'ax_bids', mappings: 'ax_template_mappings', generations: 'ax_generations', profiles: 'ax_profiles' });
export const FIELDS = Object.freeze({
  staff: ['department','name','position','education_school','education_major','education_degree','graduation_year','joined_on','employment_type','active','career_years','career_verified','career_source','source_ref'],
  performances: ['task_name','summary','client','year','amount','period','field','evidence_verified','share','source_ref'],
  participations: ['staff_id','performance_id','role','verified','source_ref'],
  bids: ['notice_number','title','organization','deadline','source_ref'],
  mappings: ['name','template_hash','profile'],
  generations: ['bid_id','template_hash','staff_ids','performance_ids','mapping_id','report'],
  profiles: ['role','approved','active'],
});
export const SELECTS = Object.fromEntries(Object.entries(FIELDS).map(([name,fields])=>[name,['id',...fields,'created_at','updated_at'].join(',')]));
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const required = {staff:['name'],performances:['task_name'],participations:['staff_id','performance_id'],bids:['title'],mappings:['name','template_hash','profile'],generations:['template_hash','staff_ids','performance_ids','report']};
const booleans = new Set(['active','career_verified','evidence_verified','verified','approved']);
const numberRanges={graduation_year:[1900,2200],year:[1900,2200],amount:[0,1e15],share:[0,100],career_years:[0,80]};
const privatePattern = /\b\d{6}\s*-\s*[1-8]\d{6}\b|\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|https?:\/\//i;
export function cleanText(value,max=2000){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||privatePattern.test(value))throw new Error('허용되지 않는 값 또는 개인정보·URL이 포함되어 있습니다.');
  return value.trim();
}
export function cleanMapping(value){
  if(!Array.isArray(value)||value.length>100)throw new Error('매핑 표 수는 100개 이하여야 합니다.');
  return value.map(m=>{
    if(!m||!['staff','performance','unknown'].includes(m.kind)||!['repeat','pairs'].includes(m.mode||'repeat')||typeof m.tableId!=='string'||m.tableId.length>200)throw new Error('매핑 형식이 올바르지 않습니다.');
    const fields = new Set(m.kind==='staff'?['_index','name','department','position','education','educationSchool','educationMajor','educationDegree','educationGraduationYear','joinDate','employmentType','employmentTenure','careerYears','role']:['_index','taskName','client','amount','period','startDate','endDate','description','year','share','field','evidenceVerified']);
    const columns={};
    for(const [index,field] of Object.entries(m.columns||{})){if(!/^\d{1,3}$/.test(index)||(!fields.has(field)&&field!==''))throw new Error('금지 또는 미지원 매핑 필드입니다.');columns[index]=field;}
    if(!Number.isInteger(m.headerRow)||m.headerRow<0||m.headerRow>1000)throw new Error('머리글 행을 확인하세요.');
    const pairs=(m.pairs||[]).map(pair=>{for(const k of ['row','column','targetRow','targetColumn'])if(!Number.isInteger(pair[k])||pair[k]<0||pair[k]>1000)throw new Error('셀 매핑 위치를 확인하세요.');if(!fields.has(pair.field))throw new Error('금지 매핑 필드입니다.');return Object.fromEntries(['row','column','targetRow','targetColumn','field'].map(k=>[k,pair[k]]));});
    return {tableId:m.tableId,kind:m.kind,mode:m.mode||'repeat',headerRow:m.headerRow,columns,pairs};
  });
}
export function validateRecord(resource,input,{partial=false}={}){
  if(!Object.hasOwn(FIELDS,resource)||!input||typeof input!=='object'||Array.isArray(input))throw new Error('지원되지 않는 자료 형식입니다.');
  for(const key of Object.keys(input))if(!FIELDS[resource].includes(key))throw new Error('허용되지 않는 필드가 있습니다.');
  const out={};
  for(const [key,val] of Object.entries(input)){
    if(val===null){out[key]=null;continue;}
    if(booleans.has(key)){if(typeof val!=='boolean')throw new Error('확인 상태는 참/거짓이어야 합니다.');out[key]=val;}
    else if(key in numberRanges){const [min,max]=numberRanges[key];if(typeof val!=='number'||!Number.isFinite(val)||val<min||val>max||(['year','graduation_year'].includes(key)&&!Number.isInteger(val)))throw new Error('수치 범위를 확인하세요.');out[key]=val;}
    else if(key==='profile')out[key]=cleanMapping(val);
    else if(key==='report'){
      if(!val||typeof val!=='object'||Array.isArray(val))throw new Error('생성 결과 요약이 필요합니다.');
      out[key]={};for(const k of ['filledCells','filledRows','overflowCount','unfilledCount']){if(!Number.isInteger(val[k])||val[k]<0||val[k]>100000)throw new Error('생성 요약 값이 올바르지 않습니다.');out[key][k]=val[k];}
    }
    else if(key.endsWith('_ids')){if(!Array.isArray(val)||val.length>100||val.some(id=>!UUID.test(id))||new Set(val).size!==val.length)throw new Error('선택 ID를 확인하세요.');out[key]=val;}
    else if(key.endsWith('_id')){if(!UUID.test(val))throw new Error('연결 ID를 확인하세요.');out[key]=val;}
    else if(key==='template_hash'){if(!/^[a-f0-9]{64}$/.test(val))throw new Error('문서 해시를 확인하세요.');out[key]=val;}
    else if(key==='role'&&resource==='profiles'){if(!['admin','editor','viewer'].includes(val))throw new Error('지원되지 않는 역할입니다.');out[key]=val;}
    else if(key==='joined_on'){if(!/^\d{4}-\d{2}-\d{2}$/.test(val)||(Number.isNaN(Date.parse(val))||new Date(val).toISOString().slice(0,10)!==val))throw new Error('입사일 형식은 YYYY-MM-DD입니다.');out[key]=val;}
    else out[key]=cleanText(val,key==='summary'?4000:500);
  }
  if(!partial)for(const key of required[resource]||[])if(out[key]===undefined||out[key]===null||out[key]==='')throw new Error('필수 필드를 확인하세요.');
  if(out.career_verified===true&&(!out.career_source||out.career_years==null)&&!partial)throw new Error('검증된 경력은 확인 근거와 기간이 필요합니다.');
  return out;
}
export function employmentTenure(joinedOn){if(!joinedOn)return '확인 필요';const start=new Date(joinedOn),now=new Date();if(Number.isNaN(start.getTime())||start>now)return '확인 필요';const months=(now.getFullYear()-start.getFullYear())*12+now.getMonth()-start.getMonth()-(now.getDate()<start.getDate()?1:0);return `${Math.floor(months/12)}년 ${months%12}개월 (입사일 기준)`;}
export function toEngineStaff(s){return {id:s.id,name:s.name,department:s.department,position:s.position,educationSchool:s.education_school,educationMajor:s.education_major,educationDegree:s.education_degree,educationGraduationYear:s.graduation_year,joinDate:s.joined_on,employmentTenure:employmentTenure(s.joined_on),employmentType:s.employment_type,careerYears:s.career_years,careerVerified:s.career_verified===true,careerSource:s.career_source,sourceRef:s.source_ref};}
export function toEnginePerformance(p){return {id:p.id,taskName:p.task_name,description:p.summary,client:p.client,year:p.year,amount:p.amount,period:p.period,field:p.field,evidenceVerified:p.evidence_verified===true,share:p.share,sourceRef:p.source_ref};}
// No network call, logging or file creation. Unknown columns, birth/age/address/contact/attachments are never retained.
export const SHEET_MAPS={
  staff:{'부서':'department','이름':'name','직위':'position','최종학력 학교':'education_school','최종학력 전공':'education_major','최종학력 학위':'education_degree','최종학력 졸업년월':'graduation_year','인트윈 입사년월일':'joined_on'},
  performances:{'과업명':'task_name','용역 개요':'summary','발급기관':'client','연도':'year','금액':'amount','계약기간':'period','분야':'field','지분율(%)':'share'},
  bids:{'공고번호':'notice_number','공고명':'title','공고기관':'organization','마감일시':'deadline'},
};
export function projectSheetRows(resource,headers,rows,{tab='승인자료',startRow=2,employmentType='확인 필요'}={}){
  const map=SHEET_MAPS[resource];if(!map)throw new Error('지원하지 않는 import 종류입니다.');
  const normalized=headers.map(h=>String(h||'').replace(/\s+/g,''));
  const cols=Object.entries(map).map(([header,field])=>[normalized.indexOf(header.replace(/\s+/g,'')),field]).filter(([index])=>index>=0);
  if(!cols.some(([,f])=>f===(resource==='staff'?'name':resource==='bids'?'title':'task_name')))throw new Error('이름 또는 사업명 머리글을 확인하세요.');
  return rows.flatMap((row,index)=>{
    const candidate={source_ref:`${tab}!row:${startRow+index}`};
    for(const [col,field] of cols){let v=row[col];if(v===undefined||v===null||v==='')continue;
      if(['amount','year','graduation_year','share'].includes(field)){v=Number(String(v).replace(/,/g,'').match(field==='graduation_year'?/^\d{4}/:/^-?[\d.]+$/)?.[0]);if(!Number.isFinite(v))continue;}
      else if(field==='joined_on'){const m=String(v).match(/^(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);if(!m)continue;v=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;}
      else v=String(v);candidate[field]=v;
    }
    if(resource==='staff')Object.assign(candidate,{active:true,employment_type:employmentType,career_verified:false});
    if(resource==='performances')candidate.evidence_verified=false;
    if(!candidate[resource==='staff'?'name':resource==='bids'?'title':'task_name'])return [];
    return [validateRecord(resource,candidate)];
  });
}

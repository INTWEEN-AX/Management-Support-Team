/**
 * Browser-local HWPX form engine.
 * Adapted from the existing Apps Script FormFill.gs / FormAnalyzer.gs algorithms:
 * normalized label aliases, first-three-row header detection, blank rows only,
 * missing hp:t creation, and explicit overflow reporting. Original .gs files untouched.
 * No HTTP, storage, Google APIs, AI, or private HR fields are used here.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { inflateSync, strFromU8, strToU8, zipSync } from 'fflate';

const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const SECTION_RE = /^Contents\/section\d+\.xml$/;
export const HWPX_LIMITS = Object.freeze({ fileBytes: 10 * 1024 * 1024, expandedBytes: 40 * 1024 * 1024, entryBytes: 12 * 1024 * 1024, entries: 1024, tables: 500, cells: 30000, ratio: 200 });
const STAFF_FIELDS = [['_index','연번'],['name','성명'],['department','부서'],['position','직위'],['employmentType','고용형태'],['education','학력 (학교·전공·학위)'],['educationSchool','최종학교'],['educationMajor','전공'],['educationDegree','학위'],['educationGraduationYear','졸업연도'],['careerYears','검증된 경력'],['employmentTenure','입사 후 근속'],['joinDate','입사일'],['role','담당업무']];
const PERF_FIELDS = [['_index','연번'],['taskName','사업·과업명'],['client','발주처'],['amount','계약금액'],['period','수행기간'],['startDate','시작일'],['endDate','종료일'],['description','수행내용'],['year','수행연도'],['share','참여지분'],['field','분야'],['evidenceVerified','증빙 확인']];
export const HWPX_FIELDS = Object.freeze({ staff: STAFF_FIELDS.map(([value,label])=>({value,label})), performance: PERF_FIELDS.map(([value,label])=>({value,label})) });
const ALIASES = {
  staff: {
    _index:['연번','번호','순번','no'], name:['성명','이름','참여자명','인력명','참여인력','담당자'], department:['소속','부서','소속부서','근무처'], position:['직위','직급','직책'], employmentType:['고용형태','근무형태','상근여부'], education:['최종학력','학력','학력사항'], educationSchool:['출신학교','학교','최종학교'], educationMajor:['전공','학과','전공분야'], educationDegree:['학위'], educationGraduationYear:['졸업연도','졸업년도'], careerYears:['경력','경력기간','총경력','실무경력','경력년수','경력연수'], employmentTenure:['근속기간','재직기간','근속연수'], joinDate:['입사일','입사년월일','입사일자'], role:['담당업무','역할','참여분야','담당분야','수행업무'],
  },
  performance: {
    _index:['연번','번호','순번','no'], taskName:['과업명','사업명','용역명','계약건명','실적명','사업내용','용역과업명'], client:['발주처','발주기관','수요기관','계약기관','발주자','주관기관'], amount:['계약금액','계약액','사업비','용역비','금액','수행금액'], period:['계약기간','수행기간','용역기간','사업기간','이행기간'], startDate:['착수일','시작일','계약일자','계약일'], endDate:['완료일','종료일','준공일'], description:['용역개요','사업개요','주요내용','과업개요','수행내용','비고'], year:['수행연도','사업연도','연도'], share:['지분율','참여지분','분담비율'], field:['분야','사업분야'], evidenceVerified:['증빙확인','증빙여부'],
  },
};
const FORBIDDEN_LABEL = /생년월|생일|주민등록|주민번호|개인연락처|휴대폰|휴대전화|핸드폰|집주소|자택주소|개인주소|주소|전화번호|연락처|이메일|email|전자우편|계좌|급여|연봉|보수|비밀번호|비상연락|긴급연락|혈액형|성별|종교|병역|건강|장애정보/;
export const normalizeLabel = value => String(value ?? '').toLowerCase().replace(/[\s()（）:：.\-_/]/g,'');
export const isBlankCell = value => /^[\s\-–—_.·]*$/.test(String(value ?? ''));
export const isForbiddenHwpxLabel = value => FORBIDDEN_LABEL.test(normalizeLabel(value));
const aliasMaps = Object.fromEntries(Object.entries(ALIASES).map(([kind,fields])=>[kind,Object.fromEntries(Object.entries(fields).flatMap(([field,labels])=>labels.map(label=>[normalizeLabel(label),field])))]));
const fieldsByKind = Object.fromEntries(Object.entries(HWPX_FIELDS).map(([kind,fields])=>[kind,new Set(fields.map(f=>f.value))]));
function fail(message) { throw new Error(message); }
function asBytes(value) { return value instanceof Uint8Array ? value : new Uint8Array(value); }
function localName(node) { return node.localName || String(node.nodeName).split(':').pop(); }
function children(node,tag) { return Array.from(node.childNodes || []).filter(n=>n.nodeType===1 && (!tag || localName(n)===tag)); }
function descendants(node,tag,stopAtTables=false) {
  const out=[];
  function walk(current) { for(const child of children(current)){ if(localName(child)===tag) out.push(child); if(!(stopAtTables && localName(child)==='tbl')) walk(child); } }
  walk(node);return out;
}
function textOf(node) { return descendants(node,'t',true).map(n=>n.textContent || '').join('').replace(/\s+/g,' ').trim(); }
function parseXml(bytes) {
  let xml;
  try { xml = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { fail('UTF-8 XML만 지원합니다. 문서를 HWPX로 다시 저장하세요.'); }
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('DTD 또는 XML entity가 있는 문서는 지원하지 않습니다.');
  let broken=false;
  let document;
  try { document = new DOMParser({onError:()=>{broken=true;}}).parseFromString(xml,'application/xml'); } catch { fail('HWPX XML 구조가 올바르지 않습니다.'); }
  if(broken || !document?.documentElement || document.getElementsByTagName('parsererror').length) fail('HWPX XML 구조가 올바르지 않습니다.');
  // Whitespace, element count, and nesting are bounded before recursive table traversal.
  const stack=[[document.documentElement,0]];let count=0;
  while(stack.length){const [node,depth]=stack.pop();if(depth>100 || ++count>150000)fail('XML 구조가 너무 복잡합니다. 작은 문서로 나누세요.');for(const child of children(node))stack.push([child,depth+1]);}
  return document;
}

/** Strict ZIP central-directory preflight, followed by bounded individual inflation. */
export function readHwpxArchive(input,{fileName='서식.hwpx'}={}) {
  if(!/\.hwpx$/i.test(fileName)) fail('HWPX만 지원합니다. HWP 바이너리는 한컴에서 HWPX로 저장한 뒤 사용하세요.');
  const bytes=asBytes(input);if(!bytes.length || bytes.length>HWPX_LIMITS.fileBytes)fail('HWPX는 10MB 이하만 지원합니다.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=offset=>view.getUint16(offset,true),u32=offset=>view.getUint32(offset,true);
  if(bytes.length<22 || u32(0)!==0x04034b50)fail('HWPX ZIP 파일 서명이 올바르지 않습니다.');
  let eocd=-1;
  for(let pos=bytes.length-22;pos>=Math.max(0,bytes.length-65557);pos--){if(u32(pos)===0x06054b50 && pos+22+u16(pos+20)===bytes.length){eocd=pos;break;}}
  if(eocd<0)fail('ZIP 중앙 디렉터리를 찾지 못했습니다.');
  const count=u16(eocd+10),size=u32(eocd+12),offset=u32(eocd+16);
  if(u16(eocd+4)||u16(eocd+6)||u16(eocd+8)!==count||count===65535||count>HWPX_LIMITS.entries||offset+size!==eocd)fail('분할·ZIP64·과도한 항목의 압축 문서는 지원하지 않습니다.');
  const entries=[];const seen=new Set();let pos=offset,total=0;
  for(let i=0;i<count;i++){
    if(pos+46>eocd || u32(pos)!==0x02014b50)fail('ZIP 항목 구조가 손상되었습니다.');
    const flags=u16(pos+8),method=u16(pos+10),compressedSize=u32(pos+20),originalSize=u32(pos+24),nameLength=u16(pos+28),extraLength=u16(pos+30),commentLength=u16(pos+32),localOffset=u32(pos+42);
    const end=pos+46+nameLength+extraLength+commentLength;if(end>eocd)fail('ZIP 항목 길이가 올바르지 않습니다.');
    let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(pos+46,pos+46+nameLength));}catch{fail('UTF-8 ZIP 항목 이름만 지원합니다.');}
    if(!name || seen.has(name) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /[\x00-\x1f]/.test(name))fail('중복 또는 안전하지 않은 ZIP 경로입니다.');
    if(flags&1 || ![0,8].includes(method) || originalSize===0xffffffff || localOffset===0xffffffff)fail('암호화·ZIP64·미지원 압축 방식은 처리하지 않습니다.');
    if(originalSize>HWPX_LIMITS.entryBytes || originalSize/Math.max(1,compressedSize)>HWPX_LIMITS.ratio || (total+=originalSize)>HWPX_LIMITS.expandedBytes)fail('압축 해제 크기 또는 압축 비율 제한을 초과했습니다.');
    if(/(?:^|\/)(?:scripts?|javascript|activex|embeddings?|oleobjects?|_xmlsignatures|signatures?)(?:\/|\.)|\.(?:exe|dll|js|vbs|ps1|bat|cmd)$/i.test(name))fail('실행 코드·임베디드 객체·서명이 포함된 HWPX는 지원하지 않습니다.');
    if(localOffset+30>offset || u32(localOffset)!==0x04034b50 || u16(localOffset+8)!==method || u16(localOffset+6)!==flags)fail('ZIP 로컬 헤더가 일치하지 않습니다.');
    const localNameLength=u16(localOffset+26),localExtra=u16(localOffset+28),start=localOffset+30+localNameLength+localExtra;
    if(start+compressedSize>offset)fail('ZIP 데이터 범위를 벗어났습니다.');
    let localName;try{localName=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(localOffset+30,localOffset+30+localNameLength));}catch{fail('ZIP 파일 이름이 손상되었습니다.');}
    if(localName!==name)fail('ZIP 파일 이름이 일치하지 않습니다.');
    seen.add(name);entries.push({name,method,originalSize,compressedSize,start,crc:u32(pos+16)});pos=end;
  }
  if(pos!==eocd)fail('ZIP 중앙 디렉터리 크기가 올바르지 않습니다.');
  const files=new Map();
  for(const entry of entries){
    let data;try{data=entry.method===0?bytes.slice(entry.start,entry.start+entry.compressedSize):inflateSync(bytes.subarray(entry.start,entry.start+entry.compressedSize),{out:new Uint8Array(entry.originalSize)});}catch{fail('HWPX 압축 데이터를 읽지 못했습니다.');}
    if(data.length!==entry.originalSize || crc32(data)!==entry.crc)fail('ZIP 크기 또는 CRC 검사가 실패했습니다.');
    if(/\.(?:xml|hpf|rels)$/i.test(entry.name)) {
      const doc=parseXml(data);
      if(descendants(doc,'Relationship').some(node=>node.getAttribute('TargetMode')==='External'))fail('외부 참조 관계가 있는 문서는 지원하지 않습니다.');
    }
    files.set(entry.name,data);
  }
  if(!files.has('mimetype') || strFromU8(files.get('mimetype')).trim()!=='application/hwp+zip')fail('HWPX mimetype이 올바르지 않습니다.');
  const sections=Array.from(files.keys()).filter(name=>SECTION_RE.test(name)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  if(!sections.length || !files.has('Contents/header.xml'))fail('HWPX 본문 또는 스타일 헤더가 없습니다.');
  for(const name of sections){const root=parseXml(files.get(name)).documentElement;if(localName(root)!=='sec'||root.namespaceURI!=='http://www.hancom.co.kr/hwpml/2011/section')fail('지원하지 않는 HWPX 본문 네임스페이스 또는 구조입니다.');}
  return {files,sections,fileName};
}
const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let bit=0;bit<8;bit++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let crc=0xffffffff;for(const byte of data)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function topTables(document){return descendants(document,'tbl',true);}
function gridFor(table){return children(table,'tr').map(tr=>children(tr,'tc'));}
function matchField(text,kind){return isForbiddenHwpxLabel(text)?null:aliasMaps[kind][normalizeLabel(text)]||null;}
function inferMapping(grid){
  let best=null;
  for(let row=0;row<Math.min(3,grid.length-1);row++){
    const texts=grid[row].map(textOf),labeled=texts.filter(Boolean).length;if(labeled<2)continue;
    // Label/value pairs have alternating empty targets, not a repeated header row.
    if(texts.length>=4 && texts.filter(isBlankCell).length>=Math.floor(texts.length/2))continue;
    for(const kind of ['staff','performance']){
      const columns={};texts.forEach((text,i)=>{const field=matchField(text,kind);if(field)columns[i]=field;});
      const score=Object.values(columns).filter(field=>field!=='_index').length;
      if(score>=Math.max(2,Math.ceil(labeled/2))&&(!best || score>best.score))best={kind,mode:'repeat',headerRow:row,columns,score,pairs:[]};
    }
  }
  if(best)return best;
  let pairsBest=null;
  for(const kind of ['staff','performance']){
    const pairs=[];
    grid.forEach((row,r)=>row.forEach((cell,c)=>{const field=matchField(textOf(cell),kind);if(!field||field==='_index')return;
      if(row[c+1]&&isBlankCell(textOf(row[c+1])))pairs.push({row:r,column:c,field,targetRow:r,targetColumn:c+1});
      else if(grid[r+1]?.[c]&&isBlankCell(textOf(grid[r+1][c])))pairs.push({row:r,column:c,field,targetRow:r+1,targetColumn:c});
    }));
    if(pairs.length>=2&&(!pairsBest||pairs.length>pairsBest.pairs.length))pairsBest={kind,mode:'pairs',headerRow:0,columns:{},pairs,score:pairs.length};
  }
  return pairsBest||{kind:'unknown',mode:'repeat',headerRow:0,columns:{},pairs:[],score:0};
}
function tableDetails(sectionName,index,table){
  const grid=gridFor(table),mapping=inferMapping(grid),id=`${sectionName}#${index}`;
  const rows=grid.map(row=>row.map(cell=>({text:textOf(cell),colSpan:Number(children(cell,'cellSpan')[0]?.getAttribute('colSpan')||1),rowSpan:Number(children(cell,'cellSpan')[0]?.getAttribute('rowSpan')||1)})));
  // Do not expose populated prohibited cells through analysis/preview either.
  rows.forEach((labelRow,rowIndex)=>labelRow.forEach((cell,column)=>{if(isForbiddenHwpxLabel(cell.text)){for(const row of rows.slice(rowIndex+1)){if(row[column]&&!matchField(row[column].text,'staff')&&!matchField(row[column].text,'performance')&&!isForbiddenHwpxLabel(row[column].text))row[column].text=isBlankCell(row[column].text)?'':'[제외된 개인정보]';}}}));
  rows.forEach(row=>row.forEach((cell,column)=>{if(isForbiddenHwpxLabel(cell.text)&&row[column+1]&&!matchField(row[column+1].text,'staff')&&!matchField(row[column+1].text,'performance')&&!isForbiddenHwpxLabel(row[column+1].text))row[column+1].text=isBlankCell(row[column+1].text)?'':'[제외된 개인정보]';}));
  const warnings=[];
  if(rows.some(row=>row.some(cell=>cell.colSpan>1||cell.rowSpan>1)))warnings.push('병합 셀이 있습니다. 데이터 행의 열 수와 대응을 직접 확인하세요.');
  if(rows.some(row=>row.some(cell=>isForbiddenHwpxLabel(cell.text))))warnings.push('금지된 개인정보 필드는 자동 채우기 대상에서 제외됩니다.');
  if(mapping.kind==='unknown')warnings.push('자동 판정이 어려운 표입니다. 종류·머리글·열 매핑을 직접 지정하세요.');
  return {id,tableId:id,sectionName,index,rows,rowCount:rows.length,colCount:Math.max(0,...rows.map(row=>row.length)),...mapping,warnings};
}
export function analyzeHwpx(input,options={}){
  const archive=readHwpxArchive(input,options),tables=[],sections=[];let cells=0;
  for(const sectionName of archive.sections){const doc=parseXml(archive.files.get(sectionName));const nodes=topTables(doc);sections.push({name:sectionName,tableCount:nodes.length});
    nodes.forEach((table,index)=>{const details=tableDetails(sectionName,index,table);cells+=details.rows.reduce((sum,row)=>sum+row.length,0);if(tables.length>=HWPX_LIMITS.tables || cells>HWPX_LIMITS.cells)fail('문서 표 또는 셀 개수 제한을 초과했습니다.');tables.push(details);});}
  return {fileName:archive.fileName,sections,tables,warnings:['HWPX 표의 텍스트만 채웁니다. 쪽 나눔·글자 넘침은 한컴에서 최종 확인하세요.','병합 데이터 행은 자동으로 채우지 않습니다. 원본의 예시·기입 행은 보존합니다.']};
}
function setCellText(cell,value){
  const texts=descendants(cell,'t',true);if(texts.length){texts[0].textContent=value;for(const text of texts.slice(1))text.textContent='';return true;}
  const run=descendants(cell,'run',true)[0],paragraph=descendants(cell,'p',true)[0],doc=cell.ownerDocument;
  const namespace=cell.namespaceURI||HP,prefix=cell.prefix||'hp';
  const t=doc.createElementNS(namespace,`${prefix}:t`);t.textContent=value;
  if(run){run.appendChild(t);return true;}
  if(paragraph){const created=doc.createElementNS(namespace,`${prefix}:run`);created.setAttribute('charPrIDRef','0');created.appendChild(t);paragraph.appendChild(created);return true;}
  return false;
}
function safeValue(record,field,kind,index){
  if(!fieldsByKind[kind]?.has(field))fail('허용되지 않은 필드 매핑입니다.');
  if(field==='_index')return String(index+1);
  if(field==='careerYears'){
    const years=record.careerYears;
    if(record.careerVerified!==true || typeof record.careerSource!=='string' || !record.careerSource.trim() || years==='' || years==null || !Number.isFinite(Number(years)) || Number(years)<0 || Number(years)>80)return '확인 필요';
    return `${Number(years)}년 (검증됨)`;
  }
  if(field==='education'){
    const clean=value=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim():'';
    const school=clean(record.educationSchool||record.eduSchool),major=clean(record.educationMajor||record.eduMajor),degree=clean(record.educationDegree||record.eduDegree);
    const text=`학교: ${school||'확인 필요'} · 전공: ${major||'확인 필요'} · 학위: ${degree||'확인 필요'}`;
    if(text.length>1000)fail('학력 통합 필드 값은 1,000자 이하만 지원합니다.');
    return text;
  }
  if(field==='evidenceVerified')return record.evidenceVerified===true?'증빙 확인':'확인 필요';
  let value=record[field];
  // Original Apps Script spellings, permitted safe aliases only.
  const aliases={department:'dept',position:'title',educationSchool:'eduSchool',educationDegree:'eduDegree',educationMajor:'eduMajor',client:'org',period:'contractPeriod',description:'desc',startDate:'contractDate'};
  if((value===undefined||value===null||value==='')&&aliases[field])value=record[aliases[field]];
  if(value===undefined||value===null||value==='')return '확인 필요';
  if(!['string','number','boolean'].includes(typeof value))return '확인 필요';
  const text=String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim();if(text.length>1000)fail('필드 값은 1,000자 이하만 지원합니다.');
  return text||'확인 필요';
}
function validatePrivacy(grid,mapping){
  // Do not output existing private values in a forbidden labelled field. Reject, never log values.
  const labelRow=grid[mapping.headerRow]||[];
  const forbiddenColumns=labelRow.flatMap((cell,i)=>isForbiddenHwpxLabel(textOf(cell))?[i]:[]);
  grid.forEach((row,rowIndex)=>row.forEach((cell,column)=>{if(isForbiddenHwpxLabel(textOf(cell))){for(const following of grid.slice(rowIndex+1)){const value=following[column]&&textOf(following[column]);if(value&&!isBlankCell(value)&&!matchField(value,'staff')&&!matchField(value,'performance')&&!isForbiddenHwpxLabel(value))fail('원본의 금지 개인정보 칸에 값이 있습니다. 해당 값을 제거한 빈 서식을 사용하세요.');}}}));
  for(const row of grid){for(let col=0;col<row.length-1;col++){if(isForbiddenHwpxLabel(textOf(row[col])) && !isBlankCell(textOf(row[col+1])) && !matchField(textOf(row[col+1]),'staff') && !matchField(textOf(row[col+1]),'performance') && !isForbiddenHwpxLabel(textOf(row[col+1])))fail('원본의 금지 개인정보 항목에 값이 있습니다. 개인정보를 제거한 서식을 사용하세요.');}}
  return new Set(forbiddenColumns);
}
function validateMapping(mapping,details){
  if(!['staff','performance','unknown'].includes(mapping.kind))fail('서식 종류는 staff/performance/unknown만 지원합니다.');
  if(mapping.kind==='unknown')return;
  if(!['repeat','pairs'].includes(mapping.mode||'repeat'))fail('지원하지 않는 표 매핑 방식입니다.');
  if(!Number.isInteger(mapping.headerRow)||mapping.headerRow<0||mapping.headerRow>=details.rowCount)fail('머리글 행 범위가 올바르지 않습니다.');
  const valid=fieldsByKind[mapping.kind];
  for(const [column,field] of Object.entries(mapping.columns||{})){if(!/^\d+$/.test(column)||Number(column)>=details.colCount||!valid.has(field))fail('열 번호 또는 필드 매핑이 올바르지 않습니다.');}
  for(const pair of mapping.pairs||[]){if(!valid.has(pair.field)||![pair.row,pair.column,pair.targetRow,pair.targetColumn].every(Number.isInteger)||!details.rows[pair.row]?.[pair.column]||!details.rows[pair.targetRow]?.[pair.targetColumn])fail('라벨·값 위치 매핑이 올바르지 않습니다.');}
}

function recordKey(record,index) {
  const id=record.id??index;
  if(!['string','number'].includes(typeof id))fail('선택 데이터 ID 형식이 올바르지 않습니다.');
  return String(id);
}
export function verifyHwpxOutputCells(bytes,writes,{fileName='서식.hwpx'}={}) {
  if(!Array.isArray(writes)||writes.length>HWPX_LIMITS.cells)fail('검증 셀 목록 범위를 초과했습니다.');
  const archive=readHwpxArchive(bytes,{fileName}),grids=new Map();
  for(const write of writes){
    if(!archive.sections.includes(write.sectionName)||typeof write.value!=='string')fail('검증 셀 위치 또는 기대값 형식이 올바르지 않습니다.');
    if(!grids.has(write.sectionName))grids.set(write.sectionName,topTables(parseXml(archive.files.get(write.sectionName))).map(gridFor));
    const cell=grids.get(write.sectionName)?.[write.tableIndex]?.[write.row]?.[write.column];
    const normalizedExpected=write.value.replace(/\s+/g,' ').trim();
    if(!cell||textOf(cell)!==normalizedExpected)fail('산출물 재열기 검증 실패: 기록할 값과 실제 셀 내용이 다릅니다. 파일을 내려받지 않습니다.');
  }
  return writes.length;
}
function verifyWrittenCells(bytes,writes,recordsByKind,fileName) {
  // Reopen the generated ZIP; validation must read serialized output rather than in-memory DOM.
  const checkedCells=verifyHwpxOutputCells(bytes,writes,{fileName});
  const matched={staff:new Set(),performance:new Set()},fieldsWritten={staff:new Map(),performance:new Map()};
  for(const write of writes){
    const normalizedExpected=write.value.replace(/\s+/g,' ').trim();
    const set=fieldsWritten[write.kind].get(write.recordId)||new Set();set.add(write.field);fieldsWritten[write.kind].set(write.recordId,set);
    const identity=write.kind==='staff'?'name':'taskName';
    if(write.field===identity&&normalizedExpected&&normalizedExpected!=='확인 필요')matched[write.kind].add(write.recordId);
  }
  const missingFields=[];
  for(const kind of ['staff','performance']){
    recordsByKind[kind].forEach((record,index)=>{
      const id=recordKey(record,index),written=fieldsWritten[kind].get(id)||new Set();
      const relevant=HWPX_FIELDS[kind].map(item=>item.value).filter(field=>field!=='_index'&&(field=== (kind==='staff'?'name':'taskName')||field==='careerYears'||record[field]!==undefined&&record[field]!==null&&record[field]!==''));
      // A combined education cell explicitly covers school, major and degree including unknown markers.
      if(written.has('education')){written.add('educationSchool');written.add('educationMajor');written.add('educationDegree');}
      if(written.has('educationSchool')&&(!record.educationMajor||written.has('educationMajor'))&&(!record.educationDegree||written.has('educationDegree')))written.add('education');
      const fields=relevant.filter(field=>!written.has(field));
      if(fields.length)missingFields.push({kind,id,fields});
    });
  }
  return {
    matchedStaffIds:[...matched.staff],matchedPerformanceIds:[...matched.performance],
    missingStaffIds:recordsByKind.staff.map(recordKey).filter(id=>!matched.staff.has(id)),
    missingPerformanceIds:recordsByKind.performance.map(recordKey).filter(id=>!matched.performance.has(id)),
    checkedCells,missingFields,
  };
}

export function fillHwpx(input,{fileName='서식.hwpx',mappings,staff=[],performance=[]}={}){
  if(!Array.isArray(staff)||!Array.isArray(performance)||staff.some(item=>!item||typeof item!=='object'||Array.isArray(item))||performance.some(item=>!item||typeof item!=='object'||Array.isArray(item))||staff.length>500||performance.length>500)fail('선택 목록은 종류별 500건 이하여야 합니다.');
  for(const records of [staff,performance]){const ids=records.map(recordKey);if(new Set(ids).size!==ids.length)fail('선택 데이터 ID가 중복되었습니다.');}
  const archive=readHwpxArchive(input,{fileName}),analysis=analyzeHwpx(input,{fileName});
  const selected=mappings??analysis.tables;
  if(!Array.isArray(selected)||selected.length>HWPX_LIMITS.tables)fail('표 매핑 목록이 올바르지 않습니다.');
  const profiles=new Map();
  for(const mapping of selected){const id=mapping.tableId||mapping.id;const details=analysis.tables.find(table=>table.id===id);if(!details||profiles.has(id))fail('존재하지 않거나 중복된 표 매핑입니다.');validateMapping(mapping,details);profiles.set(id,mapping);}
  const report={filledCells:0,filledRows:0,overflow:[],unfilled:[],warnings:[...analysis.warnings],tables:analysis.tables.length,staff:0,performance:0};
  const writes=[];
  let changed=false;
  for(const sectionName of archive.sections){
    const doc=parseXml(archive.files.get(sectionName));let sectionChanged=false;
    topTables(doc).forEach((table,index)=>{
      const id=`${sectionName}#${index}`,details=analysis.tables.find(item=>item.id===id),mapping=profiles.get(id)||{kind:'unknown',mode:'repeat',headerRow:details.headerRow};
      const grid=gridFor(table),forbidden=validatePrivacy(grid,mapping);
      if(mapping.kind==='unknown'){report.unfilled.push({tableId:id,reason:'매핑 미지정'});return;}
      const records=mapping.kind==='staff'?staff:performance;
      if(!records.length){report.unfilled.push({tableId:id,reason:'선택한 데이터 없음'});return;}
      const write=(cell,field,item,recordIndex,row,column)=>{const value=safeValue(item,field,mapping.kind,recordIndex);if(setCellText(cell,value)){writes.push({sectionName,tableIndex:index,row,column,field,value,kind:mapping.kind,recordId:recordKey(item,recordIndex)});report.filledCells++;sectionChanged=true;return true;}report.unfilled.push({tableId:id,reason:'텍스트를 넣을 문단이 없는 셀'});return false;};
      if(mapping.mode==='pairs'){
        let wrote=false;
        for(const pair of mapping.pairs||[]){
          if(isForbiddenHwpxLabel(textOf(grid[pair.row][pair.column]))||forbidden.has(pair.targetColumn))continue;
          const cell=grid[pair.targetRow][pair.targetColumn];if(!isBlankCell(textOf(cell))){report.unfilled.push({tableId:id,reason:'기입된 라벨값 보존'});continue;}
          wrote=write(cell,pair.field,records[0],0,pair.targetRow,pair.targetColumn)||wrote;
        }
        if(wrote){report.filledRows++;report[mapping.kind]++;}
        if(records.length>1)report.overflow.push({tableId:id,kind:mapping.kind,filled:wrote?1:0,total:records.length});
        return;
      }
      const columns=Object.entries(mapping.columns||{}).filter(([col])=>!forbidden.has(Number(col)));
      if(!columns.length){report.unfilled.push({tableId:id,reason:'채울 열 매핑 없음'});return;}
      let used=0;
      for(let row=mapping.headerRow+1;row<grid.length&&used<records.length;row++){
        const cells=grid[row];
        if(!cells.every(cell=>isBlankCell(textOf(cell))))continue;
        // A physical cell array is not a logical merged-cell grid; never guess alignment.
        if(cells.length!==grid[mapping.headerRow].length||cells.some(cell=>Number(children(cell,'cellSpan')[0]?.getAttribute('colSpan')||1)>1||Number(children(cell,'cellSpan')[0]?.getAttribute('rowSpan')||1)>1)){
          report.unfilled.push({tableId:id,row,reason:'병합·열 수 불일치 데이터 행은 수동 확인 필요'});continue;
        }
        let wrote=false;for(const [column,field] of columns){if(cells[Number(column)])wrote=write(cells[Number(column)],field,records[used],used,row,Number(column))||wrote;}
        if(wrote){used++;report.filledRows++;report[mapping.kind]++;}
      }
      if(used<records.length)report.overflow.push({tableId:id,kind:mapping.kind,filled:used,total:records.length});
    });
    if(sectionChanged){archive.files.set(sectionName,strToU8(new XMLSerializer().serializeToString(doc)));changed=true;}
  }
  if(!changed)fail('채울 수 있는 빈 칸이 없습니다. 표 매핑과 선택 데이터, 기입 여부를 확인하세요.');
  const output={};for(const name of ['mimetype',...Array.from(archive.files.keys()).filter(name=>name!=='mimetype')])output[name]=[archive.files.get(name),{level:name==='mimetype'?0:6}];
  const bytes=zipSync(output);
  report.verification=verifyWrittenCells(bytes,writes,{staff,performance},fileName);
  if(report.verification.missingStaffIds.length||report.verification.missingPerformanceIds.length)report.warnings.push('선택한 데이터 일부의 성명·과업명이 산출물에 반영되지 않았습니다. 누락 ID를 확인하고 다운로드를 중단하세요.');
  if(report.verification.missingFields.length)report.warnings.push('선택한 데이터에 매핑되지 않은 필드가 있습니다. verification.missingFields의 항목별 매핑을 확인하세요.');
  report.warnings.push('미리보기 이미지·Preview 텍스트는 원본 그대로입니다. 한컴에서 본문을 열고 다시 저장하세요.');
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
  return {bytes,fileName:fileName.replace(/\.hwpx$/i,'')+`_작성_${stamp}.hwpx`,report};
}

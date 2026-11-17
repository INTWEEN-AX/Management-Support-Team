// The Apps Script FormFill.gs index and qualification approach, without external calls.
import {DOMParser} from '@xmldom/xmldom';
import {readHwpxArchive} from './hwpx.js';
const privateText=/\d{6}\s*-\s*[1-8]\d{6}|\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|생년월일|주민등록번호|자택주소|집주소/i;
const KINDS=[['performance','실적',['수행실적','용역실적','유사용역','실적증명','사업실적']],['staff','인력',['참여인력','투입인력','기술인력','인력현황','이력서','이력사항']],['holding','보유 증빙',['사업자등록증','납세증명','인감증명','보험가입','신용평가']],['writing','담당자 작성',['제안서','수행계획','사업계획','견적','가격제안']]];
export function classifyFormName(name){const key=name.replace(/\s/g,'');for(const [kind,label,words]of KINDS)if(words.some(w=>key.includes(w)))return {kind,label};return {kind:'unknown',label:'확인 필요'};}
export function extractSubmissionRequirements(input,options={}){
 const archive=readHwpxArchive(input,options),forms=[],requirements=[],seen=new Set();
 for(const sectionName of archive.sections){const xml=new TextDecoder().decode(archive.files.get(sectionName));const doc=new DOMParser().parseFromString(xml,'application/xml');
  const paragraphs=Array.from(doc.getElementsByTagNameNS('*','p'));
  paragraphs.forEach((p,index)=>{const text=Array.from(p.getElementsByTagNameNS('*','t')).map(t=>t.textContent||'').join(' ').replace(/\s+/g,' ').trim();if(!text||privateText.test(text))return;
   const location=`${sectionName} · 문단 ${index+1}`;
   const patterns=[/\[\s*(?:별지\s*제?\s*)?서식\s*([\d-]+)\s*호?\s*\]\s*([^\[※<(]{2,70})/g,/\[\s*별지\s*제?\s*([\d-]+)\s*호\s*서식\s*\]\s*([^\[※<(]{2,70})/g,/(?:서식|양식)\s*([\d-]+)\s*호?[.)\]>〉]\s*([^\[※<(]{2,70})/g];
   for(const pattern of patterns)for(const m of text.matchAll(pattern)){const title=m[2].trim(),key=`form:${m[1]}:${title}`;if(seen.has(key)||forms.length>=100)continue;seen.add(key);forms.push({number:m[1],title,...classifyFormName(title),location});}
   if(text.length>=10&&text.length<=350&&/참가자격|제출기한|제출서류|필수|배점|평가항목|증빙|실적.*이상|학위.*이상/.test(text)&&!/[·․…]{3,}/.test(text)){const key=`req:${text}`;if(!seen.has(key)&&requirements.length<50){seen.add(key);requirements.push({text,location,confirmation:'원문 위치 확인 필요'});}}
  });
 }
 return {forms,requirements};
}

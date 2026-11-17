// Synthetic fixtures only. No server sample, company record, or private document is copied.
import { zipSync, strToU8 } from 'fflate';
const NS='http://www.hancom.co.kr/hwpml/2011/paragraph';
function esc(text){return String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
export function cell(text='',options={}){
  const value=text===null?'':`<hp:t>${esc(text)}</hp:t>`;
  return `<hp:tc borderFillIDRef="7"><hp:subList textDirection="HORIZONTAL"><hp:p id="7" paraPrIDRef="23" styleIDRef="8"><hp:run charPrIDRef="17">${value}</hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="${options.colSpan||1}" rowSpan="${options.rowSpan||1}"/><hp:cellSz width="12000" height="2000"/></hp:tc>`;
}
export function table(rows,id='900'){return `<hp:tbl id="${id}" rowCnt="${rows.length}" colCnt="${rows[0].length}" borderFillIDRef="7">${rows.map(row=>`<hp:tr>${row.map(c=>typeof c==='object'&&c!==null?cell(c.text,c):cell(c)).join('')}</hp:tr>`).join('')}</hp:tbl>`;}
function section(content){return `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="${NS}"><hp:p id="1" paraPrIDRef="23" styleIDRef="8"><hp:run charPrIDRef="17"><hp:t>합성 서식 · 원본 문구 유지</hp:t>${content}</hp:run></hp:p></hs:sec>`;}
export function archive(sections,extra={}){
 const files={mimetype:[strToU8('application/hwp+zip'),{level:0}],
 'version.xml':strToU8('<?xml version="1.0"?><version value="5.1"/>'),
 'Contents/header.xml':strToU8('<?xml version="1.0"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"><hh:refList><hh:charProperties><hh:charPr id="17" height="1000"/></hh:charProperties><hh:paraProperties><hh:paraPr id="23"/></hh:paraProperties><hh:styles><hh:style id="8" name="합성스타일"/></hh:styles></hh:refList></hh:head>'),
 'Contents/content.hpf':strToU8('<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest/></opf:package>'),
 'META-INF/container.xml':strToU8('<?xml version="1.0"?><container/>'),
 'Preview/PrvText.txt':strToU8('합성 미리보기'),
 'BinData/image.png':new Uint8Array([137,80,78,71,13,10,26,10]),
 ...Object.fromEntries(sections.map((content,i)=>[`Contents/section${i}.xml`,strToU8(section(content))])),...extra};
 return zipSync(files,{level:6});
}
export function staffFixture(){return archive([table([
 ['연번','성명','직위','총경력','입사일'],
 ['예시 보존','합성 기존값','표 수정 금지','확인 필요','미기입'],
 [null,null,null,null,null],
 ['','','','',''],
 ])]);}
export function performanceFixture(){return archive([
 table([[{text:'합성 수행실적 양식',colSpan:4}],['발주기관','계약금액','용역명','용역기간'],[null,null,null,null]],'901'),
 table([['성명',null,'담당업무',null]],'902'),
 ]);}
export function unknownFixture(){return archive([table([['A','B'],[null,null]],'903')]);}
export function createSyntheticHwpx(kind='staff') {
  if(!['staff','performance'].includes(kind))throw new Error('합성 서식 종류가 올바르지 않습니다.');
  return {bytes:kind==='staff'?staffFixture():performanceFixture(),fileName:kind==='staff'?'합성_참여인력_서식.hwpx':'합성_수행실적_서식.hwpx'};
}

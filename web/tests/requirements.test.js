import test from 'node:test';
import assert from 'node:assert/strict';
import {strToU8,zipSync} from 'fflate';
import {extractSubmissionRequirements,classifyFormName} from '../lib/requirements.js';
function document(){return zipSync({'mimetype':strToU8('application/hwp+zip'),'Contents/header.xml':strToU8('<header/>'),'Contents/section0.xml':strToU8('<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p><hp:run><hp:t>[서식 1호] 참여인력 이력사항</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>필수 증빙은 해당 서식을 확인하여 제출한다.</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>담당자 연락처는 fixture에 넣지 않는다.</hp:t></hp:run></hp:p></hs:sec>')});}
test('submission forms and literal requirements retain XML paragraph sources',()=>{const result=extractSubmissionRequirements(document(),{fileName:'합성.hwpx'});assert.equal(result.forms[0].kind,'staff');assert.equal(result.forms[0].location,'Contents/section0.xml · 문단 1');assert.equal(result.requirements[0].text,'필수 증빙은 해당 서식을 확인하여 제출한다.');assert.equal(result.requirements.length,1);});
test('unrecognized title remains unknown, not invented',()=>assert.equal(classifyFormName('합성 비정형 문서').kind,'unknown'));

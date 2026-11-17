import { hwpToHwpx } from '@ssabrojs/hwpxjs/browser';
import CFB from 'cfb';
import JSZip from 'jszip';
const MAX = 10 * 1024 * 1024;
const EXPANDED = 40 * 1024 * 1024;
export async function convert(bytes) {
  if (!bytes.length || bytes.length > MAX) throw new Error('HWP는 10MB 이하만 변환할 수 있습니다.');
  const cfb = CFB.read(bytes, { type: 'array' });
  const rawHeader = CFB.find(cfb, 'FileHeader')?.content;
  const header = rawHeader && new Uint8Array(rawHeader);
  if (!header || header.length < 256 || new TextDecoder().decode(header.slice(0, 17)) !== 'HWP Document File') throw new Error('HWP 5 형식이 아닙니다. HWP 3/다른 형식은 한컴에서 HWPX로 저장하세요.');
  if (header[35] !== 5 || header[34] > 1) throw new Error('지원 범위는 HWP 5.0~5.1입니다.');
  const flags = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(36, true);
  if (flags & (2 | 16 | 256)) throw new Error('암호화/DRM HWP는 지원하지 않습니다. 권한 있는 원본을 한컴에서 HWPX로 저장하세요.');
  if (flags & (4 | 1024)) throw new Error('배포용(ViewText) HWP는 지원하지 않습니다. 일반 원본이 필요합니다.');
  const output = await hwpToHwpx(bytes);
  if (!output.length || output.length > MAX) throw new Error('변환 HWPX가 10MB 제한을 초과했습니다.');
  const zip = await JSZip.loadAsync(output, { checkCRC32: true });
  const entries = Object.values(zip.files).filter(e => !e.dir);
  if (entries.length > 1000) throw new Error('HWPX 항목 제한 초과');
  let total = 0;
  const xml = [];
  for (const entry of entries) {
    const data = await entry.async('uint8array');
    total += data.length;
    if (total > EXPANDED) throw new Error('HWPX 압축 해제 크기 제한 초과');
    if (entry.name.endsWith('.xml') || entry.name.endsWith('.hpf')) xml.push(new TextDecoder().decode(data));
  }
  for (const name of ['mimetype', 'META-INF/container.xml', 'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml']) {
    if (!zip.file(name)) throw new Error('HWPX 필수 항목 누락: ' + name);
  }
  if ((await zip.file('mimetype').async('string')).trim() !== 'application/owpml') throw new Error('HWPX mimetype 오류');
  // OWPML requires first uncompressed mimetype local entry.
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== 0 || new TextDecoder().decode(output.slice(30, 30 + view.getUint16(26, true))) !== 'mimetype') throw new Error('HWPX ZIP 구조 오류');
  return { output, xml };
}
if (typeof self !== 'undefined') self.onmessage = async event => {
  try { const result = await convert(new Uint8Array(event.data)); self.postMessage(result, [result.output.buffer]); }
  catch (error) { self.postMessage({ error: error.message || '변환 실패' }); }
};

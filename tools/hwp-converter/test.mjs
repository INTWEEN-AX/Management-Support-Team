import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import CFB from 'cfb';
import JSZip from 'jszip';
import { deflateRawSync } from 'node:zlib';
function fixture(flags = 0, minor = 0) {
  const cfb = CFB.utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write('HWP Document File'); header[35] = 5; header[34] = minor; header.writeUInt32LE(flags, 36);
  CFB.utils.cfb_add(cfb, 'FileHeader', header);
  const text = Buffer.from('합성 변환 검증\r', 'utf16le');
  const para = Buffer.alloc(22);
  const record = (tag, level, data) => { const h = Buffer.alloc(4); h.writeUInt32LE(tag | level << 10 | data.length << 20); return Buffer.concat([h, data]); };
  const body = Buffer.concat([record(66, 0, para), record(67, 1, text)]);
  CFB.utils.cfb_add(cfb, 'DocInfo', flags & 1 ? deflateRawSync(Buffer.alloc(0)) : Buffer.alloc(0));
  CFB.utils.cfb_add(cfb, 'BodyText/Section0', flags & 1 ? deflateRawSync(body) : body);
  return new Uint8Array(CFB.write(cfb, { type: 'buffer' }));
}
const html = await readFile('../../apps-script/HwpConverterVendor.html', 'utf8');
const source = JSON.parse(html.match(/window.HWP_WORKER_SOURCE = (.*);/)[1]);
function run(bytes) {
  return new Promise((resolve, reject) => {
    const context = vm.createContext({ TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, setTimeout, clearTimeout, console });
    context.self = context;
    context.importScripts = function () {};
    context.postMessage = value => { if (value && typeof value === 'object') resolve(value); };
    try { vm.runInContext(source, context); context.onmessage({ data: bytes.buffer }); } catch (e) { reject(e); }
  });
}
for (const flags of [0, 1]) test('bundled browser conversion, compressed=' + !!flags, async () => {
  const result = await run(fixture(flags));
  assert.equal(result.error, undefined);
  const zip = await JSZip.loadAsync(new Uint8Array(result.output), { checkCRC32: true });
  assert.match(await zip.file('Contents/section0.xml').async('string'), /합성 변환 검증/);
  assert.ok(result.xml.length >= 4);
});
for (const flags of [2, 4, 16, 256, 1024]) test('reject protection flag ' + flags, async () => {
  assert.match((await run(fixture(flags))).error, /암호화|배포용/);
});
test('reject unsupported version', async () => assert.match((await run(fixture(0, 2))).error, /지원 범위/));
test('reject non-HWP and oversize', async () => {
  assert.ok((await run(new Uint8Array([1,2,3]))).error);
  assert.match((await run(new Uint8Array(10 * 1024 * 1024 + 1))).error, /10MB/);
});

// Runs the real apps-script/FormFill.gs + FormAnalyzer.gs in a Node VM with a minimal
// XmlService/Utilities shim. Synthetic fixtures only; no real HWP/HWPX or personal data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { archive, table, staffFixture, performanceFixture } from './hwpx-fixtures.js';

const gs = f => readFileSync(new URL('../../apps-script/' + f, import.meta.url), 'utf8');
const wrappers = new WeakMap();
const wrap = node => { if (!node) return node; if (!wrappers.has(node)) wrappers.set(node, new El(node)); return wrappers.get(node); };
class El {
  constructor(node) { this.n = node; }
  getChildren() { return Array.from(this.n.childNodes).filter(c => c.nodeType === 1).map(wrap); }
  getName() { return this.n.localName; }
  getNamespace() { return { uri: this.n.namespaceURI, prefix: this.n.prefix }; }
  getText() { return Array.from(this.n.childNodes).filter(c => c.nodeType === 3).map(c => c.data).join(''); }
  setText(v) { while (this.n.firstChild) this.n.removeChild(this.n.firstChild); this.n.appendChild(this.n.ownerDocument.createTextNode(String(v))); return this; }
  addContent(el) { this.n.appendChild(el.n); return this; }
  setAttribute(k, v) { this.n.setAttribute(k, v); return this; }
}
const XmlService = {
  parse: xml => { const d = new DOMParser().parseFromString(xml, 'application/xml'); return { d, getRootElement: () => wrap(d.documentElement) }; },
  createElement: (name, ns) => { const d = new DOMParser().parseFromString('<x/>', 'application/xml'); return wrap(d.createElementNS(ns.uri, (ns.prefix ? ns.prefix + ':' : '') + name)); },
  getRawFormat: () => ({ format: doc => new XMLSerializer().serializeToString(doc.d) }),
};
const blob = (bytes, name) => ({ bytes, name, setContentType() { return this; }, getName() { return this.name; }, getBytes() { return this.bytes; }, getDataAsString() { return strFromU8(this.bytes); } });
const Utilities = {
  base64Decode: s => Array.from(Buffer.from(s, 'base64')),
  base64Encode: b => Buffer.from(b).toString('base64'),
  newBlob: (data, _t, name) => blob(typeof data === 'string' ? strToU8(data) : Uint8Array.from(data), name),
  unzip: b => Object.entries(unzipSync(Uint8Array.from(b.getBytes()))).map(([n, d]) => blob(d, n)),
  zip: parts => blob(zipSync(Object.fromEntries(parts.map(p => [p.getName(), p.getName() === 'mimetype' ? [p.getBytes(), { level: 0 }] : p.getBytes()]))), 'out.zip'),
  formatDate: () => '20260101_0000',
};

function loadGs({ hr = [], perf = [], company = {}, bid = {} } = {}) {
  const ctx = vm.createContext({ XmlService, Utilities, Session: { getScriptTimeZone: () => 'Asia/Seoul' }, Logger: { log() {} },
    getHRData: () => hr, getPerformanceData: () => perf, getCompanyInfo: () => company,
    findBidRecord_: () => bid, JSON, Date, Object, Array, String, Number, Math });
  for (const f of ['FormAnalyzer.gs', 'FormFill.gs']) vm.runInContext(gs(f), ctx, { filename: f });
  return ctx;
}
const fill = (ctx, bytes, selection = { perfKeys: [], hrNames: [] }) => ctx.fillFormFromUpload({ name: '서식.hwpx', dataBase64: Buffer.from(bytes).toString('base64'), selection, bidNo: '1', bidOrd: '0' });
const sectionText = (out, n = 0) => strFromU8(unzipSync(new Uint8Array(Buffer.from(out.dataBase64, 'base64')))[`Contents/section${n}.xml`]);

const people = [
  { name: '가상갑', dept: '합성팀', position: '책임', birthDate: '1990-01-01', eduSchool: '합성대', eduDegree: '학사', career: '10년', joinDate: '2020-01-01' },
  { name: '가상을', dept: '합성팀', position: '선임', career: '5년' },
];
const perf = [{ taskName: '합성 용역', year: 2024, org: '합성기관', amount: 1000, contractPeriod: '2024.01~2024.12' }];

test('staff table: selected people land in order, with source and location, verified in output', () => {
  const out = fill(loadGs({ hr: people }), staffFixture(), { hrNames: ['가상갑', '가상을'] });
  assert.equal(out.report.hr, 2);
  const names = out.report.entries.filter(e => e.field === 'name');
  assert.deepEqual(names.map(e => e.value), ['가상갑', '가상을']);
  assert.ok(names.every(e => e.source.startsWith('인력현황 DB') && e.section === 'Contents/section0.xml' && e.table === 1 && e.row >= 3 && e.col === 2 && e.verified === true));
  assert.match(sectionText(out), /가상갑/);
  assert.match(sectionText(out), /합성 기존값/, 'existing example row must be preserved');
});

test('birth date is never written into the form', () => {
  const bytes = archive([table([['연번', '성명', '생년월일', '직위'], [null, null, null, null]])]);
  const out = fill(loadGs({ hr: people }), bytes, { hrNames: ['가상갑'] });
  assert.doesNotMatch(sectionText(out), /1990/);
  assert.equal(out.report.entries.some(e => e.field === 'birthDate'), false);
  assert.equal(out.report.skipped[0].label, '생년월일');
  assert.match(sectionText(out), /가상갑/);
});

test('performance table fills by header, ignoring column order; no page numbers invented', () => {
  const out = fill(loadGs({ perf }), performanceFixture(), { perfKeys: ['합성용역|2024'] });
  assert.equal(out.report.perf, 1);
  const org = out.report.entries.find(e => e.field === 'org');
  assert.equal(org.value, '합성기관'); assert.equal(org.col, 1);
  assert.ok(out.report.entries.every(e => !('page' in e)));
});

test('"성명" in a person-label table does not receive the CEO name', () => {
  const out = fill(loadGs({ company: { ceo: '가상대표', name: '합성회사' } }), archive([table([['성명', null, '담당업무', null]])]));
  assert.doesNotMatch(sectionText(out), /가상대표/);
});

test('"성명" next to company labels still receives CEO name', () => {
  const bytes = archive([table([['업체명', null], ['성명', null]])]);
  const out = fill(loadGs({ company: { ceo: '가상대표', name: '합성회사' } }), bytes);
  assert.match(sectionText(out), /가상대표/); assert.match(sectionText(out), /합성회사/);
});

test('overflow is reported and unmatched forms leave the file untouched', () => {
  const out = fill(loadGs({ hr: people }), archive([table([['A', 'B'], [null, null]])]), { hrNames: ['가상갑'] });
  assert.equal(out.report.hr, 0); assert.equal(out.report.entries.length, 0);
  const one = fill(loadGs({ hr: people }), archive([table([['연번', '성명', '직위'], [null, null, null]])]), { hrNames: ['가상갑', '가상을'] });
  assert.deepEqual(one.report.overflow, [{ kind: "hr", filled: 1, total: 2, section: "Contents/section0.xml", table: 1 }]);
});

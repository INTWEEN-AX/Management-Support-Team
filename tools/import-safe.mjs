#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { projectSheetRows, SHEET_MAPS, cleanText, RESOURCE_TABLES } from '../web/lib/catalog.js';

const MAX_BYTES = 10 * 1024 * 1024;
export const EXPECTED_PROJECT_URL = 'https://oancjcvjtpbipodewjki.supabase.co';
export function parseArgs(args) {
  const options = { resource: 'staff', tab: '승인자료', apply: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help') options.help = true;
    else if (['--input', '--resource', '--tab'].includes(arg)) {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('INVALID_OPTIONS');
      options[arg.slice(2)] = args[++index];
    } else throw new Error('INVALID_OPTIONS');
  }
  if (!SHEET_MAPS[options.resource]) throw new Error('INVALID_RESOURCE');
  options.tab = cleanText(options.tab, 200);
  if (!options.tab || /[!\n\r]/.test(options.tab)) throw new Error('INVALID_TAB');
  return options;
}
export function prepareImport(payload, options = {}) {
  const resource = options.resource || 'staff', tab = options.tab || '승인자료';
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.headers) || !Array.isArray(payload.rows)) throw new Error('INVALID_PAYLOAD');
  if (!SHEET_MAPS[resource] || payload.headers.length > 200 || payload.rows.length > 10000 || payload.headers.some(value => typeof value !== 'string' || value.length > 500)) throw new Error('INVALID_SHAPE');
  if (payload.rows.some(row => !Array.isArray(row) || row.length > 200 || row.some(cell => cell !== null && !['string','number','boolean'].includes(typeof cell)))) throw new Error('INVALID_CELLS');
  const allowed = new Set(Object.keys(SHEET_MAPS[resource]).map(value => value.replace(/\s+/g, '')));
  const headers = payload.headers.map(value => value.replace(/\s+/g, ''));
  const validHeaders = headers.filter(value => allowed.has(value));
  if (new Set(validHeaders).size !== validHeaders.length) throw new Error('AMBIGUOUS_HEADERS');
  const safeTab = cleanText(tab, 200);
  if (!safeTab || /[!\n\r]/.test(safeTab)) throw new Error('INVALID_TAB');
  const records = projectSheetRows(resource, payload.headers, payload.rows, {
    tab: safeTab, employmentType: safeTab.includes('상근') && !safeTab.includes('비상근') ? '상근' : safeTab.includes('비상근') ? '비상근' : '확인 필요',
  });
  return {
    records,
    summary: { totalRows: payload.rows.length, acceptedRows: records.length, skippedRows: payload.rows.length - records.length, excludedColumns: payload.headers.length - validHeaders.length },
  };
}
async function inputPayload(input) {
  let raw;
  if (input && input !== '-') {
    const info = await stat(input);
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('INPUT_TOO_LARGE');
    raw = await readFile(input, 'utf8');
  } else {
    let bytes = 0; const chunks = [];
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > MAX_BYTES) throw new Error('INPUT_TOO_LARGE'); chunks.push(chunk); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('INPUT_TOO_LARGE');
  return JSON.parse(raw);
}
export async function applyRecords(resource, records, env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const token = env.AX_IMPORT_ACCESS_TOKEN;
  if (url !== EXPECTED_PROJECT_URL || !key?.startsWith('sb_publishable_') || !token || token.length > 8192 || !/^[A-Za-z0-9._-]+$/.test(token)) throw new Error('AUTH_CONFIGURATION_REQUIRED');
  const require = createRequire(new URL('../web/package.json', import.meta.url));
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth?.user) throw new Error('AUTH_REJECTED');
  const { data: profile, error: profileError } = await db.from('ax_profiles').select('id,role,approved,active').eq('id', auth.user.id).maybeSingle();
  if (profileError || !profile?.approved || !profile.active || !['admin','editor'].includes(profile.role)) throw new Error('APPROVED_EDITOR_REQUIRED');
  const table = RESOURCE_TABLES[resource];
  let insertedRows = 0, duplicateRows = 0;
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100);
    const { data: existing, error: readError } = await db.from(table).select('source_ref').in('source_ref', batch.map(record => record.source_ref));
    if (readError) throw new Error('IMPORT_READ_REJECTED');
    const references = new Set(existing.map(row => row.source_ref));
    const fresh = batch.filter(record => !references.has(record.source_ref));
    duplicateRows += batch.length - fresh.length;
    if (!fresh.length) continue;
    const { error: insertError } = await db.from(table).insert(fresh.map(record => ({ ...record, created_by: profile.id })));
    if (!insertError) { insertedRows += fresh.length; continue; }
    // Concurrent duplicate imports are skipped individually; no existing row is overwritten.
    if (insertError.code !== '23505') throw new Error('IMPORT_WRITE_REJECTED');
    for (const record of fresh) {
      const { error } = await db.from(table).insert({ ...record, created_by: profile.id });
      if (!error) insertedRows++;
      else if (error.code === '23505') duplicateRows++;
      else throw new Error('IMPORT_WRITE_REJECTED');
    }
  }
  return { insertedRows, duplicateRows };
}
export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write('사용: node tools/import-safe.mjs --input /private/file.json --resource staff --tab "재직(상근)" [--apply]\n입력 생략 또는 --input - 는 stdin. 기본은 dry-run. JSON {headers,rows}의 허용 열만 메모리에서 추립니다.\n--apply는 기존 AX 프로젝트의 publishable key와 승인된 사용자 access token 환경변수(AX_IMPORT_ACCESS_TOKEN)가 필요합니다. 토큰을 인자로 전달하지 마세요.\n');
    return;
  }
  const { records, summary } = prepareImport(await inputPayload(options.input), options);
  const result = options.apply ? await applyRecords(options.resource, records) : {};
  // Row values, source labels, auth identifiers and credentials are never printed or written.
  process.stdout.write(JSON.stringify({ dryRun: !options.apply, ...summary, ...result }) + '\n');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => { process.stderr.write('가져오기를 완료하지 못했습니다. 입력 형식·권한·프로젝트 설정을 확인하세요. 일부 배치가 이미 등록됐을 수 있으므로 재실행은 source_ref 중복 건을 건너뜁니다. 원문·자격증명은 출력하지 않았습니다.\n'); process.exitCode = 1; });
}

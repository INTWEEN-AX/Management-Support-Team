import { build } from 'esbuild';
import { writeFile, readFile } from 'node:fs/promises';
const result = await build({ entryPoints: ['worker.js'], bundle: true, platform: 'browser', format: 'iife', minify: true, legalComments: 'inline', write: false });
const source = result.outputFiles[0].text;
const licenses = await readFile('THIRD_PARTY_LICENSES.txt', 'utf8');
await writeFile('../../apps-script/HwpConverterVendor.html', '<!-- Generated: npm ci && npm run build in tools/hwp-converter. See THIRD_PARTY.md. -->\n<script>\nwindow.HWP_WORKER_SOURCE = ' + JSON.stringify(source).replace(/</g, '\\u003c') + ';\nwindow.HWP_CONVERTER_LICENSES = ' + JSON.stringify(licenses).replace(/</g, '\\u003c') + ';\n</script>\n');
console.log('Vendored worker bytes:', Buffer.byteLength(source));

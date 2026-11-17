# Local HWP conversion review

Reviewed 2026-11-17. Upstream: https://github.com/ssabro/hwpxjs and
https://www.npmjs.com/package/@ssabrojs/hwpxjs/v/0.4.0 .
`@ssabrojs/hwpxjs` is pinned to 0.4.0 (MIT); the lockfile pins the full build graph
and registry integrity. Its published self-contained browser ESM is 750,692 bytes
(approximately 733 KiB; confirm installed file size when rebuilding).
Published browser bundle SHA-256:
`8e2179f18d34a2ce3efcf5602870bf123869049b35ba17e163de20c2cf6680b3`.
The generated worker includes that browser implementation plus CFB/ZIP validation,
with tree shaking/minification, approximately 415 KB before HTML string escaping.
No runtime CDN, dynamic imports, service/API conversion, or HWP network transfer.
The main upstream license is in LICENSE.hwpxjs; dependency license texts are in
THIRD_PARTY_LICENSES.txt and bundled legal notices are retained.
The HWP parser credits the MIT rhwp port (Edward Kim, 2025–2026).

## Supported scope and limits

The UI accepts local HWP 5.0–5.1 CFB files; HWP 3, unknown formats, encrypted,
public-key-encrypted, DRM, distribution/ViewText and prepare-distribution files
are rejected. HWPX and PDF continue through the existing flow; PDF is not converted
by this library. Upstream also supports HWPX reading and Markdown/HTML conversion,
but these APIs are not exposed by this feature. It does not write legacy HWP.

Input and generated HWPX are capped at 10 MiB; conversion is serialized in a
terminable blob worker, limited to 30 seconds. Output is limited to 1,000 ZIP
entries / 40 MiB expanded content. A compressed input can use more memory during
upstream parsing; the timeout is not a hard browser heap limit. Do not treat this
as a general hostile-document sandbox or a full OWPML schema validator.

Before existing workflow enrollment, output must pass ZIP CRC checks, the first
stored mimetype entry (`application/owpml`), required container/content/header/
section entries, and independent browser XML well-formedness checks (no DTD or
entity declarations). These establish package structure, not visual fidelity.

Upstream attempts to preserve text, merged tables, embedded images, fonts and
basic styles. Its source explicitly limits borders, non-line shapes, charts,
OLE and text art; headers/footers/footnotes are parsed but not emitted in their
original placement. Individual failed sections may silently become empty.
**Every converted result must be compared with the untouched original in Hancom
before final use/submission.** The UI states this and provides manual Hancom
Save As HWPX guidance on failure. The File object is retained locally in the tab;
the user's original disk file is never modified. Closing the tab clears memory.
Only validated derived HWPX enters existing payloads; originals never do.
Synthetic sample buttons remain unchanged.

## Rebuild / verification

From this directory: `npm ci`, `npm run build`, `npm test`, `npm audit`.
Commit the generated `apps-script/HwpConverterVendor.html` along with source and
lockfile. Apps Script includes the generated HTML before the conversion adapter
and existing UI script. The `.clasp.json` root is `apps-script`; `web/` is separate.
No clasp deployment is performed by these build commands.

Tests execute the actual browser bundle without Node Buffer/process globals,
using synthetic compressed/uncompressed HWP CFB fixtures and protection/version/
size/invalid-input rejection cases. They do not prove Hancom rendering or the
live Apps Script iframe's worker permissions. If blob workers are unavailable,
the UI fails clearly with manual conversion guidance.

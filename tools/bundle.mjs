/**
 * Fold the built game into one self-contained HTML file.
 *
 * For publishing somewhere that serves a single page and nothing else — an
 * artifact host, a gist, an email attachment. The build is already only two
 * files; this inlines them so there is nothing to fetch and no paths to get
 * wrong.
 *
 *   npm run build && node tools/bundle.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const out = process.argv[3] ?? 'dist/emerald-isle.html';

const assets = readdirSync(join(dist, 'assets'));
const js = readFileSync(join(dist, 'assets', assets.find((f) => f.endsWith('.js'))), 'utf8');
const css = readFileSync(join(dist, 'assets', assets.find((f) => f.endsWith('.css'))), 'utf8');

// The charset declaration comes first and is not decoration: the page is full
// of characters that are not ASCII — the star ratings, the shift arrow on the
// second hotkey row, every Irish name with a fada in it — and a host that
// serves this without a charset renders all of them as mojibake. The HTML
// encoding sniff reads the first 1024 bytes wherever they sit, so this works
// even when the surrounding <head> belongs to somebody else.
const page = `<meta charset="utf-8" />
<title>Emerald Isle</title>
<style>
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0c0f0d; }
#app { position: fixed; inset: 0; }
${css}
</style>
<div id="app"></div>
<script type="module">
${js}
</script>
`;

writeFileSync(out, page, 'utf8');
console.log(`${out}  ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB`);

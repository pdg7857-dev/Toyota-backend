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
// The mobile head tags come with it.
//
// A single file is the copy most likely to be opened on a phone — it is the
// one you can mail somebody or drop on a static host — and without a viewport
// tag a phone lays the page out at 980 points and scales it down, which makes
// the game a postage stamp and puts every touch coordinate in the wrong place.
// The icon is inline for the same reason everything else here is: a
// self-contained page that 404s on a favicon is not self-contained.
const ICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<rect width='32' height='32' rx='6' fill='%23243a1e'/>" +
  "<path d='M16 5l3.2 6.8 7.3.9-5.4 5 1.4 7.2L16 21.4 9.5 24.9l1.4-7.2-5.4-5 7.3-.9z' fill='%23c9a84c'/>" +
  "</svg>";

const page = `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="theme-color" content="#0c0f0d" />
<link rel="icon" href="${ICON}" />
<link rel="apple-touch-icon" href="${ICON}" />
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

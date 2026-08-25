import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const c = join(root, d, 'chrome-linux', 'chrome');
    if (existsSync(c)) return c;
  }
}
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
await page.goto('http://127.0.0.1:4173/?fresh', { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelector('.cs-card').click());
await page.waitForTimeout(1800);
await page.evaluate(() => window.__game.world.travelTo('caer_dubh'));
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const g = window.__game;
  const seen = new Map();
  for (const e of g.world.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const v = g.views.get(e.id);
    if (!v || seen.has(e.defId)) continue;
    seen.set(e.defId, {
      name: e.name,
      authored: '#' + g.mobOf(e.defId).view.color.toString(16).padStart(6, '0'),
      built: '#' + v.material.color.getHex().toString(16).padStart(6, '0'),
    });
  }
  // What the eye actually gets: read the pixels the renderer produced.
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  return { rows: [...seen.values()].slice(0, 8), gl: !!gl };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();

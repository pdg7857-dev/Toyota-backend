/**
 * Walk to a landmark that holds something and look at it.
 *
 * The half no assertion can do: a mark meant to be picked out from ninety
 * metres is either legible against the ground or it is not, and a screenshot
 * is the only thing that can say which.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.LOOK_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = join(process.cwd(), 'screenshots', 'discover');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const c = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(c)) return c;
  }
  return undefined;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelector('.cs-card').click());
await wait(1600);

const list = await page.evaluate(() => {
  const g = window.__game;
  g.world.worldTimeMs = g.dayLengthMs * 0.42;
  for (const def of g.allMobs()) def.aggroRadius = 0;
  return g.world.sites.map((s) => ({ id: s.id, kind: s.kind, structure: s.structure, x: s.pos.x, z: s.pos.z }));
});
console.log(`${list.length} sites in the Fenmarch`);
for (const s of list.slice(0, 4)) console.log(`  ${s.kind.padEnd(6)} ${s.structure.padEnd(11)} ${Math.round(s.x)}, ${Math.round(s.z)}`);

const boon = list.find((s) => s.kind === 'boon') ?? list[0];
const cache = list.find((s) => s.kind === 'cache') ?? list[0];

for (const [tag, site, back] of [['far', boon, 70], ['near', boon, 12]]) {
  await page.evaluate(
    ({ site, back }) => {
      const g = window.__game;
      g.world.player.pos = { x: site.x, z: site.z - back };
      g.rig.yaw = 0;
      g.rig.distance = 11;
      g.rig.stream(g.world.player.pos.x, g.world.player.pos.z, true);
    },
    { site, back },
  );
  await wait(1500);
  await page.screenshot({ path: join(OUT, `${tag}-${site.structure}.png`) });
  console.log(`${tag}: ${site.structure} from ${back}m`);
}

// Open one and see what happens.
const took = await page.evaluate(async ({ site }) => {
  const g = window.__game;
  const me = g.world.player;
  me.pos = { x: site.x, z: site.z - 3 };
  await new Promise((r) => setTimeout(r, 400));
  const before = { gold: me.gold ?? 0, effects: (me.effects ?? []).length };
  g.world.submit(me.id, { t: 'search' });
  await new Promise((r) => setTimeout(r, 400));
  const after = { gold: me.gold ?? 0, effects: (me.effects ?? []).length };
  // And again, which must do nothing.
  g.world.submit(me.id, { t: 'search' });
  await new Promise((r) => setTimeout(r, 300));
  return {
    before,
    after,
    twice: { gold: me.gold ?? 0, effects: (me.effects ?? []).length },
    found: Object.keys(g.world.found).length,
    log: document.querySelector('#log')?.textContent?.replace(/\s+/g, ' ').slice(-160),
  };
}, { site: boon });
await wait(500);
await page.screenshot({ path: join(OUT, 'opened.png') });
console.log('opened:', JSON.stringify(took));

await page.evaluate(async ({ site }) => {
  const g = window.__game;
  g.world.player.pos = { x: site.x, z: site.z - 3 };
  g.world.submit(g.world.player.id, { t: 'search' });
  await new Promise((r) => setTimeout(r, 400));
}, { site: cache });
await page.keyboard.press('m');
await wait(900);
await page.screenshot({ path: join(OUT, 'map.png') });
console.log('map drawn');

if (errors.length) {
  console.log('PAGE ERRORS');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
await browser.close();

/**
 * Stand in a camp and empty it, and watch it notice.
 *
 * The muster is the one thing in this game that happens *because of what you
 * just did* and happens fast enough to react to, so the only way to judge it
 * is to cause one and look at the screen when it lands.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.LOOK_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = join(process.cwd(), 'screenshots', 'muster');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const c = join(root, d, 'chrome-linux', 'chrome');
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
await page.waitForFunction(() => window.__game && window.__game.world.tickCount > 8, null, { timeout: 40000 });
await wait(600);

const out = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  me.level = 12;
  g.world.worldTimeMs = g.dayLengthMs * 0.45;

  // Stand in the middle of a real camp and empty it.
  const camps = new Map();
  for (const e of g.world.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const def = g.mobOf(e.defId);
    if (def.stars >= 5 || def.horse) continue;
    const key = `${Math.round(e.pos.x / 150)}:${Math.round(e.pos.z / 150)}`;
    camps.set(key, [...(camps.get(key) ?? []), e]);
  }
  const [, pack] = [...camps].sort((a, b) => b[1].length - a[1].length)[0];
  const centre = {
    x: pack.reduce((n, e) => n + e.pos.x, 0) / pack.length,
    z: pack.reduce((n, e) => n + e.pos.z, 0) / pack.length,
  };
  me.pos = { x: centre.x, z: centre.z };
  g.rig.stream(me.pos.x, me.pos.z, true);
  await new Promise((r) => setTimeout(r, 800));

  let mustered = null;
  for (let n = 0; n < 20 && !mustered; n++) {
    const victim = [...g.world.entities.values()].find(
      (e) => e.kind === 'mob' && !e.dead && !e.roused && Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) < 90,
    );
    if (!victim) {
      // Wait for the camp to come back rather than giving up: a farm is a
      // farm, and the respawn timer is part of the pace being measured.
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    victim.pos = { x: me.pos.x + 2, z: me.pos.z };
    g.world.submit(me.id, { t: 'target', id: victim.id });
    g.world.submit(me.id, { t: 'autoAttack', on: true });
    const until = Date.now() + 6000;
    while (!victim.dead && Date.now() < until) {
      victim.health = 1;
      me.health = g.world.statsOf(me).maxHealth;
      await new Promise((r) => setTimeout(r, 50));
    }
    const champion = [...g.world.entities.values()].find((e) => e.roused);
    if (champion) mustered = { name: champion.name, killsTaken: n + 1 };
  }
  g.world.submit(me.id, { t: 'autoAttack', on: false });
  me.health = g.world.statsOf(me).maxHealth;
  await new Promise((r) => setTimeout(r, 500));

  const coming = [...g.world.entities.values()].filter(
    (e) => e.kind === 'mob' && !e.dead && e.aiState === 'chasing',
  );
  const champion = [...g.world.entities.values()].find((e) => e.roused);
  if (champion) g.world.submit(me.id, { t: 'target', id: champion.id });
  await new Promise((r) => setTimeout(r, 400));

  return {
    mustered,
    coming: coming.length,
    banner: document.querySelector('#zone-banner')?.textContent,
    frame: document.querySelector('#target-name')?.textContent,
    threat: document.querySelector('#target-threat')?.textContent,
    log: document.querySelector('#log')?.textContent?.replace(/\s+/g, ' ').slice(-160),
  };
});
await wait(400);
await page.screenshot({ path: join(OUT, 'roused.png') });
console.log('muster:', JSON.stringify(out, null, 1));

if (errors.length) {
  console.log('PAGE ERRORS');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
await browser.close();

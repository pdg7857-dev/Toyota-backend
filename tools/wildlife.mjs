/**
 * Stand still and watch. The only way to judge whether a flock reads as birds
 * or as four grey triangles is to look at some.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.LOOK_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = join(process.cwd(), 'screenshots', 'wildlife');
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
await wait(2000);

const setup = await page.evaluate(async () => {
  const g = window.__game;
  g.world.worldTimeMs = g.dayLengthMs * 0.45;
  for (const def of g.allMobs()) def.aggroRadius = 0;
  // Look up: birds fly at eleven to twenty-six metres and the follow camera
  // never points there on its own.
  g.rig.pitch = 0.05;
  g.rig.distance = 14;
  g.rig.stream(g.world.player.pos.x, g.world.player.pos.z, true);
  await new Promise((r) => setTimeout(r, 900));
  let flocks = 0;
  let clouds = 0;
  let rings = 0;
  g.rig.scene.traverse((o) => {
    if (!o.userData?.ambient) return;
    if (o.isInstancedMesh) flocks++;
    else if (o.isPoints) clouds++;
    else rings++;
  });
  return { flocks, clouds, rings };
});
await wait(1200);
await page.screenshot({ path: join(OUT, 'sky.png') });
console.log('sky:', JSON.stringify(setup));

// Walk into a flock and watch it break.
const scatter = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  const wl = g.rig.wildlife;
  const flock = wl.flocksForTest()[0];
  const before = { x: flock.centreForTest().x, z: flock.centreForTest().z };
  me.pos = { x: before.x, z: before.z - 4 };
  g.rig.stream(me.pos.x, me.pos.z, true);
  await new Promise((r) => setTimeout(r, 1600));
  const after = flock.centreForTest();
  return {
    moved: Math.round(Math.hypot(after.x - before.x, after.z - before.z)),
    scattered: flock.scatteredForTest() > 0,
  };
});
await page.screenshot({ path: join(OUT, 'scatter.png') });
console.log('scatter:', JSON.stringify(scatter));

// A lake, for the midges and the rings.
await page.evaluate(async () => {
  const g = window.__game;
  const f = g.rig.height;
  const me = g.world.player;
  let spot = null;
  let best = Infinity;
  for (let dx = -900; dx <= 900; dx += 20) {
    for (let dz = -900; dz <= 900; dz += 20) {
      const x = dx;
      const z = dz;
      if (!f.underwater(x, z)) continue;
      const d = Math.hypot(dx, dz);
      if (d < best) { best = d; spot = { x, z }; }
    }
  }
  if (spot) {
    // On the shore looking out, not standing in it.
    me.pos = { x: spot.x, z: spot.z - 34 };
    g.rig.yaw = 0;
    g.rig.pitch = 0.24;
    g.rig.distance = 8;
    g.rig.stream(me.pos.x, me.pos.z, true);
  }
  await new Promise((r) => setTimeout(r, 3200));
  return spot;
});
await page.screenshot({ path: join(OUT, 'water.png') });
const wl = await page.evaluate(() => {
  let clouds = 0;
  let rings = 0;
  window.__game.rig.scene.traverse((o) => {
    if (!o.userData?.ambient) return;
    if (o.isPoints) clouds++;
    else if (o.isMesh && !o.isInstancedMesh) rings++;
  });
  return { clouds, rings };
});
console.log('water:', JSON.stringify(wl));

if (errors.length) {
  console.log('PAGE ERRORS');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
await browser.close();

/**
 * Walk into every town in a zone and look at it.
 *
 * The fifth of the same job `smoke`, `look`, `bestiary` and `wildlife` do, and
 * it earned its place before it was finished: the first version of a
 * settlement was a leystone, a trader and one longhouse, and every assertion in
 * the suite passed. What the picture showed was a man standing beside a rock.
 * "Six towns per zone" is a claim about how a place *reads*, and no structural
 * check can see it.
 *
 *   npm run build && npm run preview &
 *   node tools/towns.mjs                 # every town in the Fenmarch
 *   ZONE=caer_dubh node tools/towns.mjs
 *
 * Writes into screenshots/towns/.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.TOWNS_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = process.env.TOWNS_OUT ?? join(process.cwd(), 'screenshots', 'towns');
const ZONE = process.env.ZONE ?? 'fenmarch';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const candidate = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
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
await wait(1500);

if (ZONE !== 'fenmarch') {
  await page.evaluate((z) => window.__game.world.travelTo(z), ZONE);
  await wait(1500);
}

// Noon, and nothing hunting. Same reason the bestiary does it: this is a tool
// for looking at a place, and half the shots were of a death screen or of an
// unlit hillside before the clock and the aggro were pinned.
await page.evaluate(() => {
  const g = window.__game;
  for (const def of g.allMobs()) def.aggroRadius = 0;
  const me = g.world.player;
  me.level = Math.max(me.level, g.world.zone.levelRange[0]);
  me.dead = false;
  me.health = g.world.statsOf(me).maxHealth;
  g.world.worldTimeMs = 12 * 60 * 1000;
});
await wait(400);

const towns = await page.evaluate(() =>
  (window.__game.world.zone.settlements ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    role: t.role,
    x: t.pos.x,
    z: t.pos.z,
  })),
);
console.log(`${ZONE}: ${towns.length} towns`);

for (const [i, town] of towns.entries()) {
  const back = 42;
  await page.evaluate(
    ({ x, z, back }) => {
      const g = window.__game;
      const me = g.world.player;
      // Into the square first. Waking the stone is proximity and nothing else,
      // so a tool that only ever stands back to take the picture would report
      // every town in the game as unvisited — and would never have noticed if
      // the attuning had quietly stopped working.
      me.pos.x = x;
      me.pos.z = z;
      g.rig.stream(x, z, true);
    },
    { x: town.x, z: town.z, back },
  );
  await wait(400);
  // Then back off to one side and look in, the way you would arrive at it: a
  // town is judged on what it looks like from the road, not from the middle of
  // its own square.
  await page.evaluate(
    ({ x, z, back }) => {
      const g = window.__game;
      const me = g.world.player;
      me.pos.x = x + back;
      me.pos.z = z + back;
      const yaw = Math.atan2(-back, -back);
      me.facing = yaw;
      g.rig.yaw = yaw;
      g.rig.stream(me.pos.x, me.pos.z, true);
    },
    { x: town.x, z: town.z, back },
  );
  // Long enough for the stone to have woken as well as for the cell to have
  // streamed in — the shot is of a town you have arrived at, not one you are
  // being shown.
  await wait(1400);
  const file = `${ZONE}-${String(i).padStart(2, '0')}-${town.role}.png`;
  await page.screenshot({ path: join(OUT, file) });
  const woken = await page.evaluate(() => Object.keys(window.__game.world.stones).length);
  console.log(
    `  ${town.name.padEnd(20)} ${town.role.padEnd(11)} at ${town.x.toFixed(0)}, ${town.z.toFixed(0)}` +
      `  (${woken} stones woken)`,
  );
}

// And the road itself, with everything on it. A town's whole purpose is being
// somewhere you can get back to, and that is a picture of the panel.
await page.evaluate(() => {
  const g = window.__game;
  for (const town of g.world.zone.settlements ?? []) g.world.stones[town.id] = true;
  g.hud.toggleLeystones();
});
await wait(600);
await page.screenshot({ path: join(OUT, `${ZONE}-road.png`) });
console.log('  the leystone road');

if (errors.length) {
  console.log('PAGE ERRORS');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
await browser.close();

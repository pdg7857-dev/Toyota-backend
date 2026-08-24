/**
 * Stand somewhere and look at it.
 *
 * `smoke.mjs` proves the game runs; this one is for the other half of the job —
 * walking around and noticing that the ground has a dark halo following the
 * player, or that a landmark reads as a black box at distance. Unit tests
 * cannot see either, and neither can a pass/fail smoke run.
 *
 *   npm run build && npm run preview &
 *   node tools/look.mjs                     # one shot of each landmark kind
 *   ZONE=caer_dubh node tools/look.mjs
 *   AT=-140,60 YAW=2.2 node tools/look.mjs  # or just stand at a spot
 *
 * Writes into screenshots/look/.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.LOOK_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = process.env.LOOK_OUT ?? join(process.cwd(), 'screenshots', 'look');
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

/**
 * Put the character somewhere and point the camera.
 *
 * Camera yaw is set explicitly rather than left to follow the player: the two
 * are independent since free look landed, so setting only `facing` framed
 * every early attempt at this on empty grass beside the thing being examined.
 */
async function stand(page, x, z, yaw) {
  await page.evaluate(
    ({ x, z, yaw }) => {
      const g = window.__game;
      g.world.player.pos.x = x;
      g.world.player.pos.z = z;
      g.world.player.facing = yaw;
      g.rig.yaw = yaw;
      g.rig.stream(x, z, true);
    },
    { x, z, yaw },
  );
  await wait(1300);
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

if (process.env.AT) {
  const [x, z] = process.env.AT.split(',').map(Number);
  const yaw = Number(process.env.YAW ?? 0);
  await stand(page, x, z, yaw);
  await page.screenshot({ path: join(OUT, `${ZONE}-at.png`) });
  console.log(`${ZONE} at ${x},${z}`);
} else {
  const list = await page.evaluate(() =>
    (window.__game.rig.structures ?? []).map((s) => ({ kind: s.kind, x: s.pos.x, z: s.pos.z })),
  );
  console.log(`${ZONE}: ${list.length} landmarks`);
  const seen = new Set();
  let n = 0;
  for (const st of list) {
    if (seen.has(st.kind)) continue;
    seen.add(st.kind);
    // Stand back and to one side, looking in: a landmark is judged on its
    // silhouette from across a field, not from underneath it.
    await stand(page, st.x + 26, st.z + 26, Math.atan2(-1, -1));
    await page.screenshot({ path: join(OUT, `${ZONE}-${String(n++).padStart(2, '0')}-${st.kind}.png`) });
    console.log(`  ${st.kind} at ${st.x.toFixed(0)}, ${st.z.toFixed(0)}`);
  }
}

if (errors.length) {
  console.log('PAGE ERRORS');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
await browser.close();

/**
 * Stand in front of every creature in the game and photograph it.
 *
 * `smoke.mjs` proves the game runs and `look.mjs` proves the ground looks
 * right. This is the third of the same job: silhouettes. A stag whose antlers
 * come out of its chest, a wolf standing on one leg, a heron the size of a
 * bear — none of that is visible to an assertion, to a unit test, or to a
 * pass/fail smoke run. Somebody has to look at the wolf.
 *
 *   npm run build && npm run preview &
 *   node tools/bestiary.mjs             # every plan, one row per zone
 *   ZONE=caer_dubh node tools/bestiary.mjs
 *   PLAN=stag node tools/bestiary.mjs   # just the ones shaped like that
 *
 * Writes into screenshots/bestiary/.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.LOOK_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = process.env.LOOK_OUT ?? join(process.cwd(), 'screenshots', 'bestiary');
const ZONES = (process.env.ZONE ?? 'fenmarch,ardmoor,reach,caer_dubh').split(',');
const ONLY = process.env.PLAN;
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
const page = await browser.newPage({ viewport: { width: 1600, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelector('.cs-card').click());
await wait(1500);

for (const zone of ZONES) {
  const shot = await page.evaluate(
    async ({ zone, only }) => {
      const g = window.__game;
      if (g.world.zone.id !== zone) g.world.travelTo(zone);
      await new Promise((r) => setTimeout(r, 1200));

      // Nothing in this tool is a fight. Standing a level-1 character in front
      // of a Caer Dubh lineup and letting it aggro produced a photograph of
      // the death screen, which is a true picture of something and not the
      // thing being looked at.
      // Blind rather than pacified. Setting `ai` back to idle on a timer loses
      // to the aggro check, which runs every tick and only has to win once.
      for (const def of g.allMobs()) def.aggroRadius = 0;
      const calm = () => {
        for (const e of g.world.entities.values()) {
          if (e.kind !== 'mob') continue;
          e.ai = 'idle';
          e.target = null;
        }
        g.world.player.dead = false;
        g.world.player.health = g.world.statsOf(g.world.player).maxHealth;
      };
      calm();
      window.__calm = setInterval(calm, 100);

      // Noon, and the sun where the theme's own light puts it. A silhouette
      // judged at 08:22 under overcast is a silhouette judged in the dark, and
      // every plan looks the same in the dark.
      g.world.worldTimeMs = g.dayLengthMs * 0.5;

      // One creature of each kind, and only the ones that are actually in this
      // zone's spawn list — a lineup of every mob in the game in every zone is
      // four identical pictures.
      const kinds = new Map();
      for (const e of g.world.entities.values()) {
        if (e.kind !== 'mob' || e.dead) continue;
        const def = g.mobOf(e.defId);
        if (def.summonedBy) continue;
        if (!kinds.has(def.id)) kinds.set(def.id, e);
      }
      let list = [...kinds.values()];
      if (only) list = list.filter((e) => g.bodyPlanFor(e.defId).id === only);
      list.sort((a, b) => g.mobOf(a.defId).level - g.mobOf(b.defId).level);
      list = list.slice(0, 8);
      if (list.length === 0) return { zone, names: [] };

      // A flat stretch of ground in front of the camera, so nothing is
      // half-buried in a hillside while being judged on its shape.
      const px = g.world.player.pos.x;
      const pz = g.world.player.pos.z;
      const spacing = 3.4;
      const start = -((list.length - 1) * spacing) / 2;
      const names = [];
      list.forEach((e, i) => {
        e.pos = { x: px + start + i * spacing, z: pz + 14 };
        e.spawnPos = { ...e.pos };
        // Facing the camera, and holding still: a creature mid-stride in a
        // lineup is being judged on the frame it happened to be caught in.
        e.facing = Math.PI;
        e.ai = 'idle';
        e.target = null;
        names.push(g.mobOf(e.defId).name + ' [' + g.bodyPlanFor(e.defId).id + ']');
      });
      // Everything else out of the shot.
      for (const e of g.world.entities.values()) {
        if (e.kind === 'mob' && !list.includes(e) && !e.dead) e.pos = { x: px + 4000, z: pz };
      }
      g.rig.yaw = 0;
      g.rig.distance = 7;
      g.world.player.facing = 0;
      g.rig.stream(px, pz, true);
      await new Promise((r) => setTimeout(r, 900));
      return { zone, names };
    },
    { zone, only: ONLY },
  );

  if (shot.names.length === 0) {
    console.log(`${zone}: nothing matched`);
    continue;
  }
  await wait(1400);
  await page.screenshot({ path: join(OUT, `${zone}.png`) });
  console.log(`${zone}: ${shot.names.join(', ')}`);
}

// What is in your hands. Every weapon shape, one after another, on the figure
// that is on screen for the whole game.
const gearLooks = await page.evaluate(async () => {
  const g = window.__game;
  if (g.world.zone.id !== 'fenmarch') g.world.travelTo('fenmarch');
  await new Promise((r) => setTimeout(r, 1200));
  for (const def of g.allMobs()) def.aggroRadius = 0;
  g.world.worldTimeMs = g.dayLengthMs * 0.5;
  g.rig.distance = 5;
  g.rig.pitch = 0.22;
  g.rig.yaw = Math.PI * 0.8;
  g.rig.stream(g.world.player.pos.x, g.world.player.pos.z, true);
  return g.weaponLooks();
});
for (const look of gearLooks) {
  await page.evaluate((weapon) => {
    const g = window.__game;
    g.world.player.equipment = { ...g.world.player.equipment, weapon };
  }, look.itemId);
  await wait(700);
  await page.screenshot({ path: join(OUT, `gear-${look.look}.png`) });
}
console.log(`gear: ${gearLooks.map((l) => l.look).join(', ')}`);

// The dragon, which never stands in a spawn list and so is never in a lineup.
await page.evaluate(async () => {
  const g = window.__game;
  if (g.world.zone.id !== 'fenmarch') g.world.travelTo('fenmarch');
  await new Promise((r) => setTimeout(r, 1200));
  for (const def of g.allMobs()) def.aggroRadius = 0;
  // Wake it rather than spawning one: a dragon is world state, and there is no
  // way to put one on the ground that is not the way the game does it.
  const wyrm = g.dragons().find((d) => d.zoneId === 'fenmarch');
  g.world.dragons[wyrm.id].remainingMs = 1;
  for (let i = 0; i < 250 && g.world.dragonState(wyrm.id).phase !== 'roosting'; i++) {
    await new Promise((r) => setTimeout(r, 40));
    const now = g.world.dragonState(wyrm.id);
    if (now.phase !== 'roosting' && now.remainingMs > 5000) g.world.dragons[wyrm.id].remainingMs = 1;
  }
  const e = [...g.world.entities.values()].find((x) => x.kind === 'mob' && g.mobOf(x.defId).dragon);
  if (e) {
    g.world.player.pos = { x: e.pos.x, z: e.pos.z - 22 };
    e.facing = Math.PI;
    e.ai = 'idle';
  }
  g.world.worldTimeMs = g.dayLengthMs * 0.5;
  g.rig.distance = 20;
  g.rig.pitch = 0.3;
  g.rig.yaw = 0;
  g.rig.stream(g.world.player.pos.x, g.world.player.pos.z, true);
});
await wait(1600);
await page.screenshot({ path: join(OUT, 'dragon.png') });
console.log('dragon: up close');

// And the player's own body, which is the one on screen for the whole game.
await page.evaluate(async () => {
  const g = window.__game;
  if (g.world.zone.id !== 'fenmarch') g.world.travelTo('fenmarch');
  await new Promise((r) => setTimeout(r, 1200));
  g.world.player.dead = false;
  g.world.player.health = g.world.statsOf(g.world.player).maxHealth;
  // Walking, not standing: a rig with legs is judged on the gait, and an idle
  // pose is exactly the frame in which a broken one looks fine.
  g.world.submit(g.world.player.id, { t: 'move', dir: { x: 0, z: 1 } });
  g.rig.distance = 6;
  g.rig.pitch = 0.2;
  g.rig.yaw = Math.PI * 0.85;
  g.rig.stream(g.world.player.pos.x, g.world.player.pos.z, true);
});
await wait(1400);
await page.screenshot({ path: join(OUT, 'player.png') });
console.log('player: close up');

if (errors.length) {
  console.log('PAGE ERRORS');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
await browser.close();

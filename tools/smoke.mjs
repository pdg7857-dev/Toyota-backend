/**
 * Visual smoke test: boots the built game in a real browser, plays it for a few
 * seconds, and writes screenshots plus a pass/fail report.
 *
 * This is the feedback loop that makes the web stack worth it — rendering bugs
 * (UI behind the terrain, a black screen, a silent exception in the frame loop)
 * are invisible to unit tests but obvious here.
 *
 *   npm run build && npm run preview &      # serve on 4173
 *   node tools/smoke.mjs
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { removeFixtureModel, writeFixtureModel } from './fixture-model.mjs';
import { join } from 'node:path';

const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = process.env.SMOKE_OUT ?? join(process.cwd(), 'screenshots');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Find a pre-installed Chromium. The bundled browser revision rarely matches
 * whatever the image shipped, so probe rather than pinning a path.
 */
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined; // let Playwright use its own download
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidate = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Walk at the current target until it is inside weapon range. Reads distance
 * from the running game rather than guessing at a duration.
 */
async function closeToTarget(page, timeoutMs = 60000) {
  const gap = () =>
    page.evaluate(() => {
      const g = window.__game;
      const player = g.world.player;
      const target = player.targetId != null ? g.world.entity(player.targetId) : null;
      if (!target) return null;
      return (
        Math.hypot(target.pos.x - player.pos.x, target.pos.z - player.pos.z) -
        g.world.statsOf(player).attackRange
      );
    });

  // Point the camera at it before each step. 'w' walks where the camera is
  // looking, and camps roam now — walking forward at where a creature used to
  // be standing is how "closed to weapon range" started failing on a game that
  // was working perfectly.
  const face = () =>
    page.evaluate(() => {
      const g = window.__game;
      const player = g.world.player;
      const target = player.targetId != null ? g.world.entity(player.targetId) : null;
      if (!target) return;
      g.rig.yaw = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
    });

  const start = Date.now();
  let d = await gap();
  if (d === null) return false;
  // Hold the key down and poll, rather than tapping it. Tapping walked for
  // 220ms and then spent as long again round-tripping two evaluates, so the
  // character covered about a fifth of the ground the clock said it should —
  // which reads as "walking is broken" rather than "the harness is slow".
  await page.keyboard.down('w');
  while (d > 0 && Date.now() - start < timeoutMs) {
    await face();
    await wait(120);
    d = await gap();
    if (d === null) break;
  }
  await page.keyboard.up('w');
  await wait(400);
  return d !== null && d <= 0;
}

/**
 * In-page: hold a creature on its last point of health until the swing that
 * kills it lands.
 *
 * Setting health to 1 and sleeping a fixed 1.6s is a coin toss — a missed swing
 * or a swing timer that has not come around leaves it alive, and the check
 * reads as "the rare carried nothing" when the rare was simply still standing.
 * That is the same fixed-duration trap `closeToTarget` was written to kill.
 */
const KILL_HELPER = `
  async (victim, ms = 8000) => {
    const g = window.__game;
    g.world.submit(g.world.player.id, { t: 'target', id: victim.id });
    g.world.submit(g.world.player.id, { t: 'autoAttack', on: true });
    const until = Date.now() + ms;
    while (!victim.dead && Date.now() < until) {
      victim.health = 1;
      await new Promise((r) => setTimeout(r, 120));
    }
    return victim.dead;
  }
`;

async function main() {
  mkdirSync(OUT, { recursive: true });

  const executablePath = findChromium();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  // An explicit context, so the "coming back later" check below can open a
  // second page on the same origin — and therefore the same localStorage —
  // without reloading this one and firing its save-on-unload.
  const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await wait(900);
  await page.screenshot({ path: join(OUT, '00-class-select.png') });

  // Pick the class named by CLASS (default Warrior) from the start screen.
  const wanted = (process.env.CLASS ?? 'Warrior').toLowerCase();
  const picked = await page.evaluate((name) => {
    const cards = [...document.querySelectorAll('.cs-card')];
    const card = cards.find((c) => c.querySelector('h2')?.textContent?.toLowerCase() === name);
    if (!card) return false;
    card.click();
    return true;
  }, wanted);
  if (!picked) throw new Error('class select did not offer ' + wanted);

  await wait(1500);
  await page.screenshot({ path: join(OUT, '01-spawn.png') });

  // Sound.
  //
  // Rendered offline, not measured off the speakers: this browser has no audio
  // device, so a live context's clock does not reliably advance and the same
  // working synthesiser measures as silence about half the time. Offline the
  // graph produces exact samples, and the question — did it make a sound —
  // finally has an answer that means something.
  const sound = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player.id;
    const probe = g.audioProbe;
    if (!probe) return { ok: false, why: 'no probe' };

    const level = await probe({ t: 'levelUp', entityId: me, level: 2 });
    const swing = await probe({ t: 'swing', sourceId: me, targetId: me }, 0.5);
    const hit = await probe({
      t: 'damage', sourceId: me, targetId: me, amount: 40,
      crit: false, damageType: 'physical', abilityId: null,
    }, 0.6);
    // A real creature as the victim: distance decides volume, so an event
    // aimed at an entity id that does not exist is correctly silent — which is
    // what the first version of this check accidentally measured.
    // Stand the victim next to the player. Distance decides volume, and at the
    // spawn point the nearest camp is a hundred metres off and correctly
    // silent — which is what the first two versions of this check measured
    // without noticing.
    const pp = g.world.player.pos;
    const victim = [...g.world.entities.values()].find((e) => e.kind === 'mob');
    const home = { ...victim.pos };
    victim.pos = { x: pp.x + 3, z: pp.z };
    const crit = await probe({
      t: 'damage', sourceId: me, targetId: victim.id, amount: 90,
      crit: true, damageType: 'physical', abilityId: null,
    }, 0.6);
    const near = await probe({
      t: 'damage', sourceId: me, targetId: victim.id, amount: 40,
      crit: false, damageType: 'physical', abilityId: null,
    }, 0.6);
    const nothing = await probe({ t: 'leash', mobId: me }, 0.4);
    // And put it back, so nothing downstream inherits a teleported creature.
    const farAway = await probe({
      t: 'damage', sourceId: me, targetId: victim.id, amount: 40,
      crit: false, damageType: 'physical', abilityId: null,
    }, 0.4);
    victim.pos = home;
    const restored = await probe({
      t: 'damage', sourceId: me, targetId: victim.id, amount: 40,
      crit: false, damageType: 'physical', abilityId: null,
    }, 0.4);
    void farAway;

    // The live path, checked only for existing and running — its loudness is
    // what is untrustworthy here, not its wiring.
    const a = g.audio;
    a.start();
    const meter = a.meter();

    return {
      ok: level.peak > 0.05 && swing.peak > 0.005 && hit.peak > 0.02,
      level: level.peak,
      swing: swing.peak,
      hit: hit.peak,
      crit: crit.peak,
      near: near.peak,
      silence: nothing.peak,
      acrossTheZone: restored.peak,
      liveMeter: meter,
      volume: a.level,
    };
  });

  // What a frame costs, measured where a player actually stands.
  //
  // At the spawn point looking into the zone, not at some waypoint the run
  // teleported to halfway through: a probe pointed at empty sky reports
  // twenty-one draw calls and proves nothing.
  //
  // Balance is measured rather than guessed in this project and performance is
  // no different: a zone with six hundred creatures and three kilometres of
  // streamed scenery in it went to 2,627 draw calls a frame without anybody
  // noticing, because nothing in the suite could see a draw call. Printed as
  // well as bounded, because a number that only fails is a number nobody
  // watches drift.
  const frame = await page.evaluate(() => {
    const g = window.__game;
    const r = g.rig.renderer;
    let objects = 0;
    g.rig.scene.traverse(() => objects++);

    const t0 = performance.now();
    for (let i = 0; i < 120; i++) g.world.tick();
    const tickMs = (performance.now() - t0) / 120;

    r.render(g.rig.scene, g.rig.camera);
    return {
      entities: g.world.entities.size,
      objects,
      drawCalls: r.info.render.calls,
      triangles: r.info.render.triangles,
      tickMs: +tickMs.toFixed(2),
    };
  });



  // Target the nearest ordinary creature, then walk to it.
  //
  // This used to hold 'w' for five seconds and press Tab, which assumed the
  // nearest camp was straight ahead of the spawn facing. On a zone three
  // kilometres across it is not: the run walked twenty-seven metres into empty
  // moor, Tab found nothing, and the report said combat was broken. Pick the
  // creature first and let `closeToTarget` do the walking — it steers.
  await page.evaluate(() => {
    const g = window.__game;
    const player = g.world.player;
    let best = null;
    let bestD = Infinity;
    for (const e of g.world.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      const def = g.mobOf(e.defId);
      if (def.horse || def.stars >= 5) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    if (best !== null) g.world.submit(player.id, { t: 'target', id: best });
  });
  await wait(300);
  await page.screenshot({ path: join(OUT, '02-approach.png') });
  await page.keyboard.press('t');
  const reached = await closeToTarget(page);
  await page.keyboard.press('1'); // Strike
  await wait(1800);
  await page.screenshot({ path: join(OUT, '03-combat.png') });

  await wait(4000);
  await page.keyboard.press('f'); // loot whatever died
  await wait(600);
  await page.screenshot({ path: join(OUT, '04-after-fight.png') });

  // Open the panels.
  await page.keyboard.press('c');
  await page.keyboard.press('i');
  await wait(600);
  await page.screenshot({ path: join(OUT, '05-panels.png') });
  await page.keyboard.press('c');
  await page.keyboard.press('i');

  // --- vendor scene -------------------------------------------------------
  // Put a sellable good in the bags, stand next to Maeve, and open the shop.
  const vendorReady = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return false;
    const player = g.world.player;
    const vendor = [...g.world.entities.values()].find((e) => e.kind === 'vendor');
    if (!vendor) return false;
    g.world.addItem(player, { itemId: 'bear_claw', qty: 3 });
    g.world.addItem(player, { itemId: 'wolf_pelt', qty: 5 });
    player.gold = 900;
    player.pos.x = vendor.pos.x + 2;
    player.pos.z = vendor.pos.z + 2;
    return true;
  });
  if (!vendorReady) throw new Error('no vendor found in the zone');
  await wait(500);
  await page.keyboard.press('e');
  await wait(600);
  await page.screenshot({ path: join(OUT, '06-vendor.png') });
  const vendorOpened = await page.evaluate(
    () => getComputedStyle(document.querySelector('#vendor-window')).display !== 'none',
  );

  // Accept the first quest on offer from the trader.
  const questAccepted = await page.evaluate(() => {
    const row = document.querySelector('#vendor-quests .quest-row');
    if (!row) return false;
    row.click();
    return true;
  });
  await wait(300);

  const goldBefore = await page.evaluate(() => window.__game.world.player.gold);
  // Sell the first thing in the bags column.
  //
  // Clicked in-page rather than through Playwright's actionability checks: the
  // bags column scrolls, and a row below the fold is "not visible" to a real
  // click for thirty seconds before the run dies — which reports as "selling
  // paid no gold" and has nothing to do with selling.
  const row = page.locator('#vendor-bags .vendor-row').first();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.dispatchEvent('click');
  await wait(400);
  const goldAfter = await page.evaluate(() => window.__game.world.player.gold);
  const soldSomething = goldAfter > goldBefore;
  await page.keyboard.press('Escape');
  await wait(300);

  // Quest log, then travel to the next zone.
  await page.keyboard.press('j');
  await wait(400);
  await page.screenshot({ path: join(OUT, '06b-quest-log.png') });
  await page.keyboard.press('j');

  const travelled = await page.evaluate(async () => {
    const g = window.__game;
    const player = g.world.player;
    player.level = 25;
    const exit = g.world.zone.exits[0];
    player.pos.x = exit.pos.x;
    player.pos.z = exit.pos.z;
    await new Promise((r) => setTimeout(r, 300));
    g.world.submit(player.id, { t: 'travel', toZoneId: exit.toZoneId });
    await new Promise((r) => setTimeout(r, 500));
    return g.world.zone.id;
  });
  await wait(900);
  await page.screenshot({ path: join(OUT, '06c-new-zone.png') });

  // --- terrain themes -----------------------------------------------------
  // Every zone gets its own ground shape, palette, light and scatter. Unit
  // tests can check the numbers; only a screenshot can tell you a place looks
  // like anywhere at all, so walk through all four and photograph each.
  const looks = [];
  for (const [i, zoneId] of ['fenmarch', 'ardmoor', 'reach', 'caer_dubh'].entries()) {
    const look = await page.evaluate((id) => {
      const g = window.__game;
      g.world.travelTo(id);
      return null;
    }, zoneId);
    void look;
    // travelTo pushes a zoneChanged event; give the loop a frame to rebuild.
    await wait(1200);
    const seen = await page.evaluate(() => {
      const g = window.__game;
      const player = g.world.player;
      const view = g.views.get(player.id);
      return {
        zone: g.world.zone.id,
        theme: g.rig.theme.id,
        sky: g.rig.scene.background.getHex(),
        fogFar: g.rig.scene.fog.far,
        // The player must be standing ON the ground, not in it or over it.
        groundGap: view ? view.group.position.y - g.rig.heightAt(player.pos.x, player.pos.z) : 99,
        props: g.rig.scene.children.length,
      };
    });
    looks.push(seen);
    await page.screenshot({ path: join(OUT, `08-${i}-${zoneId}.png`) });
  }
  const distinctSkies = new Set(looks.map((l) => l.sky)).size;
  const themesMatched = looks.every((l) => l.theme && l.theme.length > 0);
  const standingOnGround = looks.every((l) => Math.abs(l.groundGap) < 0.05);

  // Back to the Fenmarch for the boss scene below.
  await page.evaluate(() => window.__game.world.travelTo('fenmarch'));
  await wait(900);

  // Wading.
  //
  // The sim is flat, so a creature that walks into a lake has no idea it did.
  // The renderer is what has to answer, and the failure it prevents is a wolf
  // padding along the bottom of a pond with its ears under the surface.
  const wade = await page.evaluate(async () => {
    const g = window.__game;
    const water = g.rig.height.spec.waterLevel;
    if (water === undefined) return { ok: false, why: 'no water in this zone' };

    // Find the deepest ground within reach of the player rather than assuming
    // where the lake is — the terrain is generated and the pond moves.
    let spot = null;
    let deepest = water;
    const at = g.world.player.pos;
    for (let dx = -600; dx <= 600; dx += 20) {
      for (let dz = -600; dz <= 600; dz += 20) {
        const x = at.x + dx;
        const z = at.z + dz;
        const h = g.rig.heightAt(x, z);
        if (h < deepest) { deepest = h; spot = { x, z }; }
      }
    }
    if (!spot) return { ok: false, why: 'no lake found' };

    const victim = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    victim.pos = { ...spot };
    victim.spawnPos = { ...spot };
    await new Promise((r) => setTimeout(r, 400));

    const view = g.views.get(victim.id);
    return {
      ok: true,
      bed: +deepest.toFixed(2),
      water: +water.toFixed(2),
      stands: +g.rig.standAt(spot.x, spot.z).toFixed(2),
      feet: view ? +view.group.position.y.toFixed(2) : null,
    };
  });
  // Above the lake bed it would otherwise sink to, and never above the water.
  const wading =
    wade.ok && wade.stands > wade.bed + 0.3 && wade.stands <= wade.water;

  // --- learning a zone's skill -------------------------------------------
  // Buy a tome from the zone's trader, read it, and check the skill actually
  // lands on the bar. Unit tests cover the rules; only this covers the four
  // pieces of UI that have to line up for a player to ever use one.
  const taught = await page.evaluate(async () => {
    const g = window.__game;
    const player = g.world.player;
    g.world.travelTo('ardmoor');
    await new Promise((r) => setTimeout(r, 400));

    const vendor = [...g.world.entities.values()].find((e) => e.kind === 'vendor');
    const stock = g.vendorStock(vendor.vendorId);
    const tomeId = stock.find((id) => g.itemOf(id).teaches && g.canUse(id));
    if (!tomeId) return { ok: false, why: 'no tome on the shelf' };
    const skillId = g.itemOf(tomeId).teaches;

    player.level = 40;
    player.gold = 999999;
    player.pos.x = vendor.pos.x + 2;
    player.pos.z = vendor.pos.z + 2;
    const before = player.gold;
    g.world.submit(player.id, { t: 'buy', vendorId: vendor.id, itemId: tomeId });
    await new Promise((r) => setTimeout(r, 300));
    const bought = player.inventory.some((st) => st.itemId === tomeId) && player.gold < before;

    g.world.submit(player.id, { t: 'learnSkill', itemId: tomeId });
    await new Promise((r) => setTimeout(r, 300));
    return {
      ok: bought && (player.learnedSkills ?? []).includes(skillId),
      bought,
      skillId,
      learned: player.learnedSkills ?? [],
    };
  });
  await wait(500);
  await page.keyboard.press('i');
  await wait(400);
  await page.screenshot({ path: join(OUT, '09-taught-skill.png') });
  await page.keyboard.press('i');

  // The bar has two rows once a class has more than ten skills, and the newly
  // learned one must stop rendering as "Untaught".
  const bar = await page.evaluate(() => ({
    rows: document.querySelectorAll('#skill-bar .skill-row').length,
    slots: document.querySelectorAll('#skill-bar .slot').length,
    untaught: document.querySelectorAll('#skill-bar .slot.unlearned').length,
  }));

  // --- the armour line ----------------------------------------------------
  // Take the first step of the Fenmarch's kit chain, hand over the trophies,
  // and check the piece comes back and the trophies do not.
  const armour = await page.evaluate(async () => {
    const g = window.__game;
    g.world.travelTo('fenmarch');
    await new Promise((r) => setTimeout(r, 400));

    const player = g.world.player;
    player.level = 20;
    const maeve = [...g.world.entities.values()].find((e) => e.vendorId === 'maeve');
    player.pos.x = maeve.pos.x + 2;
    player.pos.z = maeve.pos.z;

    const quest = g.questOf('fenmarch_kit_01');
    const objective = quest.objectives[0];
    g.world.addItem(player, { itemId: objective.itemId, qty: objective.count });
    g.world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: quest.id });
    await new Promise((r) => setTimeout(r, 400));
    const ready = g.world.isQuestComplete(player, quest.id);

    g.world.submit(player.id, { t: 'turnInQuest', vendorId: maeve.id, questId: quest.id });
    await new Promise((r) => setTimeout(r, 400));

    const rewardId = quest.rewards.items[0];
    return {
      ok:
        ready &&
        player.inventory.some((st) => st.itemId === rewardId) &&
        !player.inventory.some((st) => st.itemId === objective.itemId),
      piece: g.itemOf(rewardId).name,
      slot: g.itemOf(rewardId).slot,
    };
  });
  await wait(300);
  await page.keyboard.press('i');
  await wait(400);
  await page.screenshot({ path: join(OUT, '11-armour-line.png') });
  await page.keyboard.press('i');

  // --- a bounty spawn -----------------------------------------------------
  const bounty = await page.evaluate(async () => {
    const g = window.__game;
    const player = g.world.player;
    const host = [...g.world.entities.values()].find(
      (e) => e.kind === 'mob' && g.mobOf(g.mobOf(e.defId).rareVariant ?? e.defId).bounty,
    );
    if (!host) return { ok: false, why: 'no bounty camp in this zone' };
    const spec = g.mobOf(g.mobOf(host.defId).rareVariant);

    host.defId = spec.id;
    host.name = spec.name;
    host.dead = false;
    host.corpseGold = 0;
    host.health = 1;
    player.pos.x = host.pos.x + 2;
    player.pos.z = host.pos.z;
    g.world.submit(player.id, { t: 'target', id: host.id });
    g.world.submit(player.id, { t: 'autoAttack', on: true });
    // Held on one point of health until a swing actually lands, rather than
    // sleeping a fixed 1.5s and hoping. A missed swing or a swing timer that
    // has not come round left this reporting "the bounty paid nothing" when
    // the bounty was simply still standing — the same trap `closeToTarget` and
    // KILL_HELPER were both written to close.
    const until = Date.now() + 20000;
    while (!host.dead && Date.now() < until) {
      host.health = 1;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: host.dead && (host.corpseGold ?? 0) > 0, name: spec.name, kind: spec.bounty, gold: host.corpseGold };
  });

  // --- a rare spawn -------------------------------------------------------
  // Force one up on a camp spawn point and check the four things that make it
  // findable: it is visibly a different creature, the plate reads from further
  // away than an ordinary mob's, the log calls it out, and it actually carries
  // its signature item.
  const rareCheck = await page.evaluate(async () => {
    const g = window.__game;
    g.world.travelTo('fenmarch');
    await new Promise((r) => setTimeout(r, 400));

    const player = g.world.player;
    player.level = 20;
    // An ITEM rare specifically: bounty hosts also carry a variant now, and
    // a bounty carries a purse rather than a signature piece.
    const host = [...g.world.entities.values()].find((e) => {
      if (e.kind !== 'mob') return false;
      const variantId = g.mobOf(e.defId).rareVariant;
      return !!variantId && !g.mobOf(variantId).bounty;
    });
    if (!host) return { ok: false, why: 'no item-rare camp in the zone' };
    const rareId = g.mobOf(host.defId).rareVariant;
    const rare = g.mobOf(rareId);

    // Take over the spawn point the way a respawn would.
    host.defId = rareId;
    host.name = rare.name;
    host.level = rare.level;
    host.dead = false;
    host.health = g.world.statsOf(host).maxHealth;
    player.pos.x = host.pos.x + 3;
    player.pos.z = host.pos.z;
    g.world.submit(player.id, { t: 'target', id: host.id });
    // Hold it alive for a moment: the view rebuilds at the rare's size on the
    // next frame, and a screenshot of a corpse proves nothing about that.
    g.__rare = host;
    await new Promise((r) => setTimeout(r, 900));

    return {
      ok: true,
      name: rare.name,
      taller: rare.view.height > g.mobOf(rare.rareOf).view.height,
    };
  });
  await wait(300);
  await page.screenshot({ path: join(OUT, '10-rare-spawn.png') });
  const rarePlate = await page.evaluate(
    () => document.querySelectorAll('.nameplate.rare').length,
  );

  // Now kill it and check what it was carrying.
  const rareLoot = await page.evaluate(async (helper) => {
    const killIt = eval(helper);
    const g = window.__game;
    const host = g.__rare;
    const rare = g.mobOf(host.defId);
    await killIt(host);
    const loot = (host.corpseLoot ?? []).map((st) => g.itemOf(st.itemId));
    return {
      ok: host.dead && loot.some((i) => i.quality === 'epic'),
      name: rare.name,
      signature: loot.filter((i) => i.quality === 'epic').map((i) => i.name),
      // Named for what it carries: the creature's first word opens the item.
      namedForItem: loot.some((i) => i.name.startsWith(rare.name.split(' ')[0])),
    };
  }, KILL_HELPER);
  await wait(400);
  await page.screenshot({ path: join(OUT, '10b-rare-killed.png') });

  // --- a horse ------------------------------------------------------------
  // Wear one down, take it, ride it. Checks the one rule the mechanic turns
  // on: you cannot capture a healthy horse, and killing it gets you nothing.
  const horse = await page.evaluate(async () => {
    const g = window.__game;
    g.world.travelTo('fenmarch');
    await new Promise((r) => setTimeout(r, 400));

    const player = g.world.player;
    player.level = 30;
    player.stable = [];
    player.mounted = null;
    const wild = [...g.world.entities.values()].find(
      (e) => e.kind === 'mob' && g.mobOf(e.defId).horse,
    );
    if (!wild) return { ok: false, why: 'no herd in the zone' };

    player.pos.x = wild.pos.x + 1.5;
    player.pos.z = wild.pos.z;
    // Healthy: it should refuse.
    g.world.submit(player.id, { t: 'capture', id: wild.id });
    await new Promise((r) => setTimeout(r, 250));
    const refusedWhileHealthy = !(player.stable ?? []).includes(g.mobOf(wild.defId).horse);

    // Worn down: keep trying until it gives in.
    let taken = false;
    for (let i = 0; i < 40 && !taken; i++) {
      wild.dead = false;
      wild.health = g.world.statsOf(wild).maxHealth * 0.1;
      g.world.submit(player.id, { t: 'capture', id: wild.id });
      await new Promise((r) => setTimeout(r, 90));
      taken = (player.stable ?? []).length > 0;
    }

    const onFoot = g.world.statsOf(player).moveSpeed;
    g.world.submit(player.id, { t: 'mount', mountId: player.stable[0] });
    await new Promise((r) => setTimeout(r, 300));
    return {
      ok: refusedWhileHealthy && taken && player.mounted === player.stable[0],
      refusedWhileHealthy,
      mount: player.mounted,
      onFoot,
      ridden: g.world.statsOf(player).moveSpeed,
    };
  });
  await wait(600);
  await page.screenshot({ path: join(OUT, '14-mounted.png') });

  // --- the luxury merchant -------------------------------------------------
  const luxury = await page.evaluate(async () => {
    const g = window.__game;
    const player = g.world.player;
    const vendor = [...g.world.entities.values()].find((e) => e.vendorId === 'ceallach');
    if (!vendor) return { ok: false, why: 'no luxury merchant' };

    const stock = g.vendorStock('ceallach');
    const cheapest = stock
      .map((id) => g.itemOf(id))
      .sort((a, b) => a.value - b.value)[0];

    player.level = 40;
    player.pos.x = vendor.pos.x + 2;
    player.pos.z = vendor.pos.z + 2;
    // Not enough coin: it should refuse.
    player.gold = 10;
    g.world.submit(player.id, { t: 'buy', vendorId: vendor.id, itemId: cheapest.id });
    await new Promise((r) => setTimeout(r, 250));
    const refusedWhenPoor = !player.inventory.some((st) => st.itemId === cheapest.id);

    player.gold = 99999999;
    g.world.submit(player.id, { t: 'buy', vendorId: vendor.id, itemId: cheapest.id });
    await new Promise((r) => setTimeout(r, 250));
    const bought = player.inventory.some((st) => st.itemId === cheapest.id);

    const before = g.world.statsOf(player);
    g.world.submit(player.id, { t: 'equip', itemId: cheapest.id });
    await new Promise((r) => setTimeout(r, 250));
    const after = g.world.statsOf(player);
    return {
      ok: refusedWhenPoor && bought && player.equipment[cheapest.slot] === cheapest.id,
      item: cheapest.name,
      slot: cheapest.slot,
      price: cheapest.value * 4,
      betterAfter: after.damageMax > before.damageMax || after.defense > before.defense,
    };
  });
  await wait(300);
  await page.keyboard.press('e');
  await wait(500);
  await page.screenshot({ path: join(OUT, '15-luxury.png') });
  await page.keyboard.press('Escape');

  // --- other adventurers ---------------------------------------------------
  // The population is the one feature whose entire purpose is being seen, so
  // it is the one a unit test can least vouch for: names over heads, a class
  // colour, a line in the log and a bubble over whoever said it.
  const people = await page.evaluate(async (helper) => {
    const killIt = eval(helper);
    const g = window.__game;
    if (g.world.zone.id !== 'fenmarch') g.world.travelTo('fenmarch');
    await new Promise((r) => setTimeout(r, 400));
    const player = g.world.player;
    const crowd = [...g.world.entities.values()].filter((e) => e.kind === 'npc');
    if (crowd.length === 0) return { ok: false, why: 'nobody about' };

    // Go to the creature rather than dragging it here: a mob moved off its
    // spawn point walks straight back to it and heals on the way, which is the
    // leash doing exactly what it should and a check quietly measuring nothing.
    const boar = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    if (!boar) return { ok: false, why: 'nothing to kill' };
    player.pos.x = boar.pos.x + 1.5;
    player.pos.z = boar.pos.z;

    // Stand the crowd around the player so every plate is on screen at once,
    // and so somebody is close enough to see the level land.
    for (const [i, person] of crowd.entries()) {
      person.pos.x = player.pos.x + (i - 1.5) * 3;
      person.pos.z = player.pos.z - 6;
      // Parked: their own goal would walk them out of earshot mid-check.
      person.npcGoal = { x: person.pos.x, z: person.pos.z };
      person.npcUntilMs = 60000;
    }

    // A grey kill pays no experience at all, so at level 40 the level never
    // lands and "nobody congratulated you" is measuring the wrong thing.
    // Drop into the band this camp belongs to and the kill is worth something.
    player.level = 4;
    player.xp = g.xpToNext(player.level) - 1;
    const levelBefore = player.level;
    const died = await killIt(boar);
    // The grats fires on the tick the level lands; give the HUD a frame to put
    // it in the log and over their head.
    await new Promise((r) => setTimeout(r, 500));

    return {
      ok: died,
      count: crowd.length,
      names: crowd.map((p) => `${p.name} ${p.level} ${p.classId}`),
      levelled: g.world.player.level > levelBefore,
      // Their bodies must render, in their class colour, like any player.
      bodies: crowd.filter((p) => {
        const view = g.views.get(p.id);
        return view && view.group.visible;
      }).length,
    };
  }, KILL_HELPER);
  await wait(600);
  await page.screenshot({ path: join(OUT, '15b-adventurers.png') });
  const crowdUi = await page.evaluate(() => {
    // Say something on purpose rather than waiting to overhear one.
    //
    // Chatter runs on a shared floor with a minimum gap between lines, so
    // whether a bubble happens to be up when this samples is a coin toss — and
    // this check has been flipping between runs for exactly that reason. What
    // it is actually for is "does a line render over the speaker's head", so
    // it now makes a line and looks.
    const g = window.__game;
    const near = [...g.world.entities.values()]
      .filter((e) => e.kind === 'npc')
      .sort((a, b) => {
        const p = g.world.player.pos;
        return (
          Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z)
        );
      })[0];
    if (near) {
      near.pos = { x: g.world.player.pos.x + 6, z: g.world.player.pos.z + 2 };
      g.hud.handleEvents(
        [{ t: 'chat', entityId: near.id, name: near.name, classId: near.classId ?? 'ranger', text: 'quiet out here' }],
        g.rig.camera,
      );
      g.hud.update(g.rig.camera);
    }
    return {
    plates: [...document.querySelectorAll('.nameplate.adventurer')].filter(
      (n) => n.style.display !== 'none',
    ).length,
    bubbles: [...document.querySelectorAll('.nameplate .np-says')].filter(
      (n) => n.style.display !== 'none',
    ).length,
    chatLines: [...document.querySelectorAll('#log .log-chat')].map((n) => n.textContent),
    // Selecting somebody you cannot fight must not offer you a health bar.
    hpHidden: (() => {
      const person = [...g.world.entities.values()].find((e) => e.kind === 'npc');
      if (!person) return false;
      g.world.submit(g.world.player.id, { t: 'target', id: person.id });
      return true;
    })(),
    };
  });
  await wait(400);
  const crowdTarget = await page.evaluate(() => ({
    name: document.querySelector('#target-name')?.textContent ?? '',
    barHidden: getComputedStyle(document.querySelector('#target-hp')).visibility === 'hidden',
  }));

  // --- boss scene ---------------------------------------------------------
  // Jump straight to Old Scar via the debug handle so we can actually see a
  // telegraph render. Reaching him legitimately is a 25-level grind.
  const bossReady = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return false;
    // The travel step above left us in Ardmoor; Old Scar lives in the Fenmarch.
    if (g.world.zone.id !== 'fenmarch') g.world.travelTo('fenmarch');
    const player = g.world.player;
    player.level = 25;
    player.attributes = { strength: 51, dexterity: 4, focus: 2, vitality: 37 };
    player.equipment = {
      weapon: 'scarred_fang',
      chest: 'bearhide_cuirass',
      head: 'bearhide_helm',
      legs: 'fenhide_leggings',
      ring: 'outlaws_signet',
    };
    const boss = [...g.world.entities.values()].find((e) => e.defId === 'old_scar');
    if (!boss) return false;
    const stats = g.world.statsOf(player);
    player.health = stats.maxHealth;
    player.energy = stats.maxEnergy;
    player.pos.x = boss.pos.x + 3;
    player.pos.z = boss.pos.z;
    g.world.submit(player.id, { t: 'target', id: boss.id });
    g.world.submit(player.id, { t: 'autoAttack', on: true });
    return true;
  });
  if (!bossReady) throw new Error('debug handle unavailable — cannot reach the boss scene');

  // Catch a telegraph mid-wind-up: poll until the banner shows, then shoot.
  let sawTelegraph = false;
  for (let i = 0; i < 120 && !sawTelegraph; i++) {
    await wait(250);
    sawTelegraph = await page.evaluate(
      () => getComputedStyle(document.querySelector('#telegraph-banner')).display !== 'none',
    );
  }
  await page.screenshot({ path: join(OUT, '07-boss-telegraph.png') });

  // --- the war ------------------------------------------------------------
  // Flip a front and check the three things that make it real: the banner
  // changes, the panel says so, and the ground is garrisoned by the new owner.
  const realm = await page.evaluate(async () => {
    const g = window.__game;
    g.world.travelTo('fenmarch');
    await new Promise((r) => setTimeout(r, 400));

    const holding = g.holdingOf('road_watch');
    const before = g.world.controllerOf('road_watch');
    const challenger = holding.claimants.find((c) => c !== before);
    const postsBefore = [...g.world.entities.values()].filter((e) => e.holding === 'road_watch');
    const garrisonBefore = postsBefore.length ? g.mobOf(postsBefore[0].defId).name : null;

    // Start the front a few kills short of the line rather than grinding a
    // hundred in a browser: what this is checking is that a kill tips it and
    // the ground changes hands, not the arithmetic the unit tests own.
    g.world.control['road_watch'] = -56;
    const victim = postsBefore[0];
    g.world.player.level = 40;
    g.world.player.pos.x = victim.pos.x + 1;
    g.world.player.pos.z = victim.pos.z;
    g.world.submit(g.world.player.id, { t: 'autoAttack', on: true });

    let flipped = null;
    for (let i = 0; i < 40 && !flipped; i++) {
      victim.dead = false;
      victim.health = 1;
      g.world.submit(g.world.player.id, { t: 'target', id: victim.id });
      await new Promise((r) => setTimeout(r, 120));
      if (g.world.controllerOf('road_watch') !== before) flipped = g.world.controllerOf('road_watch');
    }

    // Respawn every post so the new garrison actually stands there.
    for (const post of postsBefore) {
      post.dead = true;
      post.respawnInMs = 1;
    }
    await new Promise((r) => setTimeout(r, 400));
    const garrisonAfter = g.mobOf(postsBefore[0].defId).name;

    return {
      ok: flipped === challenger && garrisonAfter !== garrisonBefore,
      from: before,
      to: flipped,
      garrisonBefore,
      garrisonAfter,
    };
  });
  // The art pipeline, proved with a model made on the spot.
  //
  // The claim is that a file dropped into `public/models/` replaces a capsule
  // and plays its clips. Until something has actually done it, every part of
  // that is a guess — the fit, the clip matching, whether a missing file is
  // really harmless. Committing a fake wolf would put a grey box in the
  // shipped game, so one is written here, checked, and deleted.
  const fixture = join(process.cwd(), 'dist', 'models', 'mob', '__fixture.gltf');
  writeFixtureModel(fixture);
  const art = await page.evaluate(async () => {
    const g = window.__game;
    const target = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    if (!target) return { ok: false, why: 'nothing to dress' };
    const before = g.views.get(target.id)?.hasModel ?? null;
    const dressed = g.tryModel(`mob:${target.defId}`, { file: 'models/mob/__fixture.gltf' });
    await new Promise((r) => setTimeout(r, 1800));
    const view = g.views.get(target.id);

    // Walk the body and find what is actually standing there now.
    let meshes = 0;
    let tagged = 0;
    let fitted = 0;
    view.group.traverse((o) => {
      if (o.isMesh && o.visible) meshes++;
      if (o.userData.entityId === target.id) tagged++;
    });
    // How tall the model renders, against the height the creature was authored
    // at. This is the fit, and it is the thing that goes wrong when art arrives
    // in centimetres — the failure that makes a wolf forty units tall.
    const def = g.mobOf(target.defId);
    if (view.hasModel) {
      let maxY = 0;
      view.group.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        o.geometry.computeBoundingBox();
        const scale = o.getWorldScale(view.group.position.clone()).y;
        maxY = Math.max(maxY, o.geometry.boundingBox.max.y * scale);
      });
      fitted = +maxY.toFixed(2);
    }
    return {
      ok: view.hasModel === true,
      before,
      dressed,
      meshes,
      tagged,
      fitted,
      authored: def.view.height,
      anim: view.anim.current,
      capsuleHidden: !view.group.children[0].children[0].visible,
    };
  });
  await wait(400);
  await page.screenshot({ path: join(OUT, '20-model.png') });
  // And taking it off again puts the capsule back — the property that makes
  // shipping with an empty manifest safe.
  const artOff = await page.evaluate(async () => {
    const g = window.__game;
    const target = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    g.tryModel(`mob:${target.defId}`, null);
    const missing = g.tryModel(`mob:${target.defId}`, { file: 'models/mob/__nope.glb' });
    await new Promise((r) => setTimeout(r, 900));
    return { attempted: missing, stillAlive: !!g.views.get(target.id) };
  });
  removeFixtureModel(fixture);

  // Day, night and weather. Checked against the lights the renderer actually
  // ended up with, because the only failure that matters here is "night went
  // too dark to play in" and no structural assertion can see that.
  const skies = [];
  for (const [name, frac] of [
    ['noon', 0.5],
    ['dusk', 0.74],
    ['midnight', 0.02],
  ]) {
    await page.evaluate(
      ({ frac, day }) => {
        window.__game.world.worldTimeMs = day * frac;
      },
      { frac, day: 24 * 60 * 1000 },
    );
    await wait(700);
    await page.screenshot({ path: join(OUT, `19-sky-${name}.png`) });
    skies.push(
      await page.evaluate((label) => {
        const g = window.__game;
        const light = g.world.daylight();
        // Reading pixels back off the canvas was the obvious check and does not
        // work: the drawing buffer is not preserved, so every sample came back
        // pure black, noon included.
        const sky = g.rig.scene.background;
        return {
          label,
          phase: light.phase,
          light: +light.light.toFixed(2),
          clock: `${String(light.hour).padStart(2, '0')}:${String(light.minute).padStart(2, '0')}`,
          weather: g.world.weather().kind,
          sun: +g.rig.sun.intensity.toFixed(2),
          ambient: +g.rig.hemi.intensity.toFixed(2),
          skyLum: +(sky.r * 0.3 + sky.g * 0.59 + sky.b * 0.11).toFixed(3),
        };
      }, name),
    );
  }
  const clockShown = await page.evaluate(
    () => document.querySelector('#minimap-clock')?.textContent ?? '',
  );

  // Dying, and buying it back.
  const death = await page.evaluate(async () => {
    const g = window.__game;
    const player = g.world.player;
    player.level = 30;
    player.xp = 500;
    player.xpDebt = 0;
    player.health = 1;
    // Stop swinging back, and get off the horse. The run arrives here with
    // auto-attack on from an earlier fight, and the first attempt at this
    // reported "the player refuses to die" while quietly killing its killer.
    g.world.submit(player.id, { t: 'autoAttack', on: false });
    g.world.submit(player.id, { t: 'mount', mountId: null });

    // The highest-level creature in the zone, not the first one. Accuracy is
    // level-gap only, so a level-1 hare swinging at a level-30 character
    // essentially never lands — which reads as death being broken.
    const killer = [...g.world.entities.values()]
      .filter((e) => e.kind === 'mob' && !e.dead && !g.mobOf(e.defId).horse)
      .sort((a, b) => b.level - a.level)[0];
    if (!killer) return { ok: false, why: 'nothing alive nearby' };
    killer.pos = { x: player.pos.x + 1, z: player.pos.z };
    // Move its home with it. A mob teleported a kilometre from its spawn point
    // leashes on the very next tick and walks back — exactly right of the game,
    // and it looked like "the player refuses to die".
    killer.spawnPos = { ...killer.pos };
    killer.aiState = 'chasing';
    killer.targetId = player.id;
    killer.threat = { [player.id]: 100 };
    killer.autoAttack = true;
    g.world.submit(player.id, { t: 'target', id: killer.id });
    const until = Date.now() + 12000;
    const killerMax = g.world.statsOf(killer).maxHealth;
    while (!player.dead && Date.now() < until) {
      player.health = 1;
      killer.health = killerMax;
      await new Promise((r) => setTimeout(r, 100));
    }
    return {
      ok: player.dead,
      owed: player.xpDebt ?? 0,
      level: player.level,
      xp: player.xp,
      hp: Math.round(player.health),
      killer: killer.name,
      killerAi: killer.aiState,
      killerGap: +Math.hypot(killer.pos.x - player.pos.x, killer.pos.z - player.pos.z).toFixed(1),
      killerRange: +g.world.statsOf(killer).attackRange.toFixed(1),
      mounted: player.mounted ?? null,
      spot: player.deathSpot ? { ...player.deathSpot.pos } : null,
    };
  });
  await wait(500);
  await page.screenshot({ path: join(OUT, '18-death.png') });
  const deathUi = await page.evaluate(() => ({
    shown: getComputedStyle(document.querySelector('#death-overlay')).display !== 'none',
    cost: document.querySelector('#death-cost')?.textContent ?? '',
    debtBar: parseFloat(document.querySelector('#xp-debt')?.style.width ?? '0'),
  }));
  const reclaimed = await page.evaluate(async () => {
    const g = window.__game;
    const player = g.world.player;
    g.world.submit(player.id, { t: 'respawn' });
    await new Promise((r) => setTimeout(r, 300));
    const owedAfterRespawn = player.xpDebt ?? 0;
    // Too far away first: the refusal has to name the reason.
    g.world.submit(player.id, { t: 'reclaim' });
    await new Promise((r) => setTimeout(r, 300));
    const refused = (player.xpDebt ?? 0) === owedAfterRespawn;
    if (player.deathSpot) player.pos = { ...player.deathSpot.pos };
    g.world.submit(player.id, { t: 'reclaim' });
    await new Promise((r) => setTimeout(r, 300));
    return { owedAfterRespawn, refused, owedNow: player.xpDebt ?? 0, level: player.level };
  });

  // The map. Checked by sampling the canvas rather than by looking for an
  // element: a map panel that opens onto a blank rectangle passes every
  // structural assertion anyone would think to write.
  await page.keyboard.press('m');
  await wait(900);
  await page.screenshot({ path: join(OUT, '17-map.png') });
  const mapState = await page.evaluate(() => {
    const panel = document.querySelector('#map-panel');
    const full = document.querySelector('#map-canvas');
    const mini = document.querySelector('#minimap-canvas');
    const distinct = (canvas) => {
      const ctx = canvas.getContext('2d');
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) {
        seen.add((d[i] >> 3) * 4096 + (d[i + 1] >> 3) * 64 + (d[i + 2] >> 3));
      }
      return seen.size;
    };
    return {
      open: panel && !panel.classList.contains('map-hidden'),
      fullColours: distinct(full),
      miniColours: distinct(mini),
      title: document.querySelector('#map-title')?.textContent ?? '',
      legend: document.querySelectorAll('#map-hint span').length,
    };
  });
  await page.keyboard.press('Escape');
  await wait(300);
  const mapClosed = await page.evaluate(() =>
    document.querySelector('#map-panel').classList.contains('map-hidden'),
  );

  await wait(500);
  await page.keyboard.press('k');
  await wait(500);
  await page.screenshot({ path: join(OUT, '12-realm.png') });
  const realmPanel = await page.evaluate(() => ({
    open: getComputedStyle(document.querySelector('#realm-window')).display !== 'none',
    fronts: document.querySelectorAll('#realm-body .realm-bar').length,
    standings: document.querySelectorAll('#realm-body .realm-row.standing').length,
  }));
  await page.keyboard.press('k');

  // --- a dragon -----------------------------------------------------------
  // Wind one onto a holding and check the three things that make it a world
  // entity rather than a boss: the ground it lands on empties, it is standing
  // there in the world, and killing it hands the ground back.
  const wyrm = await page.evaluate(async () => {
    const g = window.__game;
    g.world.travelTo('fenmarch');
    await new Promise((r) => setTimeout(r, 400));

    const def = g.dragons().find((d) => d.zoneId === 'fenmarch');
    // Skip the dormancy rather than idling for half an hour in a browser.
    g.world.dragons[def.id].remainingMs = 1;
    for (let i = 0; i < 200 && g.world.dragonState(def.id).phase !== 'roosting'; i++) {
      await new Promise((r) => setTimeout(r, 40));
      // Only shorten the phases BEFORE the roost. Shortening the roost too
      // ends the visit on the next tick, and the dragon leaves before anyone
      // can look at it.
      const now = g.world.dragonState(def.id);
      if (now.phase !== 'roosting' && now.remainingMs > 5000) {
        g.world.dragons[def.id].remainingMs = 1;
      }
    }

    const state = g.world.dragonState(def.id);
    const holdingId = state.holdingId;
    const entity = [...g.world.entities.values()].find((e) => e.dragonId === def.id);
    const garrison = [...g.world.entities.values()].filter((e) => e.holding === holdingId);
    const player = g.world.player;
    player.level = 40;
    if (entity) {
      player.pos.x = entity.pos.x + 2;
      player.pos.z = entity.pos.z;
      g.world.submit(player.id, { t: 'target', id: entity.id });
    }
    return {
      phase: state.phase,
      holding: holdingId,
      inWorld: !!entity,
      groundEmptied: garrison.length === 0,
      suppressed: g.world.isSuppressed(holdingId),
      name: entity ? entity.name : null,
    };
  });
  await wait(700);
  await page.screenshot({ path: join(OUT, '13-dragon.png') });
  await page.keyboard.press('k');
  await wait(400);
  await page.screenshot({ path: join(OUT, '13b-dragon-realm.png') });
  await page.keyboard.press('k');

  const wyrmDead = await page.evaluate(async (helper) => {
    const killIt = eval(helper);
    const g = window.__game;
    const def = g.dragons().find((d) => d.zoneId === 'fenmarch');
    const entity = [...g.world.entities.values()].find((e) => e.dragonId === def.id);
    if (!entity) return { ok: false, why: 'never turned up' };
    const holdingId = g.world.dragonState(def.id).holdingId;
    await killIt(entity);
    const loot = (entity.corpseLoot ?? []).map((st) => g.itemOf(st.itemId));
    return {
      ok: entity.dead && g.world.dragonState(def.id).phase === 'slain' && !g.world.isSuppressed(holdingId),
      carried: loot.map((i) => i.name),
    };
  }, KILL_HELPER);

  // Pull gameplay state straight out of the running page for assertions.
  const state = await page.evaluate(() => {
    const log = [...document.querySelectorAll('#log .log-line')].map((n) => n.textContent);
    return {
      canvas: !!document.querySelector('canvas'),
      hp: document.querySelector('#player-hp .bar-label')?.textContent ?? '',
      xp: document.querySelector('#xp-bar .bar-label')?.textContent ?? '',
      target: document.querySelector('#target-name')?.textContent ?? '',
      targetVisible:
        getComputedStyle(document.querySelector('#target-frame')).display !== 'none',
      slots: document.querySelectorAll('#skill-bar .slot').length,
      nameplates: [...document.querySelectorAll('.nameplate')].filter(
        (n) => n.style.display !== 'none',
      ).length,
      log,
    };
  });

  // --- while you were away -------------------------------------------------
  // The load path is the one thing unit tests cannot reach: the sim's catch-up
  // is pure and covered, but "does the game actually run it on boot, and does
  // the player see what changed" only happens in a browser.
  //
  // Force a save, backdate it five days, then open a SECOND page on the same
  // origin — reloading this one would fire its beforeunload and rewrite the
  // timestamp we just doctored.
  const backdated = await page.evaluate((days) => {
    window.dispatchEvent(new Event('beforeunload'));
    const key = 'emerald-isle:save:v1';
    const raw = localStorage.getItem(key);
    if (!raw) return { ok: false, why: 'nothing saved' };
    const envelope = JSON.parse(raw);
    if (typeof envelope.savedAt !== 'number') return { ok: false, why: 'save is not stamped' };
    envelope.savedAt = Date.now() - days * 24 * 3600 * 1000;
    localStorage.setItem(key, JSON.stringify(envelope));
    return { ok: true };
  }, 5);

  const returning = await context.newPage();
  const returningErrors = [];
  returning.on('pageerror', (e) => returningErrors.push(`pageerror: ${e.message}`));
  await returning.goto(URL.replace('?fresh', ''), { waitUntil: 'networkidle' });
  await wait(2200);
  await returning.screenshot({ path: join(OUT, '16-while-you-were-away.png') });

  const away = await returning.evaluate(() => {
    const card = document.querySelector('#away-report');
    const shown = card && getComputedStyle(card).display !== 'none';
    return {
      shown: !!shown,
      title: document.querySelector('#away-title')?.textContent ?? '',
      rows: document.querySelectorAll('#away-report .away-row').length,
      logged: [...document.querySelectorAll('#log .log-line')].some((n) =>
        /while you were away/i.test(n.textContent ?? ''),
      ),
      // It must be the same character, not a new one: catch-up runs the world,
      // it does not restart it.
      level: window.__game.world.player.level,
      zone: window.__game.world.zone.id,
    };
  });
  // Escape backs out of it, like every other layer of UI.
  await returning.keyboard.press('Escape');
  await wait(300);
  const awayDismissed = await returning.evaluate(
    () => getComputedStyle(document.querySelector('#away-report')).display === 'none',
  );

  // Hand the run back to the original page. The second page above took the
  // foreground, and a backgrounded tab stops getting animation frames — so
  // every check after this one would be reading a render loop that is not
  // running.
  await returning.close();
  await page.bringToFront();
  await wait(600);

  // Can I win this fight, and is that corpse worth walking to.
  const danger = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    // Blinded, not pacified — putting `ai` back to idle on a timer loses to
    // the aggro check, which runs every tick and only has to win once. Saved
    // and restored: these are the shared definitions, and the boss-mechanics
    // block below needs its boss to actually come at the player.
    const aggro = new Map();
    for (const def of g.allMobs()) {
      aggro.set(def.id, def.aggroRadius);
      def.aggroRadius = 0;
    }
    const calm = setInterval(() => {
      for (const e of g.world.entities.values()) {
        if (e.kind === 'mob') { e.ai = 'idle'; e.targetId = null; }
      }
      me.dead = false;
      me.health = g.world.statsOf(me).maxHealth;
    }, 80);

    // Three creatures spanning the scale, standing next to each other. The
    // colour has to differ, or the scale is decoration.
    const all = Object.values(g.allMobs()).filter((m) => m.stars < 5 && !m.horse && !m.dragon);
    const near = (lvl, stars) =>
      all.filter((m) => m.stars === stars).reduce((b, m) =>
        Math.abs(m.level - lvl) < Math.abs(b.level - lvl) ? m : b);
    const mobs = [...g.world.entities.values()].filter((e) => e.kind === 'mob' && !e.dead).slice(0, 3);
    const want = [near(me.level - 12, 1), near(me.level, 1), near(me.level + 6, 4)];
    mobs.forEach((e, i) => {
      const def = want[i];
      e.defId = def.id;
      e.name = def.name;
      e.level = def.level;
      e.pos = { x: me.pos.x + (i - 1) * 4, z: me.pos.z + 6 };
      e.spawnPos = { ...e.pos };
      e.dead = false;
      e.health = g.world.statsOf(e).maxHealth;
    });

    // A corpse with coin on it, well beyond the range a nameplate carries.
    const far = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !mobs.includes(e));
    far.pos = { x: me.pos.x + 40, z: me.pos.z + 30 };
    far.dead = true;
    far.corpseGold = 12;
    far.respawnInMs = 120000;
    await new Promise((r) => setTimeout(r, 900));

    g.world.submit(me.id, { t: 'target', id: mobs[2].id });
    await new Promise((r) => setTimeout(r, 300));
    const deadly = document.querySelector('#target-threat').textContent;
    g.world.submit(me.id, { t: 'target', id: mobs[0].id });
    await new Promise((r) => setTimeout(r, 300));
    const trivial = document.querySelector('#target-threat').textContent;
    clearInterval(calm);
    for (const def of g.allMobs()) def.aggroRadius = aggro.get(def.id);
    // Put the lineup back out of reach before the aggro goes back on. Left
    // standing four metres away, three creatures picked for being harder than
    // the player promptly killed them, and every later check ran against a
    // corpse — whose view is hidden, so the impact burst probe measured
    // nothing and read as "the camera no longer shakes".
    for (const e of mobs) {
      e.pos = { x: me.pos.x + 900, z: me.pos.z + 900 };
      e.spawnPos = { ...e.pos };
    }
    me.dead = false;
    me.health = g.world.statsOf(me).maxHealth;

    const colours = [...document.querySelectorAll('.nameplate.hostile')]
      .filter((p) => p.style.display === 'block')
      .map((p) => p.querySelector('.np-name')?.style.color)
      .filter(Boolean);
    const farView = g.views.get(far.id);
    return {
      colours: [...new Set(colours)].length,
      deadly,
      trivial,
      // Visible at forty metres, where a nameplate is long gone: "there is
      // loot over there" should be answered by looking, not by walking back.
      marked: !!farView && farView.lootMark !== null,
      farAway: Math.round(Math.hypot(far.pos.x - me.pos.x, far.pos.z - me.pos.z)),
    };
  });

  // Tooltips.
  //
  // Sixteen skill slots and a bagful of gear, and until now not one of them
  // said what it was: everything hung off the browser's own `title=`, which is
  // a second's delay, no structure, and — because an attribute is written once
  // — no way to say what a skill costs *now* or how a weapon compares to the
  // one in your hand.
  const tips = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const read = () => document.querySelector('#tip');
    const hover = async (el) => {
      const r = el.getBoundingClientRect();
      const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true };
      el.dispatchEvent(new MouseEvent('mouseenter', at));
      el.dispatchEvent(new MouseEvent('mousemove', at));
      await new Promise((r2) => setTimeout(r2, 60));
      const tip = read();
      const text = tip.style.display === 'block' ? tip.textContent : '';
      el.dispatchEvent(new MouseEvent('mouseleave', at));
      return text;
    };

    // A weapon in the bag and a different one worn, so there is something to
    // compare against — the half of a tooltip's job that was missing outright.
    const weapons = Object.values(g.allItems()).filter((i) => i.slot === 'weapon' && g.canUse(i.id));
    me.inventory = [{ itemId: weapons[0].id, qty: 1 }];
    me.equipment = { ...me.equipment, weapon: weapons[weapons.length - 1].id };
    document.querySelector('#inventory-window').style.display = 'block';
    await new Promise((r) => setTimeout(r, 250));
    const bagText = await hover(document.querySelector('#inventory-body .bag-slot'));
    document.querySelector('#inventory-window').style.display = 'none';

    const slots = [...document.querySelectorAll('#skill-bar .slot')];
    const known = await hover(slots[0]);
    const lockedSlot = slots[slots.length - 1];
    const locked = await hover(lockedSlot);

    return {
      bag: bagText.slice(0, 120),
      // The comparison line, which is the whole reason this exists.
      compares: /damage a second|strength|The same as/.test(bagText),
      known: known.slice(0, 90),
      knownHasCost: /energy/.test(known),
      // A locked slot says only "Lv 44" on the bar. The tip has to say what it
      // is and how to get it, or the slot is a number and nothing else.
      lockedSaysHow: /level|Read /i.test(locked),
      lockedNamed: locked.length > 20 && !/^Lv /.test(locked),
      // And it has to go away again.
      hidden: read().style.display === 'none',
    };
  });

  // Bodies.
  //
  // Structural, like the impact burst: whether a wolf reads as a wolf is a
  // question for `tools/bestiary.mjs` and a person's eyes. What this guards is
  // the thing that cannot be seen in a screenshot of one creature — that a
  // creature is still ONE draw call after growing four legs and a head, and
  // that the figures the player is close to actually have limbs that move.
  const bodies = await page.evaluate(async () => {
    const g = window.__game;
    const meshes = (view) => {
      let n = 0;
      view.group.traverse((o) => { if (o.isMesh && o.visible && o !== view.selectionRing) n++; });
      return n;
    };
    const mob = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    const mobView = g.views.get(mob.id);
    const meView = g.views.get(g.world.player.id);

    // A limb has to actually be driven, not merely exist. Walk for a moment
    // and see whether anything on the player changed angle.
    const leg = [...meView.joints.values()][0];
    const before = leg ? leg.rotation.x : 0;
    g.world.submit(g.world.player.id, { t: 'move', dir: { x: 0, z: 1 } });
    await new Promise((r) => setTimeout(r, 500));
    const after = leg ? leg.rotation.x : 0;
    g.world.submit(g.world.player.id, { t: 'move', dir: { x: 0, z: 0 } });

    return {
      mob: g.mobOf(mob.defId).name,
      plan: g.bodyPlanFor(mob.defId).id,
      mobMeshes: meshes(mobView),
      mobTriangles: mobView.mesh.geometry.index
        ? mobView.mesh.geometry.index.count / 3
        : mobView.mesh.geometry.attributes.position.count / 3,
      myJoints: meView.joints.size,
      limbMoved: Math.abs(after - before) > 0.02,
    };
  });

  // What is in your hands is what you equipped.
  const gear = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const meView = () => g.views.get(me.id);
    const held = () => {
      let n = 0;
      for (const j of ['armR', 'armL']) {
        for (const child of meView().joints.get(j)?.children ?? []) if (child.isMesh) n++;
      }
      return n;
    };
    // Triangle count off the held meshes: two weapons of different shapes
    // cannot come out the same size, and comparing shapes any other way means
    // reaching into geometry this check has no business knowing about.
    const tris = () => {
      let n = 0;
      for (const j of ['armR', 'armL']) {
        for (const c of meView().joints.get(j)?.children ?? []) {
          if (!c.isMesh) continue;
          n += c.geometry.index
            ? c.geometry.index.count / 3
            : c.geometry.attributes.position.count / 3;
        }
      }
      return n;
    };

    // Two weapons this character can actually hold whose names say two
    // different objects — not two ids, two shapes.
    const usable = Object.values(g.allItems()).filter((i) => i.slot === 'weapon' && g.canUse(i.id));
    const byLook = new Map();
    for (const i of usable) {
      const look = g.weaponLookFor(i.name, me.classId);
      if (!byLook.has(look)) byLook.set(look, i);
    }
    const picks = [...byLook.values()];
    if (picks.length < 2) return { ok: false, why: `only ${picks.length} shapes available` };

    const before = held();
    me.equipment = { ...me.equipment, weapon: picks[0].id };
    await new Promise((r) => setTimeout(r, 300));
    const first = tris();
    me.equipment = { ...me.equipment, weapon: picks[1].id };
    await new Promise((r) => setTimeout(r, 300));
    const second = tris();

    return {
      ok: true,
      before,
      after: held(),
      shapes: picks.length,
      first: picks[0].name,
      second: picks[1].name,
      changed: first !== second,
    };
  });

  // Combat feel: the flash where a hit lands.
  //
  // Structural, not visual — a burst that exists for one frame at sixty is
  // impossible to catch in a screenshot, and the failure worth guarding is
  // "no impact was created at all", not "it looked wrong".
  const impact = await page.evaluate(async () => {
    const g = window.__game;
    const victim = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    if (!victim) return { ok: false, why: 'nothing to hit' };
    victim.pos = { x: g.world.player.pos.x + 3, z: g.world.player.pos.z };
    victim.spawnPos = { ...victim.pos };
    await new Promise((r) => setTimeout(r, 200));

    // Both hits are read as a share of THIS creature's health, because that is
    // what the burst is sized off. A flat 40 damage is a scratch on a boss and
    // most of a hare, so a fixed pair of numbers measured whichever mob the run
    // happened to leave alive rather than the scaling.
    const max = g.world.statsOf(victim).maxHealth;
    const before = g.views.bursts.length;
    g.views.addImpact(victim.id, max * 0.02, false, 'frost');
    const ordinary = g.views.bursts.length;
    const smallScale = g.views.bursts[g.views.bursts.length - 1]?.scale ?? 0;
    g.views.addImpact(victim.id, max, true, 'fire');
    const bigScale = g.views.bursts[g.views.bursts.length - 1]?.scale ?? 0;

    // Taking one yourself shakes the camera; somebody else's does not.
    g.views.shake = 0;
    g.views.addImpact(victim.id, max * 0.02, false, 'physical');
    const shakeFromTheirs = g.views.shake;
    g.views.addImpact(g.world.player.id, 400, false, 'physical');
    const shakeFromMine = g.views.shake;

    return {
      ok: ordinary > before,
      before,
      ordinary,
      smallScale: +smallScale.toFixed(2),
      bigScale: +bigScale.toFixed(2),
      shakeFromTheirs: +shakeFromTheirs.toFixed(3),
      shakeFromMine: +shakeFromMine.toFixed(3),
    };
  });

  // The three boss mechanics, and the shapes that make them beatable.
  //
  // Checked on the renderer's own objects rather than by eye: a cone drawn
  // pointing the wrong way, or a hazard patch that never appears, is invisible
  // to every assertion about the simulation and to a screenshot taken at the
  // wrong moment.
  const shapes = await page.evaluate(async () => {
    const g = window.__game;
    const out = {};
    for (const [zone, bossId, want] of [
      ['ardmoor', 'aonghus', 'aonghus_cleave'],
      ['reach', 'old_cauldron', 'old_cauldron_hazard'],
      ['ardmoor', 'muireann', 'muireann_fixate'],
    ]) {
      g.world.player.level = g.mobOf(bossId).level + 1;
      if (g.world.zone.id !== zone) g.world.travelTo(zone);
      await new Promise((r) => setTimeout(r, 500));
      const boss = [...g.world.entities.values()].find((e) => e.kind === 'mob' && e.defId === bossId);
      if (!boss) { out[want] = { ok: false, why: 'boss missing' }; continue; }

      g.world.player.pos = { x: boss.pos.x + 5, z: boss.pos.z };
      // Keep both standing from a timer, not from inside the wait loop: the
      // fight otherwise finishes while the check is looking the other way.
      if (window.__pin) clearInterval(window.__pin);
      window.__pin = setInterval(() => {
        g.world.player.health = g.world.statsOf(g.world.player).maxHealth;
        g.world.player.dead = false;
        boss.health = g.world.statsOf(boss).maxHealth;
      }, 30);
      g.world.submit(g.world.player.id, { t: 'target', id: boss.id });

      // For a hazard, wait for it to *land* — the patch is the thing being
      // checked and it does not exist until the cast resolves. Breaking as
      // soon as the cast started reported zero patches every time.
      const until = Date.now() + 40000;
      while (Date.now() < until) {
        if (want.endsWith('hazard')) {
          if (g.world.hazards.length) break;
        } else if (boss.cast?.id === want) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      // One frame for the renderer to build the patch it was just told about.
      await new Promise((r) => setTimeout(r, 120));

      const rings = g.views.telegraphs ?? [];
      const cone = rings.find((r) => r.cone);
      let aim = null;
      if (cone) {
        cone.group.updateMatrixWorld(true);
        const fwd = new cone.group.position.constructor(0, 0, 1).applyQuaternion(cone.group.quaternion);
        const dx = g.world.player.pos.x - boss.pos.x;
        const dz = g.world.player.pos.z - boss.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        aim = +((fwd.x * dx + fwd.z * dz) / len).toFixed(2);
      }
      out[want] = {
        ok: true,
        rings: rings.length,
        cone: !!cone,
        aimedAtPlayer: aim,
        stamped: rings.some((r) => !!r.at),
        patches: (g.views.hazardPatches ?? []).length,
        hazards: g.world.hazards.length,
      };
      clearInterval(window.__pin);
      window.__pin = null;
    }
    return out;
  });
  await wait(300);
  await page.screenshot({ path: join(OUT, '21-boss-mechanics.png') });
  // Put the run back where it found it: this block travels, levels up and
  // parks the player next to a boss, and everything after it assumes an
  // ordinary character in the Fenmarch. Sited late for the same reason —
  // early, it wrecked twenty checks downstream that had nothing to do with it.
  await page.evaluate(async () => {
    const g = window.__game;
    if (window.__pin) { clearInterval(window.__pin); window.__pin = null; }
    if (g.world.zone.id !== 'fenmarch') g.world.travelTo('fenmarch');
    await new Promise((r) => setTimeout(r, 500));
  });
  await wait(400);

  await browser.close();

  const checks = [
    ['canvas present', state.canvas],
    // Exact kit contents are a unit-test concern; here we only care that the
    // bar rendered a plausible number of slots for the chosen class.
    ['skill bar built', state.slots >= 6],
    ['player health shown', /\d+ \/ \d+/.test(state.hp)],
    // Thousands separators, and a "to go" tail. The old pattern wanted a bare
    // `n / n XP` and had been quietly failing since the bar was reformatted.
    ['xp bar shown', /[\d,]+ \/ [\d,]+/.test(state.xp)],
    ['a target was acquired', state.targetVisible && state.target.length > 0],
    ['nameplates rendering', state.nameplates > 0],
    ['closed to weapon range', reached],
    ['combat happened', state.log.some((l) => /hit|slain|died/i.test(l ?? ''))],
    ['vendor shop opened', vendorOpened],
    ['quest accepted from trader', questAccepted],
    ['travelled to a second zone', travelled === 'ardmoor'],
    ['selling paid gold', soldSomething],
    ['boss telegraph rendered', sawTelegraph],
    ['every zone has its own sky', distinctSkies === 4],
    ['every zone resolved a theme', themesMatched],
    ['entities stand on the terrain', standingOnGround],
    ['a creature in a lake wades rather than walking the bottom', wading],
    ['nameplates are coloured by what they would do to you', danger.colours >= 2],
    ['the target frame says the danger in words', danger.deadly !== danger.trivial],
    ['and says it about the right creature', /deadly|dangerous/.test(danger.deadly ?? '')],
    ['a corpse with loot on it is marked from across a camp', danger.marked && danger.farAway > 25],
    ['a bag item says what it is', tips.bag.length > 20],
    ['and how it compares to what you are wearing', tips.compares],
    ['a skill says what it costs', tips.knownHasCost],
    ['a locked skill says how to get it', tips.lockedSaysHow && tips.lockedNamed],
    ['and the tooltip goes away again', tips.hidden],
    ['a creature is shaped like the creature it is', bodies.plan !== 'blob'],
    // The whole point of merging. Six hundred creatures a zone can afford one
    // draw call each and not six, and a plan that quietly stops merging is
    // invisible until the frame budget check fails somewhere else entirely.
    ['and is still one mesh after growing legs', bodies.mobMeshes === 1],
    ['the figures you stand next to have joints', bodies.myJoints >= 4],
    ['and their limbs actually move', bodies.limbMoved],
    ['you are holding something', gear.ok && gear.after > 0],
    ['and swapping weapons changes what it is', gear.changed === true],
    ['bought and learned a zone skill', taught.ok],
    ['skill bar built two rows', bar.rows === 2 && bar.slots >= 15],
    ['unlearned skills still marked', bar.untaught > 0],
    ['rare spawn killed and carried its signature', rareLoot.ok],
    ['rare is named for what it carries', rareLoot.namedForItem === true],
    ['rare renders bigger than its camp', rareCheck.taller === true],
    ['rare nameplate marked', rarePlate > 0],
    ['refused a healthy horse, took a spent one', horse.ok],
    ['riding is faster than walking', horse.ridden > horse.onFoot],
    ['the luxury merchant refused a pauper and served a lord', luxury.ok],
    ['a luxury piece filled a new slot', ['offhand', 'amulet', 'bracelet'].includes(luxury.slot)],
    ['the zone has other people in it', people.ok && people.count > 0],
    ['their bodies render', people.bodies === people.count],
    ['their nameplates render', crowdUi.plates > 0],
    ['somebody congratulated the level', people.levelled && crowdUi.chatLines.length > 0],
    ['what they said is over their head', crowdUi.bubbles > 0],
    ['selecting one offers no health bar', crowdTarget.barHidden && crowdTarget.name.length > 0],
    ['a dragon took a holding', wyrm.inWorld && wyrm.phase === 'roosting'],
    ['the ground it landed on emptied', wyrm.groundEmptied && wyrm.suppressed],
    ['killing it handed the ground back', wyrmDead.ok],
    ['it carried something', (wyrmDead.carried ?? []).length > 0],
    ['a front changed hands', realm.ok],
    ['the new holder garrisons the ground', realm.garrisonAfter !== realm.garrisonBefore],
    // 2,627 was the number before the scatter was instanced and entities
    // stopped drawing through the fog. 700 is a ceiling with room in it, not a
    // target — if this fails, something started drawing per-object again.
    ['a hit leaves a mark where it landed', impact.ok === true],
    ['a big crit is a bigger mark than a scratch', impact.bigScale > impact.smallScale * 2],
    ['your own beating shakes the camera', impact.shakeFromMine > impact.shakeFromTheirs],
    ['a cleave draws a cone', shapes.aonghus_cleave?.cone === true],
    ['and points it at the player', (shapes.aonghus_cleave?.aimedAtPlayer ?? 0) > 0.9],
    ['a hazard leaves a patch on the ground', (shapes.old_cauldron_hazard?.patches ?? 0) > 0],
    ['a fixate stamps its circle on a spot, not on the caster', shapes.muireann_fixate?.stamped === true],
    ['the game makes a sound', sound.ok === true],
    ['a swing, a hit and a level-up all sound different', sound.swing !== sound.hit && sound.hit !== sound.level],
    ['a crit is louder than an ordinary hit', sound.crit > sound.near],
    ['an event with no sound makes none', sound.silence === 0],
    ['a fight across the zone is inaudible', sound.acrossTheZone === 0],
    ['the live audio graph is wired', sound.liveMeter !== null],
    ['a frame is under 700 draw calls', frame.drawCalls < 700],
    ['a frame is under 400k triangles', frame.triangles < 400000],
    // 50ms is one tick of world time. Anything approaching that is a sim that
    // cannot keep up with itself.
    ['a sim tick costs under 5ms', frame.tickMs < 5],
    ['a dropped-in model replaces the capsule', art.ok === true],
    ['it was a capsule before', art.before === false],
    ['the capsule is hidden underneath it', art.capsuleHidden === true],
    ['the model is fitted to the creature it replaced', Math.abs(art.fitted - art.authored) < art.authored * 0.25],
    ['the model is clickable', art.tagged > 1],
    ['its animation is playing', typeof art.anim === 'string'],
    ['a missing model leaves the creature standing', artOff.stillAlive === true],
    ['the sun crosses the sky', skies[0].light > skies[2].light + 0.2],
    ['and the world actually gets darker', skies[0].sun > skies[2].sun * 2 && skies[0].skyLum > skies[2].skyLum * 2],
    ['night keeps enough ambient to see by', skies[2].ambient >= skies[0].ambient * 0.45],
    ['the clock is on screen', /\d\d:\d\d/.test(clockShown)],
    ['dying opens a debt instead of taking a level', death.ok && death.owed > 0 && death.level === 30 && death.xp === 500],
    ['the death screen says what it cost', /experience owed/i.test(deathUi.cost) && deathUi.shown],
    ['the debt is drawn on the xp bar', deathUi.debtBar > 0],
    ['the debt survives the respawn', reclaimed.owedAfterRespawn > 0],
    ['reclaiming from across the zone is refused', reclaimed.refused === true],
    ['walking back to the body clears it', reclaimed.owedNow === 0],
    ['the map opens', mapState.open === true],
    ['the map drew the zone rather than a blank rectangle', mapState.fullColours > 40],
    ['the minimap drew ground', mapState.miniColours > 12],
    ['the map names the zone and its band', /levels \d+/i.test(mapState.title)],
    ['the map has a legend', mapState.legend >= 7],
    ['escape closes the map', mapClosed === true],
    ['realm panel opens', realmPanel.open],
    ['realm panel lists every front', realmPanel.fronts === 8],
    ['realm panel lists standing', realmPanel.standings === 5],
    ['armour line paid out its piece', armour.ok],
    ['armour line piece fits a slot', !!armour.slot],
    ['bounty spawn paid a windfall', bounty.ok],
    ['the world moved while logged out', backdated.ok && away.shown && away.rows > 0],
    ['it says how long you were gone', /day/i.test(away.title)],
    ['and left it in the log too', away.logged],
    ['the returning character is the one who left', away.level > 1],
    ['escape backs out of it', awayDismissed],
    ['no page errors', errors.length === 0 && returningErrors.length === 0],
  ];

  console.log('\n--- smoke results ---');
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log('\nplayer:', state.hp, '| xp:', state.xp, '| target:', state.target);
  console.log('log tail:', state.log.slice(0, 6));
  console.log('horse:', JSON.stringify(horse), '| luxury:', JSON.stringify(luxury));
  console.log('dragon:', JSON.stringify(wyrm), JSON.stringify(wyrmDead));
  console.log('realm:', JSON.stringify(realm), '|', JSON.stringify(realmPanel));
  console.log('wade:', JSON.stringify(wade));
  console.log('danger:', JSON.stringify(danger));
  console.log('tips:', JSON.stringify(tips));
  console.log('bodies:', JSON.stringify(bodies), '| gear:', JSON.stringify(gear));
  console.log('map:', JSON.stringify(mapState), 'closed:', mapClosed);
  console.log('impact:', JSON.stringify(impact));
  console.log('shapes:', JSON.stringify(shapes));
  console.log('sound:', JSON.stringify(sound));
  console.log('frame:', JSON.stringify(frame));
  console.log('art:', JSON.stringify(art), JSON.stringify(artOff));
  console.log('sky:', skies.map((x) => JSON.stringify(x)).join(' '), '| clock:', clockShown);
  console.log('death:', JSON.stringify(death), JSON.stringify(deathUi), JSON.stringify(reclaimed));
  console.log('armour:', JSON.stringify(armour), '| bounty:', JSON.stringify(bounty));
  console.log('rare:', JSON.stringify({ ...rareCheck, ...rareLoot }), '| rare plates:', rarePlate);
  console.log('away:', JSON.stringify(backdated), JSON.stringify(away), 'dismissed:', awayDismissed);
  console.log('people:', JSON.stringify(people), '|', JSON.stringify(crowdUi), '|', JSON.stringify(crowdTarget));
  console.log('taught:', JSON.stringify(taught), '| bar:', JSON.stringify(bar));
  console.log('zones:', looks.map((l) => `${l.zone}/${l.theme} sky#${l.sky.toString(16)}`).join('  '));
  if (errors.length || returningErrors.length)
    console.log('\nerrors:\n' + [...errors, ...returningErrors].join('\n'));
  console.log(`\nscreenshots in ${OUT}`);

  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
  await page.click('#vendor-bags .vendor-row');
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
    await new Promise((r) => setTimeout(r, 1500));
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
  const crowdUi = await page.evaluate(() => ({
    plates: [...document.querySelectorAll('.nameplate.adventurer')].filter(
      (n) => n.style.display !== 'none',
    ).length,
    bubbles: [...document.querySelectorAll('.nameplate .np-says')].filter(
      (n) => n.style.display !== 'none',
    ).length,
    chatLines: [...document.querySelectorAll('#log .log-chat')].map((n) => n.textContent),
    // Selecting somebody you cannot fight must not offer you a health bar.
    hpHidden: (() => {
      const g = window.__game;
      const person = [...g.world.entities.values()].find((e) => e.kind === 'npc');
      if (!person) return false;
      g.world.submit(g.world.player.id, { t: 'target', id: person.id });
      return true;
    })(),
  }));
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
  console.log('map:', JSON.stringify(mapState), 'closed:', mapClosed);
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

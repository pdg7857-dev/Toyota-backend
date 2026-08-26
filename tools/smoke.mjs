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

  // Name the character, then pick the class named by CLASS (default Warrior).
  //
  // Typed rather than passed on the query string: the box is the control a
  // player actually uses, and it is the reason four different lines of what
  // the population says now land on somebody rather than on "Wanderer".
  const SMOKE_NAME = 'Fionnbharr';
  const wanted = (process.env.CLASS ?? 'Warrior').toLowerCase();
  const picked = await page.evaluate(
    ({ name, typed }) => {
      const box = document.querySelector('#cs-name-input');
      if (box) {
        box.value = typed;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const cards = [...document.querySelectorAll('.cs-card')];
      const card = cards.find((c) => c.querySelector('h2')?.textContent?.toLowerCase() === name);
      if (!card) return { ok: false, box: !!box };
      card.click();
      return { ok: true, box: !!box };
    },
    { name: wanted, typed: SMOKE_NAME },
  );
  if (!picked.ok) throw new Error('class select did not offer ' + wanted);

  // Wait for the game to be *running*, not for a stopwatch.
  //
  // Every check below this line was written against a fixed 1500ms boot, and
  // the first run after a rebuild is slower than that — a cold HTTP cache and
  // a module graph nobody has parsed before — so twenty-one timing-sensitive
  // checks failed on the first run and passed on the second. A suite that
  // fails a fifth of itself at random is a suite people learn to ignore.
  await page.waitForFunction(
    () => {
      const g = window.__game;
      // Ticking, with a world and a zone actually built around the player.
      return !!g && g.world.tickCount > 8 && [...g.views.all].length > 20;
    },
    null,
    { timeout: 40000 },
  );
  await wait(400);
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
    // Named, not "the first vendor in the map". A zone has six traders now and
    // the one nearest the arrival point is Ceallach, who sells luxuries and
    // gives no work — which reported the quest offer as broken when what was
    // actually wrong was the probe standing in the wrong shop.
    const vendor = [...g.world.entities.values()].find((e) => e.vendorId === 'maeve');
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

  // What the work actually asks, before you take it on.
  //
  // The offer row is the one row in the shop a player has to make a decision
  // about, and it showed a name and a number. The job was in a native `title=`
  // — a second's delay, no structure, and nothing to say what it pays.
  const questOffer = await page.evaluate(async () => {
    const row = document.querySelector('#vendor-quests .quest-row');
    if (!row) return { ok: false, why: 'nothing on offer' };
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 400, clientY: 400 }));
    await new Promise((r) => setTimeout(r, 60));
    const tip = document.querySelector('#tip');
    const text = getComputedStyle(tip).display === 'none' ? '' : (tip.textContent ?? '');
    row.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    // Structural rather than keyword-matched: the objective lines and the
    // summary come out of the quest itself, so this cannot pass by accident on
    // whichever chain the trader happens to be offering.
    const name = row.querySelector('span')?.textContent ?? '';
    const quest = Object.values(window.__game.allQuests()).find((q) =>
      name.includes(q.name),
    );
    return {
      ok: text.length > 0,
      quest: quest?.id ?? null,
      saysTheJob: !!quest && quest.objectives.every((o) => text.includes(o.text)),
      saysWhy: !!quest && text.includes(quest.summary),
      saysThePay: /xp/.test(text),
      text: text.slice(0, 120),
    };
  });

  // Accept the first quest on offer from the trader.
  const questAccepted = await page.evaluate(() => {
    const row = document.querySelector('#vendor-quests .quest-row');
    if (!row) return false;
    row.click();
    return true;
  });
  await wait(300);

  // The lot, in one click.
  //
  // A run brings back a dozen stacks of trade goods and each used to want its
  // own click. What is worth asserting is the half that makes it safe to
  // press: it must never touch a piece of gear.
  const sellAll = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const items = g.allItems();
    const goods = Object.values(items).filter((it) => it.merchantGood).slice(0, 4);
    const keep = Object.values(items).find((it) => it.slot === 'weapon');
    if (goods.length < 2 || !keep) return { ok: false, why: 'not enough to sell' };

    me.inventory = [
      ...goods.map((it) => ({ itemId: it.id, qty: 3 })),
      { itemId: keep.id, qty: 1 },
    ];
    g.hud.openVendor(
      [...g.world.entities.values()].find((e) => e.vendorId === 'maeve').id,
    );
    await new Promise((r) => setTimeout(r, 300));

    const row = document.querySelector('#vendor-bags .vendor-row.sell-all');
    if (!row) return { ok: false, why: 'no sell-all row' };
    const before = me.gold;
    row.click();
    await new Promise((r) => setTimeout(r, 400));

    const left = (me.inventory ?? []).map((st) => st.itemId);
    return {
      ok: true,
      paid: me.gold - before,
      // Every trade good gone, and the weapon still there.
      cleared: goods.every((it) => !left.includes(it.id)),
      keptGear: left.includes(keep.id),
      rows: document.querySelectorAll('#vendor-bags .vendor-row').length,
    };
  });

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
    // Can you actually see a creature standing on this ground?
    //
    // Caer Dubh shipped once as black shapes on a black hill, and the answer
    // at the time was a floor on the light. That is only half of it: a light
    // floor cannot help a creature whose own colour is within a few percent of
    // the ground's, which the Sunken Wood's smugglers and Caer Dubh's
    // Blackshields both were.
    //
    // Measured in *pixels*, off the frame the renderer actually produced.
    // Every other way of asking this — the material colour, the theme's light
    // multiplier — is a proxy, and the proxies all read fine while the picture
    // was a silhouette.
    // Stood square in front of the camera at a readable distance, with the
    // ground behind it rather than the sky: the question is whether it reads
    // against the ground, and a creature on the horizon is a different one.
    // Placed in one turn and measured in the next, because the views lerp
    // toward a position the sim has told them about and a creature teleported
    // and rendered in the same breath is drawn where it used to be.
    const placed = await page.evaluate(() => {
      const g = window.__game;
      const me = g.world.player;
      // The *worst* creature in the zone, not whichever one the iteration
      // happened to reach first: the question is whether the hardest thing to
      // see here still reads, and a run that picks a different creature every
      // time is a measurement of nothing.
      const lum = (hex) =>
        (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255)) / 255;
      const ground =
        (lum(g.rig.theme.ground.dry) + lum(g.rig.theme.ground.damp)) / 2;
      let mob = null;
      let worst = Infinity;
      for (const e of g.world.entities.values()) {
        if (e.kind !== 'mob' || e.dead) continue;
        const def = g.mobOf(e.defId);
        if (def.horse || def.dragon) continue;
        const gap = Math.abs(lum(def.view.color) - ground);
        if (gap >= worst) continue;
        worst = gap;
        mob = e;
      }
      if (!mob) return null;
      // Blinded while it poses. Seven metres is inside anything's aggro, and a
      // creature left fighting the player is a creature the next four checks
      // are quietly measuring instead of what they think they are.
      window.__poseHome = { pos: { ...mob.pos }, spawn: { ...mob.spawnPos } };
      window.__poseAggro = new Map();
      for (const def of g.allMobs()) {
        window.__poseAggro.set(def.id, def.aggroRadius);
        def.aggroRadius = 0;
      }
      const cam = g.rig.camera;
      const len = Math.hypot(me.pos.x - cam.position.x, me.pos.z - cam.position.z) || 1;
      const fx = (me.pos.x - cam.position.x) / len;
      const fz = (me.pos.z - cam.position.z) / len;
      mob.pos = { x: me.pos.x + fx * 7, z: me.pos.z + fz * 7 };
      mob.dead = false;
      mob.health = g.world.statsOf(mob).maxHealth;
      return mob.id;
    });
    await wait(700);
    seen.contrast = await page.evaluate((mobId) => {
      const g = window.__game;
      const mob = g.world.entity(mobId ?? -1);
      if (!mob) return { ok: false, why: 'nothing alive here' };

      const r = g.rig.renderer;
      r.render(g.rig.scene, g.rig.camera);

      // Copied out in the same task as the render: the drawing buffer is not
      // preserved, so a read one frame later is a read of a cleared canvas.
      const src = r.domElement;
      const flat = document.createElement('canvas');
      flat.width = src.width;
      flat.height = src.height;
      const ctx = flat.getContext('2d');
      ctx.drawImage(src, 0, 0);

      const lumOf = (x, y, w, h) => {
        const d = ctx.getImageData(x, y, w, h).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        }
        return sum / (d.length / 4);
      };

      const v = g.views.get(mob.id);
      if (!v) return { ok: false, why: 'it has no view' };
      const p = v.group.position.clone();
      p.y += g.mobOf(mob.defId).view.height * 0.55;
      p.project(g.rig.camera);
      const px = (p.x * 0.5 + 0.5) * src.width;
      const py = (-p.y * 0.5 + 0.5) * src.height;
      const box = Math.round(src.width * 0.012);
      if (px < box * 6 || px > src.width - box * 6 || py < box || py > src.height - box) {
        return { ok: false, why: 'it did not land on screen' };
      }
      const body = lumOf(Math.round(px - box / 2), Math.round(py - box / 2), box, box);
      const left = lumOf(Math.round(px - box * 5), Math.round(py - box / 2), box, box);
      const right = lumOf(Math.round(px + box * 4), Math.round(py - box / 2), box, box);
      const ground = (left + right) / 2;
      return {
        ok: true,
        mob: mob.name,
        body: +body.toFixed(3),
        ground: +ground.toFixed(3),
        gap: +Math.abs(body - ground).toFixed(3),
        at: [Math.round(px), Math.round(py)],
      };
    }, placed);

    // Put it back where it was standing, and give everything its eyes again.
    await page.evaluate((mobId) => {
      const g = window.__game;
      const mob = g.world.entity(mobId ?? -1);
      const home = window.__poseHome;
      if (mob && home) {
        mob.pos = { ...home.pos };
        mob.spawnPos = { ...home.spawn };
        mob.targetId = null;
        mob.threat = {};
        mob.aiState = 'idle';
      }
      for (const def of g.allMobs()) {
        const was = window.__poseAggro?.get(def.id);
        if (was !== undefined) def.aggroRadius = was;
      }
      g.world.lastCombatTick.clear();
      g.world.player.threat = {};
      g.world.submit(g.world.player.id, { t: 'autoAttack', on: false });
      g.world.submit(g.world.player.id, { t: 'target', id: null });
    }, placed);

    looks.push(seen);
    await page.screenshot({ path: join(OUT, `08-${i}-${zoneId}.png`) });
  }
  const distinctSkies = new Set(looks.map((l) => l.sky)).size;
  const themesMatched = looks.every((l) => l.theme && l.theme.length > 0);
  const standingOnGround = looks.every((l) => Math.abs(l.groundGap) < 0.05);
  // 0.08 is a floor rather than a target: the four zones measure 0.14 to 0.27
  // as they stand, and anything near this number is a creature authored into
  // the colour of its own ground. Printed as well as bounded, because a
  // number that only fails is a number nobody watches drift.
  const readable = looks.every((l) => l.contrast?.ok && l.contrast.gap >= 0.08);

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
    // Waited *for*, not slept through. Nine hundred milliseconds is comfortably
    // past the five-hundred-and-fifty the card fades in over, and it still
    // failed about one run in ten — because the card only starts fading when
    // the loot event lands, and the kill it is waiting on is a real fight.
    const cardUp = async () => {
      const until = Date.now() + 6000;
      while (Date.now() < until) {
        const el = document.querySelector('#drop');
        if (el.classList.contains('show') && parseFloat(getComputedStyle(el).opacity) > 0.2) return;
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    await cardUp();

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
    // Waited *for*, not slept through. Nine hundred milliseconds is comfortably
    // past the five-hundred-and-fifty the card fades in over, and it still
    // failed about one run in ten — because the card only starts fading when
    // the loot event lands, and the kill it is waiting on is a real fight.
    const cardUp = async () => {
      const until = Date.now() + 6000;
      while (Date.now() < until) {
        const el = document.querySelector('#drop');
        if (el.classList.contains('show') && parseFloat(getComputedStyle(el).opacity) > 0.2) return;
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    await cardUp();
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
    const until = Date.now() + 14000;
    const killerMax = g.world.statsOf(killer).maxHealth;
    const playerMax = g.world.statsOf(player).maxHealth;
    // Held up for a couple of seconds first, so it is a fight and not an
    // execution. The recap says how much of you went in how long, and a
    // character pinned at one health from the start dies to a single blow —
    // which measured as "the recap does not say how fast it happened".
    const standUntil = Date.now() + 2600;
    while (!player.dead && Date.now() < until) {
      player.health = Date.now() < standUntil ? playerMax : 1;
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
    // How it happened. The most instructive moment in the game used to say
    // what it cost and nothing about itself.
    recap: document.querySelector('#death-recap')?.textContent ?? '',
    recapLines: document.querySelectorAll('#death-recap div').length,
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
  // A mark the player puts down themselves.
  //
  // The whole of the navigation in this game was an arrow pointing at one
  // quest objective. Clicked through a real pointer event rather than by
  // calling the handler, because the failure worth guarding is the map layer
  // going `pointer-events: none` and the canvas never hearing about it — which
  // is exactly what happened to the target frame's tooltip.
  const marking = await page.evaluate(async () => {
    const g = window.__game;
    const canvas = document.querySelector('#map-canvas');
    const rect = canvas.getBoundingClientRect();
    const fire = (fx, fy) =>
      canvas.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: rect.left + rect.width * fx,
          clientY: rect.top + rect.height * fy,
        }),
      );

    fire(0.3, 0.7);
    await new Promise((r) => setTimeout(r, 350));
    const mark = g.map.mark ? { ...g.map.mark } : null;
    const head = document.querySelector('#tracker-head')?.textContent ?? '';
    const dist = document.querySelector('#tracker-dist')?.textContent ?? '';
    const arrow = document.querySelector('#tracker-arrow')?.style.transform ?? '';
    const gap = mark
      ? Math.round(Math.hypot(mark.x - g.world.player.pos.x, mark.z - g.world.player.pos.z))
      : 0;

    window.__clearMark = async () => {
      fire(0.3, 0.7);
      await new Promise((r) => setTimeout(r, 350));
    };
    return {
      set: !!mark,
      inZone: !!mark && Math.abs(mark.x) <= g.world.zone.halfSize,
      tracked: /mark/i.test(head),
      // The distance it reports has to be the distance it actually is.
      saysHowFar: new RegExp(`\\b${gap}m`).test(dist),
      turned: /rotate/.test(arrow),
      gap,
      head,
      dist,
    };
  });
  await page.screenshot({ path: join(OUT, '17b-map-mark.png') });
  // And the same click again takes it off, so the quest arrow comes back.
  const unmarked = await page.evaluate(async () => {
    await window.__clearMark();
    return {
      cleared: window.__game.map.mark === null,
      backToQuest: !/mark/i.test(document.querySelector('#tracker-head')?.textContent ?? ''),
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

  // The camera stays out of the scenery.
  //
  // Walk backwards into a standing stone and the shot used to fill with the
  // dark inside face of a rock. It is the most visible thing a 3D game can do
  // wrong and nothing in this suite could see it — the sim is flat, and a
  // screenshot of the inside of a stone looks like a screenshot of the night.
  const camera = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const home = { x: me.pos.x, z: me.pos.z, yaw: g.rig.yaw, pitch: g.rig.pitch };
    const flat = () =>
      Math.hypot(g.rig.camera.position.x - me.pos.x, g.rig.camera.position.z - me.pos.z);

    // Streamed first: earlier blocks teleport the player without telling the
    // renderer, so the cells standing around are the ones from wherever the
    // run was last looking and everything in them is a kilometre away.
    g.rig.stream(me.pos.x, me.pos.z, true);
    await new Promise((r) => setTimeout(r, 400));

    // Somewhere with nothing behind it: the shot the pull-in must never touch.
    const all = [...g.rig.cells.values()].flatMap((c) => c.userData.blockers ?? []);
    const near = all.filter((b) => Math.hypot(b.x - me.pos.x, b.z - me.pos.z) < 400);
    near.sort((a, b) => b.top - a.top);
    const stone = near[0];
    if (!stone) return { ok: false, why: 'nothing standing anywhere near' };

    g.rig.pitch = 0.2;
    // The camera sits at focus - (sin yaw, cos yaw) * distance, so `away` — the
    // heading from the stone out to the player — is the yaw that puts the
    // stone between the two of them, and `away + PI` is the one that puts it
    // behind the player's back where it cannot matter.
    const away = Math.atan2(me.pos.x - stone.x, me.pos.z - stone.z);

    // Out in the open, well clear of it: the shot the pull-in must not touch.
    g.rig.yaw = away + Math.PI;
    g.rig.stream(me.pos.x, me.pos.z, true);
    await new Promise((r) => setTimeout(r, 600));
    const open = flat();

    // Now with the stone directly between the player and where the camera
    // wants to sit.
    const gap = stone.r + 3.6;
    me.pos.x = stone.x + Math.sin(away) * gap;
    me.pos.z = stone.z + Math.cos(away) * gap;
    g.rig.yaw = away;
    g.rig.stream(me.pos.x, me.pos.z, true);
    await new Promise((r) => setTimeout(r, 600));
    const behind = flat();
    const inside = Math.hypot(
      g.rig.camera.position.x - stone.x,
      g.rig.camera.position.z - stone.z,
    );

    me.pos.x = home.x;
    me.pos.z = home.z;
    g.rig.yaw = home.yaw;
    g.rig.pitch = home.pitch;
    g.rig.stream(home.x, home.z, true);
    await new Promise((r) => setTimeout(r, 300));
    return {
      ok: true,
      blockers: near.length,
      tallest: +stone.top.toFixed(1),
      open: +open.toFixed(2),
      behind: +behind.toFixed(2),
      clearOf: +(inside - stone.r).toFixed(2),
      wanted: g.rig.distance,
    };
  });

  // A camp that notices it is being farmed.
  //
  // The one thing in this game that happens *because of what you just did* and
  // happens fast enough to react to. The unit tests cover the pace; what only
  // a browser can say is whether the player is actually told.
  const muster = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const aggro = new Map();
    for (const def of g.allMobs()) {
      aggro.set(def.id, def.aggroRadius);
      def.aggroRadius = 0;
    }

    // Stand in the biggest camp within reach and empty it.
    const cells = new Map();
    for (const e of g.world.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      const def = g.mobOf(e.defId);
      if (def.stars >= 5 || def.horse) continue;
      const key = `${Math.round(e.pos.x / 150)}:${Math.round(e.pos.z / 150)}`;
      cells.set(key, [...(cells.get(key) ?? []), e]);
    }
    const packs = [...cells.values()].sort((a, b) => b.length - a.length);
    if (packs.length === 0) return { ok: false, why: 'no camp in this zone' };
    const pack = packs[0];
    const home = { x: me.pos.x, z: me.pos.z };
    me.pos = {
      x: pack.reduce((n, e) => n + e.pos.x, 0) / pack.length,
      z: pack.reduce((n, e) => n + e.pos.z, 0) / pack.length,
    };
    await new Promise((r) => setTimeout(r, 400));

    let killed = 0;
    let champion = null;
    const until = Date.now() + 40000;
    while (!champion && Date.now() < until) {
      const victim = [...g.world.entities.values()].find(
        (e) =>
          e.kind === 'mob' &&
          !e.dead &&
          !e.roused &&
          Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) < 90,
      );
      if (!victim) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      victim.pos = { x: me.pos.x + 2, z: me.pos.z };
      g.world.submit(me.id, { t: 'target', id: victim.id });
      g.world.submit(me.id, { t: 'autoAttack', on: true });
      const stop = Date.now() + 5000;
      while (!victim.dead && Date.now() < stop) {
        victim.pos = { x: me.pos.x + 2, z: me.pos.z };
        victim.health = 1;
        me.health = g.world.statsOf(me).maxHealth;
        await new Promise((r) => setTimeout(r, 50));
      }
      killed++;
      champion = [...g.world.entities.values()].find((e) => e.roused) ?? null;
    }
    g.world.submit(me.id, { t: 'autoAttack', on: false });
    if (champion) g.world.submit(me.id, { t: 'target', id: champion.id });
    await new Promise((r) => setTimeout(r, 350));

    const coming = [...g.world.entities.values()].filter(
      (e) => e.kind === 'mob' && !e.dead && e.aiState === 'chasing',
    ).length;
    // The stacked-corpse case: only the corpse F would actually take gets the
    // prompt, or four of them land on top of each other unreadably.
    const prompts = [...document.querySelectorAll('.nameplate.lootable')]
      .filter((p) => p.style.display !== 'none')
      .filter((p) => /press F/.test(p.querySelector('.np-name')?.textContent ?? '')).length;
    const banner = document.querySelector('#zone-banner')?.textContent ?? '';
    const frame = document.querySelector('#target-name')?.textContent ?? '';

    // Put the run back where it found it — and that means out of combat, not
    // just out of the camp. `autoSelect` turns auto-attack back on the instant
    // the player is fighting, which is exactly right in the game and means a
    // probe that walks away from a roused camp leaves the character quietly
    // farming hares behind the next three checks.
    for (const def of g.allMobs()) def.aggroRadius = aggro.get(def.id);
    for (const e of g.world.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      e.targetId = null;
      e.threat = {};
      e.aiState = 'idle';
      if (e.spawnPos) e.pos = { ...e.spawnPos };
    }
    me.threat = {};
    g.world.lastCombatTick.clear();
    me.pos = home;
    me.dead = false;
    me.health = g.world.statsOf(me).maxHealth;

    return {
      ok: !!champion,
      killed,
      champion: champion?.name ?? null,
      coming,
      prompts,
      banner,
      frame,
      raised: champion ? g.mobOf(champion.defId).stars : 0,
    };
  });

  // A skill worth waiting for, and the light that says when.
  //
  // Without the light the whole idea is invisible: a skill worth seventy-five
  // percent more on something nearly dead, with nothing on screen saying when,
  // is a skill nobody ever holds.
  const timing = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    // Saved and restored: these are the shared definitions, and the
    // boss-mechanics block below needs its boss to come at the player.
    const aggro = new Map();
    for (const def of g.allMobs()) {
      aggro.set(def.id, def.aggroRadius);
      def.aggroRadius = 0;
    }
    // High enough to actually own the skill. A locked slot never lights up,
    // which is correct behaviour and a useless measurement.
    const conditional = Object.values(g.allSkills()).find(
      (sk) => sk.when && sk.classId === me.classId,
    );
    if (!conditional) return { ok: false, why: `${me.classId} has nothing to time` };
    me.level = Math.max(me.level, conditional.reqLevel);

    const victim = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    if (!victim) return { ok: false, why: 'nothing alive to target' };
    const home = { ...victim.pos };
    victim.pos = { x: me.pos.x + 2, z: me.pos.z };
    // Auto-attack is left on by earlier blocks, and a creature parked two
    // metres away dies inside a second — the first version of this measured a
    // corpse, whose condition is correctly false, and reported it as the light
    // never coming on.
    g.world.submit(me.id, { t: 'autoAttack', on: false });
    g.world.submit(me.id, { t: 'target', id: victim.id });
    await new Promise((r) => setTimeout(r, 300));

    const lit = () => [...document.querySelectorAll('#skill-bar .slot.live')].length;
    const max = g.world.statsOf(victim).maxHealth;
    victim.health = max;
    await new Promise((r) => setTimeout(r, 250));
    const healthy = lit();
    victim.health = max * 0.12;
    await new Promise((r) => setTimeout(r, 250));
    const nearlyDead = lit();
    const alive = !victim.dead;
    victim.health = max;
    victim.pos = home;
    victim.spawnPos = { ...home };
    for (const def of g.allMobs()) def.aggroRadius = aggro.get(def.id);
    me.dead = false;
    me.health = g.world.statsOf(me).maxHealth;

    return {
      ok: true,
      healthy,
      nearlyDead,
      skill: conditional.name,
      level: me.level,
      alive,
    };
  });

  // What a boss does, once it has done it to you.
  //
  // A kit is four telegraphed abilities and the only way to find out what they
  // were was to die to them — fine once, poor a fortnight later. The same rule
  // the bestiary runs under: learned by playing, not read off a tooltip on
  // something that has not hit you yet.
  const kit = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const boss = [...g.world.entities.values()].find(
      (e) => e.kind === 'mob' && !e.dead && (g.mobOf(e.defId).abilities ?? []).length > 1,
    );
    if (!boss) return { ok: false, why: 'no boss standing' };
    const abilities = g.mobOf(boss.defId).abilities;

    // Nothing known yet: the frame must not spoil what has not happened.
    me.seenAbilities = [];
    g.world.submit(me.id, { t: 'target', id: boss.id });
    await new Promise((r) => setTimeout(r, 300));
    const frame = document.querySelector('#target-frame');
    const read = async () => {
      frame.dispatchEvent(
        new MouseEvent('mouseenter', { bubbles: true, clientX: 400, clientY: 400 }),
      );
      await new Promise((r) => setTimeout(r, 80));
      const tip = document.querySelector('#tip');
      const text = getComputedStyle(tip).display === 'none' ? '' : (tip.textContent ?? '');
      frame.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      return text;
    };
    const blank = await read();

    // Now it uses one on you, through the real path: the mob has to be
    // fighting the player for it to count, which is the whole rule.
    boss.pos = { x: me.pos.x + 2, z: me.pos.z };
    boss.spawnPos = { ...boss.pos };
    boss.targetId = me.id;
    boss.aiState = 'attacking';
    boss.threat = { [me.id]: 100 };
    boss.abilityCooldowns = {};
    const until = Date.now() + 12000;
    while ((me.seenAbilities ?? []).length === 0 && Date.now() < until) {
      me.health = g.world.statsOf(me).maxHealth;
      boss.health = g.world.statsOf(boss).maxHealth;
      await new Promise((r) => setTimeout(r, 100));
    }
    const learned = await read();
    const shown = (me.seenAbilities ?? [])
      .map((id) => abilities.find((a) => a.id === id)?.name)
      .filter(Boolean);

    g.world.submit(me.id, { t: 'target', id: null });
    boss.targetId = null;
    boss.threat = {};
    boss.aiState = 'idle';
    return {
      ok: true,
      boss: boss.name,
      // Nothing before, the thing it used after, and an honest count of what
      // is still unknown either way.
      quietFirst: !abilities.some((a) => blank.includes(a.name)) && /more you have not seen/.test(blank),
      names: shown.length > 0 && shown.every((n) => learned.includes(n)),
      saysTheAnswer: /Get out of|Go round|Keep moving|Move out|Interrupt it|the clock/.test(learned),
      shown,
      learned: learned.slice(0, 160),
    };
  });

  // The reckoning.
  const reckoning = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const before = Object.values(me.slain ?? {}).reduce((n, v) => n + v, 0);

    // Kill something, and see it written down. Through the base creature: a
    // Snarling Bog Wolf and a plain one are both Bog Wolves to a player.
    const victim = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    victim.pos = { x: me.pos.x + 2, z: me.pos.z };
    const base = g.mobOf(victim.defId).starOf ?? g.mobOf(victim.defId).rareOf ?? victim.defId;
    g.world.submit(me.id, { t: 'target', id: victim.id });
    g.world.submit(me.id, { t: 'autoAttack', on: true });
    const until = Date.now() + 20000;
    while (!victim.dead && Date.now() < until) {
      // Pinned every pass, not once: a skittish creature on one health point
      // breaks and runs, and the first version of this stood there swinging at
      // a hare disappearing over a hill and reported "a kill is not written
      // down" — which is a true sentence about the wrong thing.
      victim.pos = { x: me.pos.x + 2, z: me.pos.z };
      victim.health = 1;
      await new Promise((r) => setTimeout(r, 80));
    }
    g.world.submit(me.id, { t: 'autoAttack', on: false });
    await new Promise((r) => setTimeout(r, 200));

    document.querySelector('#journal-window').style.display = 'block';
    await new Promise((r) => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('#journal-body .stat-row')].map((r) => r.textContent ?? '');
    document.querySelector('#journal-window').style.display = 'none';

    return {
      counted: Object.values(me.slain ?? {}).reduce((n, v) => n + v, 0) > before,
      byBase: (me.slain ?? {})[base] > 0,
      rows: rows.length,
      // The bestiary half: what a creature does, written down the first time
      // you kill one, so the trait system is learned by playing.
      saysTrait: rows.some((r) => /Pack|Skittish|Venomous|Stubborn/.test(r)),
      total: rows.some((r) => /Creatures killed/.test(r)),
    };
  });

  // The name you gave yourself, on your own frame.
  const named = await page.evaluate(() => ({
    name: window.__game.world.player.name,
    onFrame: (document.querySelector('#player-name')?.textContent ?? '').trim(),
  }));

  // Taking your points back.
  //
  // Five attribute points a level for a hundred levels, and until now not one
  // of them could be undone. The row is in the zone's hold and nowhere else,
  // so this checks the whole path a player uses: open the shop, read the
  // price, click it, and find the points back in the pool.
  const respec = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    g.world.lastCombatTick.clear();
    g.world.submit(me.id, { t: 'target', id: null });

    // Everything this probe is about to change. A respec leaves the character
    // at base attributes with a fistful of unspent points, which is a much
    // weaker character than the one the checks after this one are measuring —
    // the same trap the muster probe fell into twice.
    const home = {
      pos: { ...me.pos },
      gold: me.gold,
      level: me.level,
      attributes: { ...me.attributes },
      unspentPoints: me.unspentPoints,
      skillRanks: { ...(me.skillRanks ?? {}) },
      skillPoints: me.skillPoints,
    };

    const hold = [...g.world.entities.values()].find(
      (e) => e.kind === 'vendor' && e.vendorId === 'maeve',
    );
    me.pos.x = hold.pos.x + 2;
    me.pos.z = hold.pos.z;
    me.gold = 500000;
    me.level = Math.max(me.level, 20);
    // Spend something, so there is something to take back.
    me.attributes = { ...me.attributes, strength: (me.attributes.strength ?? 0) + 7 };
    me.skillRanks = { ...(me.skillRanks ?? {}) };
    g.hud.openVendor(hold.id);
    await new Promise((r) => setTimeout(r, 400));
    const row = document.querySelector('#vendor-stock .respec-row');
    const price = row ? (row.textContent ?? '') : '';

    // It has to say what it takes back before you press it.
    row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 500, clientY: 400 }));
    await new Promise((r) => setTimeout(r, 80));
    const tip = document.querySelector('#tip');
    const tipText = getComputedStyle(tip).display === 'none' ? '' : (tip.textContent ?? '');
    row?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    const goldBefore = me.gold;
    row?.click();
    await new Promise((r) => setTimeout(r, 400));

    // And no other trader offers it: the hold is a place, and a smith would
    // have no idea how.
    const smith = [...g.world.entities.values()].find(
      (e) => e.kind === 'vendor' && /keeper_\w+_ardnahoe/.test(e.vendorId ?? ''),
    );
    let smithOffers = null;
    if (smith) {
      g.hud.openVendor(smith.id);
      await new Promise((r) => setTimeout(r, 300));
      smithOffers = !!document.querySelector('#vendor-stock .respec-row');
    }
    g.hud.closeVendor();

    const gainedPoints = (me.unspentPoints ?? 0) - home.unspentPoints;
    const paidGold = goldBefore - me.gold;
    // Put the character back exactly as it was found.
    me.pos = home.pos;
    me.gold = home.gold;
    me.level = home.level;
    me.attributes = home.attributes;
    me.unspentPoints = home.unspentPoints;
    me.skillRanks = home.skillRanks;
    me.skillPoints = home.skillPoints;
    g.world.lastCombatTick.clear();
    await new Promise((r) => setTimeout(r, 200));

    return {
      ok: !!row,
      price,
      saysWhatItTakes: /attribute point/.test(tipText),
      gained: gainedPoints,
      paid: paidGold,
      smithOffers,
    };
  });

  // Armour you farm one camp for.
  //
  // The set bonus is the whole feature and it is invisible in a screenshot, so
  // this measures it the only way that proves anything: the derived stat block
  // with two pieces on against the same character with one. It also opens the
  // tooltip, because a bonus nobody can find out about is a bonus nobody farms
  // four hundred kills for.
  const sets = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const set = g.allSets().find((s) => s.zoneId === g.world.zone.id) ?? g.allSets()[0];
    if (!set) return { ok: false, why: 'no set in this zone' };

    const home = { ...me.equipment };
    const worn = (n) => {
      me.equipment = {};
      for (const slot of set.slots.slice(0, n)) me.equipment[slot] = `hoard_${set.zoneId}_${slot}`;
      return g.world.statsOf(me);
    };
    const one = worn(1);
    const two = worn(2);
    const four = worn(4);

    // The keeper who makes them up, and the camp that pays for them.
    const quests = Object.values(g.allQuests()).filter((q) => q.chain === `${set.zoneId}_hoard`);
    const keeper = [...g.world.entities.values()].find(
      (e) => e.kind === 'vendor' && e.vendorId === quests[0]?.giverVendorId,
    );

    // The tooltip on a piece, with two of them on: it has to say what the set
    // is, which half is live and which is not.
    me.equipment = {};
    for (const slot of set.slots.slice(0, 2)) me.equipment[slot] = `hoard_${set.zoneId}_${slot}`;
    g.world.addItem(me, { itemId: `hoard_${set.zoneId}_${set.slots[3]}`, qty: 1 });
    g.hud.toggleInventory();
    await new Promise((r) => setTimeout(r, 400));
    const cell = [...document.querySelectorAll('#inventory-body .bag-slot')].find((c) =>
      (c.textContent ?? '').includes(set.name),
    );
    cell?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 500, clientY: 400 }));
    await new Promise((r) => setTimeout(r, 80));
    const tip = document.querySelector('#tip');
    const text = getComputedStyle(tip).display === 'none' ? '' : (tip.textContent ?? '');
    const live = tip.querySelectorAll('.tip-up').length;
    const dark = tip.querySelectorAll('.tip-off').length;
    cell?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    // And the sheet says what it is paying right now.
    g.hud.toggleInventory();
    g.hud.toggleCharacter();
    await new Promise((r) => setTimeout(r, 400));
    const sheet = [...document.querySelectorAll('#character-body .stat-row')]
      .map((r) => r.textContent ?? '')
      .find((t) => t.includes(set.name));
    g.hud.toggleCharacter();

    me.equipment = home;
    me.inventory = (me.inventory ?? []).filter((st) => !st.itemId.startsWith('hoard_'));
    return {
      ok: true,
      set: set.name,
      // Two pieces pay something one does not, and four pays something two
      // does not. Which number moves depends on the set, so it watches the
      // whole derived block rather than a field this probe had to be told
      // about — the four sets deliberately pay in four different currencies.
      twoPays: moved(one, two),
      fourPays: moved(two, four),
      keeper: keeper ? keeper.name : null,
      steps: quests.length,
      saysTheSet: text.includes(set.name),
      live,
      dark,
      sheet: sheet ?? null,
    };

    function moved(a, b) {
      return ['maxHealth', 'moveSpeed', 'regenPerSec', 'critChance', 'defense', 'skillPower'].some(
        (k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 1e-6,
      );
    }
  });

  // Towns, and the leystone road between them.
  //
  // The whole feature is about *places*, so the probe walks the character into
  // one rather than pushing a synthetic event: the stone has to wake on its
  // own, from proximity, with no key pressed — which is the one thing about it
  // that could silently stop working and that nothing in the sim suite can see
  // (the panel and the keys live here).
  const leystones = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const home = { ...me.pos };
    const towns = g.world.zone.settlements ?? [];
    if (towns.length < 2) return { towns: towns.length };
    // The probe before this one killed something, and the road is closed while
    // anything is still on you. Six seconds of combat timeout is longer than
    // this probe takes, so without letting go of the fight first the whole
    // check measures the previous one.
    g.world.lastCombatTick.clear();
    g.world.submit(me.id, { t: 'target', id: null });
    g.world.submit(me.id, { t: 'autoAttack', on: false });

    // Stand in the first town. No key: walking in is the whole interaction.
    me.pos = { ...towns[0].pos };
    await new Promise((r) => setTimeout(r, 300));
    const first = !!g.world.stones[towns[0].id];

    // And the trader who lives there is actually standing in it.
    const keeper = [...g.world.entities.values()].find(
      (e) => e.kind === 'vendor' && e.vendorId === towns[0].vendorId,
    );
    const keeperNear = keeper
      ? Math.hypot(keeper.pos.x - towns[0].pos.x, keeper.pos.z - towns[0].pos.z) < 30
      : false;

    // Wake a second one so there is somewhere to step to.
    me.pos = { ...towns[2].pos };
    await new Promise((r) => setTimeout(r, 300));

    // Back to the first, and open the panel with the key rather than by hand:
    // a panel nobody can open is the bug this game has shipped twice.
    me.pos = { ...towns[0].pos };
    await new Promise((r) => setTimeout(r, 250));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    const panel = document.querySelector('#ley-window');
    const open = panel && getComputedStyle(panel).display === 'block';
    const rows = [...panel.querySelectorAll('.realm-row')];
    const text = rows.map((r) => r.textContent ?? '');
    // The panel has to be reachable by a pointer. `#hud` is pointer-events:
    // none so the world behind stays clickable, and anything that wants a
    // click has to say so — this has been the bug twice now.
    const clickable = rows.find((r) => r.classList.contains('clickable'));
    const pointer = clickable ? getComputedStyle(clickable).pointerEvents : 'none';

    // Step. The row does it, so this measures the control a player uses.
    const before = { ...me.pos };
    clickable?.click();
    await new Promise((r) => setTimeout(r, 500));
    const moved = Math.hypot(me.pos.x - before.x, me.pos.z - before.z);
    const atTown = towns.some(
      (t) => Math.hypot(me.pos.x - t.pos.x, me.pos.z - t.pos.z) < 3 && t.id !== towns[0].id,
    );

    // A stone you have never stood at is not on the road.
    const unknown = towns.find((t) => !g.world.stones[t.id]);
    g.world.submit(me.id, { t: 'leystone', stoneId: unknown ? unknown.id : 'nowhere' });
    await new Promise((r) => setTimeout(r, 200));
    const refused = !towns.some(
      (t) => t.id === (unknown && unknown.id) && Math.hypot(me.pos.x - t.pos.x, me.pos.z - t.pos.z) < 3,
    );

    // The stone is a thing you can see, not only a rule. It is a landmark, so
    // the renderer has to have put one where the sim says the town is.
    const built = g.rig.structures.filter((st) => st.kind === 'leystone').length;
    const onTown = g.rig.structures.some(
      (st) =>
        st.kind === 'leystone' &&
        towns.some((t) => Math.hypot(st.pos.x - t.pos.x, st.pos.z - t.pos.z) < 1),
    );

    // Put everything back. Leaving the character in a different town leaves
    // every check after this one measuring somewhere else — the lesson the
    // muster probe had to learn twice.
    if (panel) panel.style.display = 'none';
    me.pos = { ...home };
    me.targetId = null;
    me.threat = {};
    g.world.lastCombatTick.clear();
    await new Promise((r) => setTimeout(r, 200));

    return {
      towns: towns.length,
      first,
      keeperNear,
      open,
      rows: rows.length,
      pointer,
      moved,
      atTown,
      refused,
      built,
      onTown,
      names: text.slice(0, 3),
      // Every town says what it is for, which is the reason there is more
      // than one of them.
      roles: new Set(towns.map((t) => t.role)).size,
    };
  });

  // Nothing is drawn on the furniture.
  //
  // Six hundred creatures project onto a screen that already has panels on it,
  // and the first honest look at a first kill had an adventurer's nameplate
  // written across the minimap's clock. Checked as a rule over whatever the
  // run happens to have on screen rather than by contriving one plate: the
  // failure is a class, not a case.
  // With the character sheet open, because a translucent panel is the worst
  // case for this rather than an edge one: a plate behind it reads straight
  // through the numbers.
  await page.keyboard.press('c');
  await wait(400);
  const tidy = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    // Stand a ring of creatures round the player so there is something to
    // measure. Two plates on screen is not a test of anything; twelve spread
    // over the window puts some of them under the panels and some of them off
    // the edge, which is the whole point.
    const ring = [...g.world.entities.values()]
      .filter((e) => e.kind === 'mob' && !e.dead)
      .slice(0, 12);
    const home = ring.map((e) => ({ ...e.pos }));
    ring.forEach((e, i) => {
      const a = (i / ring.length) * Math.PI * 2;
      const r = 6 + (i % 3) * 5;
      e.pos = { x: me.pos.x + Math.sin(a) * r, z: me.pos.z + Math.cos(a) * r };
    });

    // And two put deliberately *under the panels*, because a ring at melee
    // range never lands there and a check that cannot fail is decoration. The
    // spot is solved rather than guessed: the same projection the plates use,
    // scanned over ground the player can see, for the position that lands in
    // the middle of the box. They keep their plates past the range cut because
    // one is the target and one is hunting the player, which are the two
    // things a plate always shows for.
    const cam = g.rig.camera;
    const scratch = cam.position.clone();
    const project = (x, z) => {
      scratch.set(x, g.rig.standAt(x, z) + 2, z).project(cam);
      if (scratch.z > 1) return null;
      return {
        x: (scratch.x * 0.5 + 0.5) * window.innerWidth,
        y: (-scratch.y * 0.5 + 0.5) * window.innerHeight,
      };
    };
    const aimAt = (sel) => {
      const el = document.querySelector(sel);
      if (!el || el.offsetParent === null) return null;
      const b = el.getBoundingClientRect();
      const want = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
      const len = Math.hypot(me.pos.x - cam.position.x, me.pos.z - cam.position.z) || 1;
      const fx = (me.pos.x - cam.position.x) / len;
      const fz = (me.pos.z - cam.position.z) / len;
      let best = null;
      let bestGap = 60;
      for (let ahead = 4; ahead <= 700; ahead += 6) {
        for (let side = -600; side <= 600; side += 6) {
          const x = me.pos.x + fx * ahead - fz * side;
          const z = me.pos.z + fz * ahead + fx * side;
          const at = project(x, z);
          if (!at) continue;
          const gap = Math.hypot(at.x - want.x, at.y - want.y);
          if (gap >= bestGap) continue;
          bestGap = gap;
          best = { x, z };
        }
      }
      return best;
    };

    // Two spots are aimed at rather than three: the character sheet is open
    // for this and any plate landing on it is counted, but its box moves with
    // whatever is in it and an aim that misses reports as the rule being
    // broken. Two that always land is a check with teeth; a third that
    // sometimes does not is a flake.
    const [onFrames, onMinimap] = ring;
    const framesSpot = aimAt('#player-frame');
    const miniSpot = aimAt('#minimap');
    if (onFrames && framesSpot) {
      onFrames.pos = framesSpot;
      g.world.submit(me.id, { t: 'target', id: onFrames.id });
    }
    if (onMinimap && miniSpot) {
      onMinimap.pos = miniSpot;
      onMinimap.targetId = me.id;
    }
    await new Promise((r) => setTimeout(r, 500));

    const boxes = [
      '#minimap',
      '#minimap-clock',
      '#player-frame',
      '#target-frame',
      '#tracker',
      '#right-panels',
      '#realm-window',
      '#journal-window',
      '#quest-log',
      '#vendor-window',
      '#map-panel',
      '#away-report',
      '#death-overlay',
      '#levelup',
      '#drop',
    ]
      .map((s) => document.querySelector(s))
      .filter(
        (el) =>
          el && el.offsetParent !== null && parseFloat(getComputedStyle(el).opacity) >= 0.05,
      )
      .map((el) => el.getBoundingClientRect());
    const plates = [...document.querySelectorAll('.nameplate')].filter(
      (p) => p.style.display === 'block',
    );
    const over = plates.filter((p) => {
      const r = p.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      return boxes.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
    });
    // And none of them running off the side of the window: a plate is centred
    // on the creature and does not wrap, so the end of a long name — which is
    // where the trait word is — falls off the edge.
    const clipped = plates.filter((p) => {
      const r = p.getBoundingClientRect();
      return r.left < -1 || r.right > window.innerWidth + 1;
    }).length;
    // Put them back, and let go of them. Leaving one with the player as its
    // target leaves it hunting them through the next three checks — the same
    // way the muster probe once left the character quietly farming hares.
    ring.forEach((e, i) => {
      e.pos = { ...home[i] };
      e.spawnPos = { ...home[i] };
      e.targetId = null;
      e.threat = {};
      e.aiState = 'idle';
    });
    g.world.submit(me.id, { t: 'target', id: null });
    g.world.lastCombatTick.clear();
    return {
      boxes: boxes.length,
      plates: plates.length,
      over: over.length,
      clipped,
      // Both aimed spots have to have been found, or nothing was ever put
      // where the check is looking.
      aimed: !!framesSpot && !!miniSpot,
    };
  });

  await page.keyboard.press('c');
  await wait(300);

  // Other people, fighting real things.
  //
  // They used to stand in a camp and fight it abstractly, which from sixty
  // metres is a person turning slowly on the spot beside eight creatures that
  // have not noticed them. What only a browser can say is whether the fight
  // reaches the screen: a swing animation, a creature that actually came, and
  // — the part the whole rule rests on — a creature handed straight back.
  const pulling = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const home = { x: me.pos.x, z: me.pos.z };
    const people = [...g.world.entities.values()].filter((e) => e.kind === 'npc');
    if (people.length === 0) return { ok: false, why: 'nobody in this zone' };

    // Out of the way, so nothing yields on account of the player standing
    // there — which is the behaviour being tested a few lines down.
    me.pos = { x: g.world.zone.halfSize - 40, z: g.world.zone.halfSize - 40 };

    // Watch a fight until somebody actually lands something — and if the one
    // being watched ends first, watch the next one.
    //
    // The first version committed to the first pair it found and reported "not
    // a real fight" whenever that particular fight happened to end in the
    // first sample: an adventurer worn down to `GIVE_UP_AT` walks away, and
    // one run in ten or so caught exactly that. The property under test is
    // that adventurers hurt real creatures, not that one specific fight did.
    const deadline = Date.now() + 45000;
    const inAFight = async () => {
      while (Date.now() < deadline) {
        const p = people.find((n) => n.npcFoe !== undefined);
        if (p) {
          const f = g.world.entity(p.npcFoe);
          if (f) return { who: p, foe: f };
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    };

    let hurt = false;
    let pair = null;
    let came = false;
    let anim = '';
    while (!hurt && Date.now() < deadline) {
      pair = await inAFight();
      if (!pair) break;
      const { who: fighter, foe: quarry } = pair;
      const watching = quarry.id;
      const max = g.world.statsOf(quarry).maxHealth;
      for (let i = 0; i < 80 && !hurt && Date.now() < deadline; i++) {
        await new Promise((r) => setTimeout(r, 100));
        hurt = quarry.health < max;
        if (fighter.npcFoe !== watching) break;
      }
      came = Math.hypot(quarry.pos.x - fighter.pos.x, quarry.pos.z - fighter.pos.z) < 12;
      anim = g.views.get(fighter.id)?.anim?.current ?? anim;
    }
    if (!pair) {
      me.pos = home;
      return { ok: false, why: 'nobody picked a fight in forty-five seconds' };
    }

    // And now the player is near enough to want it. Parked just inside the
    // yield and just outside the creature's own aggro: standing on top of it
    // measures the player killing it, which the first version of this did.
    //
    // Re-acquired rather than reusing the pair above, because that fight may
    // have ended on its own — and "the adventurer let go" is only worth
    // asserting about a fight that was still going when the player walked up.
    //
    // Retried across successive fights for the same reason the damage watch is:
    // a fight can end while the player is walking over, and an adventurer worn
    // down to `GIVE_UP_AT` walks away without handing anything back whole. That
    // is not the rule failing, it is a different fight.
    let handedBack = null;
    let foe = pair.foe;
    let who = pair.who;
    for (let attempt = 0; attempt < 3 && handedBack !== true && Date.now() < deadline; attempt++) {
      const live = await inAFight();
      if (!live) break;
      who = live.who;
      foe = live.foe;
      const max = g.world.statsOf(foe).maxHealth;
      const reach = g.mobOf(foe.defId).aggroRadius;
      me.pos = { x: foe.pos.x + reach + 18, z: foe.pos.z };
      await new Promise((r) => setTimeout(r, 700));
      handedBack = who.npcFoe === undefined && foe.health >= max - 0.5;
    }

    me.pos = home;
    return {
      ok: true,
      hurt,
      came,
      anim,
      handedBack,
      // Never theirs to finish, whatever else happens.
      alive: !foe.dead,
      foe: foe.name,
      by: who.name,
    };
  });

  // The level you just earned.  // The level you just earned.
  //
  // The payoff of the whole design, and until now one grey line in a nine-line
  // log — gone in seconds, usually mid-fight. What is worth asserting is not
  // that a card appeared but that it *says what changed*: a skill granted at a
  // level used to arrive by a box quietly ceasing to be grey.
  const levelling = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const was = { level: me.level, xp: me.xp, points: me.unspentPoints, skills: me.skillPoints };

    // A level that actually grants something, so the card has all three
    // things to say rather than only the points.
    const granted = Object.values(g.allSkills())
      .filter((sk) => sk.classId === me.classId && !sk.taughtBy && sk.reqLevel > 1)
      .sort((a, b) => b.reqLevel - a.reqLevel)[0];
    me.level = granted.reqLevel - 1;
    me.xp = Math.max(0, g.xpToNext(me.level) - 1);

    const victim = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    g.world.submit(me.id, { t: 'target', id: victim.id });
    g.world.submit(me.id, { t: 'autoAttack', on: true });
    const until = Date.now() + 20000;
    while (!victim.dead && Date.now() < until) {
      victim.pos = { x: me.pos.x + 2, z: me.pos.z };
      victim.health = 1;
      await new Promise((r) => setTimeout(r, 80));
    }
    g.world.submit(me.id, { t: 'autoAttack', on: false });
    await new Promise((r) => setTimeout(r, 800));

    const card = document.querySelector('#levelup');
    const shown = card.classList.contains('show') && getComputedStyle(card).opacity > 0.2;
    const head = document.querySelector('#levelup-level').textContent ?? '';
    const body = document.querySelector('#levelup-body').textContent ?? '';
    const keys = [...document.querySelectorAll('#levelup-body b')].map((b) => b.textContent);

    // And again at the level that opens the road out. A band's bottom is the
    // one number a player has no way of knowing they have reached, and the
    // alternative is walking to the end of the road and being turned back.
    const exit = g.world.zone.exits[0];
    let door = '';
    if (exit) {
      me.level = exit.minLevel - 1;
      me.xp = Math.max(0, g.xpToNext(me.level) - 1);
      const second = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
      g.world.submit(me.id, { t: 'target', id: second.id });
      g.world.submit(me.id, { t: 'autoAttack', on: true });
      const stop = Date.now() + 20000;
      while (!second.dead && Date.now() < stop) {
        second.pos = { x: me.pos.x + 2, z: me.pos.z };
        second.health = 1;
        await new Promise((r) => setTimeout(r, 80));
      }
      g.world.submit(me.id, { t: 'autoAttack', on: false });
      await new Promise((r) => setTimeout(r, 250));
      door = document.querySelector('#levelup-body').textContent ?? '';
    }

    me.level = was.level;
    me.xp = was.xp;
    me.unspentPoints = was.points;
    me.skillPoints = was.skills;
    return {
      saysTheDoor: !!exit && door.includes(exit.label),
      door: door.slice(0, 100),
      shown,
      head,
      reached: head.includes(String(granted.reqLevel)),
      saysPoints: /point/.test(body),
      saysTheSkill: body.includes(granted.name),
      // The key it sits on, which is the part that makes it findable.
      saysTheKey: keys.some((k) => /^(⇧?[0-9])$/.test(k ?? '')),
      skill: granted.name,
      body: body.slice(0, 140),
    };
  });

  // Eight grades of the same piece.
  //
  // The whole reason a boss stays worth killing: you have the Longsword, but
  // you have a Royal one and there is a Godly one. What only a browser can say
  // is whether the grade reaches the *player* — the name, the colour and the
  // comparison against what they are wearing.
  const grades = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const seen = { camp: new Set(), boss: new Set() };
    const roll = (mobId, n) => {
      const def = g.mobOf(mobId);
      const out = new Set();
      for (let i = 0; i < n; i++) {
        const mob = [...g.world.entities.values()].find((e) => e.kind === 'mob');
        if (!mob) break;
        const was = mob.defId;
        mob.defId = mobId;
        g.world.rollLootFor(mob, me);
        for (const st of mob.corpseLoot ?? []) {
          const tier = g.tierOf(st.itemId);
          if (tier) out.add(tier);
        }
        mob.defId = was;
      }
      void def;
      return out;
    };
    // A camp creature and a boss, many kills each: the question is which
    // grades each *can* produce, not which one this kill did.
    for (const t of roll('bog_wolf', 400)) seen.camp.add(t);
    for (const t of roll('old_scar', 400)) seen.boss.add(t);

    // And one on the ground, so the card and the bags say what it is.
    const prize = `godly__${Object.values(g.allItems()).find((it) => it.slot === 'weapon' && g.canUse(it.id) && !it.critBonus).id}`;
    const victim = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    victim.pos = { x: me.pos.x + 1, z: me.pos.z };
    victim.dead = true;
    victim.health = 0;
    victim.corpseLoot = [{ itemId: prize, qty: 1 }];
    victim.corpseGold = 1;
    victim.respawnInMs = 120000;
    // Cleared *before* the loot, not after. A card from an earlier probe is
    // still on screen for a couple of seconds, and a check that waits for "a
    // card is up" finds that one instantly and then reads somebody else's
    // prize off it — which is how this reported an epic when it had asked for
    // a rare.
    const before = document.querySelector('#drop');
    before.classList.remove('show');
    document.querySelector('#drop-name').textContent = '';
    await new Promise((r) => setTimeout(r, 60));
    g.world.submit(me.id, { t: 'loot', id: victim.id });
    // Waited *for*, not slept through. Nine hundred milliseconds is comfortably
    // past the five-hundred-and-fifty the card fades in over, and it still
    // failed about one run in ten — because the card only starts fading when
    // the loot event lands, and the kill it is waiting on is a real fight.
    const cardUp = async () => {
      const until = Date.now() + 6000;
      while (Date.now() < until) {
        const el = document.querySelector('#drop');
        if (el.classList.contains('show') && parseFloat(getComputedStyle(el).opacity) > 0.2) return;
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    await cardUp();
    const card = document.querySelector('#drop-name')?.textContent ?? '';

    const base = g.itemOf(prize.slice('godly__'.length));
    const godly = g.itemOf(prize);
    return {
      ok: true,
      camp: [...seen.camp],
      boss: [...seen.boss],
      // The rule: a camp never carries a boss grade and a boss never carries
      // a camp one.
      campStaysBelow: [...seen.camp].every((t) => !['royal', 'majestic', 'imperial', 'godly'].includes(t)),
      bossStaysAbove: [...seen.boss].every((t) => ['royal', 'majestic', 'imperial', 'godly'].includes(t)),
      // And it reaches the player as a name, not as an id.
      named: /^Godly /.test(card),
      stronger: (godly.damageMax ?? 0) > (base.damageMax ?? 0),
      card,
    };
  });

  // The drop that was worth the hour.
  //
  // A rare or an epic used to arrive as one grey line in a nine-line log,
  // which is exactly what a level used to do and wrong for the same reason.
  // What is worth asserting is the useful half: that it says whether the thing
  // beats what you are already wearing.
  const drop = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const items = g.allItems();
    const worn = me.equipment?.weapon ? g.itemOf(me.equipment.weapon) : null;
    // A weapon this character can actually use, so the card has a comparison
    // to make rather than a refusal.
    const prize = Object.values(items).find(
      (it) =>
        it.slot === 'weapon' &&
        (it.quality === 'rare' || it.quality === 'epic') &&
        g.canUse(it.id),
    );
    if (!prize) return { ok: false, why: 'no rare weapon for this class' };

    // Through the real event, from a real corpse: the card reads the loot
    // stream, and a hand-made event would prove only that the function works.
    const victim = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    victim.pos = { x: me.pos.x + 1, z: me.pos.z };
    victim.dead = true;
    victim.health = 0;
    victim.corpseLoot = [{ itemId: prize.id, qty: 1 }];
    victim.corpseGold = 3;
    victim.respawnInMs = 120000;
    // Cleared *before* the loot, not after. A card from an earlier probe is
    // still on screen for a couple of seconds, and a check that waits for "a
    // card is up" finds that one instantly and then reads somebody else's
    // prize off it — which is how this reported an epic when it had asked for
    // a rare.
    const before = document.querySelector('#drop');
    before.classList.remove('show');
    document.querySelector('#drop-name').textContent = '';
    await new Promise((r) => setTimeout(r, 60));
    g.world.submit(me.id, { t: 'loot', id: victim.id });
    // Waited *for*, not slept through. The card fades in over five hundred and
    // fifty milliseconds and the old fixed sleep of nine hundred still failed
    // about one run in ten, because the loot has to reach the event stream
    // first and that is a real tick rather than a promise.
    const until = Date.now() + 6000;
    while (Date.now() < until) {
      const el = document.querySelector('#drop');
      if (el.classList.contains('show') && parseFloat(getComputedStyle(el).opacity) > 0.2) break;
      await new Promise((r) => setTimeout(r, 80));
    }

    const card = document.querySelector('#drop');
    const shown = card.classList.contains('show') && getComputedStyle(card).opacity > 0.2;
    const name = document.querySelector('#drop-name')?.textContent ?? '';
    const body = document.querySelector('#drop-body')?.textContent ?? '';
    const colour = getComputedStyle(document.querySelector('#drop-name')).color;

    // And nothing at all for the four hundredth Wolf Pelt.
    card.classList.remove('show');
    const junk = Object.values(items).find((it) => it.merchantGood);
    const second = [...g.world.entities.values()].find(
      (e) => e.kind === 'mob' && !e.dead && e.id !== victim.id,
    );
    second.pos = { x: me.pos.x + 1, z: me.pos.z };
    second.dead = true;
    second.health = 0;
    second.corpseLoot = [{ itemId: junk.id, qty: 2 }];
    second.corpseGold = 1;
    second.respawnInMs = 120000;
    g.world.submit(me.id, { t: 'loot', id: second.id });
    await new Promise((r) => setTimeout(r, 600));
    const quiet = !document.querySelector('#drop').classList.contains('show');

    return {
      ok: true,
      shown,
      names: name === prize.name,
      quality: /^rgb/.test(colour) && colour !== 'rgb(232, 224, 200)',
      // The question a player actually asks of something they just picked up.
      compares: worn ? /against your|The same as your/.test(body) : /Nothing in that slot/.test(body),
      quiet,
      prize: prize.name,
      prizeId: prize.id,
      body: body.slice(0, 120),
    };
  });

  // And a picture of it, because a card nobody looks at is a card that can be
  // ugly for a year. Replayed through the HUD rather than by levelling again:
  // the state is already back where it was and putting it out twice is not
  // what is being photographed.
  await page.evaluate(() => {
    const g = window.__game;
    g.hud.handleEvents(
      [
        { t: 'levelUp', entityId: g.world.player.id, level: g.world.player.level },
        ...(g.hud.skillForSlot(6)
          ? [{ t: 'skillUnlocked', entityId: g.world.player.id, skillId: g.hud.skillForSlot(6) }]
          : []),
      ],
      g.camera,
    );
  });
  await page.evaluate((itemId) => {
    const g = window.__game;
    g.hud.handleEvents(
      [{ t: 'lootGained', entityId: g.world.player.id, items: [{ itemId, qty: 1 }], gold: 3 }],
      g.rig.camera,
    );
  }, drop.prizeId ?? null);
  await wait(500);
  await page.screenshot({ path: join(OUT, '20-levelup.png') });

  // The belt.
  //
  // Sixteen consumables, a two-clock cooldown system built so chaining them is
  // impossible, and a balance test measuring exactly how much they save you —
  // and until now no key drank one. The only way to reach the answer to a
  // fight going wrong was to open the backpack and click, which nobody has
  // ever done while something was hitting them.
  const belt = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const usable = (f) =>
      Object.values(g.allItems()).filter(
        (i) => i.consumable?.family === f && (i.reqLevel ?? 1) <= me.level,
      );
    const potion = usable('potion').pop();
    const elixir = usable('elixir').pop();
    if (!potion || !elixir) return { ok: false, why: 'nothing drinkable at this level' };
    me.inventory = [
      { itemId: potion.id, qty: 3 },
      { itemId: elixir.id, qty: 2 },
    ];
    me.consumableCooldowns = {};
    await new Promise((r) => setTimeout(r, 300));

    const slots = [...document.querySelectorAll('#belt .belt-slot')].map((s) => s.textContent ?? '');
    // Counted out of the bag, not read off the health bar: out of combat you
    // regenerate four percent a second, so "health went up" is true whether or
    // not the key did anything at all.
    const held = () => (me.inventory ?? []).find((s) => s.itemId === potion.id)?.qty ?? 0;
    const before = held();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const after = held();

    // And a second one has to be refused, or the two clocks mean nothing.
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));

    return {
      ok: true,
      slots,
      shown: slots.length === 2 && slots[0].includes(potion.name),
      drank: after < before,
      chained: held() < after,
      onCooldown: (me.consumableCooldowns?.potion ?? 0) > 0,
      // The panel's scroll needs the wheel to reach it: the HUD is
      // pointer-events: none, and the character sheet at level 24 is taller
      // than the space it has.
      panelReachable:
        getComputedStyle(document.querySelector('#right-panels')).pointerEvents !== 'none',
    };
  });

  // What a creature does that a stat block cannot.
  const traits = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    // A creature with a trait, targeted, so the frame and the plate both have
    // to say what it is.
    const withTrait = [...g.world.entities.values()].find(
      (e) => e.kind === 'mob' && !e.dead && g.traitFor(g.mobOf(e.defId)),
    );
    if (!withTrait) return { ok: false, why: 'nothing in this zone has a trait' };
    withTrait.pos = { x: me.pos.x + 3, z: me.pos.z };
    g.world.submit(me.id, { t: 'target', id: withTrait.id });
    await new Promise((r) => setTimeout(r, 400));
    const trait = g.traitFor(g.mobOf(withTrait.defId));
    const frame = document.querySelector('#target-threat').textContent ?? '';

    // And the frame's own tooltip, which carries the answer. The HUD is
    // `pointer-events: none` so the canvas behind it swallows a hover on any
    // panel nobody marked `hoverable` — the target frame's tip was unreachable
    // for a while and no assertion could see it, because the *text* was there.
    const el = document.querySelector('#target-frame');
    const box = el.getBoundingClientRect();
    const at = { clientX: box.left + 20, clientY: box.top + 10, bubbles: true };
    el.dispatchEvent(new MouseEvent('mouseenter', at));
    el.dispatchEvent(new MouseEvent('mousemove', at));
    await new Promise((r) => setTimeout(r, 80));
    const tipEl = document.querySelector('#tip');
    const tipText = tipEl.style.display === 'block' ? tipEl.textContent : '';
    el.dispatchEvent(new MouseEvent('mouseleave', at));
    const reachable = getComputedStyle(el).pointerEvents !== 'none';
    const plate = [...document.querySelectorAll('.nameplate.hostile .np-trait')]
      .map((n) => n.textContent)
      .filter(Boolean);
    return {
      ok: true,
      name: withTrait.name,
      trait: trait.id,
      // Both places, because the frame is what you read before pulling and the
      // plate is what you read while deciding which of four to pull.
      inFrame: frame.includes(trait.name),
      tipReachable: reachable,
      tipHasAnswer: tipText.includes(trait.answer),
      onPlate: plate.includes(trait.name),
      // And the answer, which is the half that makes it a mechanic.
      answer: trait.answer.length > 12,
    };
  });

  // The world between fights.
  //
  // Everything in a zone that moved used to be a health bar, and a world whose
  // only motion is a thing that wants to kill you reads as a shooting gallery
  // rather than as a place.
  const alive = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    let flocks = 0;
    let clouds = 0;
    let taggable = 0;
    g.rig.scene.traverse((o) => {
      if (!o.userData?.ambient) return;
      if (o.isInstancedMesh) flocks++;
      else if (o.isPoints) clouds++;
      // The one rule that has to hold: the click raycast resolves against
      // `entityId`, so a bird carrying one would be a bird you could target,
      // and a bird you can target is a bird somebody will try to kill.
      if (o.userData.entityId !== undefined) taggable++;
      o.traverse?.((c) => {
        if (c !== o && c.userData?.entityId !== undefined) taggable++;
      });
    });

    // Walk into one and watch it break up. Birds that only circle are
    // wallpaper; birds that scatter because you walked under them are the
    // cheapest possible proof that the world noticed you.
    const flock = g.rig.wildlife.flocksForTest()[0];
    const before = flock.centreForTest();
    me.pos = { x: before.x, z: before.z - 4 };
    g.rig.stream(me.pos.x, me.pos.z, true);
    await new Promise((r) => setTimeout(r, 1400));
    const after = flock.centreForTest();

    // And the camera has to stay above the water. It clamped to the lake BED,
    // so wading into a tarn put it under the surface and the screen went the
    // colour of the water plane.
    const field = g.rig.height;
    let underwater = 0;
    let checked = 0;
    for (let dx = -900; dx <= 900; dx += 90) {
      for (let dz = -900; dz <= 900; dz += 90) {
        if (!field.underwater(dx, dz)) continue;
        checked++;
        if (field.clearHeight(dx, dz) < field.at(dx, dz) + 0.001) underwater++;
      }
    }

    return {
      flocks,
      clouds,
      taggable,
      scattered: Math.round(Math.hypot(after.x - before.x, after.z - before.z)),
      lakePoints: checked,
      cameraUnderWater: underwater,
    };
  });

  // Things worth walking to.
  //
  // The sim half is covered by unit tests; what only a browser can answer is
  // whether the mark on an unopened landmark actually exists in the scene, and
  // whether opening one makes it go away.
  const found = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const site = g.world.openSites()[0];
    if (!site) return { ok: false, why: 'nothing to find in this zone' };

    const marks = () => {
      let n = 0;
      g.rig.scene.traverse((o) => {
        if (o.userData?.siteMark) n++;
      });
      return n;
    };
    me.pos = { x: site.pos.x, z: site.pos.z - 20 };
    g.rig.stream(me.pos.x, me.pos.z, true);
    await new Promise((r) => setTimeout(r, 700));
    const before = marks();

    me.pos = { x: site.pos.x, z: site.pos.z - 2 };
    const goldBefore = me.gold ?? 0;
    const effectsBefore = (me.effects ?? []).length;
    g.world.submit(me.id, { t: 'search' });
    await new Promise((r) => setTimeout(r, 500));
    const paid = (me.gold ?? 0) > goldBefore || (me.effects ?? []).length > effectsBefore;
    const after = marks();

    // And the buff row, which had no display at all before this.
    const pips = document.querySelectorAll('#effects .pip').length;
    return {
      ok: true,
      kind: site.kind,
      before,
      after,
      paid,
      pips,
      opened: g.world.found[site.id] === true,
      onMap: g.world.sites.some((s) => g.world.found[s.id]),
    };
  });

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
    // In front of the *camera*, not at a fixed offset from the player. A fixed
    // offset is behind the camera about half the time, and a nameplate that
    // does not project is a nameplate with no colour on it — which reads as
    // "the threat scale does nothing" and has nothing to do with the scale.
    const cam = g.rig.camera.position;
    const len = Math.hypot(me.pos.x - cam.x, me.pos.z - cam.z) || 1;
    const fx = (me.pos.x - cam.x) / len;
    const fz = (me.pos.z - cam.z) / len;
    mobs.forEach((e, i) => {
      const def = want[i];
      e.defId = def.id;
      e.name = def.name;
      e.level = def.level;
      e.pos = {
        x: me.pos.x + fx * 8 - fz * (i - 1) * 4,
        z: me.pos.z + fz * 8 + fx * (i - 1) * 4,
      };
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
    // Waited *for*, not slept through. Nine hundred milliseconds is comfortably
    // past the five-hundred-and-fifty the card fades in over, and it still
    // failed about one run in ten — because the card only starts fading when
    // the loot event lands, and the kill it is waiting on is a real fight.
    const cardUp = async () => {
      const until = Date.now() + 6000;
      while (Date.now() < until) {
        const el = document.querySelector('#drop');
        if (el.classList.contains('show') && parseFloat(getComputedStyle(el).opacity) > 0.2) return;
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    await cardUp();

    g.world.submit(me.id, { t: 'target', id: mobs[2].id });
    await new Promise((r) => setTimeout(r, 300));
    const deadly = document.querySelector('#target-threat').textContent;
    g.world.submit(me.id, { t: 'target', id: mobs[0].id });
    await new Promise((r) => setTimeout(r, 300));
    const trivial = document.querySelector('#target-threat').textContent;

    // Read while the lineup is still standing there. It used to be read after
    // they were put back out of reach, which measured whether a frame had
    // happened to run in between — three colours on a good day and none on a
    // bad one, decided by whatever the check before this one had done.
    const colours = [...document.querySelectorAll('.nameplate.hostile')]
      .filter((p) => p.style.display === 'block')
      .map((p) => p.querySelector('.np-name')?.style.color)
      .filter(Boolean);

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

  // What a point in an attribute buys.
  //
  // Two of the four used to be dead weight for most of the roster, and the
  // fix is only worth anything if a player can *see* which half of their bar
  // answers to the points they have spent.
  await page.keyboard.press('c');
  await wait(400);
  const build = await page.evaluate(async () => {
    const g = window.__game;
    const me = g.world.player;
    const hover = async (sel) => {
      const el = document.querySelector(sel);
      if (!el) return '';
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 400, clientY: 400 }));
      await new Promise((r) => setTimeout(r, 60));
      const tip = document.querySelector('#tip');
      const text = getComputedStyle(tip).display === 'none' ? '' : (tip.textContent ?? '');
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      return text;
    };

    const rows = [...document.querySelectorAll('#character-body .stat-row')];
    const find = (word) =>
      rows.findIndex((r) => (r.textContent ?? '').toLowerCase().startsWith(word));
    const at = find('strength');
    const attr = at >= 0 ? await hover(`#character-body .stat-row:nth-of-type(${at + 1})`) : '';

    // And a skill that names one, so the two halves agree.
    const scaled = Object.values(g.allSkills()).find(
      (sk) => sk.classId === me.classId && sk.scalesWith && !sk.taughtBy,
    );
    const slot = g.hud.skillForSlot(0) ? '#skill-bar .slot' : null;
    let skill = '';
    if (slot) {
      const slots = [...document.querySelectorAll('#skill-bar .slot')];
      const which = slots.find((el) => (el.textContent ?? '').includes(scaled?.name ?? '\u0000'));
      if (which) {
        which.dispatchEvent(
          new MouseEvent('mouseenter', { bubbles: true, clientX: 400, clientY: 400 }),
        );
        await new Promise((r) => setTimeout(r, 60));
        const tip = document.querySelector('#tip');
        skill = getComputedStyle(tip).display === 'none' ? '' : (tip.textContent ?? '');
        which.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      }
    }
    return {
      ok: attr.length > 0,
      // The attribute says what it buys and which skills it is worth to.
      saysWhatItBuys: /Damage on every swing|health a point|energy a point|crit a point/.test(attr),
      namesTheSkills: /% power on \d+ of your skills/.test(attr),
      // And the skill says which attribute it answers to.
      skillNamesIt: /(Strength|Dexterity|Focus|Vitality) skill — /.test(skill),
      skillSaysPower: /% power at your/.test(skill),
      scaled: scaled?.name ?? null,
      attr: attr.slice(0, 130),
      skill: skill.slice(0, 130),
    };
  });

  await page.keyboard.press('c');
  await wait(250);

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
    g.world.player.dead = false;
    g.world.player.health = g.world.statsOf(g.world.player).maxHealth;
    g.world.submit(g.world.player.id, { t: 'move', dir: { x: 0, z: 1 } });
    // The widest the leg gets from where it started, sampled across a whole
    // stride rather than read once at the end. A walk cycle is a cycle: the
    // single reading came back at the same angle it left about one run in
    // five, and reported that limbs do not move.
    let swung = 0;
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (leg) swung = Math.max(swung, Math.abs(leg.rotation.x - before));
    }
    const after = before + swung;
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
    // Off the deliberate line-up rather than off whatever happened to be on
    // screen when the snapshot was taken. The snapshot version failed about
    // one run in three — not because plates were broken but because the run
    // had wandered somewhere empty, which is a measurement of the walk.
    ['nameplates rendering', tidy.plates > 0],
    ['closed to weapon range', reached],
    ['combat happened', state.log.some((l) => /hit|slain|died/i.test(l ?? ''))],
    ['vendor shop opened', vendorOpened],
    ['quest accepted from trader', questAccepted],
    ['the trader takes the lot in one click', sellAll.ok && sellAll.cleared && sellAll.paid > 0],
    ['and never touches a piece of gear', sellAll.keptGear],
    ['an offer says what the work is', questOffer.ok && questOffer.saysTheJob],
    ['and why anybody wants it done', questOffer.saysWhy],
    ['and what it pays', questOffer.saysThePay],
    ['travelled to a second zone', travelled === 'ardmoor'],
    ['selling paid gold', soldSomething],
    ['boss telegraph rendered', sawTelegraph],
    ['every zone has its own sky', distinctSkies === 4],
    ['every zone resolved a theme', themesMatched],
    ['entities stand on the terrain', standingOnGround],
    ['and can be told apart from it', readable],
    ['a creature in a lake wades rather than walking the bottom', wading],
    ['the camera keeps its distance in the open', camera.ok && camera.open > camera.wanted * 0.7],
    ['and comes in rather than into a stone', camera.behind < camera.open * 0.75],
    ['landing outside the thing it avoided', camera.clearOf > 0],
    ['a camp notices when you empty it', muster.ok],
    ['and sends some of them, not all of them', muster.coming > 1 && muster.coming <= 5],
    ['the one who steps up is named for it', /Roused/.test(muster.champion ?? '')],
    ['and the player is actually told', /Roused/.test(muster.banner)],
    ['only one corpse offers the loot key', muster.prompts <= 1],
    ['a skill lights up when its moment arrives', timing.ok && timing.nearlyDead > 0],
    ['and is dark the rest of the time', timing.healthy === 0],
    ['an attribute says what it buys', build.ok && build.saysWhatItBuys],
    ['and which of your skills it is worth to', build.namesTheSkills],
    ['a skill says which attribute it answers to', build.skillNamesIt && build.skillSaysPower],
    ['a boss frame gives nothing away at first', kit.ok && kit.quietFirst],
    ['and names what it has actually shown you', kit.names],
    ['and what to do about it', kit.saysTheAnswer],
    ['you can put your own name to it', picked.box && named.name === SMOKE_NAME],
    ['and it is on your own frame', named.onFrame === SMOKE_NAME],
    ['the hold will take your points back', respec.ok && respec.gained >= 7],
    ['and says what it takes before you press it', respec.saysWhatItTakes],
    ['and charges for it', respec.paid > 0],
    ['a specialist will not', respec.smithOffers === false],
    ['a set can be farmed off one camp', sets.ok && sets.steps === 4],
    ['made up by the keeper in a town', !!sets.keeper],
    ['two pieces pay a bonus', sets.twoPays],
    ['and four pay another', sets.fourPays],
    ['a piece says what set it is part of', sets.saysTheSet],
    ['and which half of it is live', sets.live > 0 && sets.dark > 0],
    ['the sheet says what a set is paying', /\d \/ 4/.test(sets.sheet ?? '')],
    ['every zone has towns in it', leystones.towns >= 4 && leystones.towns <= 7],
    ['each selling something different', leystones.roles >= 3],
    ['a trader standing in each', leystones.keeperNear],
    ['a stone that is actually there', leystones.built >= 4 && leystones.onTown],
    ['walking in wakes it, with no key at all', leystones.first],
    ['the road opens on L', leystones.open && leystones.rows > 3],
    ['and can be clicked', leystones.pointer === 'auto'],
    ['stepping puts you at another town', leystones.moved > 50 && leystones.atTown],
    ['and never at one you have not stood in', leystones.refused],
    ['a kill is written down', reckoning.counted && reckoning.byBase],
    ['the panels have their own screen to themselves',
      tidy.boxes > 2 && tidy.plates > 4 && tidy.aimed && tidy.over === 0],
    ['and no plate runs off the side of the window', tidy.clipped === 0],
    ['somebody else pulls a real creature', pulling.ok && pulling.came],
    ['and it is a real fight', pulling.hurt && pulling.alive],
    ['and you get it back whole when you want it', pulling.handedBack === true],
    ['a camp never carries a boss grade', grades.ok && grades.campStaysBelow && grades.camp.length > 2],
    ['and a boss never carries a camp one', grades.bossStaysAbove && grades.boss.length > 2],
    ['a grade reaches the player by name', grades.named && grades.stronger],
    ['a rare drop is a moment, not a log line', drop.ok && drop.shown && drop.names],
    ['and says how it compares to what you wear', drop.compares],
    ['and the four hundredth pelt says nothing', drop.quiet],
    ['a level is a moment, not a log line', levelling.shown && levelling.reached],
    ['and says what it gave you', levelling.saysPoints],
    ['and names the skill it granted', levelling.saysTheSkill],
    ['and the key that skill sits on', levelling.saysTheKey],
    ['and the road that just opened', levelling.saysTheDoor],
    ['the reckoning adds it up', reckoning.total && reckoning.rows > 6],
    ['and says what the creature does', reckoning.saysTrait],
    ['the belt shows what you are carrying', belt.ok && belt.shown],
    ['a key drinks it', belt.drank],
    ['and the family cooldown refuses a second', belt.onCooldown && !belt.chained],
    ['the character sheet can be scrolled to the bottom', belt.panelReachable],
    ['a creature says what it does that a stat block cannot', traits.ok && traits.inFrame],
    ['and says it on its nameplate too', traits.onPlate],
    ['and the frame can actually be hovered', traits.tipReachable],
    ['and says what to do about it', traits.tipHasAnswer],
    ['there are birds in the sky', alive.flocks > 0],
    ['a flock breaks up when you walk into it', alive.scattered > 3],
    ['and nothing ambient can ever be targeted', alive.taggable === 0],
    ['the camera stays above the water', alive.lakePoints > 0 && alive.cameraUnderWater === 0],
    ['an unopened landmark is marked in the world', found.ok && found.before > 0],
    ['searching it pays', found.paid],
    ['and the mark goes away', found.after < found.before],
    ['what is on you is on the screen', found.kind !== 'boon' || found.pips > 0],
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
    ['the death screen says what killed you', /finished it/.test(deathUi.recap)],
    ['and how fast it happened', /% of you/.test(deathUi.recap)],
    ['the death screen says what it cost', /experience owed/i.test(deathUi.cost) && deathUi.shown],
    ['the debt is drawn on the xp bar', deathUi.debtBar > 0],
    ['the debt survives the respawn', reclaimed.owedAfterRespawn > 0],
    ['reclaiming from across the zone is refused', reclaimed.refused === true],
    ['walking back to the body clears it', reclaimed.owedNow === 0],
    ['the map opens', mapState.open === true],
    ['a click puts your own mark on it', marking.set && marking.inZone],
    ['the arrow takes the mark over the quest', marking.tracked && marking.turned],
    ['and says how far it is', marking.saysHowFar],
    ['clicking it again takes it off', unmarked.cleared && unmarked.backToQuest],
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
  console.log('camera:', JSON.stringify(camera), '| mark:', JSON.stringify(marking));
  console.log('muster:', JSON.stringify(muster), '| offer:', JSON.stringify(questOffer));
  console.log('timing:', JSON.stringify(timing));
  console.log('reckoning:', JSON.stringify(reckoning));
  console.log('leystones:', JSON.stringify(leystones));
  console.log('sets:', JSON.stringify(sets));
  console.log('respec:', JSON.stringify(respec), '| named:', JSON.stringify(named));
  console.log('levelling:', JSON.stringify(levelling));
  console.log('kit:', JSON.stringify(kit));
  console.log('build:', JSON.stringify(build));
  console.log('grades:', JSON.stringify(grades));
  console.log('drop:', JSON.stringify(drop), '| sell-all:', JSON.stringify(sellAll));
  console.log('pulling:', JSON.stringify(pulling), '| tidy:', JSON.stringify(tidy));
  console.log('belt:', JSON.stringify(belt));
  console.log('traits:', JSON.stringify(traits));
  console.log('alive:', JSON.stringify(alive));
  console.log('found:', JSON.stringify(found));
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
  console.log(
    'zones:',
    looks
      .map(
        (l) =>
          `${l.zone}/${l.theme} sky#${l.sky.toString(16)}` +
          ` ${l.contrast?.ok ? `${l.contrast.mob} ${l.contrast.body} v ground ${l.contrast.ground}` : (l.contrast?.why ?? '?')}`,
      )
      .join('\n       '),
  );
  if (errors.length || returningErrors.length)
    console.log('\nerrors:\n' + [...errors, ...returningErrors].join('\n'));
  console.log(`\nscreenshots in ${OUT}`);

  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

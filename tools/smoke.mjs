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
async function closeToTarget(page, timeoutMs = 8000) {
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

  const start = Date.now();
  let d = await gap();
  if (d === null) return false;
  while (d > 0 && Date.now() - start < timeoutMs) {
    await page.keyboard.down('w');
    await wait(220);
    await page.keyboard.up('w');
    d = await gap();
    if (d === null) return false;
  }
  await wait(400);
  return d <= 0;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const executablePath = findChromium();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

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

  // Walk into the boar camp.
  await page.keyboard.down('w');
  await wait(5200);
  await page.keyboard.up('w');
  await wait(400);
  await page.screenshot({ path: join(OUT, '02-approach.png') });

  // Target the nearest hostile and close to weapon range before swinging.
  //
  // Walking for a fixed number of seconds and hoping to stop inside reach is
  // luck: it left the run standing four metres short, logging "Out of range"
  // and reporting "no combat happened" as though the sim were broken.
  await page.keyboard.press('Tab');
  await wait(200);
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
  const rareLoot = await page.evaluate(async () => {
    const g = window.__game;
    const host = g.__rare;
    const rare = g.mobOf(host.defId);
    host.health = 1;
    g.world.submit(g.world.player.id, { t: 'autoAttack', on: true });
    await new Promise((r) => setTimeout(r, 1600));
    const loot = (host.corpseLoot ?? []).map((st) => g.itemOf(st.itemId));
    return {
      ok: host.dead && loot.some((i) => i.quality === 'epic'),
      name: rare.name,
      signature: loot.filter((i) => i.quality === 'epic').map((i) => i.name),
      // Named for what it carries: the creature's first word opens the item.
      namedForItem: loot.some((i) => i.name.startsWith(rare.name.split(' ')[0])),
    };
  });
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

  const wyrmDead = await page.evaluate(async () => {
    const g = window.__game;
    const def = g.dragons().find((d) => d.zoneId === 'fenmarch');
    const entity = [...g.world.entities.values()].find((e) => e.dragonId === def.id);
    if (!entity) return { ok: false, why: 'never turned up' };
    const holdingId = g.world.dragonState(def.id).holdingId;
    entity.health = 1;
    g.world.submit(g.world.player.id, { t: 'autoAttack', on: true });
    await new Promise((r) => setTimeout(r, 1800));
    const loot = (entity.corpseLoot ?? []).map((st) => g.itemOf(st.itemId));
    return {
      ok: entity.dead && g.world.dragonState(def.id).phase === 'slain' && !g.world.isSuppressed(holdingId),
      carried: loot.map((i) => i.name),
    };
  });

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

  await browser.close();

  const checks = [
    ['canvas present', state.canvas],
    // Exact kit contents are a unit-test concern; here we only care that the
    // bar rendered a plausible number of slots for the chosen class.
    ['skill bar built', state.slots >= 6],
    ['player health shown', /\d+ \/ \d+/.test(state.hp)],
    ['xp bar shown', /\d+ \/ \d+ XP/.test(state.xp)],
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
    ['a dragon took a holding', wyrm.inWorld && wyrm.phase === 'roosting'],
    ['the ground it landed on emptied', wyrm.groundEmptied && wyrm.suppressed],
    ['killing it handed the ground back', wyrmDead.ok],
    ['it carried something', (wyrmDead.carried ?? []).length > 0],
    ['a front changed hands', realm.ok],
    ['the new holder garrisons the ground', realm.garrisonAfter !== realm.garrisonBefore],
    ['realm panel opens', realmPanel.open],
    ['realm panel lists every front', realmPanel.fronts === 8],
    ['realm panel lists standing', realmPanel.standings === 5],
    ['armour line paid out its piece', armour.ok],
    ['armour line piece fits a slot', !!armour.slot],
    ['bounty spawn paid a windfall', bounty.ok],
    ['no page errors', errors.length === 0],
  ];

  console.log('\n--- smoke results ---');
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log('\nplayer:', state.hp, '| xp:', state.xp, '| target:', state.target);
  console.log('log tail:', state.log.slice(0, 6));
  console.log('horse:', JSON.stringify(horse), '| luxury:', JSON.stringify(luxury));
  console.log('dragon:', JSON.stringify(wyrm), JSON.stringify(wyrmDead));
  console.log('realm:', JSON.stringify(realm), '|', JSON.stringify(realmPanel));
  console.log('armour:', JSON.stringify(armour), '| bounty:', JSON.stringify(bounty));
  console.log('rare:', JSON.stringify({ ...rareCheck, ...rareLoot }), '| rare plates:', rarePlate);
  console.log('taught:', JSON.stringify(taught), '| bar:', JSON.stringify(bar));
  console.log('zones:', looks.map((l) => `${l.zone}/${l.theme} sky#${l.sky.toString(16)}`).join('  '));
  if (errors.length) console.log('\nerrors:\n' + errors.join('\n'));
  console.log(`\nscreenshots in ${OUT}`);

  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

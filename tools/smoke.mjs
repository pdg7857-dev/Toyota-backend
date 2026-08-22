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
    ['no page errors', errors.length === 0],
  ];

  console.log('\n--- smoke results ---');
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log('\nplayer:', state.hp, '| xp:', state.xp, '| target:', state.target);
  console.log('log tail:', state.log.slice(0, 6));
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

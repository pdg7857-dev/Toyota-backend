/**
 * The first five minutes, as a new player sees them.
 *
 * Everything else in this repository proves the game *works*. This one asks
 * the other question: standing at the standing stones with no idea what any of
 * this is, what can you actually tell? It walks the opening beats and
 * photographs each one, and prints what was on screen and how far away the
 * nearest thing to do was.
 *
 *   npm run build && npm run preview &
 *   node tools/firstrun.mjs
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.LOOK_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = join(process.cwd(), 'screenshots', 'firstrun');
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
await page.goto(URL, { waitUntil: 'networkidle' });
await wait(900);
await page.screenshot({ path: join(OUT, '0-class-select.png') });

await page.evaluate(() => document.querySelector('.cs-card').click());
await wait(1800);
await page.screenshot({ path: join(OUT, '1-spawn.png') });

const opening = await page.evaluate(() => {
  const g = window.__game;
  const me = g.world.player;
  const d = (e) => Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
  const mobs = [...g.world.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
  mobs.sort((a, b) => d(a) - d(b));
  const onScreen = [...g.views.all].filter((v) => v.group.visible).length;
  return {
    nearest: mobs[0] ? { name: mobs[0].name, away: Math.round(d(mobs[0])) } : null,
    within60: mobs.filter((m) => d(m) < 60).length,
    within120: mobs.filter((m) => d(m) < 120).length,
    onScreen,
    tracker: document.querySelector('#tracker')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200) ?? '(none)',
    help: document.querySelector('#help')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 250) ?? '(none)',
    log: document.querySelector('#log')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 250) ?? '(none)',
    skills: [...document.querySelectorAll('#skill-bar .slot, #skill-bar div')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20),
  };
});
console.log('spawn:', JSON.stringify(opening, null, 1));


// Walk down the road and take the first fight, which is the whole of what a
// new player is told to do.
const opening2 = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  const nearest = () => {
    let best = null, gap = Infinity;
    for (const e of g.world.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
      if (d < gap) { gap = d; best = e; }
    }
    return best;
  };
  const prey = nearest();
  me.pos = { x: prey.pos.x, z: prey.pos.z - 3 };
  g.world.submit(me.id, { t: 'target', id: prey.id });
  g.world.submit(me.id, { t: 'autoAttack', on: true });
  const until = Date.now() + 25000;
  while (!prey.dead && Date.now() < until) await new Promise((r) => setTimeout(r, 120));
  await new Promise((r) => setTimeout(r, 600));
  return {
    killed: prey.dead,
    xp: me.xp,
    gold: me.gold ?? 0,
    corpseGold: prey.corpseGold ?? 0,
    corpseLoot: (prey.corpseLoot ?? []).length,
  };
});
await wait(500);
await page.screenshot({ path: join(OUT, '2-first-kill.png') });
console.log('first kill:', JSON.stringify(opening2));
console.log('tracker now:', await page.evaluate(
  () => document.querySelector('#tracker')?.textContent?.replace(/\s+/g, ' ').trim() ?? '(none)',
));

await page.keyboard.press('f');
await wait(600);
await page.screenshot({ path: join(OUT, '3-looted.png') });
console.log('after loot:', await page.evaluate(() => ({
  gold: window.__game.world.player.gold ?? 0,
  bags: (window.__game.world.player.inventory ?? []).length,
  tracker: document.querySelector('#tracker')?.textContent?.replace(/\s+/g, ' ').trim() ?? '(none)',
})));


// A quarter of an hour in: what does the screen say to somebody who has been
// levelling for a while and has never read a wiki?
const midgame = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  me.level = 18;
  me.xp = 900;
  me.gold = 2400;
  await new Promise((r) => setTimeout(r, 700));
  const q = g.world.player.quests ?? [];
  return {
    quests: q.length,
    questLog: document.querySelector('#tracker')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 130),
    // Things a player at this point has probably never been told.
    skillPoints: me.skillPoints ?? 0,
    unspent: me.unspentPoints ?? 0,
    bags: (me.inventory ?? []).length,
    consumables: (me.inventory ?? []).filter((s) => g.itemOf(s.itemId).consumable).length,
    learned: (me.learnedSkills ?? []).length,
    stable: (me.stable ?? []).length,
  };
});
console.log('midgame:', JSON.stringify(midgame));

// Danger, and loot you can see from across a camp.
const danger = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  me.level = 10;
  // Three creatures spanning the scale, side by side in front of the camera.
  const all = Object.values(g.allMobs()).filter((m) => m.stars < 5 && !m.horse && !m.dragon);
  const pick = (lvl, stars) =>
    all.find((m) => m.level === lvl && m.stars === stars) ??
    all.reduce((b, m) => (Math.abs(m.level - lvl) < Math.abs(b.level - lvl) ? m : b));
  const want = [pick(2, 1), pick(10, 1), pick(18, 4)];
  const mobs = [...g.world.entities.values()].filter((e) => e.kind === 'mob' && !e.dead).slice(0, 3);
  const out = [];
  mobs.forEach((e, i) => {
    const def = want[i] ?? want[0];
    e.defId = def.id;
    e.name = def.name;
    e.level = def.level;
    e.pos = { x: me.pos.x + (i - 1) * 5, z: me.pos.z + 9 };
    e.spawnPos = { ...e.pos };
    e.health = g.world.statsOf(e).maxHealth;
    e.ai = 'idle';
    out.push(`${def.name} lv${def.level} ★${def.stars}`);
  });
  g.world.submit(me.id, { t: 'target', id: mobs[2].id });

  // And a corpse with something on it, well outside nameplate range.
  const far = [...g.world.entities.values()].find((e) => e.kind === 'mob' && !mobs.includes(e));
  far.pos = { x: me.pos.x + 26, z: me.pos.z + 20 };
  far.dead = true;
  far.corpseGold = 12;
  far.respawnInMs = 90000;

  // Nothing in this probe is a fight: the first version stood a level-10
  // character next to a ★4 and photographed the death screen.
  for (const def of g.allMobs()) def.aggroRadius = 0;
  const calm = setInterval(() => {
    for (const e of g.world.entities.values()) {
      if (e.kind === 'mob') { e.ai = 'idle'; e.target = null; }
    }
    me.dead = false;
    me.health = g.world.statsOf(me).maxHealth;
  }, 80);
  await new Promise((r) => setTimeout(r, 1200));
  clearInterval(calm);
  const marks = [...g.views.all].filter((v) => v.lootMark).length;
  return {
    lineup: out,
    plates: [...document.querySelectorAll('.nameplate.hostile')]
      .filter((p) => p.style.display === 'block')
      .map((p) => p.querySelector('.np-name')?.style.color)
      .filter(Boolean),
    threat: document.querySelector('#target-threat')?.textContent,
    lootMarks: marks,
  };
});
await wait(600);
await page.screenshot({ path: join(OUT, '7-danger.png') });
console.log('danger:', JSON.stringify(danger));

// A creature's trait, on the frame and on the plate.
await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  me.level = 12;
  for (const def of g.allMobs()) def.aggroRadius = 0;
  const wolves = Object.values(g.allMobs()).filter(
    (m) => g.traitFor(m)?.id === 'pack' && m.level <= 14 && m.stars < 5,
  );
  const mobs = [...g.world.entities.values()].filter((e) => e.kind === 'mob' && !e.dead).slice(0, 4);
  mobs.forEach((e, i) => {
    const def = wolves[0];
    e.defId = def.id;
    e.name = def.name;
    e.level = def.level;
    e.pos = { x: me.pos.x + (i - 1.5) * 3, z: me.pos.z + 7 };
    e.spawnPos = { ...e.pos };
    e.health = g.world.statsOf(e).maxHealth;
  });
  g.world.submit(me.id, { t: 'target', id: mobs[1].id });
  g.rig.stream(me.pos.x, me.pos.z, true);
  const calm = setInterval(() => {
    for (const e of g.world.entities.values()) if (e.kind === 'mob') { e.ai = 'idle'; e.targetId = null; }
    me.dead = false;
    me.health = g.world.statsOf(me).maxHealth;
  }, 80);
  await new Promise((r) => setTimeout(r, 1200));
  clearInterval(calm);
});
await page.evaluate(() => {
  const el = document.querySelector('#target-frame');
  const b = el.getBoundingClientRect();
  const at = { clientX: b.left + 30, clientY: b.top + 14, bubbles: true };
  el.dispatchEvent(new MouseEvent('mouseenter', at));
  el.dispatchEvent(new MouseEvent('mousemove', at));
});
await wait(400);
await page.screenshot({ path: join(OUT, '8-trait.png') });
console.log('trait:', await page.evaluate(() => ({
  frame: document.querySelector('#target-threat')?.textContent,
  tip: document.querySelector('#tip')?.textContent?.slice(0, 160),
})));

// Tooltips. Sixteen skill slots and a bagful of gear, and until now not one of
// them said what it was.
await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  me.level = 46;
  me.xp = 10;
  me.gold = 90000;
  // Something in the bag worth comparing against something worn.
  const weapons = Object.values(g.allItems()).filter((i) => i.slot === 'weapon' && g.canUse(i.id));
  me.inventory = weapons.slice(0, 3).map((i) => ({ itemId: i.id, qty: 1 }));
  me.equipment = { ...me.equipment, weapon: weapons[6]?.id ?? weapons[0].id };
});
await page.keyboard.press('i');
await wait(500);
const bagCell = await page.$('#inventory-body .bag-slot');
if (bagCell) {
  await bagCell.hover();
  await wait(400);
  await page.screenshot({ path: join(OUT, '4-item-tooltip.png') });
  console.log('item tip:', await page.evaluate(
    () => document.querySelector('#tip')?.textContent?.trim().slice(0, 200) ?? '(none)'));
} else {
  console.log('item tip: no bag cell found');
}
await page.keyboard.press('i');
await wait(300);

await page.hover('#skill-bar .skill-row:first-child .slot:nth-child(3)');
await wait(400);
await page.screenshot({ path: join(OUT, '5-skill-tooltip.png') });
console.log('skill tip:', await page.evaluate(
  () => document.querySelector('#tip')?.textContent?.trim().slice(0, 250) ?? '(none)'));

const locked = await page.$('#skill-bar .skill-row.secondary .slot:last-child');
if (locked) {
  await page.hover('#skill-bar .skill-row.secondary .slot:last-child');
  await wait(400);
  await page.screenshot({ path: join(OUT, '6-locked-tooltip.png') });
  console.log('locked tip:', await page.evaluate(
    () => document.querySelector('#tip')?.textContent?.trim().slice(0, 250) ?? '(none)'));
}


// The panels, at a point where a player has decisions to make.
await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  me.level = 24;
  me.unspentPoints = 12;
  me.skillPoints = 5;
  me.gold = 5400;
  me.xp = 400;
  for (const def of g.allMobs()) def.aggroRadius = 0;
  const items = Object.values(g.allItems()).filter((i) => g.canUse(i.id));
  me.inventory = items.slice(0, 10).map((i) => ({ itemId: i.id, qty: 1 }));
  await new Promise((r) => setTimeout(r, 600));
});
// Kill a few things first, so the reckoning has something in it.
await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  for (const def of g.allMobs()) def.aggroRadius = 0;
  const kinds = new Map();
  for (const e of g.world.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const def = g.mobOf(e.defId);
    if (def.stars >= 5 || def.horse) continue;
    kinds.set(def.id, (kinds.get(def.id) ?? 0) + 1);
  }
  // Straight into the record: this is a look at the panel, not a play session.
  me.slain = {};
  let n = 0;
  for (const [id] of [...kinds].slice(0, 9)) {
    const base = g.mobOf(id);
    me.slain[base.starOf ?? base.rareOf ?? id] = 6 + n * 37;
    n++;
  }
  me.record = { deaths: 4, biggestHit: 812, worstTaken: 344 };
  me.questsDone = ['fenmarch_story_1', 'fenmarch_story_2'];
  await new Promise((r) => setTimeout(r, 300));
});

for (const [key, name] of [['c', 'character'], ['i', 'inventory'], ['j', 'quests'], ['k', 'realm'], ['b', 'reckoning']]) {
  await page.keyboard.press(key);
  await wait(700);
  await page.screenshot({ path: join(OUT, `9-${name}.png`) });
  await page.keyboard.press(key);
  await wait(250);
}
console.log('panels: shot');

// The belt, and the character panel's reachable bottom.
console.log('belt:', await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  const usable = (f) =>
    Object.values(g.allItems()).filter(
      (i) => i.consumable?.family === f && (i.reqLevel ?? 1) <= me.level,
    );
  const potions = usable('potion');
  const elixirs = usable('elixir');
  me.inventory = [
    { itemId: potions[potions.length - 1].id, qty: 4 },
    { itemId: elixirs[0].id, qty: 2 },
  ];
  me.health = g.world.statsOf(me).maxHealth * 0.3;
  await new Promise((r) => setTimeout(r, 400));
  const slots = [...document.querySelectorAll('#belt .belt-slot')].map((s) => s.textContent);
  // Counted out of the bag, not read off the health bar: out of combat you
  // regenerate 4% a second, so "health went up" is true whether or not the key
  // did anything at all.
  const before = (me.inventory ?? []).find((s) => s.itemId === potions[potions.length - 1].id)?.qty ?? 0;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  const after = (me.inventory ?? []).find((s) => s.itemId === potions[potions.length - 1].id)?.qty ?? 0;
  const panel = document.querySelector('#right-panels');
  return {
    slots,
    drank: after < before,
    onCooldown: (me.consumableCooldowns?.potion ?? 0) > 0,
    panelScrolls: getComputedStyle(panel).pointerEvents !== 'none',
    itemLevel: potions[potions.length - 1].reqLevel,
    myLevel: me.level,
    log: document.querySelector('#log')?.textContent?.replace(/\s+/g, ' ').slice(-120),
  };
}));

// Consumables: can you drink one without opening a bag?
console.log('potions:', await page.evaluate(() => {
  const g = window.__game;
  const help = document.querySelector('#help')?.textContent ?? '';
  const potions = Object.values(g.allItems()).filter((i) => i.consumable);
  return {
    inGame: potions.length,
    helpMentions: /potion|drink|quaff/i.test(help),
    // Bound to anything?
    keys: help.match(/\b[A-Z]\b/g)?.join('') ?? '',
  };
}));

await browser.close();

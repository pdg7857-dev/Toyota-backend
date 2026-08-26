/**
 * Play it with a thumb.
 *
 * The fifth looking-at-it tool, and the one with the most to catch: a phone
 * changes the input scheme, the layout and the frame budget all at once, and
 * every check in `smoke` runs at 1440x810 with a mouse. It boots the real game
 * in a phone-sized viewport with touch emulation on, walks with the stick,
 * taps a creature, fires a skill, opens the panels through the pad, and
 * photographs all of it.
 *
 *   npm run build && npm run preview &
 *   node tools/mobile.mjs
 *
 * Writes into screenshots/mobile/.
 */
import { chromium, devices } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.MOBILE_URL ?? 'http://127.0.0.1:4173/?fresh&touch';
const OUT = process.env.MOBILE_OUT ?? join(process.cwd(), 'screenshots', 'mobile');
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

const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

// A phone, held sideways. Landscape is the assumed orientation — this is a
// game you steer with two thumbs — and it is also the harder case for the
// layout, because the height is what everything is anchored against.
const phone = devices['iPhone 13'];
const context = await browser.newContext({
  ...phone,
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(URL, { waitUntil: 'networkidle' });
await wait(900);
await page.screenshot({ path: join(OUT, '0-class-select.png') });

// The first screen has to be usable with a thumb before anything else is.
const csFits = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.cs-card')];
  const inner = document.querySelector('.cs-inner');
  return {
    cards: cards.length,
    // It scrolls rather than clipping: five class cards will never fit across
    // 844px, and a card you cannot reach is a class you cannot pick.
    reachable: !!inner && inner.scrollHeight >= inner.clientHeight,
    within: cards.every((c) => c.getBoundingClientRect().width > 40),
  };
});
check('the class picker is usable on a phone', csFits.cards === 5 && csFits.within);

await page.evaluate(() => document.querySelector('.cs-card').click());

// Wait for the world to be running, not for a stopwatch.
await page.waitForFunction(() => {
  const g = window.__game;
  return g && g.world && g.world.tickCount > 20 && g.rig?.structures !== undefined;
}, { timeout: 45000 });
await wait(600);

// Cap the frame budget probe at a sensible moment: standing at the arrival
// point looking into the zone, which is what a player actually sees.
const boot = await page.evaluate(() => ({
  touchClass: document.body.classList.contains('touch'),
  stick: !!document.querySelector('#stick'),
  pad: [...document.querySelectorAll('#touch-pad .touch-btn')].length,
  dpr: window.devicePixelRatio,
  bufferRatio: window.__game.rig.renderer.getPixelRatio(),
  helpHidden: getComputedStyle(document.querySelector('#help')).display === 'none',
}));
check('it knows it is a touch device', boot.touchClass && boot.stick);
check('and puts the verbs on screen', boot.pad >= 5);
check('the frame buffer is capped below the screen', boot.bufferRatio < boot.dpr);
check('the keyboard legend is gone', boot.helpHidden);

await page.screenshot({ path: join(OUT, '1-landscape.png') });

/** Drag a finger, in steps, so the game sees a real gesture rather than a jump. */
async function swipe(from, to, steps = 12, holdMs = 0) {
  // Playwright's touchscreen only taps, and what this game needs measured is a
  // *drag* — so the pointer events are dispatched directly, with the same
  // pointerType a real finger produces. Anything less than a real sequence of
  // moves is a jump, and a jump is exactly what the tap/look split has to tell
  // apart from a thumb.
  await page.evaluate(
    async ({ from, to, steps, holdMs }) => {
      const canvas = document.querySelector('canvas');
      const send = (type, x, y) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      send('pointerdown', from.x, from.y);
      for (let i = 1; i <= steps; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        send('pointermove', x, y);
        await new Promise((r) => setTimeout(r, 16));
      }
      if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 7,
          pointerType: 'touch',
          clientX: to.x,
          clientY: to.y,
          bubbles: true,
        }),
      );
    },
    { from, to, steps, holdMs },
  );
}

// --- the stick walks -----------------------------------------------------
const walked = await page.evaluate(() => {
  const p = window.__game.world.player;
  return { x: p.pos.x, z: p.pos.z };
});
await swipe({ x: 150, y: 250 }, { x: 150, y: 150 }, 10, 1400);
await wait(300);
const after = await page.evaluate(() => {
  const p = window.__game.world.player;
  return { x: p.pos.x, z: p.pos.z, stickGone: !document.querySelector('#stick').classList.contains('live') };
});
const distance = Math.hypot(after.x - walked.x, after.z - walked.z);
check('the stick walks the character', distance > 6);
check('and lets go when the thumb lifts', after.stickGone);

// --- a tap selects, a drag looks -----------------------------------------
const looked = await page.evaluate(() => window.__game.rig.yaw);
await swipe({ x: 640, y: 200 }, { x: 500, y: 210 }, 10);
await wait(200);
const yawNow = await page.evaluate(() => window.__game.rig.yaw);
check('a drag on the right looks around', Math.abs(yawNow - looked) > 0.2);

// A tap has to *select*, which is the thing a two-pixel drag threshold made
// impossible: a thumb never lands and lifts on the same pixel.
//
// It taps whichever creature is *already* nearest the middle of the looking
// half of the screen, rather than teleporting one into place. The first
// version moved a creature in front of the camera and asserted that exact
// creature came back — and got a Moor Hare instead, because the three the
// opening puts in plain sight were standing between the camera and it. The
// tap was working perfectly; the check was asking the wrong question. What is
// actually being tested is "a tap selects what is under it", so the answer is
// to tap what is under it.
const tapped = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  g.world.submit(me.id, { t: 'target', id: null });

  // Point the camera at the nearest creature first, the way a player would
  // before tapping it. Without this the probe tapped wherever the last swipe
  // happened to leave the camera looking, which is empty moor about half the
  // time — and "a tap selects nothing" is a true sentence about the wrong
  // thing. `smoke` learned this same lesson twice.
  let near = null;
  for (const e of g.world.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !g.views.get(e.id)) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (!near || d < near.d) near = { e, d };
  }
  if (!near) return { onScreen: false, why: 'nothing alive nearby' };
  g.rig.yaw = Math.atan2(near.e.pos.x - me.pos.x, near.e.pos.z - me.pos.z);
  g.rig.pitch = 0.5;
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 250));

  const v = g.views.get(near.e.id);
  const p = v.group.position.clone();
  p.y += g.mobOf(near.e.defId).view.height * 0.55;
  p.project(g.rig.camera);
  const x = (p.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
  return {
    id: near.e.id,
    name: near.e.name,
    x,
    y,
    // And in the half of the screen that looks rather than the third that
    // walks: a tap on the left puts a thumbstick down, which is correct
    // behaviour and not what this is measuring.
    onScreen: p.z < 1 && x > window.innerWidth * 0.45 && x < window.innerWidth - 20 && y > 30 && y < window.innerHeight - 40,
  };
});
if (tapped.onScreen) {
  await swipe({ x: tapped.x, y: tapped.y }, { x: tapped.x + 4, y: tapped.y + 3 }, 3);
  await wait(300);
}
const selected = await page.evaluate((meant) => {
  const g = window.__game;
  const id = g.world.player.targetId;
  const e = id !== null ? g.world.entity(id) : null;
  return { id, meant, name: e?.name ?? null };
}, tapped.id ?? null);
check('a tap selects what is under it', tapped.onScreen && selected.id === tapped.id);

await page.screenshot({ path: join(OUT, '2-targeted.png') });

// --- a skill fires from a tap --------------------------------------------
//
// With whatever was selected pulled into reach first: a melee skill with its
// target twenty metres away does not fail to *fire*, it fails to be allowed,
// and this check is about the button rather than about the range rule.
const cast = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  const target = me.targetId !== null ? g.world.entity(me.targetId) : null;
  if (target) target.pos = { x: me.pos.x + 1.5, z: me.pos.z };
  await new Promise((r) => setTimeout(r, 250));
  const slot = document.querySelector('#skill-bar .slot');
  const box = slot.getBoundingClientRect();
  const before = Object.values(me.skillCooldowns ?? {}).filter((v) => v > 0).length;
  slot.click();
  await new Promise((r) => setTimeout(r, 500));
  const after = Object.values(me.skillCooldowns ?? {}).filter((v) => v > 0).length;
  return {
    fired: after > before,
    hadTarget: !!target,
    big: box.width >= 36 && box.height >= 36,
    onScreen: box.right < window.innerWidth + 1 && box.left > -1,
  };
});
check('a skill slot is big enough to hit', cast.big);
check('and every one of them is on screen', cast.onScreen);
check('tapping one casts it', cast.fired);

// Nothing on screen names a key this device does not have.
//
// The one instruction a new player gets is on a nameplate and it said "press F
// to loot". A phone has no F, and that is not a wording problem — it is the
// only instruction on screen naming a control that does not exist.
const wording = await page.evaluate(() => {
  const g = window.__game;
  const me = g.world.player;
  // The nearest one, and given time to *arrive*: views interpolate, so a
  // creature moved across the zone has no nameplate on screen for the best
  // part of a second and the check reads as "nothing says anything".
  // Whatever is selected — the tap probe above has already aimed the camera at
  // it, so its plate is definitely on screen. Killed properly, with a respawn
  // timer: a corpse with `respawnInMs` at zero is a corpse the sim stands back
  // up on the next tick, which is the same trap the dragon tests fell into.
  const corpse = me.targetId !== null ? g.world.entity(me.targetId) : null;
  if (!corpse) return { prompts: [], beltKeys: 0, tracker: '', anyPressKey: false, why: 'no target' };
  corpse.pos = { x: me.pos.x + 1.5, z: me.pos.z };
  corpse.dead = true;
  corpse.aiState = 'dead';
  corpse.respawnInMs = 120000;
  corpse.corpseLoot = [{ itemId: 'wolf_pelt', qty: 1 }];
  corpse.corpseGold = 3;
  return new Promise((done) =>
    setTimeout(() => {
      const plates = [...document.querySelectorAll('.nameplate')]
        .filter((n) => n.style.display !== 'none')
        .map((n) => n.textContent ?? '');
      const belt = [...document.querySelectorAll('#belt .belt-key')].length;
      const tracker = document.querySelector('#tracker-body')?.textContent ?? '';
      done({
        prompts: plates.filter((t) => /to loot/.test(t)),
        beltKeys: belt,
        tracker,
        anyPressKey: plates.some((t) => /press [A-Z]\b/.test(t)),
        plates: plates.slice(0, 6),
        corpse: { name: corpse.name, dead: corpse.dead, loot: (corpse.corpseLoot ?? []).length },
      });
    }, 1400),
  );
});
check('no nameplate names a key', !wording.anyPressKey);
check('the loot prompt says tap', wording.prompts.some((t) => /tap to loot/.test(t)));
check('the belt shows no hotkey letters', wording.beltKeys === 0);


// --- the pad reaches everything ------------------------------------------
const pad = await page.evaluate(async () => {
  const more = document.querySelector('#touch-pad .touch-more');
  more.click();
  await new Promise((r) => setTimeout(r, 200));
  const menu = document.querySelector('#touch-menu');
  const open = menu.classList.contains('open');
  const buttons = [...menu.querySelectorAll('.touch-btn')].map((b) => b.getAttribute('aria-label'));
  // Bags, through the menu, the way a player would.
  const bags = [...menu.querySelectorAll('.touch-btn')].find(
    (b) => b.getAttribute('aria-label') === 'Bags',
  );
  bags.click();
  await new Promise((r) => setTimeout(r, 350));
  const panel = document.querySelector('#inventory-window');
  const box = panel.getBoundingClientRect();
  return {
    open,
    buttons,
    closed: !menu.classList.contains('open'),
    panelShown: getComputedStyle(panel).display === 'block',
    // The panels are anchored hundreds of pixels from the right edge on a
    // desktop; on a phone they have to become a card over the game instead.
    fits: box.right <= window.innerWidth + 1 && box.left >= -1 && box.height <= window.innerHeight,
  };
});
check('the menu reaches every panel', pad.open && pad.buttons.length >= 10);
check('and closes when you choose one', pad.closed);
check('a panel fits on the screen', pad.panelShown && pad.fits);

await page.screenshot({ path: join(OUT, '3-bags.png') });
await page.evaluate(() => window.__game.hud.toggleInventory());

// --- and it looks like a game being played -------------------------------
//
// Levelled and healed first. The probe walks a level-1 character into a Moor
// Hare and taps a skill at it, which is a fair fight it loses about half the
// time — so the picture at the end of the run was a death screen rather than
// the HUD this whole change is about.
await page.evaluate(() => {
  const g = window.__game;
  const me = g.world.player;
  me.dead = false;
  me.level = 12;
  me.health = g.world.statsOf(me).maxHealth;
  me.energy = g.world.statsOf(me).maxEnergy;
});
await wait(400);

// --- the map -------------------------------------------------------------
await page.evaluate(() => window.__game.map.toggle());
await wait(500);
const mapFits = await page.evaluate(() => {
  const el = document.querySelector('#map-panel');
  const box = el.getBoundingClientRect();
  return {
    open: getComputedStyle(el).display !== 'none',
    fits: box.width <= window.innerWidth && box.height <= window.innerHeight,
  };
});
check('the map fits the screen', mapFits.open && mapFits.fits);
await page.screenshot({ path: join(OUT, '4-map.png') });
await page.evaluate(() => window.__game.map.close());

// --- nothing runs off the edge -------------------------------------------
const spill = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('#hud > *, #touch-pad, #stick')) {
    if (el.offsetParent === null && el.id !== 'stick') continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.right > window.innerWidth + 2 || b.left < -2 || b.bottom > window.innerHeight + 2) {
      out.push(`${el.id || el.className}: ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
  }
  return out;
});
check('nothing on the HUD runs off the screen', spill.length === 0);

// --- what a frame costs ---------------------------------------------------
const frame = await page.evaluate(async () => {
  const g = window.__game;
  g.rig.renderer.info.reset();
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  return {
    drawCalls: g.rig.renderer.info.render.calls,
    triangles: g.rig.renderer.info.render.triangles,
    entities: g.world.entities.size,
  };
});
// The same budget the desktop check uses. A phone GPU is a fraction of a
// laptop's, so the honest number to hold is not "the same as before" but
// "well under what a mid-range phone draws without dropping frames".
check('a frame is inside the phone budget', frame.drawCalls > 0 && frame.drawCalls < 450);

await page.screenshot({ path: join(OUT, '5-playing.png') });

// --- portrait, which somebody will hold it in anyway ----------------------
await page.setViewportSize({ width: 390, height: 844 });
await wait(700);
const portrait = await page.evaluate(() => {
  const card = document.querySelector('#rotate');
  return {
    asks: getComputedStyle(card).display !== 'none',
    text: (card.textContent ?? '').replace(/\s+/g, ' ').trim(),
    // And the game is still running behind it, so turning back is instant.
    ticking: window.__game.world.tickCount,
  };
});
await wait(400);
const stillTicking = await page.evaluate(() => window.__game.world.tickCount);
check('held upright, it asks you to turn it', portrait.asks);
check('and keeps running behind the card', stillTicking > portrait.ticking);
await page.screenshot({ path: join(OUT, '6-portrait.png') });

check('no page errors', errors.length === 0);

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log('');
console.log('boot:', JSON.stringify(boot), '| wording:', JSON.stringify(wording));
console.log('walk:', distance.toFixed(1), '| yaw moved:', (yawNow - looked).toFixed(2));
console.log('tap:', JSON.stringify(tapped), '-> target', JSON.stringify(selected));
  console.log('cast:', JSON.stringify(cast));
console.log('pad:', JSON.stringify(pad));
console.log('frame:', JSON.stringify(frame));
if (spill.length) console.log('spill:', spill.join(' | '));
console.log('portrait:', JSON.stringify(portrait));
if (errors.length) console.log('errors:', errors.slice(0, 5).join(' | '));
console.log(`\nscreenshots in ${OUT}`);

await browser.close();
process.exitCode = failed > 0 ? 1 : 0;

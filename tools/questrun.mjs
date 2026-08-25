/**
 * Play the quest chain, and watch what a player is actually told.
 *
 * The chains are the only thing in the game that gives a zone direction, and
 * every test of them so far has been about whether they *complete*. This asks
 * the other question: standing there having just accepted one, do you know
 * what you are meant to do, and does the game tell you when you have done it?
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.LOOK_URL ?? 'http://127.0.0.1:4173/?fresh';
const OUT = join(process.cwd(), 'screenshots', 'quests');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const c = join(root, d, 'chrome-linux', 'chrome');
    if (existsSync(c)) return c;
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
await page.waitForFunction(() => window.__game && window.__game.world.tickCount > 8, null, { timeout: 40000 });
await wait(600);

// Walk to the trader and take the work.
const took = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  for (const def of g.allMobs()) def.aggroRadius = 0;
  const trader = g.world.zone.vendors.find((v) => v.vendorId !== 'ceallach');
  me.pos = { x: trader.pos.x, z: trader.pos.z - 3 };
  await new Promise((r) => setTimeout(r, 500));
  return { vendorId: trader.vendorId };
});
await page.keyboard.press('e');
await wait(900);
await page.screenshot({ path: join(OUT, '1-vendor.png') });

const offered = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#vendor-quests > *')];
  return rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean);
});
console.log('offered:', JSON.stringify(offered));

// Accept everything on offer.
const clicks = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#vendor-quests .quest-row')];
  for (const row of rows) row.click();
  return { rows: rows.length, open: getComputedStyle(document.querySelector('#vendor-window')).display };
});
console.log('clicks:', JSON.stringify(clicks));
await wait(900);
await page.keyboard.press('Escape');
await wait(400);

const accepted = await page.evaluate(() => {
  const g = window.__game;
  return {
    quests: (g.world.player.quests ?? []).map((q) => {
      const def = g.questOf(q.questId);
      return {
        name: def.name,
        chain: def.chain,
        objectives: def.objectives.map((o) => o.text),
        counts: q.counts,
      };
    }),
    tracker: document.querySelector('#tracker')?.textContent?.replace(/\s+/g, ' ').trim(),
  };
});
console.log('accepted:', JSON.stringify(accepted, null, 1));

await page.keyboard.press('j');
await wait(500);
await page.screenshot({ path: join(OUT, '2-quest-log.png') });
console.log('log:', await page.evaluate(
  () => document.querySelector('#quest-log-body')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 320)));
await page.keyboard.press('j');

// Finish the first objective and see what the game says.
const done = await page.evaluate(async () => {
  const g = window.__game;
  const me = g.world.player;
  const p = (me.quests ?? [])[0];
  if (!p) return { ok: false, why: 'nothing accepted' };
  const def = g.questOf(p.questId);
  const o = def.objectives[0];
  if (o.kind === 'kill') {
    // Complete it the way a player would, but faster.
    for (let n = 0; n < o.count; n++) {
      const victim = [...g.world.entities.values()].find(
        (e) => e.kind === 'mob' && !e.dead && (g.mobOf(e.defId).starOf ?? e.defId) === o.mobId,
      );
      if (!victim) break;
      victim.pos = { x: me.pos.x + 2, z: me.pos.z };
      g.world.submit(me.id, { t: 'target', id: victim.id });
      g.world.submit(me.id, { t: 'autoAttack', on: true });
      const until = Date.now() + 8000;
      while (!victim.dead && Date.now() < until) {
        victim.health = 1;
        await new Promise((r) => setTimeout(r, 60));
      }
    }
    g.world.submit(me.id, { t: 'autoAttack', on: false });
  }
  await new Promise((r) => setTimeout(r, 400));
  return {
    ok: true,
    objective: o.text,
    counts: (me.quests ?? [])[0]?.counts,
    complete: g.world.isQuestComplete(me, p.questId),
    tracker: document.querySelector('#tracker')?.textContent?.replace(/\s+/g, ' ').trim(),
    log: document.querySelector('#log')?.textContent?.replace(/\s+/g, ' ').trim().slice(-200),
  };
});
console.log('after killing:', JSON.stringify(done, null, 1));
await page.screenshot({ path: join(OUT, '3-objective-done.png') });

if (errors.length) {
  console.log('PAGE ERRORS');
  for (const e of errors) console.log('  ' + e);
}
await browser.close();

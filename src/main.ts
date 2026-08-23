import { World } from './sim/world.js';
import { TICK_MS } from './sim/formulas.js';
import { CLASSES, FENMARCH } from './content/zone.js';
import { canEquip, getItem } from './content/items.js';
import { getMob } from './content/mobs.js';
import { getQuest } from './content/quests.js';
import { getHolding } from './content/factions.js';
import { getVendor } from './content/vendors.js';
import { SceneRig } from './render/scene.js';
import { ViewManager } from './render/views.js';
import { Hud } from './render/hud.js';
import { InputController } from './render/input.js';
import { chooseClass } from './render/classSelect.js';
import type { ClassId, Command, SimEvent } from './sim/types.js';

const SAVE_KEY = 'emerald-isle:save:v1';
const AUTOSAVE_MS = 10000;

/**
 * Wiring and the game loop.
 *
 * The loop is a fixed-timestep accumulator: the sim advances in exact TICK_MS
 * steps regardless of frame rate, and rendering interpolates between the last
 * two ticks. That decoupling is what keeps the sim deterministic — and it is
 * the same structure a network client uses against server snapshots.
 */
async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app missing');

  const params = new URLSearchParams(location.search);
  const fresh = params.has('fresh');

  // Resume a save if there is one; otherwise pick a class before building the
  // world, since class decides starting attributes, weapon and skill bar.
  let loaded = fresh ? null : loadSavedWorld();
  if (!loaded) {
    const forced = params.get('class');
    const classId =
      forced && forced in CLASSES ? (forced as ClassId) : await chooseClass(container);
    loaded = newWorld(classId);
  }
  // Bind to a const so the closures below see a non-null World.
  const world = loaded;

  const rig = new SceneRig(container, world.zone);
  // Sampled through the rig rather than captured, so it follows the zone the
  // player is actually standing in after travel.
  const views = new ViewManager(rig.scene, world, (x, z) => rig.heightAt(x, z));
  const emit = (cmd: Command): void => {
    world.submit(world.playerId, cmd);
  };
  const hud = new Hud(container, world, emit, (x, z) => rig.heightAt(x, z));
  const input = new InputController(rig.renderer.domElement, world, rig, hud, emit);

  views.sync();
  views.pushTick();

  hud.log('You wake at the standing stones on the edge of the Fenmarch.', 'log-good');
  hud.log('Click a beast to attack. Press T to toggle auto-attack.', 'log-loot');

  let accumulator = 0;
  let lastFrame = performance.now();
  let sinceSave = 0;

  function frame(now: number): void {
    requestAnimationFrame(frame);
    // Clamp so an alt-tabbed tab doesn't fast-forward hundreds of ticks at once.
    const dtMs = Math.min(120, now - lastFrame);
    lastFrame = now;
    accumulator += dtMs;

    // Reconcile the scene against the zone the sim is actually in, rather than
    // waiting to be told. Travel emits a `zoneChanged` event, but anything that
    // moves the world out of band — a debug jump, a load — does not, and a
    // renderer showing the wrong zone's ground is not a subtle failure. This is
    // the same posture a network client takes: trust state, not notification.
    if (rig.zoneId !== world.zone.id) {
      rig.loadZone(world.zone);
      views.reset();
    }

    views.sync();

    while (accumulator >= TICK_MS) {
      input.update();
      const events = world.tick();
      views.pushTick();
      applyEventsToViews(events);
      hud.handleEvents(events, rig.camera);
      accumulator -= TICK_MS;
    }

    const alpha = accumulator / TICK_MS;
    views.update(alpha, dtMs);
    rig.update(dtMs);

    const playerView = views.get(world.playerId);
    if (playerView) rig.updateCamera(playerView.group.position);

    hud.update(rig.camera);
    rig.render();

    sinceSave += dtMs;
    if (sinceSave >= AUTOSAVE_MS) {
      sinceSave = 0;
      save(world);
    }
  }

  /** Sim events drive animation. This is the seam real clips plug into. */
  function applyEventsToViews(events: SimEvent[]): void {
    for (const ev of events) {
      switch (ev.t) {
        case 'swing':
          views.get(ev.sourceId)?.anim.request('attack');
          break;
        case 'castBegin':
          views.get(ev.sourceId)?.anim.request('cast');
          break;
        case 'castComplete':
        case 'castInterrupted':
          views.get(ev.sourceId)?.anim.request('idle');
          break;
        case 'telegraph':
          // The danger circle is the whole reason the ability is dodgeable —
          // it has to be on screen for the entire wind-up.
          views.addTelegraph(ev.sourceId, ev.radius, ev.durationMs);
          break;
        case 'damage':
          views.get(ev.targetId)?.onDamaged();
          break;
        case 'death':
          views.get(ev.entityId)?.anim.request('death');
          break;
        case 'spawn':
          views.get(ev.entityId)?.anim.reset();
          break;
      }
    }
  }

  // Debug handle. Lets `tools/smoke.mjs` drive the game to a specific scene
  // (a boss fight, a given level) without a save-scumming detour, and gives you
  // a console foothold when something looks wrong in play. Read-only as far as
  // the game is concerned — anything that mutates should go through `submit`.
  (window as unknown as Record<string, unknown>).__game = {
    world,
    views,
    rig,
    hud,
    // Content lookups, so a test can ask what a trader stocks or what an item
    // does without reaching into module internals from the page.
    vendorStock: (vendorId: string) => getVendor(vendorId).stock,
    itemOf: (itemId: string) => getItem(itemId),
    canUse: (itemId: string) => canEquip(getItem(itemId), world.player.classId),
    mobOf: (mobId: string) => getMob(mobId),
    questOf: (questId: string) => getQuest(questId),
    holdingOf: (holdingId: string) => getHolding(holdingId),
  };

  window.addEventListener('beforeunload', () => save(world));
  requestAnimationFrame(frame);
}

function loadSavedWorld(): World | null {
  try {
    const json = localStorage.getItem(SAVE_KEY);
    if (json) return World.deserialize(json, FENMARCH);
  } catch (err) {
    // A corrupt or outdated save must never be a hard failure — start over.
    console.warn('Could not load save, starting fresh:', err);
  }
  return null;
}

function newWorld(classId: ClassId): World {
  return new World({ seed: 20260821, zone: FENMARCH, classId, playerName: 'Wanderer' });
}

function save(world: World): void {
  try {
    localStorage.setItem(SAVE_KEY, world.serialize());
  } catch (err) {
    console.warn('Save failed:', err);
  }
}

void boot();

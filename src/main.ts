import { World } from './sim/world.js';
import { TICK_MS, xpToNext } from './sim/formulas.js';
import { CLASSES, FENMARCH } from './content/zone.js';
import { ITEMS, canEquip, getItem } from './content/items.js';
import { MOBS, getMob } from './content/mobs.js';
import { bodyPlanFor, weaponLookFor } from './content/bodies.js';
import { DAY_LENGTH_MS } from './content/daylight.js';
import { getQuest } from './content/quests.js';
import { getHolding } from './content/factions.js';
import { DRAGONS } from './content/dragons.js';
import { getVendor } from './content/vendors.js';
import { SceneRig } from './render/scene.js';
import { ViewManager } from './render/views.js';
import { Hud } from './render/hud.js';
import { MapView } from './render/map.js';
import { GameAudio } from './render/audio.js';
import { InputController } from './render/input.js';
import { chooseClass } from './render/classSelect.js';
import type { ClassId, Command, SimEvent } from './sim/types.js';

const SAVE_KEY = 'emerald-isle:save:v1';
const AUTOSAVE_MS = 10000;

/** Most world time one frame may advance. See the clamp in `frame`. */
const MAX_FRAME_MS = 500;

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
  const restored = fresh ? null : loadSavedWorld();
  let loaded = restored?.world ?? null;
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
  const views = new ViewManager(
    rig.scene,
    world,
    (x, z) => rig.standAt(x, z),
    // The fog is the horizon, and the weather moves it.
    () => ((rig.scene.fog as { far?: number } | null)?.far ?? 500) * 1.08,
    rig.camera,
  );
  const emit = (cmd: Command): void => {
    world.submit(world.playerId, cmd);
  };
  const hud = new Hud(
    container,
    world,
    emit,
    (x, z) => rig.standAt(x, z),
    () => rig.yaw,
  );
  // The map reads the rig through thunks rather than being handed the zone's
  // terrain: travel rebuilds all of it, and a map holding the old zone's height
  // field is a map of somewhere you are not.
  const map = new MapView(container, world, {
    heightOf: () => rig.height,
    themeOf: () => rig.theme,
    structuresOf: () => rig.structures,
    yawOf: () => rig.yaw,
  });
  // Sound is a third subscriber to the same event stream the HUD and the views
  // read — it calls nothing and mutates nothing, so a muted game and a loud one
  // simulate identically.
  const audio = new GameAudio(world);
  const input = new InputController(rig.renderer.domElement, world, rig, hud, emit, map, audio);

  // Browsers refuse to start an AudioContext before a gesture, and one created
  // too early stays suspended with no error — the game is just silent and
  // nothing says why. Any first interaction will do.
  const wake = (): void => {
    audio.start();
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);

  views.sync();
  views.pushTick();

  // The opening, and only for somebody who has not had one.
  //
  // It used to greet a returning level-90 in Caer Dubh with "you wake at the
  // standing stones on the edge of the Fenmarch", which is both wrong and the
  // most patronising line in the game to read after eight hours of play.
  if (!restored) {
    hud.log(`You wake at the standing stones on the edge of ${world.zone.name}.`, 'log-good');
    hud.log('There is something grazing down the road. Click it, then press T.', 'log-loot');
  } else {
    hud.log(`Back in ${world.zone.name}.`, 'log-good');
  }

  // Run the hours since the save was written. Reading the clock is the *host's*
  // job — `sim/` never looks at one — so the elapsed span goes in as a plain
  // number, which is exactly the shape a server would use to tell a
  // reconnecting client what it missed.
  if (restored) {
    hud.showAwayReport(world.catchUp(Date.now() - restored.savedAt));
  }

  let accumulator = 0;
  let lastFrame = performance.now();
  let sinceSave = 0;

  function frame(now: number): void {
    requestAnimationFrame(frame);
    // Clamp so an alt-tabbed tab doesn't fast-forward hundreds of ticks at once.
    //
    // 120ms was too tight and the failure it caused is invisible until you
    // measure it: a machine drawing four frames a second can only ever advance
    // 480ms of world per second, so the whole game runs at a quarter speed —
    // walking, swinging, respawns, everything — and looks like a game that is
    // simply slow rather than one that is losing time. Half a second still
    // caps a minimised tab at nothing, and lets a struggling renderer keep up.
    const dtMs = Math.min(MAX_FRAME_MS, now - lastFrame);
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
      audio.handleEvents(events);
      accumulator -= TICK_MS;
    }

    const alpha = accumulator / TICK_MS;
    views.update(alpha, dtMs);
    rig.update(dtMs);
    rig.updateWildlife(dtMs, world.player.pos.x, world.player.pos.z);

    const playerView = views.get(world.playerId);
    if (playerView) rig.updateCamera(playerView.group.position, views.takeShake(dtMs));

    // The sky follows the world clock, which is sim state — so it survives a
    // save and a fortnight's catch-up without the renderer holding a clock of
    // its own. Set before the camera update so the shadow frustum picks up the
    // new sun height in the same frame.
    rig.setSky(world.daylight(), world.weather());

    hud.update(rig.camera);
    map.update(dtMs);
    audio.update();
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
          // The danger shape is the whole reason the ability is dodgeable —
          // it has to be on screen for the entire wind-up, and it has to be
          // the *right* shape: a circle means "get further away", a wedge
          // means "get round the side", and they are not interchangeable.
          views.addTelegraph(
            ev.sourceId,
            ev.radius,
            ev.durationMs,
            ev.shape === 'cone' && ev.facing !== undefined && ev.arc !== undefined
              ? { facing: ev.facing, arc: ev.arc }
              : undefined,
            ev.at,
          );
          break;
        case 'hazard':
          views.addHazard(ev.id, ev.at, ev.radius, ev.durationMs);
          break;
        case 'hazardGone':
          views.removeHazard(ev.id);
          break;
        case 'damage':
          views.get(ev.targetId)?.onDamaged();
          // And a flash where it landed. The floating number says how much;
          // this says where, how hard, and with what.
          views.addImpact(ev.targetId, ev.amount, ev.crit, ev.damageType);
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
    map,
    audio,
    // Content lookups, so a test can ask what a trader stocks or what an item
    // does without reaching into module internals from the page.
    vendorStock: (vendorId: string) => getVendor(vendorId).stock,
    itemOf: (itemId: string) => getItem(itemId),
    canUse: (itemId: string) => canEquip(getItem(itemId), world.player.classId),
    mobOf: (mobId: string) => getMob(mobId),
    bodyPlanFor: (mobId: string) => bodyPlanFor(getMob(mobId)),
    dayLengthMs: DAY_LENGTH_MS,
    allMobs: () => Object.values(MOBS),
    allItems: () => ITEMS,
    weaponLookFor,
    /**
     * One item per weapon silhouette, for `tools/bestiary.mjs`. A shape nobody
     * ever looks at is a shape nobody notices is wrong.
     */
    weaponLooks: () => {
      const seen = new Map<string, string>();
      for (const item of Object.values(ITEMS)) {
        if (item.slot !== 'weapon') continue;
        const look = weaponLookFor(item.name, item.classes?.[0]);
        if (!seen.has(look)) seen.set(look, item.id);
      }
      return [...seen].map(([look, itemId]) => ({ look, itemId }));
    },
    questOf: (questId: string) => getQuest(questId),
    holdingOf: (holdingId: string) => getHolding(holdingId),
    dragons: () => DRAGONS,
    /**
     * Render the sound graph offline and report its peak.
     *
     * Lives here because "did it make a sound" is otherwise unanswerable on a
     * machine with no sound card — which is every CI runner and the browser
     * `smoke` drives. A live AudioContext on such a machine has a clock that
     * does not reliably advance, so measuring one reports a working
     * synthesiser as silence about half the time. Rendered offline, the same
     * graph produces exact samples.
     */
    audioProbe: async (event: SimEvent, seconds = 1.5) => {
      const off = new OfflineAudioContext(1, Math.round(48000 * seconds), 48000);
      const probe = new GameAudio(world);
      probe.start(off);
      probe.handleEvents([event]);
      const rendered = await off.startRendering();
      const samples = rendered.getChannelData(0);
      let peak = 0;
      let energy = 0;
      for (const v of samples) {
        peak = Math.max(peak, Math.abs(v));
        energy += v * v;
      }
      return { peak: +peak.toFixed(4), rms: +Math.sqrt(energy / samples.length).toFixed(5) };
    },
    // Try a model without a rebuild. This is the loop somebody iterating on
    // art actually wants: export, refresh the file, paste one line, look at it.
    tryModel: (key: string, def: { file: string; scale?: number; turn?: number; lift?: number } | null) =>
      views.tryModel(key, def),
    xpToNext: (level: number) => xpToNext(level),
  };

  window.addEventListener('beforeunload', () => save(world));
  requestAnimationFrame(frame);
}

/**
 * A save, plus when it was written.
 *
 * The timestamp lives out here rather than in `World.serialize` because the sim
 * is not allowed to know what time it is. The host stamps it, the host works
 * out the gap, and the sim is handed a duration.
 */
interface SavedGame {
  world: World;
  savedAt: number;
}

function loadSavedWorld(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { savedAt?: number; world?: string };
    const json = typeof envelope.world === 'string' ? envelope.world : raw;
    return {
      world: World.deserialize(json, FENMARCH),
      // An unstamped save is one written before the world moved on its own.
      // Treat it as having been written just now: inventing an absence and
      // handing the player a changed map they were never away from is worse
      // than skipping the catch-up once.
      savedAt: envelope.savedAt ?? Date.now(),
    };
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
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ savedAt: Date.now(), world: world.serialize() }),
    );
  } catch (err) {
    console.warn('Save failed:', err);
  }
}

void boot();

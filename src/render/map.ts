import type { World } from '../sim/world.js';
import type { Entity, Vec2 } from '../sim/types.js';
import { isBoss, type StarRating } from '../sim/types.js';
import { threatBand, threatGap, type ThreatBand } from '../sim/formulas.js';
import type { ZoneDef } from '../content/zone.js';
import type { HeightField, ZoneTheme } from '../content/terrain.js';
import type { StructureDef } from '../content/structures.js';
import { clockOf, type WeatherKind } from '../content/daylight.js';
import { getMob } from '../content/mobs.js';
import { getVendor } from '../content/vendors.js';
import { FACTIONS, holdingsIn } from '../content/factions.js';
import { roadPoints } from '../content/zone.js';

/**
 * The minimap, and the map.
 *
 * A zone is three kilometres across and takes ten minutes to walk. Before this
 * the only way to find anything was the quest arrow, which points at exactly
 * one thing — so every other question a player has ("where is a camp my level",
 * "which way is the shop", "how far is the boss", "what is that tower") had no
 * answer except walking until you found out. That is not exploration, it is
 * being lost.
 *
 * Both views are drawn from the same **relief bitmap**, rendered once per zone:
 * the minimap is a crop of it, the map is the whole thing scaled down. One
 * expensive thing, built at the moment the zone banner is already covering a
 * load, rather than two cheap things that disagree about what the ground looks
 * like.
 *
 * Renderer-only, like terrain and landmarks. Nothing here is authoritative; it
 * reads world state and draws it.
 */

/** Pixels across the relief bitmap. The whole zone, at ~5 units per pixel. */
const RELIEF = 640;

/**
 * How near a click has to land to the mark already down to mean "take it off"
 * rather than "put it there", in full-map pixels.
 *
 * Generous, because the alternative to a forgiving clear is a player stacking
 * marks they cannot get rid of.
 */
const MARK_CLEAR_PX = 26;

/** How much ground the minimap shows, as a radius in world units. */
const MINIMAP_RANGE = 190;

/** Minimap size on screen, in CSS pixels. */
const MINIMAP_SIZE = 178;

/**
 * How dangerous a creature is to you, as a colour.
 *
 * The five-step read every tab-target game uses, because on the map it is the
 * only thing that answers "can I fight that": a dot's colour is a decision,
 * its position is only a fact.
 *
 * The band itself comes from `sim/formulas.ts` so the map, the nameplate over
 * the creature's head and the target frame cannot disagree about what a thing
 * is worth — which they did, because the map read the level gap and the
 * nameplate read nothing at all.
 */
export const THREAT_COLOURS: Record<ThreatBand, string> = {
  deadly: '#e05a4a',
  dangerous: '#e0913f',
  even: '#e3d24a',
  easy: '#66b04a',
  trivial: '#8a8f86',
};

function threatColour(gap: number): string {
  return THREAT_COLOURS[threatBand(gap)]!;
}

/** One word each, because it goes under a 178px circle. */
const WEATHER_WORD: Record<WeatherKind, string> = {
  clear: 'clear',
  overcast: 'overcast',
  rain: 'rain',
  mist: 'mist',
  snow: 'snow',
};

interface MapDeps {
  heightOf: () => HeightField;
  themeOf: () => ZoneTheme;
  structuresOf: () => StructureDef[];
  yawOf: () => number;
}

export class MapView {
  private readonly root: HTMLDivElement;
  private readonly mini: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D;
  private readonly panel: HTMLDivElement;
  private readonly full: HTMLCanvasElement;
  private readonly fullCtx: CanvasRenderingContext2D;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;

  /** The whole zone's ground, drawn once. Both views are crops of this. */
  private relief: HTMLCanvasElement | null = null;
  /**
   * The road, from the same function the renderer paints it with.
   *
   * Baked into the relief bitmap rather than drawn over the top, so it shows on
   * the minimap as well as the map without either view knowing about it —
   * and so the two can never disagree about where the road goes.
   */
  private road: Vec2[] = [];
  private reliefZone = '';
  private open = false;
  /**
   * Somewhere the player decided to go.
   *
   * Renderer state, and not saved. It is a note rather than a fact about the
   * world — the sim has no opinion about where you meant to walk, and a mark
   * you set twenty minutes ago and then closed the game on is not a plan any
   * more. Cleared when the zone changes for the same reason.
   */
  mark: Vec2 | null = null;
  /** Redraw throttle for the minimap: the ground under it does not move fast. */
  private sinceDraw = 0;

  constructor(
    container: HTMLElement,
    private readonly world: World,
    private readonly deps: MapDeps,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'map-layer';
    this.root.innerHTML = `
      <div id="minimap">
        <canvas id="minimap-canvas" width="${MINIMAP_SIZE * 2}" height="${MINIMAP_SIZE * 2}"></canvas>
        <div id="minimap-zone"></div>
        <div id="minimap-clock"></div>
        <div id="minimap-key">M</div>
      </div>
      <div id="map-panel" class="map-hidden">
        <header><h3 id="map-title">Map</h3><button id="map-close">×</button></header>
        <div id="map-canvas-wrap"><canvas id="map-canvas" width="1120" height="1120"></canvas></div>
        <div id="map-hint"></div>
      </div>`;
    container.appendChild(this.root);

    this.mini = this.root.querySelector<HTMLCanvasElement>('#minimap-canvas')!;
    this.miniCtx = this.mini.getContext('2d')!;
    this.panel = this.root.querySelector<HTMLDivElement>('#map-panel')!;
    this.full = this.root.querySelector<HTMLCanvasElement>('#map-canvas')!;
    this.fullCtx = this.full.getContext('2d')!;
    this.title = this.root.querySelector<HTMLElement>('#map-title')!;
    this.hint = this.root.querySelector<HTMLElement>('#map-hint')!;
    this.root.querySelector('#map-close')!.addEventListener('click', () => this.toggle());
    this.root.querySelector('#minimap')!.addEventListener('click', () => this.toggle());
    // The map is the only place a mark goes down. The minimap is a click that
    // already means "open the map", and a control that does two things
    // depending on how hard you meant it is a control nobody trusts.
    this.full.addEventListener('click', (ev) => this.clickMap(ev));
    this.full.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.mark = null;
      this.drawFull();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
    this.panel.classList.toggle('map-hidden', !this.open);
    if (this.open) this.drawFull();
  }

  close(): void {
    if (!this.open) return;
    this.toggle();
  }

  /**
   * Put a mark down, or take the one that is there off.
   *
   * The whole of the navigation in this game was an arrow pointing at one
   * quest objective. Every other question a player asks of three kilometres of
   * ground — "that tower I saw", "the camp I have to come back to when I can
   * handle it", "where the boat was" — had no answer but remembering. A mark
   * is the player's own arrow, and it is worth about as much as the quest one
   * for a tenth of the machinery.
   */
  private clickMap(ev: MouseEvent): void {
    const rect = this.full.getBoundingClientRect();
    if (rect.width <= 0) return;
    const size = this.full.width;
    // Canvas pixels, not CSS pixels: the map is drawn at 1120 and displayed at
    // whatever the panel is wide.
    const px = ((ev.clientX - rect.left) / rect.width) * size;
    const py = ((ev.clientY - rect.top) / rect.height) * size;

    if (this.mark) {
      const [mx, my] = this.toFull(this.mark, size);
      if (Math.hypot(px - mx, py - my) <= MARK_CLEAR_PX) {
        this.mark = null;
        this.drawFull();
        return;
      }
    }
    const half = this.world.zone.halfSize;
    this.mark = {
      x: (px / size) * half * 2 - half,
      z: (py / size) * half * 2 - half,
    };
    this.drawFull();
  }

  /** World point to full-map pixels. The inverse of what `clickMap` reads. */
  private toFull(p: Vec2, size: number): [number, number] {
    const half = this.world.zone.halfSize;
    return [((p.x + half) / (half * 2)) * size, ((p.z + half) / (half * 2)) * size];
  }

  /** Called every frame. Cheap unless the zone changed or the map is open. */
  update(dtMs: number): void {
    const zone = this.world.zone;
    if (this.reliefZone !== zone.id) {
      this.buildRelief(zone);
      this.mark = null;
    }
    this.sinceDraw += dtMs;
    if (this.sinceDraw >= 100) {
      this.sinceDraw = 0;
      this.drawMini();
      if (this.open) this.drawFull();
    }
  }

  // ------------------------------------------------------------------ relief

  /**
   * Draw the whole zone's ground into an offscreen bitmap.
   *
   * Roughly 400,000 height samples, which is a visible hitch — so it happens
   * exactly once per zone, behind the zone banner, and never again. Shading is
   * a slope term against a fixed north-west light: the same trick a paper
   * contour map uses, and the only thing that makes a hill legible in plan.
   */
  private buildRelief(zone: ZoneDef): void {
    const height = this.deps.heightOf();
    const theme = this.deps.themeOf();
    const canvas = document.createElement('canvas');
    canvas.width = RELIEF;
    canvas.height = RELIEF;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(RELIEF, RELIEF);
    const data = img.data;

    const span = zone.halfSize * 2;
    const step = span / RELIEF;
    const water = theme.terrain.waterLevel;
    const dry = rgb(theme.ground.dry);
    const damp = rgb(theme.ground.damp);
    const wet = rgb(theme.water?.color ?? 0x2f4a5c);
    const amp = Math.max(
      1,
      theme.terrain.amplitude +
        (theme.terrain.mountains?.amplitude ?? 0) * (theme.terrain.mountains?.mask ?? 0),
    );

    // One extra row and column of samples, so every pixel has a neighbour to
    // take a slope from without sampling the height field twice per pixel.
    const rows = new Float32Array((RELIEF + 1) * (RELIEF + 1));
    for (let j = 0; j <= RELIEF; j++) {
      const z = -zone.halfSize + j * step;
      for (let i = 0; i <= RELIEF; i++) {
        rows[j * (RELIEF + 1) + i] = height.at(-zone.halfSize + i * step, z);
      }
    }

    for (let j = 0; j < RELIEF; j++) {
      for (let i = 0; i < RELIEF; i++) {
        const h = rows[j * (RELIEF + 1) + i]!;
        const dx = rows[j * (RELIEF + 1) + i + 1]! - h;
        const dz = rows[(j + 1) * (RELIEF + 1) + i]! - h;
        // Light from the north-west, the convention every relief map uses.
        const shade = Math.max(0.45, Math.min(1.35, 1 + (dx + dz) * 0.34));
        const t = Math.max(0, Math.min(1, 0.5 - h / amp));
        let r: number, g: number, b: number;
        if (water !== undefined && h < water) {
          // Deeper water reads darker, which is what makes a lake look like a
          // basin rather than a blue sticker.
          const depth = Math.max(0, Math.min(1, (water - h) / 9));
          r = wet[0] * (1 - depth * 0.4);
          g = wet[1] * (1 - depth * 0.4);
          b = wet[2] * (1 - depth * 0.4);
        } else {
          r = (dry[0] + (damp[0] - dry[0]) * t) * shade;
          g = (dry[1] + (damp[1] - dry[1]) * t) * shade;
          b = (dry[2] + (damp[2] - dry[2]) * t) * shade;
        }
        const o = (j * RELIEF + i) * 4;
        data[o] = Math.max(0, Math.min(255, r));
        data[o + 1] = Math.max(0, Math.min(255, g));
        data[o + 2] = Math.max(0, Math.min(255, b));
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // The road, drawn straight onto the relief.
    this.road = roadPoints(zone.id, zone.theme);
    if (this.road.length > 1) {
      const px = (p: Vec2): [number, number] => [
        ((p.x + zone.halfSize) / span) * RELIEF,
        ((p.z + zone.halfSize) / span) * RELIEF,
      ];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Twice: a dark verge under a pale track, which is what makes a thin
      // line read as a worn road rather than as a scratch on the image.
      for (const [width, colour] of [
        [7, 'rgba(38, 30, 20, 0.5)'],
        [4, 'rgba(216, 201, 168, 0.75)'],
      ] as Array<[number, string]>) {
        ctx.beginPath();
        const [sx, sy] = px(this.road[0]!);
        ctx.moveTo(sx, sy);
        for (const point of this.road.slice(1)) {
          const [x, y] = px(point);
          ctx.lineTo(x, y);
        }
        ctx.lineWidth = width;
        ctx.strokeStyle = colour;
        ctx.stroke();
      }
      ctx.restore();
    }

    this.relief = canvas;
    this.reliefZone = zone.id;
  }

  /**
   * The mark, on either view.
   *
   * Deliberately not a dot: every other thing on this map is a dot, and the
   * one thing on it the player put there themselves should not have to be
   * picked out of a crowd of them.
   */
  private drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, r * 0.28);
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.stroke();
    ctx.strokeStyle = '#6fe0ff';
    ctx.lineWidth = Math.max(1.5, r * 0.2);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** World position to relief-bitmap pixel. */
  private toRelief(p: Vec2): { x: number; y: number } {
    const half = this.world.zone.halfSize;
    return { x: ((p.x + half) / (half * 2)) * RELIEF, y: ((p.z + half) / (half * 2)) * RELIEF };
  }

  // ----------------------------------------------------------------- minimap

  private drawMini(): void {
    const ctx = this.miniCtx;
    const size = this.mini.width;
    const player = this.world.player;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    // Round, because a square minimap lies about what is in range at the
    // corners — the thing it is measuring is a radius.
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.clip();

    if (this.relief) {
      const half = this.world.zone.halfSize;
      const perUnit = RELIEF / (half * 2);
      const src = MINIMAP_RANGE * perUnit;
      const c = this.toRelief(player.pos);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.relief, c.x - src, c.y - src, src * 2, src * 2, 0, 0, size, size);
    }

    const scale = size / (MINIMAP_RANGE * 2);
    const at = (p: Vec2): [number, number] => [
      size / 2 + (p.x - player.pos.x) * scale,
      size / 2 + (p.z - player.pos.z) * scale,
    ];

    // Landmarks under everything that moves, so a dot is never hidden by a
    // building that has been there all along.
    for (const st of this.deps.structuresOf()) {
      const [x, y] = at(st.pos);
      if (x < -20 || y < -20 || x > size + 20 || y > size + 20) continue;
      ctx.fillStyle = 'rgba(230, 226, 210, 0.55)';
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }

    for (const e of this.world.entities.values()) {
      if (e.id === player.id) continue;
      const [x, y] = at(e.pos);
      if (x < 0 || y < 0 || x > size || y > size) continue;
      const mark = this.markerFor(e, player);
      if (!mark) continue;
      ctx.fillStyle = mark.color;
      ctx.beginPath();
      ctx.arc(x, y, mark.r, 0, Math.PI * 2);
      ctx.fill();
      if (mark.ring) {
        ctx.strokeStyle = '#f5e6b8';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }

    // Where you fell. This is what turns the walk back from dead time into a
    // decision — go through the thing that killed you, or pay it off in kills
    // somewhere safer.
    const spot = player.deathSpot;
    if (spot && spot.zoneId === this.world.zone.id && (player.xpDebt ?? 0) > 0) {
      const [x, y] = at(spot.pos);
      if (x > -20 && y > -20 && x < size + 20 && y < size + 20) {
        ctx.strokeStyle = '#ff6a5a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 7, y - 7);
        ctx.lineTo(x + 7, y + 7);
        ctx.moveTo(x + 7, y - 7);
        ctx.lineTo(x - 7, y + 7);
        ctx.stroke();
      }
    }

    if (this.mark) {
      const [x, y] = at(this.mark);
      if (x > -20 && y > -20 && x < size + 20 && y < size + 20) this.drawMark(ctx, x, y, 9);
    }

    // The player last, and as an arrow rather than a dot: on a north-up map
    // "which way am I facing" is the one thing a dot cannot say.
    const yaw = this.deps.yawOf();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North, so the arrow has something to be relative to.
    ctx.fillStyle = 'rgba(245, 230, 184, 0.8)';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', size / 2, 26);

    const zoneEl = this.root.querySelector<HTMLElement>('#minimap-zone')!;
    zoneEl.textContent = this.world.zone.name;
    // The clock and the sky go on the minimap because that is already where a
    // player looks to ask "where am I and what is going on" — a second panel
    // for two short strings is a second thing to find.
    const light = this.world.daylight();
    const weather = this.world.weather();
    const clockEl = this.root.querySelector<HTMLElement>('#minimap-clock')!;
    clockEl.textContent =
      clockOf(light) + (weather.kind === 'clear' ? '' : ` · ${WEATHER_WORD[weather.kind]}`);
    clockEl.classList.toggle('dark', light.dark);
  }

  /**
   * What one entity looks like on a map, or nothing if it does not belong on
   * one. Corpses are the interesting case: a dead mob you have not looted is a
   * thing you want to walk back to.
   */
  private markerFor(
    e: Entity,
    player: Entity,
  ): { color: string; r: number; ring?: boolean } | null {
    if (e.kind === 'vendor') return { color: '#57c6f0', r: 5, ring: true };
    if (e.kind === 'npc') return { color: '#9ad0ff', r: 3.5 };
    if (e.kind !== 'mob') return null;
    const def = getMob(e.defId!);
    if (e.dead) {
      const loot = (e.corpseLoot?.length ?? 0) > 0 || (e.corpseGold ?? 0) > 0;
      return loot ? { color: 'rgba(245, 214, 122, 0.85)', r: 3.5 } : null;
    }
    if (def.horse) return { color: '#d9b8f0', r: 4.5 };
    if (def.dragon) return { color: '#ff4d3d', r: 8, ring: true };
    if (isBoss(def.stars)) return { color: '#ff8a5c', r: 7, ring: true };
    if (def.rareOf) return { color: '#f2d06b', r: 6, ring: true };
    return {
      color: threatColour(threatGap(def.level, def.stars, player.level)),
      r: 4 + def.stars * 0.5,
    };
  }

  // --------------------------------------------------------------- full map

  private drawFull(): void {
    const ctx = this.fullCtx;
    const size = this.full.width;
    const zone = this.world.zone;
    const player = this.world.player;
    ctx.clearRect(0, 0, size, size);
    if (this.relief) ctx.drawImage(this.relief, 0, 0, size, size);

    const half = zone.halfSize;
    const at = (p: Vec2): [number, number] => [
      ((p.x + half) / (half * 2)) * size,
      ((p.z + half) / (half * 2)) * size,
    ];

    const label = (text: string, x: number, y: number, colour: string, weight = 500): void => {
      ctx.font = `${weight} 17px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(12, 14, 12, 0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
    };

    // Camps, grouped: eleven dots in a ring is a smudge, and what a player
    // actually wants to read off a map is "there is a level 12 camp there".
    const camps = this.campsOf(zone);
    for (const camp of camps) {
      const [x, y] = at(camp.pos);
      const colour = threatColour(threatGap(camp.level, camp.stars, player.level));
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.26;
      ctx.beginPath();
      ctx.arc(x, y, 14 + camp.count * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Labels in a second pass, and only one per creature: the first version
    // wrote "Bog Wolf 8" five times down one road and "Marsh Bear 19" four
    // times on top of itself. A map you cannot read is a picture.
    const labelled = new Set<string>();
    for (const camp of [...camps].sort((a, b) => b.count - a.count)) {
      if (labelled.has(camp.name)) continue;
      labelled.add(camp.name);
      const [x, y] = at(camp.pos);
      label(
        `${camp.name} ${camp.level}`,
        x,
        y - 16 - camp.count * 1.3,
        threatColour(threatGap(camp.level, camp.stars, player.level)),
      );
    }

    // Landmarks.
    for (const st of this.deps.structuresOf()) {
      const [x, y] = at(st.pos);
      ctx.fillStyle = 'rgba(232, 227, 208, 0.72)';
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }

    // Places you have opened.
    //
    // Only the ones you have actually found: a map that lists them all is a
    // checklist, and walking a checklist is errand-running rather than
    // exploring. Drawn after the fact, the map slowly becomes a record of
    // where you have been — which is the one thing the minimap can never be.
    for (const site of this.world.sites) {
      if (!this.world.found[site.id]) continue;
      const [x, y] = at(site.pos);
      ctx.strokeStyle = site.kind === 'boon' ? '#9fd08a' : '#e0b95a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y);
      ctx.lineTo(x + 3.5, y);
      ctx.moveTo(x, y - 3.5);
      ctx.lineTo(x, y + 3.5);
      ctx.stroke();
    }

    // Holdings, in the colour of whoever is winning them right now. This is
    // the territory layer's only picture of itself.
    for (const holding of holdingsIn(zone.id)) {
      const [x, y] = at(holding.pos);
      const faction = FACTIONS[this.world.controllerOf(holding.id)];
      const colour = `#${faction.color.toString(16).padStart(6, '0')}`;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(x, y - 13);
      ctx.lineTo(x + 11, y);
      ctx.lineTo(x, y + 13);
      ctx.lineTo(x - 11, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(12, 14, 12, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      label(holding.name, x, y + 30, colour, 600);
    }

    // Bosses, traders and the roads out: the things a player navigates *to*.
    for (const spawn of zone.spawns) {
      const def = getMob(spawn.mobId);
      if (!isBoss(def.stars)) continue;
      const [x, y] = at(spawn.pos);
      ctx.fillStyle = def.stars >= 6 ? '#ff6a4a' : '#ff9a5c';
      star(ctx, x, y, 13, 6);
      label(`${def.name} ${def.level}`, x, y - 20, '#ffcaa8', 600);
    }
    for (const placement of zone.vendors) {
      const [x, y] = at(placement.pos);
      ctx.fillStyle = '#57c6f0';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      label(getVendor(placement.vendorId).name, x, y - 16, '#a8e2f7', 600);
    }
    for (const exit of zone.exits) {
      const [x, y] = at(exit.pos);
      ctx.fillStyle = player.level >= exit.minLevel ? '#8fe0a0' : '#6a7a6a';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      label(`${exit.label} (${exit.minLevel}+)`, x, y - 18, player.level >= exit.minLevel ? '#b6f0c2' : '#8a968a', 600);
    }

    const spot = player.deathSpot;
    if (spot && spot.zoneId === zone.id && (player.xpDebt ?? 0) > 0) {
      const [x, y] = at(spot.pos);
      ctx.strokeStyle = '#ff6a5a';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 9);
      ctx.lineTo(x + 9, y + 9);
      ctx.moveTo(x + 9, y - 9);
      ctx.lineTo(x - 9, y + 9);
      ctx.stroke();
      label('where you fell', x, y - 16, '#ff9a8a', 600);
    }

    if (this.mark) {
      const [mx, my] = at(this.mark);
      this.drawMark(ctx, mx, my, 15);
      label('your mark', mx, my - 22, '#bdefff', 600);
    }

    // Where you are, drawn last and drawn big.
    const [px, py] = at(player.pos);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();

    this.title.textContent = `${zone.name} — levels ${zone.levelRange[0]}–${zone.levelRange[1]}`;
    this.hint.innerHTML =
      `<span class="map-you">◉ you</span>` +
      `<span style="color:${THREAT_COLOURS.trivial}">● trivial</span>` +
      `<span style="color:${THREAT_COLOURS.even}">● even</span>` +
      `<span style="color:${THREAT_COLOURS.deadly}">● deadly</span>` +
      `<span style="color:#9fd08a">✛ found</span>` +
      `<span style="color:#ff9a5c">★ boss</span>` +
      `<span style="color:#57c6f0">● trader</span>` +
      `<span style="color:#8fe0a0">● road out</span>` +
      `<span style="color:#e8e3d0">▪ landmark</span>` +
      `<span style="color:#ff9a8a">✕ where you fell (V)</span>` +
      `<span style="color:#bdefff">✛ click to set your own mark</span>` +
      `<span class="map-scale">${Math.round(zone.halfSize * 2)}u across, about ten minutes on foot</span>`;
  }

  /**
   * Spawn points collapsed into camps.
   *
   * A zone has five hundred spawn points and nobody wants five hundred dots.
   * Grouping by "same creature, within a camp's width" is what turns the layout
   * back into the thing it was authored as.
   */
  private campsOf(
    zone: ZoneDef,
  ): Array<{ pos: Vec2; name: string; level: number; stars: StarRating; count: number }> {
    const out: Array<{
      pos: Vec2;
      name: string;
      level: number;
      stars: StarRating;
      count: number;
      sum: Vec2;
    }> = [];
    for (const spawn of zone.spawns) {
      const def = getMob(spawn.mobId);
      if (isBoss(def.stars)) continue;
      // Herds are drawn as mounts on the minimap and would only clutter this.
      if (def.horse) continue;
      const base = def.starOf ?? def.rareOf ?? def.id;
      const found = out.find(
        (c) => c.name === getMob(base).name && Math.hypot(c.pos.x - spawn.pos.x, c.pos.z - spawn.pos.z) < 190,
      );
      if (found) {
        found.count++;
        found.sum.x += spawn.pos.x;
        found.sum.z += spawn.pos.z;
        found.pos = { x: found.sum.x / found.count, z: found.sum.z / found.count };
        found.level = Math.max(found.level, getMob(base).level);
        // The hardest thing in the camp decides its colour: a camp is a place
        // you go and fight, and the pull that kills you is the one that counts.
        found.stars = Math.max(found.stars, def.stars) as StarRating;
      } else {
        out.push({
          pos: { ...spawn.pos },
          sum: { ...spawn.pos },
          name: getMob(base).name,
          level: getMob(base).level,
          stars: def.stars,
          count: 1,
        });
      }
    }
    return out;
  }
}

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

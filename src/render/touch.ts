import type { Action, InputController } from './input.js';
import type { SceneRig } from './scene.js';

/**
 * Playing it with your thumbs.
 *
 * Every control in this game was a key, and there are seventeen of them. On a
 * phone that is not "a bit awkward", it is a game you cannot move in — and the
 * genre this one is a love letter to is a *mobile* one, so a version that only
 * runs on a laptop is a version that misses the point.
 *
 * The scheme is the one every mobile action RPG converged on, because it is
 * the one that works with the hands you have:
 *
 * - **Left thumb walks.** A floating stick: put your thumb down anywhere in
 *   the left third and the stick appears under it. Floating rather than fixed,
 *   because a fixed stick is a thing you have to find without looking, and
 *   nobody looks at their left thumb.
 * - **Right thumb looks, and a tap selects.** The same ambiguity the mouse has
 *   and resolved the same way — a press that travels is a look, one that does
 *   not is a select — with a much larger slop, because a finger never lands
 *   and lifts on the same pixel and a two-pixel threshold means *nothing is
 *   ever a tap*.
 * - **Two fingers zoom.** Pinch, which is the only gesture on a phone that
 *   already means this.
 * - **Everything else is a button.** The verbs that were keys — loot, drink,
 *   talk, travel — become a pad above the skill bar, and the panels that were
 *   keys become a sheet behind one more button. Sixteen skills are already
 *   tappable, which is the one part of the HUD that was mobile all along.
 *
 * It owns the DOM for the stick and the pad, and nothing else: what a tap
 * *means* stays in `InputController`, because a tap and a click have to mean
 * the same thing and two answers to that is how they drift apart.
 */

/** How far from the middle of the stick counts as full tilt. */
const STICK_RADIUS = 54;

/** Below this, the stick is at rest. Thumbs are not precise and never still. */
const STICK_DEADZONE = 0.16;

/**
 * How far a finger may travel and still be a tap.
 *
 * The mouse threshold is two pixels, which is right for a mouse and wrong for
 * a thumb by an order of magnitude: a finger lands, rolls and lifts across ten
 * or twelve pixels on a deliberate tap. At two, every tap on a phone was a
 * look, and nothing could ever be selected.
 */
const TAP_SLOP = 14;

/** And how long. A finger held still for a second is a look that changed its mind. */
const TAP_MS = 450;

/** How much of the screen the stick owns. The rest looks and selects. */
const STICK_ZONE = 0.42;

type PadRow = [glyph: string, action: Action, label: string];

/**
 * Always up, above the skill bar.
 *
 * The four verbs you press mid-fight. Drinking is not among them because the
 * belt is already two tappable slots showing what is in them and how long
 * until you can drink again — a second button for the same thing would be a
 * second answer to "what happens when I press this".
 */
const PAD: PadRow[] = [
  ['⚔', 'autoAttack', 'Attack'],
  ['✋', 'loot', 'Loot'],
  ['⇥', 'cycleTarget', 'Next'],
  ['✕', 'back', 'Back'],
  // Sixteen slots across a phone is four pixels each, so only one row of
  // skills is drawn at a time and this is how you reach the other.
  ['⇅', 'skillRow', 'Skills'],
];

/** Behind the ☰. Everything that opens a panel, and the rarer verbs. */
const MENU: PadRow[] = [
  ['🎒', 'inventory', 'Bags'],
  ['👤', 'character', 'Character'],
  ['📜', 'quests', 'Quests'],
  ['🗺', 'map', 'Map'],
  ['🜂', 'leystones', 'Leystones'],
  ['⚑', 'realm', 'Realm'],
  ['📖', 'reckoning', 'Reckoning'],
  ['💬', 'trade', 'Trade'],
  ['🛣', 'travel', 'Travel'],
  ['🐎', 'horse', 'Take horse'],
  ['🏇', 'ride', 'Ride'],
  ['✝', 'reclaim', 'Reclaim'],
  ['🔇', 'mute', 'Mute'],
];

export class TouchControls {
  /** Where the stick is being held, -1..1, y forward. Read every frame. */
  readonly move = { x: 0, y: 0 };

  private stickId: number | null = null;
  private stickHome = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookAt = { x: 0, y: 0 };
  private lookStart = { x: 0, y: 0, at: 0 };
  private lookMoved = false;
  /** The two fingers of a pinch, and how far apart they were last frame. */
  private pinch: Map<number, { x: number; y: number }> = new Map();
  private pinchGap = 0;

  private readonly root: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly menu: HTMLElement;

  constructor(
    container: HTMLElement,
    private readonly rig: SceneRig,
    private readonly input: InputController,
  ) {
    document.body.classList.add('touch');

    this.root = document.createElement('div');
    this.root.id = 'stick';
    this.root.innerHTML = `<div id="stick-ring"><div id="stick-knob"></div></div>`;
    container.appendChild(this.root);
    this.ring = this.root.querySelector<HTMLElement>('#stick-ring')!;
    this.knob = this.root.querySelector<HTMLElement>('#stick-knob')!;
    this.menu = this.buildPad(container);

    // Ask for the whole screen on the first tap.
    //
    // A phone browser's address bar is a sixth of a landscape screen, and
    // fullscreen can only be requested from inside a gesture. Once, quietly,
    // and never retried: a game that asks twice is a game arguing with
    // somebody who said no, and it is exactly as playable in a browser frame.
    const goBig = (): void => {
      window.removeEventListener('pointerdown', goBig);
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      const ask = el.requestFullscreen ?? el.webkitRequestFullscreen;
      if (ask) void ask.call(el).catch(() => {});
    };
    window.addEventListener('pointerdown', goBig);

    const canvas = rig.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // The left of the screen walks, the right looks. Split by fraction rather
    // than by pixels so it lands in the same place on a phone and a tablet.
    if (e.clientX < window.innerWidth * STICK_ZONE && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickHome = { x: e.clientX, y: e.clientY };
      this.root.style.left = `${e.clientX}px`;
      this.root.style.top = `${e.clientY}px`;
      this.root.classList.add('live');
      this.setKnob(0, 0);
      return;
    }
    if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookAt = { x: e.clientX, y: e.clientY };
      this.lookStart = { x: e.clientX, y: e.clientY, at: performance.now() };
      this.lookMoved = false;
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    if (this.pinch.has(e.pointerId)) this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers down is a pinch, whatever either of them was doing before.
    if (this.pinch.size >= 2) {
      const [a, b] = [...this.pinch.values()];
      const gap = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (this.pinchGap > 0) {
        this.rig.distance = Math.max(5, Math.min(30, this.rig.distance - (gap - this.pinchGap) * 0.05));
      }
      this.pinchGap = gap;
      return;
    }

    if (e.pointerId === this.stickId) {
      e.preventDefault();
      const dx = e.clientX - this.stickHome.x;
      const dy = e.clientY - this.stickHome.y;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(1, len / STICK_RADIUS);
      const nx = len > 0 ? (dx / len) * clamped : 0;
      const ny = len > 0 ? (dy / len) * clamped : 0;
      this.setKnob(nx, ny);
      // Screen-down is walking away from the camera, so forward is -y.
      this.move.x = Math.abs(nx) < STICK_DEADZONE ? 0 : nx;
      this.move.y = Math.abs(ny) < STICK_DEADZONE ? 0 : -ny;
      return;
    }

    if (e.pointerId === this.lookId) {
      e.preventDefault();
      const dx = e.clientX - this.lookAt.x;
      const dy = e.clientY - this.lookAt.y;
      this.lookAt = { x: e.clientX, y: e.clientY };
      if (
        Math.hypot(e.clientX - this.lookStart.x, e.clientY - this.lookStart.y) > TAP_SLOP
      ) {
        this.lookMoved = true;
      }
      // Deltas computed by hand rather than read off `movementX`, which is not
      // reliably filled in for touch pointers in every browser — and a look
      // that works on one phone and not another is worse than none.
      this.rig.yaw -= dx * 0.006;
      this.rig.pitch = Math.max(0.15, Math.min(1.35, this.rig.pitch + dy * 0.005));
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.pinch.delete(e.pointerId);
    if (this.pinch.size < 2) this.pinchGap = 0;

    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.move.x = 0;
      this.move.y = 0;
      this.root.classList.remove('live');
      return;
    }
    if (e.pointerId === this.lookId) {
      const held = performance.now() - this.lookStart.at;
      const still = !this.lookMoved && held < TAP_MS;
      this.lookId = null;
      // A tap means exactly what a click means, resolved by the same code.
      if (still) this.input.selectAt(e.clientX, e.clientY);
    }
  }

  /**
   * The verbs, as buttons.
   *
   * Two tiers, because seventeen buttons on a phone screen is a keyboard drawn
   * badly. The four you press in a fight are always up; everything that opens
   * a panel lives behind one more tap, which is exactly how often you want to
   * open a panel mid-fight.
   */
  private buildPad(container: HTMLElement): HTMLElement {
    const pad = document.createElement('div');
    pad.id = 'touch-pad';
    for (const [label, action, title] of PAD as PadRow[]) {
      pad.appendChild(this.button(label, action, title));
    }

    const more = document.createElement('button');
    more.className = 'touch-btn touch-more';
    more.type = 'button';
    more.textContent = '☰';
    more.setAttribute('aria-label', 'More');
    pad.appendChild(more);
    container.appendChild(pad);

    const menu = document.createElement('div');
    menu.id = 'touch-menu';
    for (const [label, action, title] of MENU as PadRow[]) {
      menu.appendChild(this.button(label, action, title));
    }
    container.appendChild(menu);

    more.addEventListener('click', () => menu.classList.toggle('open'));
    // Anything chosen closes it. A menu that stays open over the game is a
    // menu covering the thing you opened it to do something about.
    menu.addEventListener('click', () => menu.classList.remove('open'));
    return menu;
  }

  private button(label: string, action: Action, title: string): HTMLElement {
    const el = document.createElement('button');
    el.className = 'touch-btn';
    el.type = 'button';
    el.innerHTML = `<span class="touch-glyph">${label}</span><span class="touch-label">${title}</span>`;
    el.setAttribute('aria-label', title);
    // `click` rather than `pointerdown`: a press that turns into a scroll or a
    // stray drag should not fire, and the browser already knows the difference.
    // Deliberately allowed to bubble: the menu closes on any click inside it,
    // and stopping propagation here meant choosing something from the sheet
    // left the sheet sitting over the thing you had just opened.
    el.addEventListener('click', () => this.input.act(action));
    return el;
  }

  /** Shut whatever the button opened. Used by the back gesture. */
  closeMenu(): void {
    this.menu.classList.remove('open');
  }

  private setKnob(nx: number, ny: number): void {
    this.knob.style.transform = `translate(${nx * STICK_RADIUS}px, ${ny * STICK_RADIUS}px)`;
    void this.ring;
  }
}

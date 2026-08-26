import { PLAYABLE_CLASSES, type ClassDef } from '../content/zone.js';
import { skillBarFor } from '../content/skills.js';
import { getItem } from '../content/items.js';
import type { ClassId } from '../sim/types.js';

/** The name a character starts with if they do not type one. */
export const DEFAULT_NAME = 'Wanderer';

/** How long a name may be. Long enough for anything Irish, short enough for a plate. */
export const MAX_NAME = 18;

export interface Chosen {
  classId: ClassId;
  name: string;
}

/**
 * First-run class picker.
 *
 * Shown only when there is no save to resume, so a returning player never has
 * to re-answer a question they already answered. Resolves to the chosen class
 * and the name, and removes itself.
 *
 * The name box is here because the other adventurers now say it four different
 * ways — a boss you put down, a creature you found, a front you turned, the
 * piece you are wearing — and every one of those lines was landing on
 * "Wanderer", which is the name the game gives to somebody who has not been
 * asked. It is optional: a player who wants to get on with it presses Begin
 * and is Wanderer, exactly as before.
 */
export function chooseClass(container: HTMLElement): Promise<Chosen> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'class-select';
    root.innerHTML = `
      <div class="cs-inner">
        <h1>Emerald Isle</h1>
        <p class="cs-sub">The Fenmarch is no place to arrive undecided. Choose what you are.</p>
        <label class="cs-name">
          <span>Your name</span>
          <input id="cs-name-input" type="text" maxlength="${MAX_NAME}"
                 placeholder="${DEFAULT_NAME}" autocomplete="off" spellcheck="false" />
        </label>
        <div class="cs-cards"></div>
      </div>`;
    const cards = root.querySelector<HTMLElement>('.cs-cards')!;
    const input = root.querySelector<HTMLInputElement>('#cs-name-input')!;

    for (const def of PLAYABLE_CLASSES) {
      cards.appendChild(buildCard(def, () => {
        root.remove();
        resolve({ classId: def.id, name: cleanName(input.value) });
      }));
    }

    container.appendChild(root);
    input.focus();
  });
}

/**
 * What a typed name becomes.
 *
 * Trimmed, collapsed and capped, and anything that is not a name falls back to
 * the default rather than being refused: a character-creation screen that
 * argues with you about punctuation before you have played a second of the
 * game is a worse first minute than a player called Wanderer.
 */
export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name.length > 0 ? name : DEFAULT_NAME;
}

function buildCard(def: ClassDef, onPick: () => void): HTMLElement {
  const card = document.createElement('button');
  card.className = 'cs-card';
  card.type = 'button';

  const weapon = getItem(def.startingWeapon);
  const kit = skillBarFor(def.id);

  card.innerHTML = `
    <div class="cs-swatch" style="background:#${def.color.toString(16).padStart(6, '0')}"></div>
    <h2>${def.name}</h2>
    <div class="cs-playstyle">${def.playstyle}</div>
    <p class="cs-desc">${def.description}</p>
    <div class="cs-stats">
      ${statRow('Strength', def.baseAttributes.strength)}
      ${statRow('Dexterity', def.baseAttributes.dexterity)}
      ${statRow('Focus', def.baseAttributes.focus)}
      ${statRow('Vitality', def.baseAttributes.vitality)}
    </div>
    <div class="cs-kit">
      <span class="cs-kit-label">Starts with</span> ${weapon.name}
      <div class="cs-skills">${kit
        .map((s) => `<span class="cs-skill" title="${s.description}">${s.name}<em>${s.reqLevel}</em></span>`)
        .join('')}</div>
    </div>
    <span class="cs-pick">Begin</span>`;

  card.addEventListener('click', onPick);
  return card;
}

function statRow(label: string, value: number): string {
  // Bar width is relative to the highest starting value any class has (12).
  const pct = Math.round((value / 12) * 100);
  return `
    <div class="cs-stat">
      <span>${label}</span>
      <span class="cs-bar"><i style="width:${pct}%"></i></span>
      <b>${value}</b>
    </div>`;
}

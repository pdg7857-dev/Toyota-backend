import { PLAYABLE_CLASSES, type ClassDef } from '../content/zone.js';
import { skillBarFor } from '../content/skills.js';
import { getItem } from '../content/items.js';
import type { ClassId } from '../sim/types.js';

/**
 * First-run class picker.
 *
 * Shown only when there is no save to resume, so a returning player never has
 * to re-answer a question they already answered. Resolves to the chosen class
 * and removes itself.
 */
export function chooseClass(container: HTMLElement): Promise<ClassId> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'class-select';
    root.innerHTML = `
      <div class="cs-inner">
        <h1>Emerald Isle</h1>
        <p class="cs-sub">The Fenmarch is no place to arrive undecided. Choose what you are.</p>
        <div class="cs-cards"></div>
      </div>`;
    const cards = root.querySelector<HTMLElement>('.cs-cards')!;

    for (const def of PLAYABLE_CLASSES) {
      cards.appendChild(buildCard(def, () => {
        root.remove();
        resolve(def.id);
      }));
    }

    container.appendChild(root);
  });
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

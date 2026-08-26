/**
 * Scan `public/models/` and print the manifest lines for whatever is in there.
 *
 * The alternative was making the game probe for `public/models/mob/<id>.glb`
 * on every spawn, which is five hundred speculative fetches on load and a
 * network panel full of red until every creature has art. This gets the
 * convenience of the convention without the cost of it: run it, paste the
 * output into `src/content/models.ts`.
 *
 *   npm run models
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'public', 'models');
const KINDS = ['mob', 'class', 'vendor'];

if (!existsSync(ROOT)) {
  console.log('No public/models directory. Nothing to scan.');
  process.exit(0);
}

/**
 * Which ids actually exist, read out of the source rather than imported.
 *
 * `src/content/` is TypeScript and this is a plain node script; a regex over
 * the id literals is enough to answer "is `bogwolf` a real creature", which is
 * the only question worth asking here. Getting it wrong costs a warning, not a
 * wrong answer.
 */
function knownIds(file, pattern) {
  const path = join(process.cwd(), 'src', 'content', file);
  if (!existsSync(path)) return new Set();
  const text = readFileSync(path, 'utf8');
  return new Set([...text.matchAll(pattern)].map((m) => m[1]));
}

const known = {
  mob: knownIds('mobs.ts', /\bid:\s*'([a-z0-9_]+)'/g),
  class: new Set(['warrior', 'druid', 'ranger', 'rogue', 'mage']),
  vendor: knownIds('vendors.ts', /\bid:\s*'([a-z0-9_]+)'/g),
};

const lines = [];
const unmatched = [];
let found = 0;

for (const kind of KINDS) {
  const dir = join(ROOT, kind);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).sort()) {
    if (!file.toLowerCase().endsWith('.glb') && !file.toLowerCase().endsWith('.gltf')) continue;
    found++;
    const id = file.replace(/\.(glb|gltf)$/i, '');
    const line = `  '${kind}:${id}': { file: 'models/${kind}/${file}' },`;
    if (known[kind].size && !known[kind].has(id)) unmatched.push(`${kind}/${file} -> no ${kind} called "${id}"`);
    lines.push(line);
  }
}

if (found === 0) {
  console.log(`Nothing in ${ROOT}. See public/models/README.md for what to export.`);
  process.exit(0);
}

console.log(`\nFound ${found} model file${found === 1 ? '' : 's'}. Paste into src/content/models.ts:\n`);
console.log('export const MODELS: Record<string, ModelDef> = {');
for (const line of lines) console.log(line);
console.log('};');

if (unmatched.length) {
  // Almost always a filename typo, and almost always invisible otherwise: the
  // game would simply never look for the file and the creature would stay a
  // capsule with no explanation.
  console.log('\nThese do not match anything in the game:');
  for (const u of unmatched) console.log(`  ${u}`);
}
console.log('');

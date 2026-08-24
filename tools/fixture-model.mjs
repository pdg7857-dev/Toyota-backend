/**
 * Build a tiny animated glTF, so the art pipeline can be proved without art.
 *
 * The whole point of `content/models.ts` is that a file dropped into
 * `public/models/` replaces a capsule and plays its clips. That claim is worth
 * exactly nothing until something has actually done it — and until it has,
 * every part of it is a guess: whether the fit works, whether the clip names
 * match, whether the animation plays, whether a missing file is really
 * harmless. Committing a fake wolf to make the point would put a grey box in
 * the shipped game, so `smoke.mjs` writes one, checks it, and deletes it.
 *
 * A hand-written glTF 2.0: one box, one rotation clip called "Idle", one
 * called "Death". No dependencies, because pulling in an exporter to test a
 * loader is a lot of machinery to prove one file format reads.
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** The eight corners of a unit-ish box, as a triangle soup (no indices). */
function boxVertices(halfX = 0.3, height = 1, halfZ = 0.3) {
  const c = [
    [-halfX, 0, -halfZ],
    [halfX, 0, -halfZ],
    [halfX, 0, halfZ],
    [-halfX, 0, halfZ],
    [-halfX, height, -halfZ],
    [halfX, height, -halfZ],
    [halfX, height, halfZ],
    [-halfX, height, halfZ],
  ];
  const faces = [
    [0, 1, 2, 3], // bottom
    [7, 6, 5, 4], // top
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
  const out = [];
  for (const [a, b, d, e] of faces) {
    for (const i of [a, b, d, a, d, e]) out.push(...c[i]);
  }
  return new Float32Array(out);
}

/**
 * Write a `.gltf` with an embedded buffer.
 *
 * `.gltf` rather than `.glb` deliberately: the binary container adds a header,
 * chunk padding and an alignment rule, all of which are opportunities to write
 * a file that is wrong in a way that looks like the loader is wrong. The loader
 * reads both, and what is under test is the pipeline, not the container.
 */
export function writeFixtureModel(path) {
  const positions = boxVertices();
  // Two clips, named the way a real exporter would name them, so the matcher in
  // `content/models.ts` is doing real work rather than being handed its answer.
  const times = new Float32Array([0, 0.5, 1]);
  const spin = new Float32Array([
    0, 0, 0, 1,
    0, 0.7071, 0, 0.7071,
    0, 0, 0, 1,
  ]);
  const topple = new Float32Array([
    0, 0, 0, 1,
    0, 0, 0.3827, 0.9239,
    0, 0, 0.7071, 0.7071,
  ]);

  const chunks = [positions, times, spin, topple];
  const offsets = [];
  let total = 0;
  for (const chunk of chunks) {
    // Pad every view to four bytes: glTF requires it and a viewer that
    // tolerates the mistake teaches you nothing about the one that does not.
    total += (4 - (total % 4)) % 4;
    offsets.push(total);
    total += chunk.byteLength;
  }
  const bytes = new Uint8Array(total);
  chunks.forEach((chunk, i) => {
    bytes.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offsets[i]);
  });

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }

  const gltf = {
    asset: { version: '2.0', generator: 'emerald-isle test fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Body' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.8, 0.4, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
    ],
    buffers: [{ byteLength: total, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
    bufferViews: chunks.map((chunk, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: chunk.byteLength })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
    ],
    animations: [
      {
        name: 'Idle',
        samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
      },
      {
        name: 'Death',
        samplers: [{ input: 1, output: 3, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
      },
    ],
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(gltf));
  return path;
}

export function removeFixtureModel(path) {
  if (existsSync(path)) rmSync(path);
}

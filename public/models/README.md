# Art goes here

Drop a `.glb` in, add one line to `src/content/models.ts`, and that creature
stops being a capsule. Nothing else in the codebase changes — see the "Art"
section of `CLAUDE.md` for why the seam is where it is.

```
public/models/mob/bog_wolf.glb        -> 'mob:bog_wolf'
public/models/class/warrior.glb       -> 'class:warrior'
public/models/vendor/maeve.glb        -> 'vendor:maeve'
```

Then in `src/content/models.ts`:

```ts
export const MODELS: Record<string, ModelDef> = {
  'mob:bog_wolf': { file: 'models/mob/bog_wolf.glb' },
};
```

`npm run models` scans this folder and prints the lines to paste, including
for files whose id it cannot match to anything — which is how you find out you
named it `bogwolf.glb`.

## What to export

**Format**: `.glb` (glTF binary, embedded textures). One file per creature.

**Scale**: whatever you like. Every model is measured and scaled to the height
that creature is authored at, so a wolf exported in centimetres and one
exported in metres land the same size. This is deliberate: art arrives at
arbitrary scale and a wolf that renders forty units tall is not a bug anybody
enjoys finding.

**Origin**: anywhere. The loader drops the model so its feet sit on the ground.

**Facing**: **+Z**. A model facing the other way is one `turn: Math.PI` in the
manifest, but everything is easier if they all face the same way.

**Poly budget**: a camp is eight of these and a zone streams several camps at
once. Aim for a few thousand triangles a creature; this game's whole look is
silhouette at distance, not surface detail up close.

**Animations**, all optional, named with these words anywhere in the clip name:

| Word | When it plays |
|---|---|
| `idle` | standing still |
| `walk` | ambling around a camp |
| `run` | chasing you, or you moving |
| `attack` | a swing landing |
| `cast` | winding up a spell or a telegraphed ability |
| `hit` | taking damage |
| `death` / `die` | dying (plays once and holds on the last frame) |

Missing clips fall back sensibly — `walk` borrows `run`, everything borrows
`idle`, and a file with only an idle is still an enormous improvement on a
capsule. A file with no animations at all renders as a static model, which is
also fine. If your exporter names everything `Take 001`, name the clips
explicitly with `clips: { idle: 'Take 001' }`.

## What happens when it is missing

Nothing. A file that 404s, fails to parse, or loads slowly leaves the capsule
standing and logs one line. That is what makes it safe to list art you have not
made yet, and to ship with the table empty.

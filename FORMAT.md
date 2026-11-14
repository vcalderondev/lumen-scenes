# Scene format (version 1)

A scene is a folder `scenes/<id>/` with a `scene.json`, low-poly models (`.obj` + `.mtl`) and
optionally one MIDI file. Lumen draws it behind the dashboard when the game is selected; the
web library manager offers it for every game listed in `games`.

The reference implementation is `player/lumen-scene.mjs` (rendering) and
`player/lumen-synth.mjs` (music). Lumen's C renderer follows them; when this document and the
reference player disagree, the player wins and this document gets fixed.

```
scenes/<id>/
  scene.json          required
  models/*.obj, *.mtl referenced by mesh layers
  music.mid           optional, referenced by "music"
  source/             optional: scripts, .blend files... never copied to the stick
  README.md           optional, never copied
```

## scene.json

```jsonc
{
  "format": 1,
  "id": "ffvii-reactor-city",          // = folder name, kebab-case
  "version": 1,                         // integer, raise it on every change (the web offers updates)
  "name": "Reactor City",
  "author": "Your name",
  "license": "CC-BY-4.0",               // CC0-1.0 | CC-BY-4.0 | CC-BY-SA-4.0
  "description": "One or two sentences.",
  "games": [                            // which games get this scene
    { "system": "psx", "title": "Final Fantasy VII", "serials": ["SCUS-94163", "SCES-00867"] }
  ],
  "music": { "file": "music.mid", "volume": 0.8 },   // optional
  "resolution": 0.5,                    // render scale, 0.25..1 (0.5 = 960x540 at 1080p)
  "camera": {
    "fov": 45,                          // vertical, degrees
    "position": [0, 7, 34], "target": [7, 8, 0],
    "orbit": { "degrees": 5, "period": 70 },          // yaw swing around target
    "bob": { "amount": [0, 0.3, 0], "period": 16 }    // sine offset
  },
  "fog": { "color": "#10241e", "near": 30, "far": 175 },   // also the clear colour
  "light": { "direction": [0.45, -0.55, -0.7], "color": "#56786c", "ambient": "#1b2625" },
  "layers": [ ... ]                     // drawn in order, at most 16
}
```

Matching (web): a game matches when its serial (from the disc file names) is in `serials`,
or else when the normalised title equals `title`
(lowercase, letters and digits only, leading "the" dropped). `system` is Lumen's system id
(`psx`, `nes`, `snes`, `n64`, `megadrive`, `gba`, `arcade`, ...).

Coordinates: right-handed, y up, the camera looks down -z by default. Units are arbitrary;
keep the scene within a few hundred units (far plane 500).

## Layers

All times are seconds, angles degrees, colours `#rrggbb`.

| type | draws | keys |
|---|---|---|
| `gradient` | full-screen vertical gradient (sky) | `stops`: 2-4 of `["#rrggbb", v]`, v from 0 (top) to 1 (bottom) |
| `stars` | screen-space twinkling points | `count`, `seed`, `color`, `size` [min, max] px at 1080p, `area` [left, top, right, bottom] 0..1, `twinkle` period, `opacity` |
| `mesh` | a flat-shaded OBJ model | `model`, `position`, `rotation` [x, y, z], `scale` (number or [x,y,z]), `spin` {axis, speed deg/s}, `bob` {amount, period}, `drift` {velocity, wrap [min, max] on x}, `instances` [[x, y, z, yaw, scale], ...], `pulse` {period, min} for emissive faces, `animate` {period, keys} (below), `fog` (default true) |
| `particles` | world-space soft points rising/drifting inside a box (wrapping) | `count`, `seed`, `box` [minX, minY, minZ, maxX, maxY, maxZ], `velocity`, `jitter` (sway), `size` (world units), `color`, `opacity`, `blend` add / alpha |
| `glow` | additive soft halos at world points | `position` or `positions`, `radius` (world units), `color`, `intensity`, `pulse` {period, min} (each position is phase-shifted) |

Rules that both renderers follow:

- **Order**: layers draw in the listed order. Meshes write depth; particles and glows test
  depth but don't write it; gradients and stars ignore depth (put them first).
- **Mesh transform**: `T(position + bob) * R(rotation + spin) * S(scale) * T(instance xyz +
  drift) * Ry(instance yaw) * S(instance scale)`. `R = Ry * Rx * Rz`. `drift.wrap` wraps the
  instance's local x into [min, max].
- **Animate** (mesh layers, for blinking, hair sway, breathing...): `{ "period": 6, "keys": [{ "t": 0, "scale": [1, 1, 1] }, { "t": 0.5, "rotation": [0, 0, 4] }, ...] }`.
  `t` is a fraction of the period (ascending, 2-32 keys); each key may set `position`
  (offset), `rotation` (offset, degrees) and `scale` (multiplier); a missing field is neutral
  (0 / 1). Between keys the value eases with smoothstep; after the last key it eases back to
  the first, so the loop is seamless. The pose applies at the layer's `position`, which is
  the pivot: model the part around the origin (e.g. eyelids hinged at their top edge).
  Final transform: `T(position + pose.position + bob) * R(rotation + pose.rotation + spin) * S(scale * pose.scale) * instance`.
- **Lighting**: per face, `colour = Kd * (ambient + light.color * max(dot(n, -direction), 0))`.
  Faces whose material has a non-zero `Ke` are emissive: colour `Ke * pulse`, unlit, and fog
  affects them half as much.
- **Fog**: linear on eye distance between `near` and `far`, towards `fog.color`.
- **Pulse**: `min + (1 - min) * (0.5 + 0.5 * sin(2π (t / period + phase)))`.
- **Generators** (`stars`, `particles`): xorshift32 seeded with `seed` (default: layer index
  + 1), four numbers per point in order (stars: u, v, size, phase; particles: x, y, z, phase).
  Particles fade in/out over the bottom and top 15 % of the box.

## Models

Wavefront OBJ, as exported by Blender (*File > Export > Wavefront (.obj)*, *Materials*
ticked, *Triangulated* optional). Read: `v` (optionally with vertex colours `v x y z r g b`),
`f` (polygons are fanned; `v/vt/vn` indices are fine, only `v` is used; negative indices ok),
`usemtl`, `mtllib`. Normals are recomputed per face (flat shading), texture coordinates are
ignored: colour comes from the material's `Kd`, or `Ke` for emissive faces.

Low poly means low poly: the whole scene, instances included, has at most **20 000
triangles**. A good scene is 2 000 - 6 000.

## Music

Standard MIDI File, format 0 or 1, at most 256 KB and 5 minutes. Lumen has no SoundFont: it
plays MIDI with its own small synthesizer, one patch per General MIDI family (piano,
chromatic percussion, organ, guitar, bass, strings, ensemble, brass, reed, pipe, synth lead,
synth pad, synth effects, ethnic, percussive, sound effects) and a synthesized drum kit on
channel 10. Supported: note on/off, program change, pitch bend (±2 semitones), CC 7 volume,
CC 10 pan, CC 11 expression, CC 64 sustain, CC 120/123, tempo changes.

**Looping**: the track plays to its last event, then jumps back to the first **CC 111** (any
channel, the RPG Maker convention) or to the start. Put an intro before the CC 111.

Write for the synth, not for a sampled piano: listen in the preview (`npm run preview`). Keep
the peak under full scale (the validator warns when it clips).

## Limits

| | |
|---|---|
| layers | 16 |
| triangles (scene) | 20 000 |
| instances per mesh layer | 512 |
| stars + particles + glow points | 3 000 |
| any file | 1 MB |
| all runtime files | 3 MB |
| MIDI | 256 KB, 5 min |

## Index

`index.json` (generated by `npm run index`, checked by CI) lists every valid scene with its
games, version and runtime files (path, size, SHA-256). Lumen web reads it to find scenes for
the games on a stick, downloads the files, checks each SHA-256 and writes them to the game's
folder:

| Lumen layout | scene folder on the stick |
|---|---|
| PlayStation (`games/psx/<n>/`) | `games/psx/<n>/scene/` |
| cartridges (`games/<system>/<name>.<ext>`) | `games/<system>/<name>-scene/` |

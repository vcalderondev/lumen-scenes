// Reactor City: generates this scene's models, music and scene.json.
//   node scenes/ffvii-reactor-city/source/build.mjs
// Original work (CC-BY-4.0): an industrial city at night, green-glowing reactors, a drifting
// airship. Inspired by the mood of late-90s RPGs; no art, music or names from any game.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mesh, rng, writeMidi, note } from '../../../tools/lib/build-helpers.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = (n) => join(DIR, 'models', n);
const tris = {};

// ---- materials --------------------------------------------------------------------------
const MAT = {
  ground: { kd: '#0a1310' }, road: { kd: '#121c19' },
  wall0: { kd: '#1d2524' }, wall1: { kd: '#171e1d' }, wall2: { kd: '#232c2a' }, roof: { kd: '#121817' },
  win: { ke: '#ffcf73' }, wing: { ke: '#7dffb0' }, winb: { ke: '#a6cbe0' },
  metal: { kd: '#3a4341' }, dark: { kd: '#222a29' }, pipe: { kd: '#2f3735' }, dome: { kd: '#48524e' },
  glow: { ke: '#5cff97' }, red: { ke: '#ff4a3d' }, white: { ke: '#e8f4ee' },
  hull: { kd: '#55605c' }, moon: { ke: '#cfe3da' }, lamp: { ke: '#ffc777' }, rail: { kd: '#141a19' },
};

// ---- skyline: ground, far and mid districts ----------------------------------------------
{
  const m = new Mesh(MAT), r = rng(7);
  m.face('ground', m.vert(-260, 0, -220), m.vert(260, 0, -220), m.vert(260, 0, 40), m.vert(-260, 0, 40));
  // keep clear of the reactors and the tower
  const clear = [[14, -18, 9], [-22, -55, 8], [40, -70, 9], [-14, -78, 8]];
  const free = (x, z, w) => clear.every(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) > cr + w);
  const building = (x, z, w, d, h) => {
    const wall = ['wall0', 'wall1', 'wall2'][Math.floor(r() * 3)];
    m.box(wall, x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, { skip: ['bottom'] });
    if (r() < 0.35) m.box('roof', x - w * 0.3, h, z - d * 0.3, x + w * 0.1, h + 0.8 + r() * 1.2, z + d * 0.1, { skip: ['bottom'] });
    // lit window strips on the front face (towards the camera)
    const floors = Math.floor(h / 1.6);
    for (let f = 1; f < floors; f++) {
      if (r() < 0.45) continue;
      const y = f * 1.6, x0 = x - w / 2 + 0.25 + r() * w * 0.3, x1 = Math.min(x + w / 2 - 0.25, x0 + 0.6 + r() * w * 0.6);
      const k = r(), mat = k < 0.7 ? 'win' : k < 0.88 ? 'winb' : 'wing';
      m.quadZ(mat, x0, y, x1, y + 0.45, z + d / 2 + 0.02);
    }
  };
  for (let i = 0; i < 70; i++) {          // far band
    const x = -110 + r() * 220, z = -120 + r() * 55, w = 4 + r() * 7, d = 4 + r() * 6, h = 6 + r() * r() * 26;
    if (free(x, z, w)) building(x, z, w, d, h);
  }
  for (let i = 0; i < 55; i++) {          // mid band
    const x = -48 + r() * 100, z = -42 + r() * 34, w = 2.5 + r() * 4, d = 2.5 + r() * 4, h = 2.5 + r() * r() * 12;
    if (free(x, z, w)) building(x, z, w, d, h);
  }
  for (let i = 0; i < 40; i++) {          // near band: low warehouses
    const x = -20 + r() * 85, z = -4 + r() * 26, w = 3 + r() * 5, d = 2.5 + r() * 4, h = 1.5 + r() * 4;
    if (free(x, z, w)) building(x, z, w, d, h);
  }
  tris.skyline = m.write(M('skyline.obj'), 'Reactor City skyline (generated, CC-BY-4.0)');
}

// ---- reactor (instanced 3x) -------------------------------------------------------------
const STACKS = [[-3, 17.5, -2], [3, 15, -2.5]];   // stack tops, local
{
  const m = new Mesh(MAT);
  m.cyl('metal', 12, 5.4, 5, 0, 4, { caps: false });
  m.cyl('glow', 12, 5.06, 5.06, 2.6, 3.0, { caps: false });
  m.cyl('dark', 12, 5, 4.6, 4, 4.6, { caps: false });
  m.dome('dome', 12, 3, 4.6, 4.6);
  m.cyl('glow', 6, 0.9, 0.9, 9.0, 9.35, { caps: true });          // core vent on the dome
  for (const [x, top, z] of STACKS) {
    m.cyl('pipe', 8, 1.0, 0.75, 0, top, { cx: x, cz: z, caps: false });
    m.cyl('glow', 8, 0.8, 0.8, top - 1.6, top - 1.2, { cx: x, cz: z, caps: false });
    m.cyl('dark', 8, 0.95, 0.95, top - 0.2, top, { cx: x, cz: z, caps: false });
    m.box('pipe', x - 0.3, 5.5, z, x + 0.3, 6.1, z + 2.4);         // pipe into the dome
  }
  // gantries and side tanks
  m.box('metal', -7.5, 0, 1.5, -5.3, 6, 3.6, { skip: ['bottom'] });
  m.box('glow', -7.52, 4.4, 1.7, -7.48, 4.8, 3.4);
  m.cyl('pipe', 8, 1.3, 1.3, 0, 5, { cx: 6.8, cz: 2.2 });
  m.box('pipe', -5.4, 3.0, 2.2, -4.8, 3.6, 2.8);
  for (let i = 0; i < 4; i++) m.box('dark', 4.2 + i * 0.01, 0, -4 + i * 1.6, 4.5, 1.6 + i * 0.6, -3.4 + i * 1.6);
  tris.reactor = m.write(M('reactor.obj'), 'Reactor (generated, CC-BY-4.0)');
}
const REACTORS = [[14, 0, -18, 25, 1.0], [-22, 0, -55, -10, 0.9], [40, 0, -70, -35, 1.1]];
const yawXf = ([x, y, z, yaw, s], [lx, ly, lz]) => {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  return [x + s * (lx * c + lz * sn), y + s * ly, z + s * (-lx * sn + lz * c)].map((v) => +v.toFixed(2));
};
const stackTops = REACTORS.flatMap((ri) => STACKS.map(([x, y, z]) => yawXf(ri, [x, y + 0.6, z])));
const ventTops = REACTORS.map((ri) => yawXf(ri, [0, 9.6, 0]));

// ---- central tower ----------------------------------------------------------------------
const TOWER = [-14, 0, -78];
{
  const m = new Mesh(MAT);
  const seg = [[6, 0, 9], [4.6, 9, 20], [3.3, 20, 34], [2.1, 34, 43]];
  seg.forEach(([rr, y0, y1], i) => {
    m.cyl(i % 2 ? 'wall2' : 'wall0', 8, rr, rr * 0.92, y0, y1, { caps: true, rot: Math.PI / 8 });
    for (let y = y0 + 1.4; y < y1 - 0.8; y += 2.2)
      m.cyl(i === 2 ? 'wing' : 'win', 8, rr * 0.93 + 0.03, rr * 0.93 + 0.03, y, y + 0.35, { caps: false, rot: Math.PI / 8 });
    m.cyl('dark', 8, rr + 0.5, rr + 0.5, y1 - 0.4, y1, { caps: true, rot: Math.PI / 8 });
  });
  m.cyl('metal', 4, 0.5, 0, 43, 52, { caps: false });
  tris.tower = m.write(M('tower.obj'), 'Tower (generated, CC-BY-4.0)');
}

// ---- airship ----------------------------------------------------------------------------
{
  const m = new Mesh(MAT);
  m.ellipsoid('hull', 8, 6, 4.5, 1.4, 1.4);
  m.box('dark', -1.2, -1.9, -0.45, 1.4, -1.2, 0.45);
  m.face('dark', m.vert(-3.6, 0, 0), m.vert(-5.4, 0, 0), m.vert(-5.6, 1.6, 0));
  m.face('dark', m.vert(-3.6, 0, 0), m.vert(-5.6, 0, -1.6), m.vert(-5.4, 0, 0));
  m.face('dark', m.vert(-3.6, 0, 0), m.vert(-5.4, 0, 0), m.vert(-5.6, 0, 1.6));
  m.box('red', 4.3, 0.2, -0.12, 4.6, 0.5, 0.12);
  m.box('white', -5.7, 1.5, -0.1, -5.45, 1.75, 0.1);
  m.box('win', -0.9, -1.75, 0.46, 1.1, -1.45, 0.47);
  tris.airship = m.write(M('airship.obj'), 'Airship (generated, CC-BY-4.0)');
}

// ---- moon -------------------------------------------------------------------------------
{ const m = new Mesh(MAT); m.ico('moon', 1); tris.moon = m.write(M('moon.obj'), 'Moon (generated, CC-BY-4.0)'); }

// ---- foreground rooftop (parallax) --------------------------------------------------------
{
  const m = new Mesh(MAT);
  m.box('rail', -40, 0, 14, -4, 3.6, 30, { skip: ['bottom'] });              // roof slab
  for (let x = -38; x <= -6; x += 2.2) m.box('rail', x, 3.6, 14.2, x + 0.12, 4.8, 14.32);
  m.box('rail', -38.2, 4.7, 14.15, -5.8, 4.86, 14.4);
  m.box('rail', -38.2, 4.15, 14.18, -5.8, 4.25, 14.36);
  m.cyl('rail', 8, 1.6, 1.6, 3.6, 7.2, { cx: -20, cz: 19 });                 // water tank
  m.cyl('rail', 8, 1.8, 0, 7.2, 8.2, { cx: -20, cz: 19, caps: false });
  for (const [x, z] of [[-21.2, 17.8], [-18.8, 17.8], [-21.2, 20.2], [-18.8, 20.2]]) m.box('rail', x - 0.1, 3.6, z - 0.1, x + 0.1, 4.2, z + 0.1);
  m.box('rail', -12.5, 3.6, 15.0, -11.9, 6.0, 15.2);                          // lamp post
  m.box('rail', -12.5, 5.9, 15.0, -11.2, 6.05, 15.2);
  m.box('lamp', -11.55, 5.6, 14.95, -11.15, 5.9, 15.25);
  tris.foreground = m.write(M('foreground.obj'), 'Rooftop (generated, CC-BY-4.0)');
}

// ---- music ------------------------------------------------------------------------------
// D minor, 66 BPM, 2-bar intro then a 16-bar loop (CC 111 marks the loop start).
{
  const PPQ = 480, BAR = PPQ * 4, INTRO = 2;
  const tempo = { events: [{ t: 0, d: [0xff, 0x51, 3, ...[0x0d, 0xdf, 0x22]] }] };   // 909 090 us/beat = 66 BPM
  const tr = (ch, prog, vol, pan) => ({ ch, events: [{ t: 0, pri: 0, d: [0xc0 | ch, prog] }, { t: 0, pri: 0, d: [0xb0 | ch, 7, vol] }, { t: 0, pri: 0, d: [0xb0 | ch, 10, pan] }] });
  const add = (track, t, n, len, vel) => {
    track.events.push({ t, pri: 2, d: [0x90 | track.ch, n, vel] });
    track.events.push({ t: t + len, pri: 1, d: [0x80 | track.ch, n, 0] });
  };
  const pad = tr(0, 89, 92, 64), bell = tr(1, 10, 70, 82), bass = tr(2, 33, 100, 60), flute = tr(3, 73, 84, 50), drums = tr(9, 0, 58, 64);
  pad.events.push({ t: INTRO * BAR, pri: 0, d: [0xb0, 111, 0] });
  const chords = {
    Dm: ['D3', 'F3', 'A3', 'D4'], Bb: ['Bb2', 'F3', 'Bb3', 'D4'], Gm: ['G2', 'D3', 'G3', 'Bb3'], A: ['A2', 'E3', 'A3', 'C#4'],
    F: ['F2', 'C3', 'F3', 'A3'], C: ['C3', 'G3', 'C4', 'E4'],
  };
  const loop = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', 'C', 'A', 'Bb', 'F', 'Gm', 'Dm', 'Bb', 'C', 'A', 'A'];
  const bars = [...Array(INTRO).fill('Dm'), ...loop];
  bars.forEach((ch, b) => {
    const t = b * BAR, c = chords[ch].map(note);
    for (const n of c.slice(1)) add(pad, t, n, BAR - 10, 70);
    add(bass, t, c[0] - 12, BAR / 2 - 20, 88);
    add(bass, t + BAR / 2, c[0] - 12, BAR / 2 - 40, 76);
    if (b >= INTRO) {
      // broken chord on the bell, eighths: 1 3 5 8 5 3 8 5 (an octave up)
      const pat = [0, 1, 2, 3, 2, 1, 3, 2];
      pat.forEach((k, i) => add(bell, t + i * (PPQ / 2), c[k] + 12, PPQ / 2 - 30, i % 4 === 0 ? 78 : 60));
    }
    if (b >= INTRO + 8) {
      add(drums, t, 36, 60, 70);
      add(drums, t + BAR / 2 + PPQ / 2, 36, 60, 48);
      for (let i = 0; i < 4; i++) add(drums, t + i * PPQ + PPQ / 2, 42, 30, 34);
      if ((b - INTRO) % 4 === 3) add(drums, t + 3 * PPQ, 38, 60, 50);
    }
  });
  // melody from loop bar 5 (q = quarter)
  const q = PPQ;
  const mel = [
    [4, [['A4', 2], ['F4', 1], ['G4', 1]]], [5, [['A4', 1.5], ['C5', 0.5], ['A4', 2]]], [6, [['G4', 2], ['E4', 1], ['G4', 1]]], [7, [['E4', 4]]],
    [8, [['D5', 2], ['C5', 1], ['Bb4', 1]]], [9, [['A4', 3], ['F4', 1]]], [10, [['G4', 1], ['A4', 1], ['Bb4', 1], ['D5', 1]]], [11, [['A4', 4]]],
    [12, [['F4', 2], ['G4', 1], ['A4', 1]]], [13, [['G4', 2], ['E4', 2]]], [14, [['C#5', 2], ['E5', 1], ['C#5', 1]]], [15, [['A4', 4]]],
  ];
  for (const [bar, notes] of mel) {
    let t = (INTRO + bar) * BAR;
    for (const [n, beats] of notes) { add(flute, t, note(n), beats * q - 40, 84); t += beats * q; }
  }
  const end = bars.length * BAR;
  for (const t of [pad, bell, bass, flute, drums]) t.events.push({ t: end, pri: 0, d: [0xb0 | t.ch, 123, 0] });
  writeMidi(join(DIR, 'music.mid'), { ppq: PPQ, tracks: [tempo, pad, bell, bass, flute, drums] });
}

// ---- scene.json -------------------------------------------------------------------------
const scene = {
  format: 1,
  id: 'ffvii-reactor-city',
  version: 1,
  name: 'Reactor City',
  author: 'Lumen PSX',
  license: 'CC-BY-4.0',
  description: 'An industrial city at night: green-glowing reactors, smoke, a slow airship and drifting motes of energy. Original low-poly scene and music.',
  games: [{
    system: 'psx', title: 'Final Fantasy VII',
    serials: [
      'SCUS-94163', 'SCUS-94164', 'SCUS-94165',
      'SCES-00867', 'SCES-10867', 'SCES-20867', 'SCES-00868', 'SCES-10868', 'SCES-20868',
      'SCES-00869', 'SCES-10869', 'SCES-20869', 'SCES-00900', 'SCES-10900', 'SCES-20900',
      'SLPS-00700', 'SLPS-00701', 'SLPS-00702', 'SLPS-01057', 'SLPS-01058', 'SLPS-01059', 'SLPS-01060',
    ],
  }],
  music: { file: 'music.mid', volume: 0.8 },
  resolution: 0.5,
  camera: { fov: 42, position: [-4, 12, 58], target: [10, 10, -20], orbit: { degrees: 5, period: 80 }, bob: { amount: [0, 0.35, 0], period: 16 } },
  fog: { color: '#24543f', near: 40, far: 210 },
  light: { direction: [0.45, -0.55, -0.7], color: '#7aa596', ambient: '#1e2a28' },
  layers: [
    { type: 'gradient', stops: [['#010405', 0], ['#06140f', 0.3], ['#1a4634', 0.52], ['#3d8562', 0.62]] },
    { type: 'stars', count: 170, seed: 11, color: '#d8efe6', size: [1, 2.6], area: [0, 0, 1, 0.5], twinkle: 3.5 },
    { type: 'mesh', model: 'models/moon.obj', position: [95, 70, -170], scale: 4.5, spin: { axis: 'y', speed: 2 }, fog: false },
    { type: 'glow', position: [95, 70, -170], radius: 20, color: '#8fd3b8', intensity: 0.3 },
    { type: 'mesh', model: 'models/skyline.obj' },
    { type: 'mesh', model: 'models/tower.obj', position: TOWER },
    { type: 'mesh', model: 'models/reactor.obj', instances: REACTORS, pulse: { period: 3.2, min: 0.55 } },
    { type: 'glow', positions: [...stackTops, ...ventTops], radius: 2.6, color: '#4dff8f', intensity: 0.85, pulse: { period: 3.2, min: 0.55 } },
    { type: 'glow', position: [TOWER[0], 52.6, TOWER[2]], radius: 1.4, color: '#ff3b30', intensity: 0.9, pulse: { period: 1.6, min: 0.1 } },
    { type: 'particles', count: 50, seed: 5, box: [6, 17, -26, 26, 40, -12], velocity: [0.6, 1.2, 0], jitter: 0.9, size: 3.2, color: '#4a6b5f', opacity: 0.18, blend: 'alpha' },
    { type: 'mesh', model: 'models/airship.obj', position: [0, 29, -48], drift: { velocity: [1.3, 0, 0], wrap: [-75, 75] }, bob: { amount: [0, 0.6, 0], period: 9 }, pulse: { period: 1.2, min: 0.2 } },
    { type: 'particles', count: 220, seed: 9, box: [-30, 0, -50, 50, 24, 10], velocity: [0.1, 0.45, 0], jitter: 0.7, size: 0.22, color: '#78ffad', opacity: 0.75, blend: 'add' },
    { type: 'mesh', model: 'models/foreground.obj', position: [0, 1.5, 26], pulse: { period: 2.4, min: 0.75 } },
    { type: 'particles', count: 60, seed: 3, box: [-16, 4, 30, 24, 20, 50], velocity: [0.25, -0.06, 0], jitter: 0.5, size: 0.05, color: '#c9dcd3', opacity: 0.35, blend: 'add' },
  ],
};
writeFileSync(join(DIR, 'scene.json'), JSON.stringify(scene, null, 2) + '\n');
console.log('triangles per model:', tris);

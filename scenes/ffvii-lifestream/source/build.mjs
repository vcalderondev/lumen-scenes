// Lifestream Motes: generates this scene's music and scene.json.
//   node scenes/ffvii-lifestream/source/build.mjs
// Original work (CC-BY-4.0): darkness, a green light breathing from below and motes of light
// drifting up at several depths. Particles only, no models. Original music.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMidi, note } from '../../../tools/lib/build-helpers.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- music: "Vigil", A minor, 3/4, 58 BPM ---------------------------------------------------
{
  const PPQ = 480, BAR = PPQ * 3, INTRO = 1;
  const tempo = { events: [{ t: 0, d: [0xff, 0x51, 3, 0x0f, 0xc8, 0xf3] }] };          // 1 034 483 us = 58 BPM
  const tr = (ch, prog, vol, pan) => ({ ch, events: [{ t: 0, pri: 0, d: [0xc0 | ch, prog] }, { t: 0, pri: 0, d: [0xb0 | ch, 7, vol] }, { t: 0, pri: 0, d: [0xb0 | ch, 10, pan] }] });
  const add = (track, t, n, len, vel) => { track.events.push({ t, pri: 2, d: [0x90 | track.ch, n, vel] }); track.events.push({ t: t + len, pri: 1, d: [0x80 | track.ch, n, 0] }); };
  const pad = tr(0, 91, 84, 64), box = tr(1, 10, 92, 70), bass = tr(2, 32, 80, 58), harp = tr(3, 46, 60, 76);
  pad.events.push({ t: INTRO * BAR, pri: 0, d: [0xb0, 111, 0] });
  const CH = { Am: ['A2', 'E3', 'A3', 'C4'], F: ['F2', 'C3', 'F3', 'A3'], C: ['C3', 'G3', 'C4', 'E4'], G: ['G2', 'D3', 'G3', 'B3'], Dm: ['D3', 'A3', 'D4', 'F4'], E: ['E2', 'B2', 'E3', 'G#3'], Em: ['E2', 'B2', 'E3', 'G3'] };
  const loop = ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E', 'F', 'G', 'Em', 'Am', 'Dm', 'E', 'Am', 'Am'];
  const bars = ['Am', ...loop];
  bars.forEach((c, b) => {
    const t = b * BAR, n = CH[c].map(note);
    for (const x of n.slice(1)) add(pad, t, x, BAR - 10, 64);
    add(bass, t, n[0], BAR - 60, 70);
    if (b >= INTRO) [1, 2, 3, 2].forEach((k, i) => i < 3 && add(harp, t + i * PPQ, n[k] + 12, PPQ - 40, i ? 44 : 54));
  });
  const q = PPQ;
  // music-box melody (beats), loop bars 1-16
  const mel = [
    [0, [['E5', 2], ['D5', 1]]], [1, [['C5', 2], ['A4', 1]]], [2, [['G4', 1], ['C5', 1], ['E5', 1]]], [3, [['D5', 3]]],
    [4, [['E5', 1], ['A5', 1], ['G5', 1]]], [5, [['F5', 2], ['C5', 1]]], [6, [['D5', 1.5], ['E5', 0.5], ['F5', 1]]], [7, [['E5', 3]]],
    [8, [['A5', 2], ['G5', 1]]], [9, [['F5', 1], ['D5', 1], ['B4', 1]]], [10, [['G4', 2], ['B4', 1]]], [11, [['C5', 3]]],
    [12, [['A4', 1], ['D5', 1], ['F5', 1]]], [13, [['E5', 1.5], ['D5', 0.5], ['B4', 1]]], [14, [['A4', 3]]], [15, [['E4', 1], ['A4', 2]]],
  ];
  for (const [bar, ns] of mel) {
    let t = (INTRO + bar) * BAR;
    for (const [nn, beats] of ns) { add(box, t, note(nn), beats * q - 30, 80); t += beats * q; }
  }
  const end = bars.length * BAR;
  for (const t of [pad, box, bass, harp]) t.events.push({ t: end, pri: 0, d: [0xb0 | t.ch, 123, 0] });
  writeMidi(join(DIR, 'music.mid'), { ppq: PPQ, tracks: [tempo, pad, box, bass, harp] });
}

// ---- scene.json --------------------------------------------------------------------------
const BREATH = { period: 7, min: 0.55 };
const scene = {
  format: 1,
  id: 'ffvii-lifestream',
  version: 1,
  name: 'Motes of Light',
  author: 'Lumen PSX',
  license: 'CC-BY-4.0',
  description: 'Darkness, a green light breathing from below and motes of light drifting up at every depth. Particles only. Original music.',
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
  camera: { fov: 40, position: [0, 0, 10], target: [-1.2, 0.4, 0], orbit: { degrees: 7, period: 46 }, bob: { amount: [0, 0.25, 0], period: 13 } },
  fog: { color: '#000000', near: 8, far: 32 },
  layers: [
    { type: 'gradient', stops: [['#000000', 0], ['#000201', 0.55], ['#021208', 0.85], ['#04200f', 1]] },
    // the light below, breathing; a second, wider and fainter
    { type: 'glow', positions: [[1.8, -4.6, -2], [4.8, -5.2, -7]], radius: 7.5, color: '#1fff66', intensity: 0.85, pulse: BREATH },
    { type: 'glow', position: [2.5, -6, -12], radius: 18, color: '#11b84c', intensity: 0.5, pulse: { period: 11, min: 0.7 } },
    // far: fine, dim, many
    { type: 'particles', count: 380, seed: 31, box: [-16, -9, -22, 18, 9, -9], velocity: [0.04, 0.32, 0], jitter: 0.6, size: 0.12, color: '#3dff7e', opacity: 0.85, blend: 'add' },
    // a slow column rising from the light, right of centre
    { type: 'particles', count: 240, seed: 32, box: [-1, -6, -5, 6, 7, 1], velocity: [0.08, 0.55, 0], jitter: 0.9, size: 0.1, color: '#8affb4', opacity: 1, blend: 'add' },
    // mid: everywhere
    { type: 'particles', count: 220, seed: 33, box: [-11, -7, -8, 12, 7, 3], velocity: [0.03, 0.28, 0], jitter: 0.5, size: 0.08, color: '#62ff98', opacity: 1, blend: 'add' },
    // soft halos around some motes
    { type: 'particles', count: 40, seed: 34, box: [-8, -6, -6, 10, 6, 2], velocity: [0.02, 0.22, 0], jitter: 0.6, size: 0.45, color: '#2bff70', opacity: 0.22, blend: 'add' },
    // near: big out-of-focus bokeh drifting past the camera
    { type: 'particles', count: 14, seed: 35, box: [-6, -4, 4, 6, 4, 7.5], velocity: [0.05, 0.15, 0], jitter: 0.3, size: 0.5, color: '#5cff93', opacity: 0.28, blend: 'add' },
  ],
};
writeFileSync(join(DIR, 'scene.json'), JSON.stringify(scene, null, 2) + '\n');
console.log('ok');

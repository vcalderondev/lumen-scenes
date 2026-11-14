// Lumen synth: a tiny General MIDI synthesizer for scene music (FORMAT.md "Music").
//
// This file is the reference implementation. Lumen (C, on the PlayStation Classic) renders
// MIDI with the same algorithm (lumen/src/midisynth.c): same instrument table, envelopes,
// drum kit, echo and soft clip, so a scene sounds the same in the browser and on the console.
// The whole file is rendered to PCM up front (a few MB), then played as a loop that jumps
// back to the first CC 111 (loop start, the RPG Maker convention) or to the beginning.
//
// No dependencies. MIT License.

export const SYNTH_RATE = 32000;
export const MAX_SECONDS = 300;

// ---- Standard MIDI File parser ---------------------------------------------------------

/** @returns {{format:number, division:number, events:Array<{tick:number, ord:number, type:string, ch?:number, a?:number, b?:number, tempo?:number}>}} */
export function parseMidi(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 0;
  const u32 = () => { const v = (u8[p] << 24 | u8[p + 1] << 16 | u8[p + 2] << 8 | u8[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { const v = u8[p] << 8 | u8[p + 1]; p += 2; return v; };
  const str4 = () => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  if (u8.length < 14 || str4() !== 'MThd') throw new Error('not a MIDI file (no MThd)');
  p += 4;
  const hlen = u32();
  const format = u16(), ntracks = u16(), division = u16();
  p = 8 + hlen;
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  if (format > 1) throw new Error('MIDI format 2 is not supported');
  const events = [];
  let ord = 0;
  for (let t = 0; t < ntracks && p + 8 <= u8.length; t++) {
    const id = str4(); p += 4;
    const len = u32();
    const end = Math.min(p + len, u8.length);
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, status = 0;
    const vlq = () => { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v >>> 0; };
    while (p < end) {
      tick += vlq();
      let b = u8[p];
      if (b & 0x80) { status = b; p++; } else if (!status) throw new Error('running status without a status byte');
      const hi = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) {
        const type = u8[p++]; const l = vlq();
        if (type === 0x51 && l === 3) events.push({ tick, ord: ord++, type: 'tempo', tempo: u8[p] << 16 | u8[p + 1] << 8 | u8[p + 2] });
        else if (type === 0x2f) events.push({ tick, ord: ord++, type: 'end' });
        p += l;
        status = 0;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
        status = 0;
      } else if (hi === 0x80 || hi === 0x90 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        const a = u8[p++], c = u8[p++];
        if (hi === 0x90 && c > 0) events.push({ tick, ord: ord++, type: 'on', ch, a, b: c });
        else if (hi === 0x80 || hi === 0x90) events.push({ tick, ord: ord++, type: 'off', ch, a });
        else if (hi === 0xb0) events.push({ tick, ord: ord++, type: 'cc', ch, a, b: c });
        else if (hi === 0xe0) events.push({ tick, ord: ord++, type: 'bend', ch, a: ((c << 7) | a) - 8192 });
      } else if (hi === 0xc0 || hi === 0xd0) {
        const a = u8[p++];
        if (hi === 0xc0) events.push({ tick, ord: ord++, type: 'prog', ch, a });
      } else throw new Error('bad MIDI status 0x' + status.toString(16));
    }
    p = end;
  }
  events.sort((x, y) => x.tick - y.tick || x.ord - y.ord);
  return { format, division, events };
}

// ---- Instruments -----------------------------------------------------------------------
// One patch per General MIDI family (program / 8). wave: 0 sine, 1 triangle, 2 saw,
// 3 square, 4 pulse 25 %, 5 noise. a/d/r in seconds, s level, lp cutoff Hz (0 = off),
// det cents of a second oscillator (0 = none), h level of a sine one octave up, g gain.
export const PATCHES = [
  /* 0 piano      */ { w: 1, a: 0.003, d: 1.6, s: 0.0, r: 0.35, lp: 0, det: 0, h: 0.25, g: 0.9 },
  /* 1 chrom perc */ { w: 0, a: 0.001, d: 0.9, s: 0.0, r: 0.5, lp: 0, det: 0, h: 0.4, g: 0.7 },
  /* 2 organ      */ { w: 3, a: 0.01, d: 0.1, s: 0.8, r: 0.12, lp: 1800, det: 0, h: 0, g: 0.3 },
  /* 3 guitar     */ { w: 2, a: 0.002, d: 0.7, s: 0.0, r: 0.25, lp: 2200, det: 0, h: 0, g: 0.45 },
  /* 4 bass       */ { w: 1, a: 0.004, d: 0.5, s: 0.6, r: 0.12, lp: 0, det: 0, h: 0, g: 1.0 },
  /* 5 strings    */ { w: 2, a: 0.25, d: 0.5, s: 0.8, r: 0.6, lp: 2600, det: 8, h: 0, g: 0.3 },
  /* 6 ensemble   */ { w: 2, a: 0.35, d: 0.5, s: 0.85, r: 0.9, lp: 2000, det: 10, h: 0, g: 0.28 },
  /* 7 brass      */ { w: 2, a: 0.05, d: 0.3, s: 0.7, r: 0.2, lp: 1600, det: 4, h: 0, g: 0.35 },
  /* 8 reed       */ { w: 3, a: 0.03, d: 0.3, s: 0.7, r: 0.15, lp: 1400, det: 0, h: 0, g: 0.3 },
  /* 9 pipe       */ { w: 0, a: 0.06, d: 0.2, s: 0.85, r: 0.25, lp: 0, det: 3, h: 0, g: 0.75 },
  /* 10 lead      */ { w: 3, a: 0.01, d: 0.2, s: 0.7, r: 0.15, lp: 3000, det: 6, h: 0, g: 0.28 },
  /* 11 pad       */ { w: 2, a: 0.8, d: 1.0, s: 0.8, r: 1.5, lp: 1200, det: 12, h: 0, g: 0.3 },
  /* 12 fx        */ { w: 1, a: 0.3, d: 0.8, s: 0.6, r: 1.2, lp: 0, det: 9, h: 0, g: 0.5 },
  /* 13 ethnic    */ { w: 4, a: 0.002, d: 0.6, s: 0.0, r: 0.3, lp: 2500, det: 0, h: 0, g: 0.4 },
  /* 14 percussive*/ { w: 0, a: 0.001, d: 0.3, s: 0.0, r: 0.15, lp: 0, det: 0, h: 0, g: 0.9 },
  /* 15 sound fx  */ { w: 5, a: 0.05, d: 0.5, s: 0.3, r: 0.5, lp: 3000, det: 0, h: 0, g: 0.25 },
];

// Drum kit (channel 10): kind 0 kick, 1 snare, 2 hat, 3 cymbal, 4 tom, 5 other.
// [kind, decay s, gain, base Hz]
export function drumFor(note) {
  switch (note) {
    case 35: case 36: return [0, 0.3, 1.0, 120];
    case 37: case 39: return [5, 0.08, 0.35, 0];
    case 38: case 40: return [1, 0.15, 0.7, 190];
    case 42: case 44: return [2, 0.04, 0.3, 0];
    case 46: return [2, 0.25, 0.3, 0];
    case 49: case 52: case 55: case 57: return [3, 1.0, 0.3, 0];
    case 51: case 53: case 59: return [3, 0.45, 0.22, 0];
    case 41: return [4, 0.3, 0.8, 90];
    case 43: return [4, 0.3, 0.8, 110];
    case 45: return [4, 0.3, 0.8, 130];
    case 47: return [4, 0.3, 0.8, 150];
    case 48: return [4, 0.3, 0.8, 170];
    case 50: return [4, 0.3, 0.8, 200];
    default: return [5, 0.08, 0.3, 0];
  }
}

const MAX_VOICES = 32;
const TAU = Math.PI * 2;

// xorshift32, identical in C
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

function osc(w, p, noise) {
  switch (w) {
    case 0: return Math.sin(TAU * p);
    case 1: return 1 - 4 * Math.abs(p - 0.5);
    case 2: return 2 * p - 1;
    case 3: return p < 0.5 ? 1 : -1;
    case 4: return p < 0.25 ? 1 : -1;
    default: return noise() * 2 - 1;
  }
}

function softclip(x) { return x >= 1 ? 1 : x <= -1 ? -1 : 1.5 * x - 0.5 * x * x * x; }

/**
 * Render a Standard MIDI File to stereo float PCM.
 * @returns {{left: Float32Array, right: Float32Array, rate: number, loopStart: number, seconds: number}}
 */
export function renderMidi(bytes, { rate = SYNTH_RATE, maxSeconds = MAX_SECONDS } = {}) {
  const { division, events } = parseMidi(bytes);
  // tick -> seconds with the tempo map
  let lastTick = 0;
  for (const e of events) if (e.tick > lastTick) lastTick = e.tick;
  const frameAt = (() => {
    const tempos = events.filter((e) => e.type === 'tempo');
    return (tick) => {
      let sec = 0, t0 = 0, us = 500000;
      for (const e of tempos) {
        if (e.tick >= tick) break;
        sec += ((e.tick - t0) * us) / (division * 1e6);
        t0 = e.tick; us = e.tempo;
      }
      sec += ((tick - t0) * us) / (division * 1e6);
      return Math.round(sec * rate);
    };
  })();
  const total = Math.min(frameAt(lastTick), Math.round(maxSeconds * rate));
  const left = new Float32Array(total), right = new Float32Array(total);

  const chans = [];
  for (let c = 0; c < 16; c++) chans.push({ prog: 0, vol: 100 / 127, expr: 1, pan: 0.5, bend: 0, sus: false });
  const voices = [];
  const noise = rng(0x2545f491);
  let loopStart = -1, age = 0;

  // echo: two delay lines (L 270 ms, R 360 ms), feedback 0.3, wet 0.22
  const dlL = new Float32Array(Math.round(0.27 * rate)), dlR = new Float32Array(Math.round(0.36 * rate));
  let diL = 0, diR = 0;

  const noteOn = (ch, note, vel) => {
    const c = chans[ch];
    if (voices.length >= MAX_VOICES) {
      let oldest = 0;
      for (let i = 1; i < voices.length; i++) if (voices[i].age < voices[oldest].age) oldest = i;
      voices.splice(oldest, 1);
    }
    const v = { ch, note, age: age++, vel: vel / 127, env: 0, stage: 0, t: 0, ph: 0, ph2: 0, ph3: 0, lp: 0, lp2: 0, held: false };
    if (ch === 9) {
      const [kind, dec, g, hz] = drumFor(note);
      v.drum = kind; v.pat = { w: 0, a: 0.001, d: dec, s: 0, r: dec, lp: 0, det: 0, h: 0, g }; v.f0 = hz;
      v.ka = 1 - Math.exp((-TAU * (kind === 1 ? 5000 : 7000)) / rate);
    } else {
      v.pat = PATCHES[(c.prog >> 3) & 15];
      v.freq = 440 * Math.pow(2, (note - 69) / 12);
      v.ka = v.pat.lp ? 1 - Math.exp((-TAU * Math.min(v.pat.lp, rate * 0.45)) / rate) : 1;
    }
    const P = v.pat;
    v.kA = 1 / Math.max(1, P.a * rate);
    v.kD = Math.exp(-1 / Math.max(1, (P.d * rate) / 3));
    v.kR = Math.exp(-1 / Math.max(1, (P.r * rate) / 5));
    voices.push(v);
  };
  const release = (v) => { if (v.stage < 2) v.stage = 2; };
  const noteOff = (ch, note) => {
    if (ch === 9) return;   // drums ring out on their own decay
    for (const v of voices) if (v.ch === ch && v.note === note && v.stage < 2) { if (chans[ch].sus) v.held = true; else release(v); }
  };

  const renderTo = (end) => {
    for (let i = renderedTo; i < end; i++) {
      let L = 0, R = 0;
      for (let k = voices.length - 1; k >= 0; k--) {
        const v = voices[k], P = v.pat, c = chans[v.ch];
        // envelope
        if (v.stage === 0) { v.env += v.kA; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
        else if (v.stage === 1) v.env = P.s + (v.env - P.s) * v.kD;
        else v.env *= v.kR;
        if ((v.stage === 2 || (v.stage === 1 && P.s === 0)) && v.env < 0.0005) { voices.splice(k, 1); continue; }
        let x;
        if (v.drum !== undefined) {
          const t = v.t / rate;
          if (v.drum === 0 || v.drum === 4) {
            const f = v.drum === 0 ? 45 + (v.f0 - 45) * Math.exp(-t / 0.03) : v.f0 * (0.7 + 0.3 * Math.exp(-t / 0.05));
            v.ph += f / rate; v.ph -= Math.floor(v.ph);
            x = Math.sin(TAU * v.ph);
          } else if (v.drum === 1) {
            v.ph += v.f0 / rate; v.ph -= Math.floor(v.ph);
            const n = noise() * 2 - 1; v.lp += v.ka * (n - v.lp);
            x = 0.6 * v.lp + 0.4 * (1 - 4 * Math.abs(v.ph - 0.5));
          } else {
            const n = noise() * 2 - 1; v.lp += v.ka * (n - v.lp);
            x = v.drum === 5 ? n * 0.6 : n - v.lp;   // hats and cymbals: high-passed noise
          }
          v.t++;
        } else {
          const f = v.freq * Math.pow(2, c.bend / 12);
          v.ph += f / rate; v.ph -= Math.floor(v.ph);
          x = osc(P.w, v.ph, noise);
          if (P.det) { v.ph2 += (f * Math.pow(2, P.det / 1200)) / rate; v.ph2 -= Math.floor(v.ph2); x = 0.5 * (x + osc(P.w, v.ph2, noise)); }
          if (P.h) { v.ph3 += (2 * f) / rate; v.ph3 -= Math.floor(v.ph3); x += P.h * Math.sin(TAU * v.ph3); }
          if (P.lp) { v.lp += v.ka * (x - v.lp); x = v.lp; }
        }
        const amp = x * v.env * v.vel * P.g * c.vol * c.expr;
        L += amp * Math.min(1, 2 * (1 - c.pan));
        R += amp * Math.min(1, 2 * c.pan);
      }
      // echo
      const eL = dlL[diL], eR = dlR[diR];
      dlL[diL] = L + eR * 0.3; dlR[diR] = R + eL * 0.3;
      if (++diL >= dlL.length) diL = 0;
      if (++diR >= dlR.length) diR = 0;
      left[i] = softclip(0.5 * (L + 0.22 * eL));
      right[i] = softclip(0.5 * (R + 0.22 * eR));
    }
    renderedTo = end;
  };
  let renderedTo = 0;

  for (const e of events) {
    const at = Math.min(frameAt(e.tick), total);
    if (at > renderedTo) renderTo(at);
    const c = chans[e.ch ?? 0];
    switch (e.type) {
      case 'on': noteOn(e.ch, e.a, e.b); break;
      case 'off': noteOff(e.ch, e.a); break;
      case 'prog': c.prog = e.a; break;
      case 'bend': c.bend = (e.a / 8192) * 2; break;
      case 'cc':
        if (e.a === 7) c.vol = e.b / 127;
        else if (e.a === 11) c.expr = e.b / 127;
        else if (e.a === 10) c.pan = e.b / 127;
        else if (e.a === 64) {
          c.sus = e.b >= 64;
          if (!c.sus) for (const v of voices) if (v.ch === e.ch && v.held) { v.held = false; release(v); }
        } else if (e.a === 111 && loopStart < 0) loopStart = at;
        else if (e.a === 120 || e.a === 123) for (const v of voices) if (v.ch === e.ch) release(v);
        break;
    }
  }
  renderTo(total);
  return { left, right, rate, loopStart: loopStart >= 0 && loopStart < total ? loopStart : 0, seconds: total / rate };
}

/** Play a rendered track in Web Audio, looping from loopStart. Returns a stop function. */
export function playRendered(ctx, r, { volume = 0.8 } = {}) {
  const buf = ctx.createBuffer(2, r.left.length || 1, r.rate);
  buf.copyToChannel(r.left, 0);
  buf.copyToChannel(r.right, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = r.loopStart / r.rate;
  src.loopEnd = r.left.length / r.rate;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination);
  src.start();
  return () => { try { src.stop(); } catch { /* already stopped */ } src.disconnect(); gain.disconnect(); };
}

// ---- preparing a user's own MIDI for a game -------------------------------------------
// Imported files are often messy (stray parts long after the song, full-scale mixes). This
// rewrites them as a clean format-0 file that Lumen's synth plays well:
//  - cuts everything after the first stretch of `maxGap` seconds without any note event
//    (sequencer leftovers), and ends the file when the last kept note ends;
//  - when the file already repeats the song (game rips often loop it many times), keeps one
//    pass, or an intro plus one pass with CC 111 at the loop point;
//  - scales every channel volume (CC 7, default 100) by `volume`, so "quiet" is baked in;
//  - keeps notes, program changes, pitch bend, CC 7/10/11/64/111/120/123 and tempo.
export function prepareMidi(bytes, { volume = 0.4, maxGap = 20, loop = true } = {}) {
  const { division, events } = parseMidi(bytes);
  const tempos = events.filter((e) => e.type === 'tempo');
  const secAt = (tick) => {
    let sec = 0, t0 = 0, us = 500000;
    for (const e of tempos) { if (e.tick >= tick) break; sec += ((e.tick - t0) * us) / (division * 1e6); t0 = e.tick; us = e.tempo; }
    return sec + ((tick - t0) * us) / (division * 1e6);
  };
  // song end: walk notes in time order; stop at a gap > maxGap after the last note-off seen
  let lastNote = -1, cut = Infinity;
  for (const e of events) {
    if (e.type !== 'on' && e.type !== 'off') continue;
    if (e.type === 'on' && lastNote >= 0 && secAt(e.tick) - secAt(lastNote) > maxGap) { cut = e.tick; break; }
    lastNote = e.tick;
  }
  let kept = events.filter((e) => e.tick < cut);
  let end = 0;
  for (const e of kept) if (e.type === 'off') end = Math.max(end, e.tick);
  // files that already repeat the song several times: keep one pass (plus an intro if any)
  let loopTick = -1, period = 0;
  if (loop) {
    period = findRepeat(kept, end, (t) => secAt(t));
    if (period) {
      const ons = kept.filter((e) => e.type === 'on');
      const intro = repeatScore(ons, 0, period, period) < 0.9;
      const stop = intro ? 2 * period : period;
      if (intro) loopTick = period;
      // notes still sounding at the cut are released there
      kept = kept.filter((e) => e.tick < stop || (e.type === 'off' && e.tick <= stop));
      for (const e of kept) if (e.type === 'off' && e.tick > stop) e.tick = stop;
      end = stop;
    }
  }
  const KEEP_CC = new Set([7, 10, 11, 64, 111, 120, 123]);
  const used = new Set(kept.filter((e) => e.type === 'on').map((e) => e.ch));
  const out = [];
  const v = Math.max(0, Math.min(1, volume));
  for (const ch of used) out.push({ tick: 0, d: [0xb0 | ch, 7, Math.round(100 * v)] });
  if (loopTick > 0) out.push({ tick: loopTick, d: [0xb0, 111, 0] });
  for (const e of kept) {
    if (e.tick > end) continue;
    switch (e.type) {
      case 'tempo': out.push({ tick: e.tick, d: [0xff, 0x51, 3, (e.tempo >> 16) & 255, (e.tempo >> 8) & 255, e.tempo & 255] }); break;
      case 'on': out.push({ tick: e.tick, d: [0x90 | e.ch, e.a, e.b] }); break;
      case 'off': out.push({ tick: e.tick, d: [0x80 | e.ch, e.a, 0] }); break;
      case 'prog': out.push({ tick: e.tick, d: [0xc0 | e.ch, e.a] }); break;
      case 'bend': { const x = e.a + 8192; out.push({ tick: e.tick, d: [0xe0 | e.ch, x & 127, x >> 7] }); break; }
      case 'cc':
        if (!KEEP_CC.has(e.a)) break;
        out.push({ tick: e.tick, d: [0xb0 | e.ch, e.a, e.a === 7 ? Math.round(e.b * v) : e.b] });
        break;
    }
  }
  // serialize (events are already in time order; the CC 7 defaults go first at tick 0)
  out.sort((a, b) => a.tick - b.tick);
  const vlq = (n) => { const b = [n & 0x7f]; while ((n >>>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  const data = [];
  let last = 0;
  for (const e of out) { data.push(...vlq(e.tick - last), ...e.d); last = e.tick; }
  data.push(...vlq(Math.max(0, end - last)), 0xff, 0x2f, 0);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, division >> 8, division & 255];
  const trk = [0x4d, 0x54, 0x72, 0x6b, (data.length >>> 24) & 255, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255];
  return {
    bytes: new Uint8Array([...head, ...trk, ...data]), seconds: secAt(end),
    trimmedSeconds: secAt(events.at(-1).tick) - secAt(end),
    repeatSeconds: period ? secAt(loopTick > 0 ? 2 * period : period) - secAt(loopTick > 0 ? period : 0) : 0,
    loopStartSeconds: loopTick > 0 ? secAt(loopTick) : 0,
  };
}

/** Fraction of note-ons in [from, from + len) that reappear (same channel, note) exactly `shift` ticks later. */
function repeatScore(ons, from, len, shift) {
  const set = new Set(ons.map((e) => `${e.tick}:${e.ch}:${e.a}`));
  let n = 0, hit = 0;
  for (const e of ons) {
    if (e.tick < from || e.tick >= from + len) continue;
    n++;
    if (set.has(`${e.tick + shift}:${e.ch}:${e.a}`)) hit++;
  }
  return n >= 16 ? hit / n : 0;
}

/** Smallest period (ticks, >= 10 s) at which the song repeats at least twice, or 0. */
function findRepeat(events, end, secAt) {
  const ons = events.filter((e) => e.type === 'on');
  if (ons.length < 64) return 0;
  // candidates: distances from notes near the middle to later identical notes
  const mid = ons[Math.floor(ons.length / 3)], cands = new Set();
  for (const e of ons) if (e.tick > mid.tick && e.ch === mid.ch && e.a === mid.a) cands.add(e.tick - mid.tick);
  for (const p of [...cands].sort((a, b) => a - b)) {
    if (secAt(p) < 10 || 3 * p > end + p * 0.05) continue;   // needs room for >= 2 full passes after the first
    if (repeatScore(ons, p, p, p) >= 0.9) return p;
  }
  return 0;
}

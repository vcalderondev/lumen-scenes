// Lumen scene player: loads, validates and renders a scene (FORMAT.md) with WebGL 1.
//
// Reference implementation. Lumen (C, GLES on the PlayStation Classic) renders scenes with
// the same math and shaders (lumen/src/scene.c): same camera, flat-shaded meshes, fog, star
// and particle generators (xorshift32 seeds) and point-sprite glows, so the browser preview
// matches the console. No dependencies. MIT License.

export const FORMAT = 1;
export const LIMITS = {
  layers: 16,
  triangles: 20000,      // whole scene, instances included
  instances: 512,        // per mesh layer
  points: 3000,          // stars + particles + glows
  fileBytes: 1 << 20,    // any single file
  sceneBytes: 3 << 20,   // all files
  midiBytes: 256 << 10,
};
export const LAYER_TYPES = ['gradient', 'stars', 'mesh', 'particles', 'glow'];
// Lumen's system ids (lumen/dist/systems/*.ini)
export const SYSTEMS = ['psx', 'nes', 'snes', 'n64', 'megadrive', 'mastersystem', 'gamegear', 'gb', 'gbc', 'gba', 'pce', 'arcade'];

/** Title key for matching: lowercase letters and digits, a leading "the" dropped. */
export const titleKey = (t) => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

/**
 * Does an index entry (or scene.json) apply to a game? By serial when the game has one,
 * else by title (cartridges). Returns 'serial' | 'title' | null.
 */
export function matchGame(entry, { system, serial, title }) {
  for (const g of entry.games ?? []) {
    if (g.system !== system) continue;
    if (serial && g.serials?.includes(serial.toUpperCase())) return 'serial';
    if (titleKey(g.title) && titleKey(g.title) === titleKey(title)) return 'title';
  }
  return null;
}

const TAU = Math.PI * 2;

// ---- small helpers ---------------------------------------------------------------------

export function color(c, fallback = [1, 1, 1]) {
  if (typeof c !== 'string') return fallback.slice();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16) / 255);
  return fallback.slice();
}
const isColor = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);

/** xorshift32; the C side uses the same generator so seeds give the same layout. */
export function rng(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const wrap = (x, lo, hi) => { const s = hi - lo; return s > 0 ? lo + ((((x - lo) % s) + s) % s) : x; };
export const normPath = (base, rel) => {
  const out = [];
  for (const part of (base ? base + '/' + rel : rel).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.join('/');
};

// ---- mat4 (column-major) ---------------------------------------------------------------
const M4 = {
  id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; },
  look(e, c, up) {
    const z = norm3(sub3(e, c)), x = norm3(cross3(up, z)), y = cross3(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot3(x, e), -dot3(y, e), -dot3(z, e), 1];
  },
  tr: (v) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1],
  sc: (s) => [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1],
  rx(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  ry(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rz(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  // rotation in degrees, applied Z, then X, then Y (yaw last): R = Ry * Rx * Rz
  rot: (d) => M4.mul(M4.ry(d[1] * Math.PI / 180), M4.mul(M4.rx(d[0] * Math.PI / 180), M4.rz(d[2] * Math.PI / 180))),
  xf(m, v) { return [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]); },
};
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
const mat3of = (m) => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];

// ---- OBJ / MTL -------------------------------------------------------------------------

export function parseMtl(text) {
  const mats = new Map();
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim().split(/\s+/);
    if (l[0] === 'newmtl') { cur = { kd: [0.8, 0.8, 0.8], ke: null }; mats.set(l.slice(1).join(' '), cur); }
    else if (cur && l[0] === 'Kd') cur.kd = [+l[1], +l[2], +l[3]];
    else if (cur && l[0] === 'Ke') { const ke = [+l[1], +l[2], +l[3]]; cur.ke = ke.some((x) => x > 0) ? ke : null; }
  }
  return mats;
}

/** Triangulated, flat, non-indexed mesh: per vertex position, face normal, colour, emissive flag. */
export function parseObj(text, mats = new Map()) {
  const v = [], vc = [], pos = [], nrm = [], col = [], emi = [];
  let mat = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim().split(/\s+/);
    if (l[0] === 'v') { v.push([+l[1], +l[2], +l[3]]); vc.push(l.length >= 7 ? [+l[4], +l[5], +l[6]] : null); }
    else if (l[0] === 'usemtl') mat = mats.get(l.slice(1).join(' ')) ?? null;
    else if (l[0] === 'f') {
      const idx = l.slice(1).map((s) => { const i = parseInt(s, 10); return i < 0 ? v.length + i : i - 1; });
      if (idx.length < 3 || idx.some((i) => !(i >= 0 && i < v.length))) throw new Error('bad face: ' + raw.trim());
      for (let k = 1; k + 1 < idx.length; k++) {
        const a = v[idx[0]], b = v[idx[k]], c = v[idx[k + 1]];
        const n = norm3(cross3(sub3(b, a), sub3(c, a)));
        let rgb, e = 0;
        if (mat?.ke) { rgb = mat.ke; e = 1; }
        else if (mat) rgb = mat.kd;
        else if (vc[idx[0]]) rgb = [0, 1, 2].map((j) => (vc[idx[0]][j] + vc[idx[k]][j] + vc[idx[k + 1]][j]) / 3);
        else rgb = [0.8, 0.8, 0.8];
        for (const p of [a, b, c]) { pos.push(...p); nrm.push(...n); col.push(...rgb); emi.push(e); }
      }
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col), emi: new Float32Array(emi), tris: pos.length / 9 };
}

// ---- validation ------------------------------------------------------------------------

/** Structural checks of scene.json. Returns a list of problems ("" path = whole scene). */
export function validateScene(s) {
  const err = [];
  const bad = (where, msg) => err.push(where ? `${where}: ${msg}` : msg);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['scene.json must be an object'];
  if (s.format !== FORMAT) bad('format', `must be ${FORMAT}`);
  if (typeof s.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) bad('id', 'lowercase kebab-case (a-z, 0-9, -)');
  if (!Number.isInteger(s.version) || s.version < 1) bad('version', 'integer >= 1, raise it on every change');
  for (const k of ['name', 'author', 'license']) if (typeof s[k] !== 'string' || !s[k].trim()) bad(k, 'required text');
  if (s.license && !/^(CC0-1\.0|CC-BY-4\.0|CC-BY-SA-4\.0)$/.test(s.license)) bad('license', 'CC0-1.0, CC-BY-4.0 or CC-BY-SA-4.0');
  if (!Array.isArray(s.games) || !s.games.length) bad('games', 'at least one game');
  else s.games.forEach((g, i) => {
    const w = `games[${i}]`;
    if (!SYSTEMS.includes(g?.system)) bad(w + '.system', SYSTEMS.join(', '));
    if (typeof g?.title !== 'string' || !g.title.trim()) bad(w + '.title', 'required');
    if (g?.serials !== undefined && (!Array.isArray(g.serials) || !g.serials.every((x) => typeof x === 'string' && /^[A-Z]{4}-\d{5}$/.test(x))))
      bad(w + '.serials', 'list like "SCUS-94163" (4 letters, dash, 5 digits)');
  });
  if (s.music !== undefined) {
    if (typeof s.music?.file !== 'string' || !/\.mid$/i.test(s.music.file)) bad('music.file', 'a .mid file');
    if (s.music?.volume !== undefined && !(isNum(s.music.volume) && s.music.volume >= 0 && s.music.volume <= 1)) bad('music.volume', '0..1');
  }
  if (s.resolution !== undefined && !(isNum(s.resolution) && s.resolution >= 0.25 && s.resolution <= 1)) bad('resolution', '0.25..1');
  const cam = s.camera ?? {};
  if (cam.fov !== undefined && !(isNum(cam.fov) && cam.fov >= 10 && cam.fov <= 120)) bad('camera.fov', '10..120');
  for (const k of ['position', 'target']) if (cam[k] !== undefined && !isVec(cam[k], 3)) bad('camera.' + k, '[x, y, z]');
  if (cam.orbit !== undefined && !(isNum(cam.orbit?.degrees) && isNum(cam.orbit?.period) && cam.orbit.period > 0)) bad('camera.orbit', '{ degrees, period > 0 }');
  if (cam.bob !== undefined && !(isVec(cam.bob?.amount, 3) && isNum(cam.bob?.period) && cam.bob.period > 0)) bad('camera.bob', '{ amount: [x,y,z], period > 0 }');
  if (s.fog !== undefined && !(isColor(s.fog?.color) && isNum(s.fog?.near) && isNum(s.fog?.far) && s.fog.far > s.fog.near)) bad('fog', '{ color, near, far > near }');
  if (s.light !== undefined) {
    if (s.light.direction !== undefined && !isVec(s.light.direction, 3)) bad('light.direction', '[x, y, z]');
    for (const k of ['color', 'ambient']) if (s.light[k] !== undefined && !isColor(s.light[k])) bad('light.' + k, '#rrggbb');
  }
  if (!Array.isArray(s.layers) || !s.layers.length) { bad('layers', 'at least one layer'); return err; }
  if (s.layers.length > LIMITS.layers) bad('layers', `at most ${LIMITS.layers}`);
  let points = 0;
  s.layers.forEach((L, i) => {
    const w = `layers[${i}]`;
    if (!LAYER_TYPES.includes(L?.type)) { bad(w + '.type', LAYER_TYPES.join(', ')); return; }
    const pulse = () => { if (L.pulse !== undefined && !(isNum(L.pulse?.period) && L.pulse.period > 0 && isNum(L.pulse?.min))) bad(w + '.pulse', '{ period > 0, min }'); };
    switch (L.type) {
      case 'gradient':
        if (!Array.isArray(L.stops) || L.stops.length < 2 || L.stops.length > 4 || !L.stops.every((st) => Array.isArray(st) && isColor(st[0]) && isNum(st[1])))
          bad(w + '.stops', '2-4 stops like ["#102030", 0.5]');
        break;
      case 'stars':
        if (!(Number.isInteger(L.count) && L.count > 0)) bad(w + '.count', 'integer > 0');
        else points += L.count;
        if (L.area !== undefined && !isVec(L.area, 4)) bad(w + '.area', '[left, top, right, bottom] in 0..1');
        if (L.size !== undefined && !isVec(L.size, 2)) bad(w + '.size', '[min, max] pixels at 1080p');
        if (L.color !== undefined && !isColor(L.color)) bad(w + '.color', '#rrggbb');
        break;
      case 'mesh':
        if (typeof L.model !== 'string' || !/\.obj$/i.test(L.model)) bad(w + '.model', 'an .obj file');
        for (const k of ['position', 'rotation']) if (L[k] !== undefined && !isVec(L[k], 3)) bad(w + '.' + k, '[x, y, z]');
        if (L.scale !== undefined && !isNum(L.scale) && !isVec(L.scale, 3)) bad(w + '.scale', 'number or [x, y, z]');
        if (L.spin !== undefined && !(['x', 'y', 'z'].includes(L.spin?.axis) && isNum(L.spin?.speed))) bad(w + '.spin', '{ axis: x|y|z, speed: degrees/s }');
        if (L.bob !== undefined && !(isVec(L.bob?.amount, 3) && isNum(L.bob?.period) && L.bob.period > 0)) bad(w + '.bob', '{ amount, period > 0 }');
        if (L.drift !== undefined && !(isVec(L.drift?.velocity, 3) && (L.drift.wrap === undefined || (isVec(L.drift.wrap, 2) && L.drift.wrap[1] > L.drift.wrap[0]))))
          bad(w + '.drift', '{ velocity: [x,y,z], wrap?: [min, max] }');
        if (L.instances !== undefined && !(Array.isArray(L.instances) && L.instances.length <= LIMITS.instances && L.instances.every((x) => isVec(x, 5))))
          bad(w + '.instances', `up to ${LIMITS.instances} of [x, y, z, yaw, scale]`);
        pulse();
        if (L.animate !== undefined) {
          const A = L.animate;
          const keyOk = (k) => k && isNum(k.t) && k.t >= 0 && k.t <= 1
            && ['position', 'rotation', 'scale'].every((f) => k[f] === undefined || isVec(k[f], 3));
          if (!(isNum(A?.period) && A.period > 0 && Array.isArray(A.keys) && A.keys.length >= 2 && A.keys.length <= 32 && A.keys.every(keyOk)
            && A.keys.every((k, j) => j === 0 || k.t >= A.keys[j - 1].t)))
            bad(w + '.animate', '{ period > 0, keys: 2-32 of { t: 0..1 ascending, position?, rotation?, scale? } }');
        }
        break;
      case 'particles':
        if (!(Number.isInteger(L.count) && L.count > 0)) bad(w + '.count', 'integer > 0');
        else points += L.count;
        if (!isVec(L.box, 6)) bad(w + '.box', '[minX, minY, minZ, maxX, maxY, maxZ]');
        if (L.velocity !== undefined && !isVec(L.velocity, 3)) bad(w + '.velocity', '[x, y, z] per second');
        if (!(isNum(L.size) && L.size > 0)) bad(w + '.size', 'world units > 0');
        if (L.color !== undefined && !isColor(L.color)) bad(w + '.color', '#rrggbb');
        if (L.blend !== undefined && !['add', 'alpha'].includes(L.blend)) bad(w + '.blend', 'add or alpha');
        break;
      case 'glow': {
        const ps = L.positions ?? (L.position ? [L.position] : null);
        if (!Array.isArray(ps) || !ps.length || !ps.every((p) => isVec(p, 3))) bad(w + '.positions', '[[x, y, z], ...] (or position)');
        else points += ps.length;
        if (!(isNum(L.radius) && L.radius > 0)) bad(w + '.radius', 'world units > 0');
        if (L.color !== undefined && !isColor(L.color)) bad(w + '.color', '#rrggbb');
        pulse();
        break;
      }
    }
  });
  if (points > LIMITS.points) bad('layers', `${points} points (stars + particles + glows), at most ${LIMITS.points}`);
  return err;
}

/** Files a scene needs at runtime, relative to its folder (scene.json first). */
export function sceneFiles(s, objTexts = new Map()) {
  const files = ['scene.json'];
  const add = (p) => { if (p && !files.includes(p)) files.push(p); };
  if (s.music?.file) add(normPath('', s.music.file));
  for (const L of s.layers ?? []) if (L.type === 'mesh' && typeof L.model === 'string') {
    const obj = normPath('', L.model);
    add(obj);
    const text = objTexts.get(obj);
    if (text) for (const m of mtllibs(text)) add(normPath(obj.split('/').slice(0, -1).join('/'), m));
  }
  return files;
}
const mtllibs = (text) => [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);

/**
 * Load a scene through read(path) -> Promise<Uint8Array> (paths relative to the scene folder).
 * Throws with every problem found. Returns { scene, models: Map<path, mesh>, midi, files, triangles }.
 */
export async function loadScene(read) {
  const dec = new TextDecoder();
  const scene = JSON.parse(dec.decode(await read('scene.json')));
  const errs = validateScene(scene);
  if (errs.length) throw new Error(errs.join('\n'));
  const models = new Map(), objTexts = new Map();
  let triangles = 0;
  for (const L of scene.layers) if (L.type === 'mesh') {
    const path = normPath('', L.model);
    if (!path) throw new Error(`model outside the scene folder: ${L.model}`);
    if (models.has(path)) continue;
    const text = dec.decode(await read(path));
    objTexts.set(path, text);
    const mats = new Map();
    for (const lib of mtllibs(text)) {
      const mp = normPath(path.split('/').slice(0, -1).join('/'), lib);
      if (!mp) throw new Error(`mtllib outside the scene folder: ${lib}`);
      for (const [k, m] of parseMtl(dec.decode(await read(mp)))) mats.set(k, m);
    }
    models.set(path, parseObj(text, mats));
  }
  for (const L of scene.layers) if (L.type === 'mesh') triangles += models.get(normPath('', L.model)).tris * (L.instances?.length ?? 1);
  if (triangles > LIMITS.triangles) throw new Error(`${triangles} triangles, at most ${LIMITS.triangles}`);
  const midi = scene.music ? await read(normPath('', scene.music.file)) : null;
  return { scene, models, midi, files: sceneFiles(scene, objTexts), triangles };
}

// ---- renderer --------------------------------------------------------------------------

const VS_MESH = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute float aEmi;
uniform mat4 uM, uVP; uniform mat3 uR; uniform vec3 uEye, uLightDir, uLightCol, uAmb;
uniform float uPulse, uFogOn; uniform vec2 uFog;
varying vec3 vCol; varying float vFog;
void main() {
  vec4 w = uM * vec4(aPos, 1.0);
  vec3 n = normalize(uR * aNrm);
  vec3 lit = aCol * (uAmb + uLightCol * max(dot(n, -uLightDir), 0.0));
  vCol = mix(lit, aCol * uPulse, aEmi);
  float f = clamp((distance(w.xyz, uEye) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  vFog = uFogOn * f * (1.0 - 0.5 * aEmi);
  gl_Position = uVP * w;
}`;
const FS_MESH = `
precision mediump float;
uniform vec3 uFogCol; varying vec3 vCol; varying float vFog;
void main() { gl_FragColor = vec4(mix(vCol, uFogCol, vFog), 1.0); }`;
const VS_FULL = `
attribute vec2 aXY; varying vec2 vUV;
void main() { vUV = vec2(0.5 + 0.5 * aXY.x, 0.5 - 0.5 * aXY.y); gl_Position = vec4(aXY, 0.0, 1.0); }`;
const FS_GRAD = `
precision mediump float;
uniform vec3 uC[4]; uniform vec4 uP; uniform float uN; varying vec2 vUV;
void main() {
  float v = vUV.y; vec3 c = uC[0];
  if (v > uP.x) c = mix(uC[0], uC[1], clamp((v - uP.x) / max(uP.y - uP.x, 1e-4), 0.0, 1.0));
  if (uN > 2.5 && v > uP.y) c = mix(uC[1], uC[2], clamp((v - uP.y) / max(uP.z - uP.y, 1e-4), 0.0, 1.0));
  if (uN > 3.5 && v > uP.z) c = mix(uC[2], uC[3], clamp((v - uP.z) / max(uP.w - uP.z, 1e-4), 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}`;
// Lumen's legibility scrim (main.c bake_scrim), for previews that show the dashboard look
const FS_SCRIM = `
precision mediump float;
uniform float uDim; varying vec2 vUV;
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
void main() {
  float l = 1.0 - ss(0.0, 0.64, vUV.x); l = 0.70 * l * (0.55 + 0.45 * l);
  float k = (1.0 - l) * (1.0 - 0.60 * ss(0.62, 1.0, vUV.y)) * (1.0 - 0.45 * (1.0 - ss(0.0, 0.24, vUV.y))) * (1.0 - uDim);
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - k);
}`;
const VS_PT = `
attribute vec4 aClip; attribute float aSize; attribute vec4 aCol; varying vec4 vCol;
void main() { vCol = aCol; gl_Position = aClip; gl_PointSize = aSize; }`;
const FS_PT = `
precision mediump float;
uniform float uGlow; varying vec4 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = uGlow > 0.5 ? pow(max(1.0 - d, 0.0), 2.0) : 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(vCol.rgb * vCol.a * a, vCol.a * a);
}`;

function program(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
  const a = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getAttribLocation(p, k))) });
  return { p, u, a };
}

/** Pure scene state at time t: camera and the generated points. Shared by the renderer and tests. */
export function cameraAt(scene, t, aspect) {
  const cam = scene.camera ?? {};
  const target = cam.target ?? [0, 0, 0];
  let eye = (cam.position ?? [0, 2, 10]).slice();
  if (cam.orbit) {
    const a = (cam.orbit.degrees * Math.PI / 180) * Math.sin(TAU * t / cam.orbit.period);
    const d = sub3(eye, target), c = Math.cos(a), s = Math.sin(a);
    eye = [target[0] + d[0] * c + d[2] * s, eye[1], target[2] - d[0] * s + d[2] * c];
  }
  if (cam.bob) { const k = Math.sin(TAU * t / cam.bob.period); eye = eye.map((x, i) => x + cam.bob.amount[i] * k); }
  const fov = ((cam.fov ?? 50) * Math.PI) / 180;
  const P = M4.persp(fov, aspect, 0.1, 500), V = M4.look(eye, target, [0, 1, 0]);
  return { eye, VP: M4.mul(P, V), fov };
}

/**
 * Keyframe pose at time t: { position (offset), rotation (offset, degrees), scale (multiplier) }.
 * Keys are at fractions t of the period; between two keys the value eases with smoothstep;
 * before the first / after the last key it eases from the last key to the first (the loop).
 * A key without a field keeps that field at its neutral value (0 offset, scale 1).
 */
export function animPose(A, t) {
  const out = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  if (!A) return out;
  const u = (((t / A.period) % 1) + 1) % 1, K = A.keys, n = K.length;
  let i = n - 1;
  for (let j = 0; j < n; j++) if (K[j].t <= u) i = j;
  const a = K[u < K[0].t ? n - 1 : i], b = K[u < K[0].t ? 0 : (i + 1) % n];
  let span = b.t - a.t, d = u - a.t;
  if (span <= 0) span += 1;
  if (d < 0) d += 1;
  const f = span > 0 ? Math.min(1, d / span) : 0, e = f * f * (3 - 2 * f);
  for (const [k, neutral] of [['position', 0], ['rotation', 0], ['scale', 1]]) {
    const va = a[k] ?? [neutral, neutral, neutral], vb = b[k] ?? [neutral, neutral, neutral];
    for (let c = 0; c < 3; c++) out[k][c] = va[c] + (vb[c] - va[c]) * e;
  }
  return out;
}

export function meshMatrices(L, t) {
  const pose = animPose(L.animate, t);
  const pos = (L.position ?? [0, 0, 0]).map((x, i) => x + pose.position[i]);
  if (L.bob) { const k = Math.sin(TAU * t / L.bob.period); for (let i = 0; i < 3; i++) pos[i] += L.bob.amount[i] * k; }
  const rot = (L.rotation ?? [0, 0, 0]).map((x, i) => x + pose.rotation[i]);
  if (L.spin) rot['xyz'.indexOf(L.spin.axis)] += L.spin.speed * t;
  const sc = (typeof L.scale === 'number' ? [L.scale, L.scale, L.scale] : L.scale ?? [1, 1, 1]).map((x, i) => x * pose.scale[i]);
  const R = M4.rot(rot), base = M4.mul(M4.tr(pos), M4.mul(R, M4.sc(sc)));
  const out = [];
  for (const [x, y, z, yaw, s] of L.instances ?? [[0, 0, 0, 0, 1]]) {
    let p = [x, y, z];
    if (L.drift) {
      p = p.map((c, i) => c + L.drift.velocity[i] * t);
      if (L.drift.wrap) p[0] = wrap(p[0], L.drift.wrap[0], L.drift.wrap[1]);
    }
    const I = M4.mul(M4.tr(p), M4.mul(M4.ry(yaw * Math.PI / 180), M4.sc([s, s, s])));
    const ry = M4.ry(yaw * Math.PI / 180);
    out.push({ M: M4.mul(base, I), R: mat3of(M4.mul(R, ry)) });
  }
  return out;
}

const pulseAt = (p, t, phase = 0) => (p ? p.min + (1 - p.min) * (0.5 + 0.5 * Math.sin(TAU * (t / p.period + phase))) : 1);

export class ScenePlayer {
  /** @param {HTMLCanvasElement} canvas @param {Awaited<ReturnType<typeof loadScene>>} loaded */
  constructor(canvas, loaded, { scrim = -1 } = {}) {
    this.canvas = canvas; this.l = loaded; this.s = loaded.scene; this.scrim = scrim;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.pMesh = program(gl, VS_MESH, FS_MESH);
    this.pGrad = program(gl, VS_FULL, FS_GRAD);
    this.pScrim = program(gl, VS_FULL, FS_SCRIM);
    this.pPt = program(gl, VS_PT, FS_PT);
    this.full = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.full);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vbo = new Map();
    for (const [path, m] of loaded.models) {
      const mk = (arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return b; };
      this.vbo.set(path, { pos: mk(m.pos), nrm: mk(m.nrm), col: mk(m.col), emi: mk(m.emi), n: m.tris * 3 });
    }
    this.ptBuf = gl.createBuffer();
    // generated points, fixed per layer (seed = layer.seed ?? index + 1)
    this.gen = this.s.layers.map((L, i) => {
      const r = rng(L.seed ?? i + 1);
      if (L.type === 'stars') return Array.from({ length: L.count }, () => [r(), r(), r(), r()]);
      if (L.type === 'particles') return Array.from({ length: L.count }, () => [r(), r(), r(), r()]);
      return null;
    });
    this.maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
  }

  resize() {
    const res = this.s.resolution ?? 0.5;
    const w = Math.max(16, Math.round(this.canvas.clientWidth * (window.devicePixelRatio || 1) * res));
    const h = Math.max(9, Math.round(this.canvas.clientHeight * (window.devicePixelRatio || 1) * res));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  draw(t) {
    const gl = this.gl, s = this.s, W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    const fogC = color(s.fog?.color, [0, 0, 0]);
    gl.clearColor(fogC[0], fogC[1], fogC[2], 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { eye, VP, fov } = cameraAt(s, t, W / H);
    const proj = H / 2 / Math.tan(fov / 2);   // pixels per world unit at distance 1
    const light = s.light ?? {};
    const ldir = norm3(light.direction ?? [-0.4, -1, -0.3]);
    const lcol = color(light.color, [1, 1, 1]), amb = color(light.ambient, [0.25, 0.25, 0.3]);
    const fog = s.fog ? [s.fog.near, s.fog.far] : [1e6, 1e6 + 1];
    const fogOf = (w) => (s.fog ? Math.min(1, Math.max(0, (Math.hypot(w[0] - eye[0], w[1] - eye[1], w[2] - eye[2]) - fog[0]) / (fog[1] - fog[0]))) : 0);

    s.layers.forEach((L, i) => {
      if (L.type === 'gradient') {
        const { p, u, a } = this.pGrad;
        gl.useProgram(p); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        const st = L.stops.slice(0, 4);
        const cs = [], ps = [];
        for (let k = 0; k < 4; k++) { const e = st[Math.min(k, st.length - 1)]; cs.push(...color(e[0])); ps.push(e[1]); }
        gl.uniform3fv(u.uC, cs); gl.uniform4fv(u.uP, ps); gl.uniform1f(u.uN, st.length);
        this.fullDraw(a.aXY);
      } else if (L.type === 'mesh') {
        const { p, u, a } = this.pMesh, b = this.vbo.get(normPath('', L.model));
        gl.useProgram(p); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
        gl.uniformMatrix4fv(u.uVP, false, VP);
        gl.uniform3fv(u.uEye, eye); gl.uniform3fv(u.uLightDir, ldir); gl.uniform3fv(u.uLightCol, lcol); gl.uniform3fv(u.uAmb, amb);
        gl.uniform2fv(u.uFog, fog); gl.uniform3fv(u.uFogCol, fogC); gl.uniform1f(u.uFogOn, L.fog === false ? 0 : 1);
        gl.uniform1f(u.uPulse, pulseAt(L.pulse, t));
        const attr = (loc, buf, n) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); };
        attr(a.aPos, b.pos, 3); attr(a.aNrm, b.nrm, 3); attr(a.aCol, b.col, 3); attr(a.aEmi, b.emi, 1);
        for (const m of meshMatrices(L, t)) {
          gl.uniformMatrix4fv(u.uM, false, m.M); gl.uniformMatrix3fv(u.uR, false, m.R);
          gl.drawArrays(gl.TRIANGLES, 0, b.n);
        }
        for (const loc of [a.aPos, a.aNrm, a.aCol, a.aEmi]) gl.disableVertexAttribArray(loc);
      } else {
        const pts = [];   // x y z w size r g b a
        const c = color(L.color, [1, 1, 1]);
        if (L.type === 'stars') {
          const [x0, y0, x1, y1] = L.area ?? [0, 0, 1, 0.6], [s0, s1] = L.size ?? [1, 2.5];
          const tw = L.twinkle ?? 3, k = H / 1080;
          for (const [ru, rv, rs, ph] of this.gen[i]) {
            const al = (0.55 + 0.45 * Math.sin(TAU * (t / tw + ph))) * (L.opacity ?? 1);
            pts.push((x0 + ru * (x1 - x0)) * 2 - 1, 1 - 2 * (y0 + rv * (y1 - y0)), 0, 1, Math.max(1, (s0 + rs * (s1 - s0)) * k), c[0], c[1], c[2], al);
          }
        } else if (L.type === 'particles') {
          const [ax, ay, az, bx, by, bz] = L.box, v = L.velocity ?? [0, 0.2, 0], j = L.jitter ?? 0;
          for (const [rx, ry, rz, ph] of this.gen[i]) {
            const w = [wrap(ax + rx * (bx - ax) + v[0] * t, ax, bx), wrap(ay + ry * (by - ay) + v[1] * t, ay, by), wrap(az + rz * (bz - az) + v[2] * t, az, bz)];
            w[0] += j * Math.sin(TAU * (t / 6 + ph)); w[2] += j * Math.cos(TAU * (t / 7 + ph));
            const e = by > ay ? (w[1] - ay) / (by - ay) : 0.5;
            const al = (L.opacity ?? 0.6) * sstep(0, 0.15, e) * (1 - sstep(0.85, 1, e)) * (1 - fogOf(w));
            const cl = M4.xf(VP, [w[0], w[1], w[2], 1]);
            if (cl[3] <= 0.1) continue;
            pts.push(cl[0], cl[1], cl[2], cl[3], Math.min(this.maxPt, Math.max(1, (L.size * proj) / cl[3])), c[0], c[1], c[2], al);
          }
        } else if (L.type === 'glow') {
          (L.positions ?? [L.position]).forEach((w, k) => {
            const cl = M4.xf(VP, [w[0], w[1], w[2], 1]);
            if (cl[3] <= 0.1) return;
            const al = (L.intensity ?? 0.8) * pulseAt(L.pulse, t, k * 0.37) * (1 - 0.7 * fogOf(w));
            pts.push(cl[0], cl[1], cl[2], cl[3], Math.min(this.maxPt, (2 * L.radius * proj) / cl[3]), c[0], c[1], c[2], al);
          });
        }
        this.drawPoints(pts, L.type === 'glow', L.type === 'stars', L.type === 'particles' && L.blend === 'alpha');
      }
    });
    if (this.scrim >= 0) {
      const { p, u, a } = this.pScrim;
      gl.useProgram(p); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(u.uDim, this.scrim);
      this.fullDraw(a.aXY);
    }
  }

  fullDraw(loc) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.full);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(loc);
  }

  drawPoints(pts, glow, flat, alphaBlend) {
    if (!pts.length) return;
    const gl = this.gl, { p, u, a } = this.pPt;
    gl.useProgram(p);
    if (flat) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    // colours are premultiplied in the shader
    if (alphaBlend) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(u.uGlow, glow ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STREAM_DRAW);
    const st = 36;
    gl.enableVertexAttribArray(a.aClip); gl.vertexAttribPointer(a.aClip, 4, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(a.aSize); gl.vertexAttribPointer(a.aSize, 1, gl.FLOAT, false, st, 16);
    gl.enableVertexAttribArray(a.aCol); gl.vertexAttribPointer(a.aCol, 4, gl.FLOAT, false, st, 20);
    gl.drawArrays(gl.POINTS, 0, pts.length / 9);
    for (const loc of [a.aClip, a.aSize, a.aCol]) gl.disableVertexAttribArray(loc);
    gl.depthMask(true);
  }

  /** Start the animation loop; returns a stop function. */
  start() {
    let raf = 0, t0 = performance.now();
    const tick = (now) => { this.resize(); this.draw((now - t0) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }
}

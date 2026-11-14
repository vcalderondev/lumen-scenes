// Reads every scene from disk, validates it and describes its files (used by validate and index).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { loadScene, LIMITS } from '../../player/lumen-scene.mjs';
import { renderMidi, parseMidi } from '../../player/lumen-synth.mjs';

export const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base)); else out.push(relative(base, p));
  }
  return out;
}

/** @returns {Promise<Array<{id, dir, ok, errors: string[], warnings: string[], entry?: object}>>} */
export async function scanScenes({ renderAudio = true } = {}) {
  const results = [];
  const sdir = join(ROOT, 'scenes');
  for (const id of readdirSync(sdir).sort()) {
    const dir = join(sdir, id);
    if (!statSync(dir).isDirectory()) continue;
    const errors = [], warnings = [];
    const res = { id, dir, errors, warnings, ok: false };
    results.push(res);
    if (!existsSync(join(dir, 'scene.json'))) { errors.push('no scene.json'); continue; }
    let loaded;
    try {
      loaded = await loadScene(async (p) => {
        const f = join(dir, p);
        if (!f.startsWith(dir + '/')) throw new Error('path outside the scene: ' + p);
        if (!existsSync(f)) throw new Error('missing file: ' + p);
        return new Uint8Array(readFileSync(f));
      });
    } catch (e) { errors.push(...String(e.message).split('\n')); continue; }
    const s = loaded.scene;
    if (s.id !== id) errors.push(`id "${s.id}" must match the folder name "${id}"`);
    let total = 0;
    const files = loaded.files.map((p) => {
      const b = readFileSync(join(dir, p));
      total += b.length;
      if (b.length > LIMITS.fileBytes) errors.push(`${p}: ${b.length} bytes, at most ${LIMITS.fileBytes}`);
      return { path: p, size: b.length, sha256: createHash('sha256').update(b).digest('hex') };
    });
    if (total > LIMITS.sceneBytes) errors.push(`scene is ${total} bytes, at most ${LIMITS.sceneBytes}`);
    if (loaded.midi) {
      if (loaded.midi.length > LIMITS.midiBytes) errors.push(`music: ${loaded.midi.length} bytes, at most ${LIMITS.midiBytes}`);
      try {
        parseMidi(loaded.midi);
        if (renderAudio) {
          const r = renderMidi(loaded.midi);
          res.seconds = +r.seconds.toFixed(1);
          if (r.seconds < 5) warnings.push(`music is only ${r.seconds.toFixed(1)} s long`);
          let peak = 0;
          for (let i = 0; i < r.left.length; i++) peak = Math.max(peak, Math.abs(r.left[i]), Math.abs(r.right[i]));
          if (peak >= 0.999) warnings.push('music clips (peak at full scale): lower channel volumes (CC 7)');
          if (peak < 0.05) warnings.push('music is nearly silent');
          res.peak = +peak.toFixed(3);
        }
      } catch (e) { errors.push('music: ' + e.message); }
    }
    for (const f of listFiles(dir)) {
      if (f.startsWith('source/') || f === 'preview.jpg' || f === 'README.md' || loaded.files.includes(f)) continue;
      warnings.push(`unused file: ${f} (not referenced by scene.json; move sources to source/)`);
    }
    res.triangles = loaded.triangles;
    res.ok = !errors.length;
    res.entry = {
      id: s.id, version: s.version, name: s.name, author: s.author, license: s.license,
      description: s.description ?? '', games: s.games, music: !!s.music,
      triangles: loaded.triangles, bytes: total, files,
    };
  }
  return results;
}

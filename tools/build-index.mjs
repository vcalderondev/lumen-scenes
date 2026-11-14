#!/usr/bin/env node
// Regenerates index.json from scenes/ (only valid scenes are listed).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanScenes, ROOT } from './lib/scan.mjs';
import { buildIndex } from './lib/index.mjs';

const results = await scanScenes({ renderAudio: false });
for (const r of results) if (!r.ok) console.error(`skipped ${r.id}: ${r.errors.join('; ')}`);
const idx = buildIndex(results);
writeFileSync(join(ROOT, 'index.json'), JSON.stringify(idx, null, 2) + '\n');
console.log(`index.json: ${idx.scenes.length} scene(s)`);

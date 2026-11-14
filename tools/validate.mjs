#!/usr/bin/env node
// Validates every scene and checks that index.json is up to date. Exit 1 on any error.
//   node tools/validate.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { scanScenes, ROOT } from './lib/scan.mjs';
import { buildIndex } from './lib/index.mjs';

const results = await scanScenes();
let failed = 0;
for (const r of results) {
  const info = r.ok ? ` (${r.triangles} triangles${r.seconds ? `, music ${r.seconds} s, peak ${r.peak}` : ''})` : '';
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}${info}`);
  for (const e of r.errors) console.log(`       error: ${e}`);
  for (const w of r.warnings) console.log(`       warning: ${w}`);
  if (!r.ok) failed++;
}
// the same game claimed by two scenes is fine (the web lets the user pick), the same serial twice in one scene is not
const want = JSON.stringify(buildIndex(results), null, 2) + '\n';
const have = existsSync(join(ROOT, 'index.json')) ? readFileSync(join(ROOT, 'index.json'), 'utf8') : '';
if (!failed && want !== have) { console.log('FAIL index.json is out of date: run `npm run index`'); failed++; }
console.log(failed ? `\n${failed} problem(s)` : `\n${results.length} scene(s) valid`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Validate content packs.   node tools/validate-content.mjs [pack.js ...]   |   node tools/validate-content.mjs --schema
// With no args: validates everything in content/manifest.js. With pack files: base manifest + those files.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadContent } from '../js/content/load.js';
import { SCHEMA } from '../js/content/schema.js';
import { describe } from '../js/content/validate.js';

const args = process.argv.slice(2);

function printFields(fields, indent) {
  for (const [k, f] of Object.entries(fields)) {
    const req = f.required ? ' (required)' : f.default !== undefined ? ` (default ${JSON.stringify(f.default)})` : ' (optional)';
    console.log(`${indent}${k}: ${describe(f)}${req}${f.doc ? ' - ' + f.doc : ''}`);
    if (f.type === 'object' && f.fields) printFields(f.fields, indent + '    ');
    if (f.type === 'list' && f.of && f.of.type === 'object') printFields(f.of.fields, indent + '    ');
  }
}

if (args.includes('--schema')) {
  for (const [type, s] of Object.entries(SCHEMA)) {
    console.log(`\n== ${s.plural}  (each entry is a ${type})\n${s.doc}`);
    printFields(s.fields, '  ');
  }
  process.exit(0);
}

const extraUrls = args.map((a) => pathToFileURL(resolve(a)).href);
const reg = await loadContent({ extraUrls });

for (const w of reg.warnings) console.log('warning:', w);
for (const e of reg.errors) console.log('ERROR:  ', e);
const counts = Object.entries(reg.maps).map(([t, m]) => `${m.size} ${t}${m.size === 1 ? '' : 's'}`).join(', ');
console.log(`\nloaded ${reg.packs.length} pack(s): ${counts}`);
if (reg.errors.length) { console.log(`${reg.errors.length} error(s) - fix them and run again.`); process.exit(1); }
console.log('OK');

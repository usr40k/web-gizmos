#!/usr/bin/env node
// How long does it take to cross each biome?   node tools/world-stats.mjs [seed] [lines]
// Casts random straight lines through the world and measures the stretches spent in one biome, in minutes at TPM tiles/minute.
import { loadContent } from '../js/content/load.js';
import { World, TPM } from '../js/world/world.js';
const seed = process.argv[2] || 'stats', lines = +process.argv[3] || 60;
const reg = await loadContent(); const w = new World(reg, seed);
const runs = {}, step = 25, len = 60000;
let rng = 12345; const rnd = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let l = 0; l < lines; l++) {
  const x0 = (rnd() - 0.5) * 80000, y0 = (rnd() - 0.5) * 80000, a = rnd() * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
  let cur = null, start = 0;
  for (let t = 0; t <= len; t += step) {
    const b = w.biomeAt(x0 + dx * t, y0 + dy * t);
    if (b !== cur) { if (cur && start > 0) (runs[cur.id] ||= []).push((t - start) / TPM); cur = b; start = t; }
  }
}
console.log(`seed "${seed}", macro cell ${w.G} tiles, ${TPM} tiles/min\n`);
console.log('biome'.padEnd(12), 'scale', 'runs', ' min   median   max   (minutes to cross along a straight line)');
for (const b of w.biomes) {
  const r = (runs[b.id] || []).sort((p, q) => p - q);
  if (!r.length) { console.log(b.id.padEnd(12), String(b.scale).padStart(5), '   0'); continue; }
  const q = (f) => r[Math.min(r.length - 1, Math.floor(r.length * f))].toFixed(1).padStart(5);
  console.log(b.id.padEnd(12), String(b.scale).padStart(5), String(r.length).padStart(4), q(0), ' ', q(0.5), ' ', q(1));
}
const all = Object.values(runs).flat().sort((a, b) => a - b);
console.log(`\noverall: median ${all[all.length >> 1].toFixed(1)} min, 90th percentile ${all[Math.floor(all.length * 0.9)].toFixed(1)} min`);

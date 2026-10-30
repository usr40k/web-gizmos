// Loads every pack listed in content/manifest.js (+ optional ?pack=name for same-folder test packs).
import { Registry } from './registry.js';

export async function loadContent({ extraNames = [], extraUrls = [] } = {}) {
  const reg = new Registry();
  const manifest = (await import('../../content/manifest.js')).default;
  // ?pack=name only accepts plain names -> ./content/packs/<name>.js (same origin, never a URL)
  const files = [
    ...manifest.map((f) => new URL('../../content/' + f.replace(/^\.\//, ''), import.meta.url).href),
    ...extraNames.filter((n) => /^[a-z0-9_-]+$/i.test(n)).map((n) => new URL(`../../content/packs/${n}.js`, import.meta.url).href),
    ...extraUrls,
  ];
  for (const f of files) {
    const label = /\/content\//.test(f) ? f.replace(/^.*\/content\//, 'content/') : f.replace(/^.*\//, '');
    try {
      const mod = await import(f);
      reg.addPack(mod.default, label);
    } catch (e) {
      reg.errors.push(`${label}: failed to load - ${e.message}`);
    }
  }
  reg.finalize();
  return reg;
}

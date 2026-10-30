// Content registry. Packs are plain data (see content/packs/_template.js); this validates them, drops anything
// broken (with a clear message) instead of crashing, and answers get/list queries for the rest of the game.
import { SCHEMA, PACK_META, SLOTS } from './schema.js';
import { validateValue } from './validate.js';

export class Registry {
  constructor() {
    this.maps = {};
    for (const t of Object.keys(SCHEMA)) this.maps[t] = new Map();
    this.pending = [];   // entries awaiting cross-reference checks
    this.errors = [];
    this.warnings = [];
    this.packs = [];
  }

  addPack(pack, source) {
    if (!pack || typeof pack !== 'object') { this.errors.push(`${source}: pack must "export default { ... }" an object`); return; }
    this.packs.push({ source, id: pack.id || source, name: pack.name });
    const plurals = Object.values(SCHEMA).map((s) => s.plural);
    for (const k of Object.keys(pack)) {
      if (!plurals.includes(k) && !PACK_META.includes(k)) this.warnings.push(`${source}: unknown top-level key "${k}" ignored (allowed: ${[...PACK_META, ...plurals].join(', ')})`);
    }
    for (const [type, spec] of Object.entries(SCHEMA)) {
      const arr = pack[spec.plural];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) { this.errors.push(`${source}: "${spec.plural}" must be a list [ ... ]`); continue; }
      arr.forEach((entry, i) => this.addEntry(type, entry, `${source} ${spec.plural}[${i}]`));
    }
  }

  addEntry(type, entry, label) {
    const spec = SCHEMA[type];
    const ctx = { errors: [], warnings: [], refs: [] };
    const value = validateValue({ type: 'object', fields: spec.fields }, entry, label, ctx);
    const name = entry && entry.id ? ` (id "${entry.id}")` : '';
    for (const w of ctx.warnings) this.warnings.push(w);
    if (ctx.errors.length) {
      for (const e of ctx.errors) this.errors.push(e + name);
      this.errors.push(`${label}${name}: skipped because of the errors above`);
      return;
    }
    if (this.maps[type].has(value.id) || this.pending.some((p) => p.type === type && p.value.id === value.id)) {
      this.errors.push(`${label}: duplicate ${type} id "${value.id}" (first definition wins) - choose a unique id`);
      return;
    }
    this.pending.push({ type, value, refs: ctx.refs, label });
  }

  // Resolve references; drop entries that point at missing things (repeat until stable), then freeze lookup maps.
  finalize() {
    const alive = new Set(this.pending.map((p) => `${p.type}:${p.value.id}`));
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of [...this.pending]) {
        let bad = null;
        for (const r of p.refs) if (!alive.has(`${r.type}:${r.id}`)) { bad = r; break; }
        if (!bad && p.type === 'building' && p.value.kind === 'race_pad' && !p.value.race) {
          this.errors.push(`${p.label} (id "${p.value.id}"): kind "race_pad" needs a "race" field naming a race id`);
          bad = {};
        } else if (bad && bad.id) {
          this.errors.push(`${bad.path}: no ${bad.type} with id "${bad.id}" exists (in "${p.value.id}"), so "${p.value.id}" was skipped`);
        }
        if (bad) { alive.delete(`${p.type}:${p.value.id}`); this.pending.splice(this.pending.indexOf(p), 1); changed = true; }
      }
    }
    for (const p of this.pending) this.maps[p.type].set(p.value.id, p.value);

    // every slot needs a free starter part, every world needs a start biome
    for (const slot of SLOTS) {
      const parts = this.list('part').filter((p) => p.slot === slot);
      if (!parts.some((p) => p.price === 0)) this.errors.push(`parts: slot "${slot}" has no free starter part (price: 0); the cheapest will be given for free`);
    }
    if (!this.list('biome').length) this.errors.push('biomes: no valid biome loaded - the game cannot start');
    else if (!this.list('biome').some((b) => b.start)) this.warnings.push('biomes: no biome has start: true, the first biome is used for spawning');
    this.pending = [];
    return this;
  }

  get(type, id) { return this.maps[type].get(id); }
  list(type) { return [...this.maps[type].values()]; }
}

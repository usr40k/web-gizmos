// Player profile: cash, fuel, garage and records. Serialised as plain JSON so it can be stored in
// localStorage (offline), a Matrix account-data event (persistent, per account) or anything else.
import { SLOTS } from '../content/schema.js';

export const CAR_COLORS = ['#e8453c', '#f28c28', '#f5d742', '#4fc860', '#2fb7d4', '#4a6cf0', '#a85cf0', '#f060b0', '#e8e8e8', '#33333a'];

export class Profile {
  constructor(reg, data = {}) {
    this.reg = reg;
    this.cash = Number.isFinite(data.cash) ? data.cash : 150;
    this.name = typeof data.name === 'string' ? data.name.slice(0, 16) : '';
    this.color = typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : CAR_COLORS[0];
    this.fuel = Number.isFinite(data.fuel) ? data.fuel : null;       // null -> full tank
    this.owned = new Set(Array.isArray(data.owned) ? data.owned : []);
    this.equipped = {};
    this.best = data.best && typeof data.best === 'object' ? { ...data.best } : {};   // raceId -> seconds
    this.stats = { coins: 0, races: 0, km: 0, ...(data.stats || {}) };
    this.pos = data.pos || null;                                      // last position, so rejoining resumes
    this.rev = data.rev || 0;
    // every slot always has an equipped, owned part (falls back to the cheapest = starter)
    for (const slot of SLOTS) {
      const parts = reg.list('part').filter((p) => p.slot === slot).sort((a, b) => a.price - b.price);
      const want = data.equipped && data.equipped[slot];
      const ok = parts.find((p) => p.id === want && (p.price === 0 || this.owned.has(p.id)));
      const pick = ok || parts[0];
      if (pick) { this.equipped[slot] = pick.id; this.owned.add(pick.id); }
    }
  }

  toJSON() {
    return { v: 1, rev: this.rev, name: this.name, color: this.color, cash: Math.round(this.cash), fuel: this.fuel === null ? null : +this.fuel.toFixed(2),
      owned: [...this.owned], equipped: this.equipped, best: this.best, stats: this.stats, pos: this.pos };
  }

  buy(partId) {
    const p = this.reg.get('part', partId);
    if (!p) return 'Unknown part';
    if (this.owned.has(partId)) return 'Already owned';
    if (this.cash < p.price) return 'Not enough cash';
    this.cash -= p.price; this.owned.add(partId); this.equipped[p.slot] = partId;
    return null;
  }
  equip(partId) {
    const p = this.reg.get('part', partId);
    if (!p || !this.owned.has(partId)) return false;
    this.equipped[p.slot] = partId; return true;
  }
}

const KEY = (room) => 'isodrive:profile:' + room;
export function loadLocal(room) {
  try { return JSON.parse(localStorage.getItem(KEY(room)) || 'null') || {}; } catch { return {}; }
}
export function saveLocal(room, profile) {
  try { localStorage.setItem(KEY(room), JSON.stringify(profile.toJSON())); } catch { /* storage may be blocked */ }
}

// Player profile: cash, fuel, garage and records. Serialised as plain JSON so it can be stored in
// localStorage (offline), a Matrix account-data event (persistent, per account) or anything else.
import { SLOTS } from '../content/schema.js';
import { canTow } from './trailer.js';

export const CAR_COLORS = ['#e8453c', '#f28c28', '#f5d742', '#4fc860', '#2fb7d4', '#4a6cf0', '#a85cf0', '#f060b0', '#e8e8e8', '#33333a'];

export class Profile {
  constructor(reg, data = {}) {
    this.reg = reg;
    this.cash = Number.isFinite(data.cash) ? data.cash : 150;
    this.name = typeof data.name === 'string' ? data.name.slice(0, 16) : '';
    this.color = typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : CAR_COLORS[0];
    this.fuel = Number.isFinite(data.fuel) ? data.fuel : null;       // null -> full tank
    this.owned = new Set(Array.isArray(data.owned) ? data.owned : []);
    const vs = reg.list('vehicle').slice().sort((a, b) => a.price - b.price);
    this.garage = new Set((Array.isArray(data.garage) ? data.garage : []).filter((id) => vs.some((v) => v.id === id)));
    if (vs[0]) this.garage.add(vs[0].id);
    this.vehicle = this.garage.has(data.vehicle) ? data.vehicle : (vs[0] && vs[0].id);
    this.trailers = new Set((Array.isArray(data.trailers) ? data.trailers : []).filter((id) => reg.get('trailer', id)));
    this.trailer = this.trailers.has(data.trailer) && !canTow(reg.get('vehicle', this.vehicle), reg.get('trailer', data.trailer)) ? data.trailer : null;
    const pk = data.parked;
    this.parked = pk && reg.get('trailer', pk.id) && [pk.x, pk.y, pk.th].every(Number.isFinite) ? { id: pk.id, x: pk.x, y: pk.y, th: pk.th } : null;     // trailer left standing in the world
    this.equipped = {};
    this.best = data.best && typeof data.best === 'object' ? { ...data.best } : {};   // raceId -> seconds
    this.stats = { coins: 0, races: 0, km: 0, ...(data.stats || {}) };
    this.pos = data.pos || null;                                      // last position, so rejoining resumes
    this.rev = data.rev || 0;
    this.tut = data.tut === true;                                     // tutorial finished or skipped
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
      owned: [...this.owned], garage: [...this.garage], vehicle: this.vehicle, trailers: [...this.trailers], trailer: this.trailer, parked: this.parked ? { id: this.parked.id, x: +this.parked.x.toFixed(1), y: +this.parked.y.toFixed(1), th: +this.parked.th.toFixed(2) } : null, equipped: this.equipped, best: this.best, stats: this.stats, pos: this.pos, tut: this.tut };
  }

  buy(partId) {
    const p = this.reg.get('part', partId);
    if (!p) return 'Unknown part';
    if (this.owned.has(partId)) return 'Already owned';
    if (this.cash < p.price) return 'Not enough cash';
    this.cash -= p.price; this.owned.add(partId); this.equipped[p.slot] = partId;
    return null;
  }
  buyVehicle(id) {
    const v = this.reg.get('vehicle', id);
    if (!v) return 'Unknown vehicle';
    if (this.garage.has(id)) return 'Already owned';
    if (this.cash < v.price) return 'Not enough cash';
    this.cash -= v.price; this.garage.add(id); this.vehicle = id; return null;
  }
  selectVehicle(id) {
    if (!this.garage.has(id)) return false;
    this.vehicle = id;
    if (this.trailer && canTow(this.reg.get('vehicle', id), this.reg.get('trailer', this.trailer))) this.trailer = null;   // cannot pull it: unhitch
    return true;
  }
  buyTrailer(id) {
    const t = this.reg.get('trailer', id);
    if (!t) return 'Unknown trailer';
    if (this.trailers.has(id)) return 'Already owned';
    if (this.cash < t.price) return 'Not enough cash';
    this.cash -= t.price; this.trailers.add(id); return null;
  }
  hitch(id) {                                    // id or null; returns an error string or ''
    if (id === null) { this.trailer = null; return ''; }
    if (!this.trailers.has(id)) return 'Not owned';
    const why = canTow(this.reg.get('vehicle', this.vehicle), this.reg.get('trailer', id));
    if (why) return why;
    this.trailer = id; return '';
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

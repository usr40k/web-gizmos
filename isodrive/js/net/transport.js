// Transport = how players find each other and where their data lives. The game only talks to this interface,
// so Matrix, MQTT, a Cloudflare Worker or WebRTC can be swapped in by writing one more class.
//
//   await t.connect({ room, name })     -> { seed, userId, displayName }
//   t.sendBeacon(obj)                   frequent, lossy, ephemeral position updates (t.beaconMs = suggested interval)
//   t.sendChat(text)
//   await t.loadProfile() / t.saveProfile(json)      durable per-player data
//   await t.publishScore(raceId, secs) / t.getScores(raceId)   shared leaderboard (best effort)
//   t.disconnect()
// Callbacks (assign before connect): onBeacon(id, data) onChat(id, name, text) onStatus(text, ok)

export class Transport {
  constructor() {
    this.kind = 'none'; this.beaconMs = 100;
    this.onBeacon = () => {}; this.onChat = () => {}; this.onStatus = () => {};
    this.userId = ''; this.displayName = '';
    this.portable = true; this.needsSetup = false; this.canSetup = false; this.saveMode = 'local';
  }
  async connect() { throw new Error('not implemented'); }
  sendBeacon() {} sendChat() {}
  async loadProfile() { return {}; }
  async saveProfile() {}
  async publishScore() {} async getScores() { return []; }
  async setupRoom() { return { ok: true }; }
  async logout() {}
  disconnect() {}
}

// Remote players: stores latest beacons and extrapolates smoothly between them (dead reckoning).
export class Peers {
  constructor() { this.map = new Map(); }
  update(id, d, now) {
    let p = this.map.get(id);
    if (!p) { p = { id, x: d.x, y: d.y, h: d.h, vx: 0, vy: 0, dx: d.x, dy: d.y, dh: d.h }; this.map.set(id, p); }
    p.x = d.x; p.y = d.y; p.h = d.h; p.vx = d.vx || 0; p.vy = d.vy || 0;
    p.name = d.n || p.name || id.slice(0, 8); p.color = d.c || p.color || '#ccc'; p.seen = now; p.rx = now;
  }
  remove(id) { this.map.delete(id); }
  // advance display positions; returns array of {x,y,h,name,color,id}
  tick(dt, now, ttl = 9000) {
    const out = [];
    for (const [id, p] of this.map) {
      if (now - p.seen > ttl) { this.map.delete(id); continue; }
      const ahead = Math.min(2.5, (now - p.rx) / 1000);
      const tx = p.x + p.vx * ahead, ty = p.y + p.vy * ahead;
      const k = 1 - Math.exp(-dt * 8);
      if (Math.hypot(tx - p.dx, ty - p.dy) > 30) { p.dx = tx; p.dy = ty; p.dh = p.h; }   // teleport / far jump
      p.dx += (tx - p.dx) * k; p.dy += (ty - p.dy) * k;
      let dh = p.h - p.dh; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.dh += dh * k;
      out.push({ id, x: p.dx, y: p.dy, h: p.dh, name: p.name, color: p.color });
    }
    return out;
  }
}

export const round2 = (v) => Math.round(v * 100) / 100;
export function packBeacon(car, name, color) {
  return { x: round2(car.x), y: round2(car.y), h: round2(car.h), vx: round2(car.vx), vy: round2(car.vy), n: name, c: color };
}
export function validBeacon(d) {
  return d && typeof d === 'object' && Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.h)
    && Math.abs(d.x) < 1e6 && Math.abs(d.y) < 1e6 && (d.n === undefined || typeof d.n === 'string') && (d.c === undefined || /^#[0-9a-f]{6}$/i.test(d.c));
}

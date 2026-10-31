// Procedural world. Everything is a pure function of (seed, coordinates), so every player who joins the same
// room with the same seed sees the identical world without any world data being sent over the network.
//
// Layout: roads form a wobbly lattice (spacing S). Biomes are jittered-Voronoi regions. Buildings sit in
// "slots" along roads. Props are scattered per tile. Coins come in trails along roads.
import { hash, rand01, noise1, strHash, clamp } from '../util/rng.js';

export const CHUNK = 16;        // tiles per chunk side
export const TPM = 600;         // tiles per minute at a typical cruising speed (~10 tiles/s). Biome "scale" is in minutes.
export const HS = 900;          // highway spacing: long, sparse roads (about 1.5 minutes apart)
export const S = HS;
export const ROAD_HALF = 1.9;   // half highway width (tiles)
export const SLOT = 400;        // roadside slot spacing along highways: buildings out here are remote
export const COIN_RUN = 120;    // spacing of coin trails
const PATCH = 1800;             // cell size of the patch-biome layer
const PATCH_CHANCE = 0.45;      // chance that a patch cell holds a patch

export class World {
  constructor(reg, seedStr, opts = {}) {
    this.reg = reg;
    this.seedStr = String(seedStr);
    this.seed = strHash(this.seedStr);
    this.biomes = reg.list('biome');
    for (const b of this.biomes) {
      b._props = b.props.map((p) => ({ def: reg.get('prop', p.prop), density: p.density }));
      b._roadside = b.roadside.map((r) => ({ def: reg.get('building', r.building), chance: r.chance }));
      b._wsum = 0;
    }
    this.startBiome = this.biomes.find((b) => b.start && !b.patch) || this.biomes.find((b) => !b.patch) || this.biomes[0];
    this.macro = this.biomes.filter((b) => !b.patch);
    this.patches = this.biomes.filter((b) => b.patch);
    if (!this.macro.length) this.macro = this.biomes;                       // pathological packs: everything is a macro biome
    this.wsum = this.macro.reduce((a, b) => a + b.weight, 0);
    this.pwsum = this.patches.reduce((a, b) => a + b.weight, 0);
    const avg = this.macro.reduce((a, b) => a + b.weight * b.scale, 0) / this.wsum;
    this.G = Math.max(1800, Math.min(9000, Math.round(TPM * avg * (opts.gFactor || 0.9))));    // macro seed spacing, calibrated from the content's scales
    this.macroCache = new Map(); this.patchCache = new Map();
    this.chunks = new Map();
    this.bldCache = new Map();
    this.collected = new Map();   // coin id -> time (ms) when it respawns
  }

  // ---------------------------------------------------------------- biomes
  // Two layers. MACRO regions come from a multiplicatively weighted Voronoi: each seed's pull is divided by its biome's
  // `scale`, so a scale-15 biome claims a far larger area than a scale-3 one. PATCH biomes are small blobs (1-2 minutes)
  // dropped inside macro regions (an oasis in the desert, a crater in the ashlands).
  macroSeed(rx, ry) {
    const key = rx + ',' + ry; let c = this.macroCache.get(key);
    if (c) return c;
    let biome, px, py;
    if (rx === 0 && ry === 0) { biome = this.startBiome; px = 0; py = 0; }
    else {
      let r = rand01(this.seed, rx, ry, 11) * this.wsum; biome = this.macro[this.macro.length - 1];
      for (const b of this.macro) { r -= b.weight; if (r <= 0) { biome = b; break; } }
      px = (rx + 0.2 + 0.6 * rand01(this.seed, rx, ry, 12)) * this.G; py = (ry + 0.2 + 0.6 * rand01(this.seed, rx, ry, 13)) * this.G;
    }
    c = { px, py, biome }; this.macroCache.set(key, c); return c;
  }
  macroAt(wx, wy) {
    const rx0 = Math.floor(wx / this.G), ry0 = Math.floor(wy / this.G);
    let best = null, bd = Infinity;
    for (let ry = ry0 - 1; ry <= ry0 + 1; ry++) for (let rx = rx0 - 1; rx <= rx0 + 1; rx++) {
      const c = this.macroSeed(rx, ry), d = Math.hypot(c.px - wx, c.py - wy) / c.biome.scale;
      if (d < bd) { bd = d; best = c; }
    }
    return best.biome;
  }
  patchCell(cx, cy) {
    const key = cx + ',' + cy; let c = this.patchCache.get(key);
    if (c !== undefined) return c;
    c = null;
    if (this.patches.length && rand01(this.seed, cx, cy, 51) < PATCH_CHANCE) {
      const px = (cx + 0.2 + 0.6 * rand01(this.seed, cx, cy, 52)) * PATCH, py = (cy + 0.2 + 0.6 * rand01(this.seed, cx, cy, 53)) * PATCH;
      let r = rand01(this.seed, cx, cy, 54) * this.pwsum, b = this.patches[this.patches.length - 1];
      for (const p of this.patches) { r -= p.weight; if (r <= 0) { b = p; break; } }
      const host = this.macroAt(px, py);
      const ok = (!b.inside.length || b.inside.includes(host.id)) && Math.hypot(px, py) > 900;       // never on top of the starting area
      if (ok) c = { px, py, biome: b, rad: b.scale * TPM / 2 * (0.8 + 0.4 * rand01(this.seed, cx, cy, 55)) };
    }
    this.patchCache.set(key, c); return c;
  }
  biomeAt(x, y) {
    // domain-warp so borders wiggle instead of being straight lines
    const wx = x + noise1(this.seed ^ 0x51, y / 700) * 120 + noise1(this.seed ^ 0x52, y / 90) * 12;
    const wy = y + noise1(this.seed ^ 0x77, x / 700) * 120 + noise1(this.seed ^ 0x78, x / 90) * 12;
    const cx0 = Math.floor(wx / PATCH), cy0 = Math.floor(wy / PATCH);
    for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
      const c = this.patchCell(cx, cy);
      if (c && Math.hypot(c.px - wx, c.py - wy) < c.rad) return c.biome;
    }
    return this.macroAt(wx, wy);
  }

  // ---------------------------------------------------------------- roads
  roadY(j, x) { return j * S + noise1(this.seed ^ (0x1000 + j * 7919), x / 320) * 30 + noise1(this.seed ^ (0x1800 + j * 7919), x / 70) * 3; }
  roadX(i, y) { return i * S + noise1(this.seed ^ (0x2000 + i * 7919), y / 320) * 30 + noise1(this.seed ^ (0x2800 + i * 7919), y / 70) * 3; }
  roadCenter(axis, idx, along) { return axis === 'H' ? this.roadY(idx, along) : this.roadX(idx, along); }
  // distance to the nearest road centre line (+ which road)
  roadAt(x, y) {
    const j = Math.round(y / S), i = Math.round(x / S);
    const dh = Math.abs(y - this.roadY(j, x)), dv = Math.abs(x - this.roadX(i, y));
    return dh <= dv ? { d: dh, axis: 'H', idx: j, along: x } : { d: dv, axis: 'V', idx: i, along: y };
  }
  nearestRoadPoint(x, y) {
    const j = Math.round(y / S), i = Math.round(x / S);
    const hx = x, hy = this.roadY(j, x), vx = this.roadX(i, y), vy = y;
    const dh = Math.hypot(hx - x, hy - y), dv = Math.hypot(vx - x, vy - y);
    return dh <= dv ? { x: hx, y: hy, h: 0 } : { x: vx, y: vy, h: Math.PI / 2 };
  }
  spawn() { return { x: 0, y: this.roadY(0, 0), h: 0 }; }

  // ---------------------------------------------------------------- buildings
  roadsideSlot(axis, idx, k, side) {
    const key = `${axis}${idx}:${k}:${side}`;
    if (this.bldCache.has(key)) return this.bldCache.get(key);
    const salt = idx * 131 + (axis === 'H' ? 1 : 2);
    const along = k * SLOT + 5 + rand01(this.seed, salt, k, side + 3) * (SLOT - 10);
    const rc = this.roadCenter(axis, idx, along);
    // biome decides what can stand here
    const probe = side * (ROAD_HALF + 3);
    const px = axis === 'H' ? along : rc + probe, py = axis === 'H' ? rc + probe : along;
    const biome = this.biomeAt(px, py);
    let r = rand01(this.seed, salt, k, side + 9), def = null;
    for (const rs of biome._roadside) { r -= rs.chance; if (r < 0) { def = rs.def; break; } }
    // TEMPORARY until settlements exist: guarantee a gas station, a shop and a race pad near the spawn point
    if (axis === 'H' && idx === 0 && k <= 1) {
      const pick = (kind) => (biome._roadside.find((x) => x.def.kind === kind) || {}).def || null;
      if (k === 0 && side === 1) def = pick('gas_station'); else if (k === 0 && side === -1) def = pick('shop'); else if (k === 1 && side === 1) def = pick('race_pad');
    }
    let b = null;
    if (def) {
      const w = def.width, d = def.depth;
      const perp = rc + side * (ROAD_HALF + 1.3 + d / 2);
      const cx = axis === 'H' ? along : perp, cy = axis === 'H' ? perp : along;
      const hx = axis === 'H' ? w / 2 : d / 2, hy = axis === 'H' ? d / 2 : w / 2;
      // reject if the footprint (plus margin) touches any road
      // (wide margin along the road to keep clear of cross roads, small margin across it)
      let clear = true;
      const mx = axis === 'H' ? 1.4 : 0.5, my = axis === 'H' ? 0.5 : 1.4;
      for (let a = -1; a <= 1 && clear; a++) for (let c = -1; c <= 1 && clear; c++) {
        const qx = cx + a * (hx + mx), qy = cy + c * (hy + my);
        if (this.roadAt(qx, qy).d < ROAD_HALF + 0.2) clear = false;
      }
      // horizontal-road buildings win ties, so overlap resolution never depends on generation order
      if (clear && axis === 'V') {
        const hs = this.buildingsInRect(cx - hx - 0.5, cy - hy - 0.5, cx + hx + 0.5, cy + hy + 0.5, ['H']);
        if (hs.length) clear = false;
      }
      if (clear) {
        const door = rc + side * (ROAD_HALF + 0.3);
        b = {
          key, def, axis, idx, side, biome,
          x: cx, y: cy, hx, hy, x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy,
          doorX: axis === 'H' ? cx : door, doorY: axis === 'H' ? door : cy,
          along,
        };
      }
    }
    this.bldCache.set(key, b);
    return b;
  }
  buildingsInRect(x0, y0, x1, y1, axes = ['H', 'V']) {
    const out = [], pad = 12;
    for (const axis of axes) {
      const lo = axis === 'H' ? y0 : x0, hi = axis === 'H' ? y1 : x1;
      const a0 = axis === 'H' ? x0 : y0, a1 = axis === 'H' ? x1 : y1;
      for (let idx = Math.floor((lo - pad) / S); idx <= Math.ceil((hi + pad) / S); idx++) {
        for (let k = Math.floor((a0 - pad) / SLOT); k <= Math.ceil((a1 + pad) / SLOT); k++) {
          for (const side of [-1, 1]) {
            const b = this.roadsideSlot(axis, idx, k, side);
            if (b && b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1) out.push(b);
          }
        }
      }
    }
    return out;
  }

  // nearest building of a kind to (x,y), searching outward; null if none within maxR
  findNearest(kind, x, y, maxR = 500) {
    for (let r = 60; r <= maxR; r *= 2) {
      let best = null, bd = Infinity;
      for (const b of this.buildingsInRect(x - r, y - r, x + r, y + r)) {
        if (b.def.kind !== kind) continue;
        const d = Math.hypot(b.doorX - x, b.doorY - y);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) return best;
    }
    return null;
  }

  // ---------------------------------------------------------------- chunks (ground + props)
  chunk(cx, cy) {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (c) return c;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const blds = this.buildingsInRect(x0 - 4, y0 - 4, x0 + CHUNK + 4, y0 + CHUNK + 4);
    const ground = new Uint8Array(CHUNK * CHUNK), flag = new Uint8Array(CHUNK * CHUNK), bidx = new Uint8Array(CHUNK * CHUNK);
    const props = [];
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const tx = x0 + lx, ty = y0 + ly, px = tx + 0.5, py = ty + 0.5, i = ly * CHUNK + lx;
      const biome = this.biomeAt(px, py);
      bidx[i] = this.biomes.indexOf(biome);
      const ri = this.roadAt(px, py);
      ground[i] = hash(this.seed, tx, ty, 5) % biome.palette.ground.length;
      if (ri.d <= ROAD_HALF) {
        let f = 1;
        if (ri.d < 0.4 && Math.floor(ri.along / 2) % 2 === 0) f = 2;
        else if (ri.d > ROAD_HALF - 0.45) f = 3;
        flag[i] = f;
        continue;
      }
      // scenery
      let r = rand01(this.seed, tx, ty, 21), def = null;
      for (const p of biome._props) { r -= p.density; if (r < 0) { def = p.def; break; } }
      if (!def || ri.d < ROAD_HALF + 1.0) continue;
      const ox = px + (rand01(this.seed, tx, ty, 22) - 0.5) * 0.7, oy = py + (rand01(this.seed, tx, ty, 23) - 0.5) * 0.7;
      if (blds.some((b) => ox > b.x0 - 0.9 && ox < b.x1 + 0.9 && oy > b.y0 - 0.9 && oy < b.y1 + 0.9)) continue;
      props.push({ x: ox, y: oy, def });
    }
    c = { cx, cy, x0, y0, ground, flag, bidx, props, canvas: null };
    this.chunks.set(key, c);
    return c;
  }
  prune(cx, cy, keep = 7) {
    if (this.chunks.size < 160) return;
    for (const [k, c] of this.chunks) if (Math.abs(c.cx - cx) > keep || Math.abs(c.cy - cy) > keep) this.chunks.delete(k);
  }

  // ---------------------------------------------------------------- collisions
  solidsNear(x, y, r = 3) {
    const circles = [], rects = [];
    for (let cy = Math.floor((y - r) / CHUNK); cy <= Math.floor((y + r) / CHUNK); cy++)
      for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++)
        for (const p of this.chunk(cx, cy).props)
          if (p.def.solid && Math.abs(p.x - x) < r && Math.abs(p.y - y) < r) circles.push({ x: p.x, y: p.y, r: p.def.radius * Math.min(1.5, p.def.size) });
    for (const b of this.buildingsInRect(x - r, y - r, x + r, y + r))
      if (b.def.kind !== 'race_pad') rects.push(b);
    return { circles, rects };
  }

  // ---------------------------------------------------------------- coins
  coinsNear(x0, y0, x1, y1, now) {
    const out = [], pad = 6;
    for (const axis of ['H', 'V']) {
      const lo = axis === 'H' ? y0 : x0, hi = axis === 'H' ? y1 : x1;
      const a0 = axis === 'H' ? x0 : y0, a1 = axis === 'H' ? x1 : y1;
      for (let idx = Math.floor((lo - pad) / S); idx <= Math.ceil((hi + pad) / S); idx++) {
        for (let run = Math.floor((a0 - 12) / COIN_RUN); run <= Math.ceil((a1 + 2) / COIN_RUN); run++) {
          const salt = idx * 97 + (axis === 'H' ? 3 : 4);
          const start = run * COIN_RUN + 4 + rand01(this.seed, salt, run, 31) * (COIN_RUN - 20);
          const lane = [-0.8, 0, 0.8][hash(this.seed, salt, run, 32) % 3];
          for (let n = 0; n < 5; n++) {
            const along = start + n * 2.2, rc = this.roadCenter(axis, idx, along) + lane;
            const x = axis === 'H' ? along : rc, y = axis === 'H' ? rc : along;
            if (x < x0 || x > x1 || y < y0 || y > y1) continue;
            const biome = this.biomeAt(x, y);
            if (rand01(this.seed, salt, run, 33) >= biome.coins) break;
            const id = `${axis}${idx}:${run}:${n}`;
            if ((this.collected.get(id) || 0) > now) continue;
            out.push({ id, x, y });
          }
        }
      }
    }
    return out;
  }
  collectCoin(id, now) { this.collected.set(id, now + 120000); }

  // ---------------------------------------------------------------- races
  raceCheckpoints(bld, race) {
    const dir = hash(this.seed, strHash(bld.key), 41) & 1 ? 1 : -1;
    const pts = [];
    for (let i = 1; i <= race.checkpoints; i++) {
      const a = bld.along + dir * race.spacing * i;
      pts.push(bld.axis === 'H' ? { x: a, y: this.roadY(bld.idx, a) } : { x: this.roadX(bld.idx, a), y: a });
    }
    return pts;
  }
}

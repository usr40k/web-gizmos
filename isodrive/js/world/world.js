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
export const WRECK_RUN = 320;   // wreck candidates per this many tiles of highway
export const COIN_RUN = 120;    // spacing of coin trails
export const STREET_HALF = 1.4;  // half width of a town street (tiles)
const LOT = 13;                 // spacing of building lots along a town street
const SETTLE_CHANCE = 0.28;     // chance that a highway crossing holds a settlement
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
    this.wreckDefs = reg.list('wreck'); this.wreckW = this.wreckDefs.reduce((a, w) => a + w.weight, 0);
    this.setts = reg.list('settlement');
    this.settCache = new Map();
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
  // distance to the nearest road centre line (+ which road). Town streets count too; their distance is padded so the
  // same "d <= ROAD_HALF" test works for narrower streets.
  roadAt(x, y) {
    const j = Math.round(y / S), i = Math.round(x / S);
    const dh = Math.abs(y - this.roadY(j, x)), dv = Math.abs(x - this.roadX(i, y));
    let r = dh <= dv ? { d: dh, axis: 'H', idx: j, along: x } : { d: dv, axis: 'V', idx: i, along: y };
    const st = this.settlementAt(x, y);
    if (st) {
      const pad = ROAD_HALF - STREET_HALF, bl = st.block, dx = x - st.cx, dy = y - st.cy;
      let m = Math.round(dx / bl); if (m === 0) m = dx >= 0 ? 1 : -1;
      let n = Math.round(dy / bl); if (n === 0) n = dy >= 0 ? 1 : -1;
      const sv = Math.abs(m * bl) <= st.r ? Math.abs(dx - m * bl) + pad : Infinity;
      const sh = Math.abs(n * bl) <= st.r ? Math.abs(dy - n * bl) + pad : Infinity;
      if (sv < r.d && sv <= sh) r = { d: sv, axis: 'V', idx: -1, along: y };
      else if (sh < r.d) r = { d: sh, axis: 'H', idx: -1, along: x };
    }
    return r;
  }
  nearestRoadPoint(x, y) {
    const j = Math.round(y / S), i = Math.round(x / S);
    const hx = x, hy = this.roadY(j, x), vx = this.roadX(i, y), vy = y;
    const dh = Math.hypot(hx - x, hy - y), dv = Math.hypot(vx - x, vy - y);
    return dh <= dv ? { x: hx, y: hy, h: 0 } : { x: vx, y: vy, h: Math.PI / 2 };
  }
  spawn() { return { x: 0, y: this.roadY(0, 0), h: 0 }; }

  // ---------------------------------------------------------------- settlements
  // One candidate per highway crossing. The crossing at spawn always holds the `starter` settlement.
  settlementCell(i, j) {
    const key = i + ',' + j;
    if (this.settCache.has(key)) return this.settCache.get(key);
    let st = null;
    if (this.setts.length) {
      const cy0 = this.roadY(j, i * S), cx = this.roadX(i, cy0), cy = this.roadY(j, cx);
      let type = null;
      if (i === 0 && j === 0) type = this.setts.find((t) => t.starter) || this.setts[0];
      else if (rand01(this.seed, i, j, 61) < SETTLE_CHANCE) {
        const host = this.biomeAt(cx, cy), ok = this.setts.filter((t) => !t.inside.length || t.inside.includes(host.id));
        let r = rand01(this.seed, i, j, 62) * ok.reduce((a, t) => a + t.weight, 0);
        for (const t of ok) { r -= t.weight; if (r <= 0) { type = t; break; } }
      }
      if (type) st = { type, i, j, cx, cy, r: type.radius, block: type.block, list: null, grid: null };
    }
    this.settCache.set(key, st);
    return st;
  }
  settlementAt(x, y, margin = 0) {
    const s = this.settlementCell(Math.round(x / S), Math.round(y / S));
    return s && Math.abs(x - s.cx) <= s.r + margin && Math.abs(y - s.cy) <= s.r + margin ? s : null;
  }
  settlementBuildings(s) {
    if (s.list) return s.list;
    const list = [], bucket = new Map();
    const bk = (x, y) => Math.floor(x / 8) + ',' + Math.floor(y / 8);
    const free = (b) => {
      for (let gx = Math.floor((b.x0 - 5) / 8); gx <= Math.floor((b.x1 + 5) / 8); gx++) for (let gy = Math.floor((b.y0 - 5) / 8); gy <= Math.floor((b.y1 + 5) / 8); gy++)
        for (const o of bucket.get(gx + ',' + gy) || []) if (o.x1 + 0.6 > b.x0 && o.x0 - 0.6 < b.x1 && o.y1 + 0.6 > b.y0 && o.y0 - 0.6 < b.y1) return false;
      return true;
    };
    const add = (b) => { list.push(b); const k = bk(b.x, b.y); (bucket.get(k) || bucket.set(k, []).get(k)).push(b); };
    const home = this.biomeAt(s.cx, s.cy);
    // guaranteed services on the highway through the middle of town
    (s.type.services || []).slice(0, 4).forEach((kind, k) => {
      const def = ((home._roadside.find((q) => q.def.kind === kind) || {}).def) || this.reg.list('building').find((q) => q.kind === kind);
      if (!def) return;
      const off = (k % 2 ? -1 : 1) * (11 + 13 * (k >> 1)), side = ((k + (k >> 1)) % 2) ? -1 : 1;
      for (let t = 0; t < 6; t++) {
        const along = s.cx + off + (off > 0 ? 1 : -1) * t * 5, rc = this.roadY(s.j, along);
        const b = this.makeBuilding(def, 'H', rc, along, side, `S${s.i},${s.j}:svc${k}`, home, s.j, ROAD_HALF, free);
        if (b) { b.settlement = s; add(b); break; }
      }
    });
    // homes and filler along the local streets (horizontal streets first, vertical ones yield to them)
    const N = Math.floor(s.r / s.block);
    for (const axis of ['H', 'V']) for (let n = -N; n <= N; n++) {
      if (n === 0) continue;
      const rc = (axis === 'H' ? s.cy : s.cx) + n * s.block, c0 = (axis === 'H' ? s.cx : s.cy) - s.r + 6;
      for (let a = 0; c0 + a * LOT < (axis === 'H' ? s.cx : s.cy) + s.r - 6; a++) for (const side of [-1, 1]) {
        const salt = s.i * 1009 + s.j * 31 + n * 7 + (axis === 'H' ? 0 : 5000), along = c0 + a * LOT + rand01(this.seed, salt, a, side + 70) * 3;
        if (rand01(this.seed, salt, a, side + 71) >= s.type.density) continue;
        const px = axis === 'H' ? along : rc + side * 5, py = axis === 'H' ? rc + side * 5 : along;
        const biome = this.biomeAt(px, py);
        const pool = [...biome.homes, ...s.type.buildings.map((q) => ({ building: q.building, chance: q.chance }))].map((q) => ({ def: this.reg.get('building', q.building), chance: q.chance })).filter((q) => q.def);
        const sum = pool.reduce((t, q) => t + q.chance, 0);
        if (!sum) continue;
        let r = rand01(this.seed, salt, a, side + 72) * sum, def = pool[pool.length - 1].def;
        for (const q of pool) { r -= q.chance; if (r <= 0) { def = q.def; break; } }
        const b = this.makeBuilding(def, axis, rc, along, side, `S${s.i},${s.j}:${axis}${n}:${a}:${side}`, biome, -1, STREET_HALF, free);
        if (b) { b.settlement = s; add(b); }
      }
    }
    s.list = list;
    s.grid = new Map();
    for (const b of list) { const k = Math.floor(b.x / 32) + ',' + Math.floor(b.y / 32); (s.grid.get(k) || s.grid.set(k, []).get(k)).push(b); }
    return list;
  }

  // ---------------------------------------------------------------- buildings
  // Footprint beside a road centre line `rc` at position `along`; null if it would touch any road or `veto(b)` says no.
  makeBuilding(def, axis, rc, along, side, key, biome, idx, half, veto) {
    const w = def.width, d = def.depth;
    const perp = rc + side * (half + 1.3 + d / 2);
    const cx = axis === 'H' ? along : perp, cy = axis === 'H' ? perp : along;
    const hx = axis === 'H' ? w / 2 : d / 2, hy = axis === 'H' ? d / 2 : w / 2;
    // reject if the footprint (plus margin) touches any road
    // (wide margin along the road to keep clear of cross roads, small margin across it)
    const mx = axis === 'H' ? 1.4 : 0.5, my = axis === 'H' ? 0.5 : 1.4;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++)
      if (this.roadAt(cx + a * (hx + mx), cy + c * (hy + my)).d < ROAD_HALF + 0.2) return null;
    const door = rc + side * (half + 0.3);
    const b = {
      key, def, axis, idx, side, biome,
      x: cx, y: cy, hx, hy, x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy,
      doorX: axis === 'H' ? cx : door, doorY: axis === 'H' ? door : cy,
      along,
    };
    return veto && !veto(b) ? null : b;
  }
  roadsideSlot(axis, idx, k, side) {
    const key = `${axis}${idx}:${k}:${side}`;
    if (this.bldCache.has(key)) return this.bldCache.get(key);
    const salt = idx * 131 + (axis === 'H' ? 1 : 2);
    const along = k * SLOT + 5 + rand01(this.seed, salt, k, side + 3) * (SLOT - 10);
    const rc = this.roadCenter(axis, idx, along);
    // biome decides what can stand here
    const probe = side * (ROAD_HALF + 3);
    const px = axis === 'H' ? along : rc + probe, py = axis === 'H' ? rc + probe : along;
    let b = null;
    if (!this.settlementAt(px, py, 30)) {            // towns build their own buildings
      const biome = this.biomeAt(px, py);
      let r = rand01(this.seed, salt, k, side + 9), def = null;
      for (const rs of biome._roadside) { r -= rs.chance; if (r < 0) { def = rs.def; break; } }
      // horizontal-road buildings win ties, so overlap resolution never depends on generation order
      if (def) b = this.makeBuilding(def, axis, rc, along, side, key, biome, idx, ROAD_HALF,
        axis === 'V' ? (v) => !this.buildingsInRect(v.x0 - 0.5, v.y0 - 0.5, v.x1 + 0.5, v.y1 + 0.5, ['H']).length : null);
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
    // towns
    const gi0 = Math.round(x0 / S) - 1, gi1 = Math.round(x1 / S) + 1, gj0 = Math.round(y0 / S) - 1, gj1 = Math.round(y1 / S) + 1;
    for (let j = gj0; j <= gj1; j++) for (let i = gi0; i <= gi1; i++) {
      const st = this.settlementCell(i, j);
      if (!st || x1 < st.cx - st.r - 12 || x0 > st.cx + st.r + 12 || y1 < st.cy - st.r - 12 || y0 > st.cy + st.r + 12) continue;
      this.settlementBuildings(st);
      for (let gy = Math.floor((y0 - pad) / 32); gy <= Math.floor((y1 + pad) / 32); gy++) for (let gx = Math.floor((x0 - pad) / 32); gx <= Math.floor((x1 + pad) / 32); gx++)
        for (const b of st.grid.get(gx + ',' + gy) || []) if (b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1) out.push(b);
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
      if (this.settlementAt(px, py) && rand01(this.seed, tx, ty, 24) < 0.7) continue;     // tidier towns
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

  // ---------------------------------------------------------------- wrecks (salvage; same respawn map as coins)
  wrecksNear(x0, y0, x1, y1, now) {
    const out = [];
    if (!this.wreckDefs.length) return out;
    for (const axis of ['H', 'V']) {
      const lo = axis === 'H' ? y0 : x0, hi = axis === 'H' ? y1 : x1, a0 = axis === 'H' ? x0 : y0, a1 = axis === 'H' ? x1 : y1;
      for (let idx = Math.floor((lo - 12) / S); idx <= Math.ceil((hi + 12) / S); idx++) {
        for (let run = Math.floor((a0 - 12) / WRECK_RUN); run <= Math.ceil((a1 + 12) / WRECK_RUN); run++) {
          const salt = idx * 89 + (axis === 'H' ? 5 : 6);
          const along = run * WRECK_RUN + 10 + rand01(this.seed, salt, run, 81) * (WRECK_RUN - 20);
          const side = hash(this.seed, salt, run, 82) & 1 ? 1 : -1, rc = this.roadCenter(axis, idx, along) + side * (ROAD_HALF + 3 + rand01(this.seed, salt, run, 83) * 4);
          const x = axis === 'H' ? along : rc, y = axis === 'H' ? rc : along;
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          if (this.settlementAt(x, y, 20) || this.roadAt(x, y).d < ROAD_HALF + 2) continue;
          if (rand01(this.seed, salt, run, 84) >= this.biomeAt(x, y).wrecks) continue;
          const id = `W${axis}${idx}:${run}`;
          if ((this.collected.get(id) || 0) > now) continue;
          let r = rand01(this.seed, salt, run, 85) * this.wreckW, def = this.wreckDefs[0];
          for (const w of this.wreckDefs) { r -= w.weight; if (r <= 0) { def = w; break; } }
          const h = (axis === 'H' ? 0 : Math.PI / 2) + (rand01(this.seed, salt, run, 86) - 0.5) * 1.2;
          out.push({ id, x, y, h, def, loot: rand01(this.seed, salt, run, 87) });
        }
      }
    }
    return out;
  }
  salvage(id, now) { this.collected.set(id, now + 600000); }

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

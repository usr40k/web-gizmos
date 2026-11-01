// Renders the world to a low-res canvas (CSS scales it up with image-rendering: pixelated).
// Ground chunks are pre-rendered once to offscreen canvases; everything with height is depth-sorted each frame.
import { CHUNK } from '../world/world.js';
import { hash } from '../util/rng.js';
import { diamond, rect, shade, fillPoly, drawText, drawTextCentered, textWidth } from './pixel.js';
import { drawProp, drawBuilding, drawPadDecal, drawZone, drawCheckpoint, drawCoin, drawCar, drawWreck, drawParkedTrailer } from './sprites.js';

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.W = 480; this.H = 270; this.sx = 0; this.sy = 0; }
  follow(x, y) { this.x = x; this.y = y; this.sx = Math.round((x - y) * 8); this.sy = Math.round((x + y) * 4); }
  px(wx, wy, wz = 0) { return [Math.round((wx - wy) * 8 - this.sx + this.W / 2), Math.round((wx + wy) * 4 - this.sy + this.H / 2 - wz)]; }
  // world rect visible on screen (with margin for tall sprites)
  bounds(margin = 5) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const ox = (dx * this.W / 2) / 16 + (dy * this.H / 2 + (dy < 0 ? -40 : 0)) / 8;
      const oy = (dy * this.H / 2 + (dy < 0 ? -40 : 0)) / 8 - (dx * this.W / 2) / 16;
      x0 = Math.min(x0, this.x + ox); x1 = Math.max(x1, this.x + ox);
      y0 = Math.min(y0, this.y + oy); y1 = Math.max(y1, this.y + oy);
    }
    return { x0: x0 - margin, x1: x1 + margin, y0: y0 - margin, y1: y1 + margin };
  }
}

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.world = world;
    this.cam = new Camera();
    this.resize();
  }

  // Integer scale in DEVICE pixels keeps pixel art crisp on any screen (retina phones included).
  // Target a short side of ~260 logical pixels, so a portrait phone still shows a useful stretch of road.
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const dw = Math.round(window.innerWidth * dpr), dh = Math.round(window.innerHeight * dpr);
    const ds = Math.max(2, Math.round(Math.min(dw, dh) / 260));
    this.scale = ds / dpr;
    this.cam.W = Math.ceil(dw / ds); this.cam.H = Math.ceil(dh / ds);
    this.canvas.width = this.cam.W; this.canvas.height = this.cam.H;
    this.canvas.style.width = (this.cam.W * ds / dpr) + 'px'; this.canvas.style.height = (this.cam.H * ds / dpr) + 'px';
    this.ctx.imageSmoothingEnabled = false;
  }

  chunkCanvas(c) {
    if (c.canvas) return c.canvas;
    const cv = document.createElement('canvas');
    cv.width = CHUNK * 16; cv.height = CHUNK * 8 + 8;
    const g = cv.getContext('2d');
    const biomes = this.world.biomes;
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const i = ly * CHUNK + lx, b = biomes[c.bidx[i]], f = c.flag[i];
      const sx = CHUNK * 8 + (lx - ly) * 8, sy = (lx + ly) * 4;
      const tx = c.x0 + lx, ty = c.y0 + ly;
      if (f === 0) {
        diamond(g, sx, sy, b.palette.ground[c.ground[i]]);
        if (hash(this.world.seed, tx, ty, 7) % 100 < 34) {                  // detail speck
          const col = b.palette.speck || shade(b.palette.ground[c.ground[i]], 1.15);
          const h = hash(this.world.seed, tx, ty, 8);
          rect(g, sx - 3 + (h % 6), sy + 2 + ((h >> 4) % 4), 1, 1, col);
          if (h & 0x100) rect(g, sx - 3 + ((h >> 8) % 6), sy + 2 + ((h >> 12) % 4), 1, 1, col);
        }
      } else {
        diamond(g, sx, sy, f === 3 ? shade(b.palette.road, 0.78) : b.palette.road);
        if (f === 2) rect(g, sx - 2, sy + 3, 4, 2, b.palette.roadLine);
        else if (f === 1 && hash(this.world.seed, tx, ty, 9) % 9 === 0) rect(g, sx - 1 + (tx & 1), sy + 3, 2, 1, shade(b.palette.road, 1.3));
      }
    }
    c.canvas = cv;
    return cv;
  }

  // g = { car, carColor, ghosts[], race, near, now, t, buildingsFn }
  draw(g) {
    const { ctx, cam, world } = this;
    const t = g.t;
    cam.follow(g.camX, g.camY);
    const biome = world.biomeAt(cam.x, cam.y);
    ctx.fillStyle = biome.palette.ground[0]; ctx.fillRect(0, 0, cam.W, cam.H);
    const B = cam.bounds();
    const cx0 = Math.floor(B.x0 / CHUNK), cx1 = Math.floor(B.x1 / CHUNK), cy0 = Math.floor(B.y0 / CHUNK), cy1 = Math.floor(B.y1 / CHUNK);

    const ents = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = world.chunk(cx, cy);
      const cv = this.chunkCanvas(c);
      const [ox, oy] = cam.px(c.x0, c.y0, 0);
      ctx.drawImage(cv, ox - CHUNK * 8, oy);
      for (const p of c.props) if (p.x > B.x0 && p.x < B.x1 && p.y > B.y0 && p.y < B.y1) ents.push({ d: p.x + p.y, f: () => drawProp(ctx, cam, p) });
    }
    world.prune(Math.floor(cam.x / CHUNK), Math.floor(cam.y / CHUNK));

    // buildings + decals
    const blds = world.buildingsInRect(B.x0, B.y0, B.x1, B.y1);
    for (const b of blds) {
      if (b.def.kind === 'race_pad') drawPadDecal(ctx, cam, b);
    }
    for (const b of blds) {
      const near = g.near === b;
      if (b.def.kind !== 'decor') drawZone(ctx, cam, b.doorX, b.doorY, 2.4, near ? '#ffffff' : b.def.accent, t);
      ents.push({ d: b.x0 + b.y0 + 0.01, f: () => drawBuilding(ctx, cam, b, t) });
    }

    // race checkpoints
    if (g.race) g.race.points.forEach((p, i) => {
      if (i < g.race.idx) return;
      ents.push({ d: p.x + p.y, f: () => drawCheckpoint(ctx, cam, p.x, p.y, g.race.color, i === g.race.idx, t) });
    });

    if (g.parked) ents.push({ d: g.parked.x + g.parked.y, f: () => drawParkedTrailer(ctx, cam, g.parked, world.reg.get('trailer', g.parked.id)) });
    for (const w of g.wrecks || []) ents.push({ d: w.x + w.y, f: () => drawWreck(ctx, cam, w, t) });
    // coins
    for (const c of g.coins) ents.push({ d: c.x + c.y, f: () => drawCoin(ctx, cam, c.x, c.y, t) });

    // cars (ghosts first so the player is drawn over on ties)
    for (const o of g.ghosts) ents.push({ d: o.x + o.y, f: () => drawCar(ctx, cam, o, o.color || '#ccc', 0.9, this.world.reg.get('vehicle', o.veh), o.trl ? { def: this.world.reg.get('trailer', o.trl), th: o.th } : null) });
    ents.push({ d: g.car.x + g.car.y + 0.02, f: () => drawCar(ctx, cam, g.car, g.carColor, 1, g.veh, g.trailer ? { def: g.trailer, th: g.car.th } : null) });

    ents.sort((a, b) => a.d - b.d);
    for (const e of ents) e.f();

    // name tags
    for (const o of g.ghosts) {
      const [sx, sy] = cam.px(o.x, o.y, 14);
      if (sx < -40 || sx > cam.W + 40 || sy < -20 || sy > cam.H + 20) continue;
      drawTextCentered(ctx, (o.name || '?').slice(0, 12), sx, sy - 6, '#ffffff', '#000');
    }
    // race compass
    if (g.race && g.race.idx < g.race.points.length) this.drawCompass(g.race.points[g.race.idx], g.car, g.race.color);
  }

  drawCompass(p, car, color) {
    const { ctx, cam } = this;
    const [tx, ty] = cam.px(p.x, p.y, 0);
    const margin = 14;
    if (tx > margin && tx < cam.W - margin && ty > margin + 30 && ty < cam.H - margin) return;   // on screen already
    const [cx, cy] = cam.px(car.x, car.y, 0);
    const a = Math.atan2(ty - cy, tx - cx);
    const rx = cam.W / 2 - 22, ry = cam.H / 2 - 40;
    const k = Math.min(rx / Math.max(1e-3, Math.abs(Math.cos(a))), ry / Math.max(1e-3, Math.abs(Math.sin(a))));
    const ax = cam.W / 2 + Math.cos(a) * k, ay = cam.H / 2 + Math.sin(a) * k;
    const pt = (r, da) => [Math.round(ax + Math.cos(a + da) * r), Math.round(ay + Math.sin(a + da) * r)];
    fillPoly(ctx, [pt(8, 0), pt(6, 2.5), pt(6, -2.5)], '#000');
    fillPoly(ctx, [pt(6, 0), pt(4.5, 2.4), pt(4.5, -2.4)], color);
  }
}

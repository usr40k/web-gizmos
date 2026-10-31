// Procedural pixel sprites. A "shape" is just a function here - content packs pick a shape + colors,
// so adding scenery never needs new drawing code. To add a NEW shape: add a function below and its name in
// SHAPES (content/schema.js).
import { fillPoly, rect, fillEllipse, strokeEllipse, shade, mix, drawTextCentered, diamond, textWidth } from './pixel.js';

const LX = -0.447, LY = 0.895;     // light direction (from the left-front)
const quant = (f) => Math.round(f * 12) / 12;

// Iso box with arbitrary heading. cx,cy = centre in world tiles, hl = half length along `ang`, hw = half width.
export function drawBox(ctx, cam, cx, cy, hl, hw, ang, z, h, color, topColor) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const fx = c, fy = s, rx = -s, ry = c;
  const P = [
    [cx - hl * fx - hw * rx, cy - hl * fy - hw * ry],
    [cx + hl * fx - hw * rx, cy + hl * fy - hw * ry],
    [cx + hl * fx + hw * rx, cy + hl * fy + hw * ry],
    [cx - hl * fx + hw * rx, cy - hl * fy + hw * ry],
  ];
  const N = [[-rx, -ry], [fx, fy], [rx, ry], [-fx, -fy]];
  for (let i = 0; i < 4; i++) {
    const n = N[i];
    if (n[0] + n[1] <= 0.001) continue;               // faces pointing away from the viewer
    const a = P[i], b = P[(i + 1) % 4];
    const f = quant(0.58 + 0.42 * Math.max(0, n[0] * LX + n[1] * LY));
    fillPoly(ctx, [cam.px(a[0], a[1], z), cam.px(b[0], b[1], z), cam.px(b[0], b[1], z + h), cam.px(a[0], a[1], z + h)], shade(color, f));
  }
  fillPoly(ctx, P.map((p) => cam.px(p[0], p[1], z + h)), shade(topColor || color, 1.12));
}

function ground(ctx, sx, sy, rx, ry, a = 0.22) {
  ctx.globalAlpha = a; fillEllipse(ctx, sx, sy, rx, ry, '#000'); ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ props
const SHAPE = {
  tree(ctx, sx, sy, p) {
    const s = p.size;
    ground(ctx, sx, sy, 5 * s, 2 * s);
    rect(ctx, sx - 1, sy - 6 * s, 2, 6 * s, p.color2 || '#6b4a2b');
    const cy = sy - 9 * s;
    fillEllipse(ctx, sx, cy, 5 * s, 4.5 * s, shade(p.color, 0.8));
    fillEllipse(ctx, sx - 1, cy - 1, 4 * s, 3.6 * s, p.color);
    fillEllipse(ctx, sx - 2, cy - 2, 2 * s, 1.6 * s, shade(p.color, 1.25));
  },
  pine(ctx, sx, sy, p) {
    const s = p.size;
    ground(ctx, sx, sy, 4 * s, 1.6 * s);
    rect(ctx, sx - 1, sy - 4 * s, 2, 4 * s, '#5b3b22');
    // stacked triangles, drawn bottom -> top
    const tri = (cy, hw, h, col) => fillPoly(ctx, [[sx, sy - cy - h], [sx - hw, sy - cy], [sx + hw, sy - cy]], col);
    tri(4 * s, 5.5 * s, 7 * s, shade(p.color, 0.75));
    tri(8 * s, 4.5 * s, 6.5 * s, p.color);
    tri(12 * s, 3.3 * s, 6 * s, shade(p.color, 1.2));
    if (p.color2) {          // snow caps
      fillPoly(ctx, [[sx, sy - 18 * s], [sx - 1.6 * s, sy - 15 * s], [sx + 1.6 * s, sy - 15 * s]], p.color2);
      rect(ctx, sx - 3 * s, sy - 12 * s, 2 * s, 1, p.color2);
      rect(ctx, sx + 1 * s, sy - 8 * s, 2 * s, 1, p.color2);
    }
  },
  cactus(ctx, sx, sy, p) {
    const s = p.size, c = p.color;
    ground(ctx, sx, sy, 4 * s, 1.6 * s);
    rect(ctx, sx - 1.5 * s, sy - 11 * s, 3 * s, 11 * s, c);
    rect(ctx, sx + 0.5 * s, sy - 11 * s, 1 * s, 11 * s, shade(c, 0.78));
    rect(ctx, sx - 4 * s, sy - 7 * s, 2.5 * s, 1.6 * s, c); rect(ctx, sx - 4 * s, sy - 10 * s, 1.6 * s, 4 * s, c);
    rect(ctx, sx + 1.5 * s, sy - 5 * s, 2.5 * s, 1.6 * s, c); rect(ctx, sx + 2.5 * s, sy - 8 * s, 1.6 * s, 4 * s, shade(c, 0.85));
    if (p.color2) rect(ctx, sx - 0.5, sy - 12 * s, 2, 1, p.color2);
  },
  rock(ctx, sx, sy, p) {
    const s = p.size, c = p.color;
    ground(ctx, sx, sy, 6 * s, 2.2 * s);
    fillPoly(ctx, [[sx - 6 * s, sy], [sx - 5 * s, sy - 4 * s], [sx - 1 * s, sy - 7 * s], [sx + 4 * s, sy - 5 * s], [sx + 6 * s, sy]], shade(c, 0.85));
    fillPoly(ctx, [[sx - 5 * s, sy - 4 * s], [sx - 1 * s, sy - 7 * s], [sx + 1 * s, sy - 4 * s], [sx - 3 * s, sy - 1 * s]], shade(c, 1.2));
    fillPoly(ctx, [[sx + 1 * s, sy - 4 * s], [sx + 4 * s, sy - 5 * s], [sx + 6 * s, sy], [sx + 1 * s, sy]], shade(c, 0.7));
  },
  crystal(ctx, sx, sy, p) {
    const s = p.size, c = p.color;
    ground(ctx, sx, sy, 4 * s, 1.6 * s, 0.3);
    ctx.globalAlpha = 0.18; fillEllipse(ctx, sx, sy - 6 * s, 8 * s, 8 * s, c); ctx.globalAlpha = 1;
    fillPoly(ctx, [[sx, sy - 15 * s], [sx - 4 * s, sy - 8 * s], [sx - 3 * s, sy], [sx, sy]], shade(c, 1.15));
    fillPoly(ctx, [[sx, sy - 15 * s], [sx + 4 * s, sy - 8 * s], [sx + 3 * s, sy], [sx, sy]], shade(c, 0.75));
    rect(ctx, sx - 2 * s, sy - 10 * s, 1, 3 * s, '#fff');
    fillPoly(ctx, [[sx + 5 * s, sy - 1 * s], [sx + 3 * s, sy - 5 * s], [sx + 7 * s, sy - 7 * s], [sx + 8 * s, sy - 1 * s]], shade(c, 0.9));
  },
  mushroom(ctx, sx, sy, p) {
    const s = p.size;
    ground(ctx, sx, sy, 4 * s, 1.6 * s);
    rect(ctx, sx - 1 * s, sy - 5 * s, 2 * s, 5 * s, p.color2 || '#f0e6d2');
    fillEllipse(ctx, sx, sy - 6 * s, 5 * s, 3.4 * s, shade(p.color, 0.8));
    fillEllipse(ctx, sx - 1, sy - 7 * s, 4 * s, 2.6 * s, p.color);
    rect(ctx, sx - 2 * s, sy - 8 * s, 1.5, 1.5, '#fff');
  },
};

export function drawProp(ctx, cam, prop) {
  const [sx, sy] = cam.px(prop.x, prop.y, 0);
  const d = prop.def;
  if (d.shape === 'box') {
    const s = d.size;
    ground(ctx, sx, sy, 7 * s, 3 * s);
    drawBox(ctx, cam, prop.x, prop.y, 0.42 * s, 0.42 * s, 0, 0, 8 * s, d.color, d.color2 || undefined);
    if (d.color2) { rect(ctx, sx - 1, sy - 8 * s - 4, 2, 2, d.color2); }
    return;
  }
  (SHAPE[d.shape] || SHAPE.rock)(ctx, sx, sy, d);
}

// ------------------------------------------------------------------ buildings
export function drawBuilding(ctx, cam, b, time) {
  const d = b.def, h = d.height;
  const cx = b.x, cy = b.y;
  if (d.kind === 'race_pad') {                 // low sign pole only; the pad itself is a ground decal
    const [sx, sy] = cam.px(cx, cy, 0);
    rect(ctx, sx - 1, sy - 22, 2, 22, '#888');
    drawSign(ctx, sx, sy - 24, d.sign || 'RACE', d.accent, '#111');
    return;
  }
  const pumps = d.kind === 'gas_station';
  const pumpDraw = () => {
    for (const o of [-1.4, 1.4]) {
      const px = b.axis === 'H' ? cx + o : b.doorX - b.side * 1.1, py = b.axis === 'H' ? b.doorY - b.side * 1.1 : cy + o;
      drawBox(ctx, cam, px, py, 0.25, 0.25, 0, 0, 6, '#e8e8e8', d.accent);
      const [qx, qy] = cam.px(px, py, 3);
      rect(ctx, qx - 1, qy - 1, 2, 2, d.accent);
    }
  };
  const [gx, gy] = cam.px(cx, cy, 0);
  ground(ctx, gx, gy + 2, (b.hx + b.hy) * 7, (b.hx + b.hy) * 3, 0.18);
  if (pumps && b.side > 0) pumpDraw();
  drawBox(ctx, cam, cx, cy, b.hx, b.hy, 0, 0, h, d.color);
  // windows on the two visible faces
  const wz0 = Math.min(3, h - 6), wz1 = wz0 + 4, win = shade(d.accent, 0.5);
  for (let x = b.x0 + 0.8; x + 0.9 < b.x1; x += 1.7)
    fillPoly(ctx, [cam.px(x, b.y1, wz0), cam.px(x + 0.9, b.y1, wz0), cam.px(x + 0.9, b.y1, wz1), cam.px(x, b.y1, wz1)], win);
  for (let y = b.y0 + 0.8; y + 0.9 < b.y1; y += 1.7)
    fillPoly(ctx, [cam.px(b.x1, y, wz0), cam.px(b.x1, y + 0.9, wz0), cam.px(b.x1, y + 0.9, wz1), cam.px(b.x1, y, wz1)], shade(d.accent, 0.38));
  drawBox(ctx, cam, cx, cy, b.hx + 0.25, b.hy + 0.25, 0, h, 1.6, d.roof || shade(d.color, 1.35), d.roof || shade(d.color, 1.4));
  if (pumps && b.side < 0) pumpDraw();
  const [tx, ty] = cam.px(cx, cy, h + 3);
  rect(ctx, tx - 1, ty - 8, 2, 8, '#777');
  drawSign(ctx, tx, ty - 10, d.sign || d.name.slice(0, 8), d.accent, '#111');
}
function drawSign(ctx, cx, cy, text, accent, bg) {
  const w = textWidth(text) + 4;
  rect(ctx, cx - w / 2 - 1, cy - 8, w + 2, 9, accent);
  rect(ctx, cx - w / 2, cy - 7, w, 7, bg);
  drawTextCentered(ctx, text, cx, cy - 6, accent, null);
}

// race pad: checker floor decal
export function drawPadDecal(ctx, cam, b) {
  const d = b.def;
  const x0 = Math.round(b.x0), y0 = Math.round(b.y0), x1 = Math.round(b.x1), y1 = Math.round(b.y1);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [sx, sy] = cam.px(x, y, 0);
    diamond(ctx, sx, sy, (x + y) % 2 ? shade(d.color, 1.5) : d.accent);
  }
}

// ground ring where you can interact (gas pumps, shop door, race start)
export function drawZone(ctx, cam, x, y, r, color, t) {
  const [sx, sy] = cam.px(x, y, 0);
  const pulse = 1 + Math.sin(t * 4) * 0.06;
  ctx.globalAlpha = 0.9;
  strokeEllipse(ctx, sx, sy, r * 11.3 * pulse, r * 5.65 * pulse, color, 72);
  ctx.globalAlpha = 0.35;
  strokeEllipse(ctx, sx, sy, r * 11.3 * pulse - 2, r * 5.65 * pulse - 1, color, 72);
  ctx.globalAlpha = 1;
}

export function drawCheckpoint(ctx, cam, x, y, color, active, t) {
  const [sx, sy] = cam.px(x, y, 0);
  ctx.globalAlpha = active ? 1 : 0.35;
  strokeEllipse(ctx, sx, sy, 2.4 * 11.3, 2.4 * 5.65, color, 64);
  const hgt = active ? 26 + Math.sin(t * 6) * 3 : 14;
  for (const side of [-1, 1]) {
    const [px, py] = cam.px(x + side * 1.2, y - side * 1.2, 0);
    rect(ctx, px - 1, py - hgt, 2, hgt, color);
  }
  if (active) { ctx.globalAlpha = 0.5; fillEllipse(ctx, sx, sy, 3, 1.5, color); }
  ctx.globalAlpha = 1;
}

export function drawCoin(ctx, cam, x, y, t) {
  const [sx, sy] = cam.px(x, y, 0);
  const bob = Math.sin(t * 5 + x) * 1.5;
  ground(ctx, sx, sy, 3, 1.2, 0.2);
  const w = Math.abs(Math.cos(t * 3 + x * 0.7)) * 2 + 1;
  fillEllipse(ctx, sx, sy - 6 + bob, w, 3, '#c98a00');
  fillEllipse(ctx, sx, sy - 6 + bob, Math.max(0.5, w - 1), 2, '#ffd84a');
}

// ------------------------------------------------------------------ cars
const GLASS = '#8fd0f0';
// Vehicle body from boxes. `v` is a vehicle definition (shape, length, width, height); missing = sedan.
export function drawCar(ctx, cam, car, color, alpha = 1, v) {
  const { x, y, h } = car;
  const L = (v && v.length) || 1.64, W = (v && v.width) || 0.88, shape = (v && v.shape) || 'sedan', H = (v && v.height) || 4.5;
  const c = Math.cos(h), s = Math.sin(h);
  const [sx, sy] = cam.px(x, y, 0);
  ctx.globalAlpha = alpha;
  ground(ctx, sx, sy + 1, L * 5.6, W * 4.6, 0.28 * alpha);
  const at = (f) => [x + c * f * L, y + s * f * L];                      // point along the vehicle, f = -0.5..0.5
  const box = (f, len, wid, z, ht, col, top) => { const [bx, by] = at(f); drawBox(ctx, cam, bx, by, len * L / 2, wid * W / 2, h, z, ht, col, top); };
  box(0, 1, 1, 0, 2, '#1b1b22');
  const dark = shade(color, 0.62);
  if (shape === 'sedan') { box(0, 1, 1, 2, 2.5, color, color); box(-0.1, 0.5, 0.84, 4.5, 2.6, GLASS, shade(color, 0.92)); }
  else if (shape === 'wagon') { box(0, 1, 1, 2, 2.5, color, color); box(-0.14, 0.7, 0.84, 4.5, 2.6, GLASS, shade(color, 0.92)); }
  else if (shape === 'suv') { box(0, 1, 1, 2, 3, color, color); box(-0.1, 0.7, 0.86, 5, 2.8, GLASS, shade(color, 0.92)); }
  else if (shape === 'pickup') { box(0, 1, 1, 2, 2.2, color, color); box(0.18, 0.4, 0.88, 4.2, 2.8, GLASS, shade(color, 0.92)); box(-0.28, 0.42, 0.96, 4.2, 0.9, dark, dark); }
  else if (shape === 'van') { box(-0.08, 0.84, 1, 2, H - 2, color, shade(color, 1.1)); box(0.4, 0.2, 0.92, 2, 3, color, color); box(0.28, 0.06, 0.8, 4.6, 2.4, GLASS, GLASS); }
  else if (shape === 'tow') { box(0.28, 0.4, 1, 2, H - 2, color, shade(color, 1.1)); box(0.4, 0.1, 0.84, 4.8, 2.4, GLASS, GLASS); box(-0.2, 0.62, 0.96, 2, 1, '#6c7480', '#8a94a2'); box(0.2, 0.1, 0.6, H, 1, '#ffb020', '#ffd24a'); }
  else if (shape === 'semi') { box(0.24, 0.42, 1, 2, H - 2, color, shade(color, 1.1)); box(0.38, 0.1, 0.84, 5, 2.6, GLASS, GLASS); box(-0.26, 0.4, 0.84, 2, 1.2, '#3a3a44', '#4a4a56'); box(0.0, 0.08, 1.0, 2, H - 3.5, dark, dark); }
  else { box(0, 1, 1, 2, 2.5, color, color); box(-0.1, 0.5, 0.84, 4.5, 2.6, GLASS, shade(color, 0.92)); }
  // lights, only on the visible end
  const front = c + s > 0;
  const ex = (front ? 1 : -1) * L / 2, rx2 = -s * W * 0.34, ry2 = c * W * 0.34;
  const lz = Math.min(3.4, H - 1);
  for (const sg of [-1, 1]) {
    const [lx, ly] = cam.px(x + ex * c + sg * rx2, y + ex * s + sg * ry2, lz);
    rect(ctx, lx, ly, 1, 1, front ? '#fff7a8' : '#ff3b3b');
  }
  ctx.globalAlpha = 1;
}

// wrecked vehicle: a tilted box with a dark hood and a puff of smoke
export function drawWreck(ctx, cam, w, t) {
  const d = w.def;
  drawBox(ctx, cam, w.x, w.y, d.length / 2, d.width / 2, w.h, 0, d.height, d.color, shade(d.color, 1.25));
  drawBox(ctx, cam, w.x + Math.cos(w.h) * d.length * 0.3, w.y + Math.sin(w.h) * d.length * 0.3, d.length * 0.18, d.width * 0.4, w.h, d.height, 0.6, '#222');
  const [sx, sy] = cam.px(w.x, w.y, d.height + 2);
  for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i / 3) % 1; rect(ctx, Math.round(sx + Math.sin(t + i * 2) * 2), Math.round(sy - k * 14), 2, 2, k < 0.6 ? '#555' : '#888'); }
}

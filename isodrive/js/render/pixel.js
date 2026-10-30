// Crisp pixel drawing helpers. Canvas polygon fills are anti-aliased, which ruins pixel art, so everything here
// is rasterized with 1px-high fillRects (scanlines) onto a low-resolution canvas that CSS then scales up.

const colorCache = new Map();
export function parseColor(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    const h = hex.replace('#', '');
    const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    c = [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
    colorCache.set(hex, c);
  }
  return c;
}
const shadeCache = new Map();
export function shade(hex, f) {
  const key = hex + '|' + f.toFixed(2);
  let v = shadeCache.get(key);
  if (!v) {
    const [r, g, b] = parseColor(hex);
    const m = (x) => Math.max(0, Math.min(255, Math.round(x * f)));
    v = `rgb(${m(r)},${m(g)},${m(b)})`;
    shadeCache.set(key, v);
  }
  return v;
}
export function mix(a, b, t) {
  const A = parseColor(a), B = parseColor(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

export function fillPoly(ctx, pts, color) {
  ctx.fillStyle = color;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  minY = Math.floor(minY); maxY = Math.ceil(maxY);
  const n = pts.length, xs = [];
  for (let y = minY; y < maxY; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) xs.push(a[0] + (sy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.round(xs[i]), x1 = Math.round(xs[i + 1]);
      if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1);
    }
  }
}

export function rect(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

export function fillEllipse(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  for (let y = -Math.round(ry); y <= Math.round(ry); y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry || 1))));
    if (w > 0) ctx.fillRect(cx - w, cy + y, w * 2, 1);
  }
}
export function strokeEllipse(ctx, cx, cy, rx, ry, color, steps = 48) {
  ctx.fillStyle = color;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
  }
}

// 16x8 iso diamond, (sx,sy) = top-centre pixel
const ROW_W = [4, 8, 12, 16, 16, 12, 8, 4];
export function diamond(ctx, sx, sy, color) {
  ctx.fillStyle = color;
  for (let r = 0; r < 8; r++) ctx.fillRect(sx - ROW_W[r] / 2, sy + r, ROW_W[r], 1);
}

// ---- 3x5 bitmap font (uppercase, digits, a little punctuation). rows are 3 bits, top to bottom.
const G = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '.': '000000000000010', ':': '000010000010000', '-': '000000111000000', '!': '010010010000010',
  '/': '001001010100100', $: '011110010011110', '+': '000010111010000', '?': '110001010000010', ',': '000000000010100',
  "'": '010010000000000', '(': '010100100100010', ')': '010001001001010', _: '000000000000111', '=': '000111000111000',
  '*': '000101010101000', '#': '101111101111101', '%': '101001010100101', '<': '001010100010001', '>': '100010001010100',
};
export function textWidth(str) { return Math.max(0, str.length * 4 - 1); }
export function drawText(ctx, str, x, y, color = '#fff', outline = '#000') {
  str = String(str).toUpperCase();
  x = Math.round(x); y = Math.round(y);
  const pass = (ox, oy, col) => {
    ctx.fillStyle = col;
    for (let i = 0; i < str.length; i++) {
      const g = G[str[i]];
      if (!g) continue;
      for (let k = 0; k < 15; k++) if (g[k] === '1') ctx.fillRect(x + ox + i * 4 + (k % 3), y + oy + Math.floor(k / 3), 1, 1);
    }
  };
  if (outline) { pass(1, 0, outline); pass(-1, 0, outline); pass(0, 1, outline); pass(0, -1, outline); }
  pass(0, 0, color);
}
export function drawTextCentered(ctx, str, cx, y, color, outline) { drawText(ctx, str, cx - textWidth(String(str)) / 2, y, color, outline); }

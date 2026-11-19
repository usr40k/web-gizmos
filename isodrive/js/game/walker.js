// On-foot movement. Screen-relative: W/up walks up the screen, A/D left/right (isometric: up = -x,-y).
import { clamp } from '../util/rng.js';

export const WALK_R = 0.28;

export function newWalker(x, y, h = 0) { return { x, y, h, vx: 0, vy: 0, speed: 0, phase: 0, biome: null }; }

// input: { throttle, steer }; speed in tiles/s; extra = [{x,y,r}] solid circles (the parked vehicle)
export function stepWalker(w, input, dt, world, speed, extra = []) {
  const up = Math.max(0, input.throttle), dn = Math.max(0, -input.throttle), s = input.steer;
  let dx = -up + dn + s, dy = -up + dn - s;
  const len = Math.hypot(dx, dy);
  if (len > 0) { dx /= len; dy /= len; }
  const k = Math.min(1, dt * 10);
  w.vx += (dx * speed - w.vx) * k; w.vy += (dy * speed - w.vy) * k;
  w.x += w.vx * dt; w.y += w.vy * dt;
  w.biome = world.biomeAt(w.x, w.y);
  const { circles, rects } = world.solidsNear(w.x, w.y, 2.5);
  for (const o of [...circles, ...extra]) {
    const ex = w.x - o.x, ey = w.y - o.y, d = Math.hypot(ex, ey), m = o.r + WALK_R;
    if (d < m && d > 1e-4) { w.x += ex / d * (m - d); w.y += ey / d * (m - d); }
  }
  for (const b of rects) {
    const px = clamp(w.x, b.x0, b.x1), py = clamp(w.y, b.y0, b.y1); let ex = w.x - px, ey = w.y - py, d = Math.hypot(ex, ey);
    if (d < WALK_R) {
      if (d < 1e-4) { const fx = b.hx - Math.abs(w.x - b.x), fy = b.hy - Math.abs(w.y - b.y); if (fx < fy) { ex = Math.sign(w.x - b.x) || 1; ey = 0; w.x += ex * (fx + WALK_R); } else { ex = 0; ey = Math.sign(w.y - b.y) || 1; w.y += ey * (fy + WALK_R); } }
      else { w.x += ex / d * (WALK_R - d); w.y += ey / d * (WALK_R - d); }
    }
  }
  w.speed = Math.hypot(w.vx, w.vy);
  if (w.speed > 0.3) { let d = Math.atan2(w.vy, w.vx) - w.h; d = Math.atan2(Math.sin(d), Math.cos(d)); w.h += d * Math.min(1, dt * 12); }
  w.phase += w.speed * dt * 2.4;
}

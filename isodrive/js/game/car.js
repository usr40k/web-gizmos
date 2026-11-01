// Car stats (base + equipped parts) and arcade physics. Units: tiles and seconds.
import { clamp } from '../util/rng.js';
import { ROAD_HALF } from '../world/world.js';
import { trailerPose } from './trailer.js';

export const FUEL_BASE_PRICE = 2;       // cash per litre
export const FUEL_TILE_KM = 0.1;        // for fuel only, one tile counts as 100 m (see the vehicle schema doc)

// vehicle base + equipped parts. Part fuelCap is relative to a 30 L car, so a "+25 L" tank is +83% on any vehicle.
export function carStats(reg, equipped, vehId, trailerId) {
  const v = reg.get('vehicle', vehId) || reg.list('vehicle')[0];
  const s = { accel: v.accel, topSpeed: v.topSpeed, grip: v.grip, offroad: v.offroad, fuelCap: v.fuelCap, efficiency: 0, l100: v.l100, turn: v.turn, brake: v.brake,
    R: 0.5 + Math.max(0, v.length - 1.64) * 0.12, veh: v };
  for (const id of Object.values(equipped)) {
    const p = reg.get('part', id);
    if (!p || !p.stats) continue;
    for (const k of ['accel', 'topSpeed', 'grip', 'offroad', 'efficiency']) s[k] += p.stats[k] || 0;
    s.fuelCap += (p.stats.fuelCap || 0) * v.fuelCap / 30;
  }
  const t = trailerId && reg.get('trailer', trailerId);
  if (t) { s.trailer = t; s.accel *= 1 - 0.4 * t.load; s.topSpeed *= 1 - 0.12 * t.load; s.brake *= 1 - 0.3 * t.load; s.grip *= 1 - 0.1 * t.load; s.l100 *= 1 + 0.4 * t.load; }
  s.accel = Math.max(2, s.accel); s.topSpeed = Math.max(5, s.topSpeed); s.grip = Math.max(1, s.grip);
  s.fuelCap = Math.max(10, s.fuelCap); s.efficiency = clamp(s.efficiency, -0.5, 0.8); s.offroad = clamp(s.offroad, 0, 1);
  return s;
}

export function newCar(spawn) {
  return { x: spawn.x, y: spawn.y, h: spawn.h, vx: 0, vy: 0, speed: 0, steer: 0, onRoad: true, crash: 0 };
}

// surface under the car: { road: bool, grip, drag }
export function surfaceAt(world, x, y, stats) {
  const biome = world.biomeAt(x, y);
  const ri = world.roadAt(x, y);
  const road = ri.d <= ROAD_HALF + 0.3;
  const s = road ? biome.roadSurface : biome.terrain;
  const grip = s.grip + (1 - s.grip) * stats.offroad * (road ? 0.6 : 1);
  const drag = s.drag - Math.max(0, s.drag - 0.35) * stats.offroad;
  return { road, grip, drag, biome };
}

// input: { throttle -1..1, steer -1..1, brake bool }.  Returns { crashSpeed } when something was hit hard.
export function stepCar(car, input, dt, world, stats, fuel) {
  const sf = surfaceAt(world, car.x, car.y, stats);
  car.onRoad = sf.road; car.biome = sf.biome;
  const c = Math.cos(car.h), s = Math.sin(car.h);
  let fwd = car.vx * c + car.vy * s, lat = -car.vx * s + car.vy * c;
  const hasFuel = fuel > 0;
  const thr = hasFuel ? input.throttle : 0;
  const top = stats.topSpeed * (sf.road ? 1 : 1 / (0.6 + 0.4 * sf.drag));

  if (thr > 0) fwd += thr * stats.accel * sf.grip * dt * (1 - clamp(fwd / (top * 1.02), 0, 1) ** 2);
  else if (thr < 0) fwd += (fwd > 0.5 ? thr * stats.brake * 1.1 : thr * stats.accel * 0.5) * dt;       // brake, then reverse
  if (input.brake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), stats.brake * dt);
  fwd -= fwd * Math.min(1, (sf.drag * 0.18 + 0.05) * dt * (thr > 0 ? 0.6 : 1.8));        // rolling drag
  fwd = clamp(fwd, -top * 0.35, top * 1.05);

  // steering authority builds with speed, shrinks at very high speed
  const sp = Math.abs(fwd);
  const auth = clamp(sp / 3.5, 0, 1) * (1 - 0.35 * clamp(sp / (stats.topSpeed * 1.2), 0, 1));
  car.steer += (input.steer - car.steer) * Math.min(1, dt * 10);
  car.h += car.steer * stats.turn * auth * (fwd >= 0 ? 1 : -1) * dt;

  // lateral grip -> drifting when grip is low
  lat *= Math.exp(-stats.grip * sf.grip * dt * (input.brake ? 0.45 : 1));
  const nc = Math.cos(car.h), ns = Math.sin(car.h);
  car.vx = fwd * nc - lat * ns; car.vy = fwd * ns + lat * nc;
  car.speed = fwd; car.slip = Math.abs(lat);

  car.x += car.vx * dt; car.y += car.vy * dt;

  // ---- collisions
  let hit = 0;
  const { circles, rects } = world.solidsNear(car.x, car.y, 3.2);
  const R = stats.R;
  for (const o of circles) {
    const dx = car.x - o.x, dy = car.y - o.y, d = Math.hypot(dx, dy), m = o.r + R;
    if (d < m && d > 1e-4) hit = Math.max(hit, bounce(car, dx / d, dy / d, m - d));
  }
  for (const b of rects) {
    const px = clamp(car.x, b.x0, b.x1), py = clamp(car.y, b.y0, b.y1);
    let dx = car.x - px, dy = car.y - py, d = Math.hypot(dx, dy);
    if (d < R) {
      if (d < 1e-4) { dx = car.x - b.x; dy = car.y - b.y; d = Math.hypot(dx, dy) || 1; }
      hit = Math.max(hit, bounce(car, dx / d, dy / d, R - d + 1e-3));
    }
  }
  car.crash = Math.max(0, car.crash - dt);
  if (hit > 3) car.crash = 0.35;
  return { hit, sf, thr };
}

function bounce(car, nx, ny, pen) {
  car.x += nx * pen; car.y += ny * pen;
  const vn = car.vx * nx + car.vy * ny;
  if (vn < 0) { car.vx -= 1.5 * vn * nx; car.vy -= 1.5 * vn * ny; car.vx *= 0.8; car.vy *= 0.8; return -vn; }
  return 0;
}

// litres per second. Real-world shape: a base L/100km figure for the class, worse at high speed (drag grows with
// speed squared), a little extra while accelerating, and a small idle burn.
export function fuelBurn(stats, speed, thr) {
  const v = Math.abs(speed), cruise = stats.topSpeed * 0.6;
  const perTile = (stats.l100 / 100) * FUEL_TILE_KM * (0.75 + 0.5 * (v / cruise) ** 2) * (1 + 0.6 * Math.max(0, thr) * Math.max(0, 1 - v / stats.topSpeed));
  return (stats.l100 * 0.0001 + perTile * v) / (1 + stats.efficiency);
}

// Does the trailer body overlap a tree/rock/building? Returns { nx, ny, pen } (push direction for the vehicle) or null.
export function trailerPush(world, car, v, t) {
  const pose = trailerPose(car, v, t, car.th), r = t.width / 2 + 0.05;
  const { circles, rects } = world.solidsNear(pose.x, pose.y, t.length / 2 + 3);
  let best = null;
  const consider = (nx, ny, pen) => { if (!best || pen > best.pen) best = { nx, ny, pen }; };
  for (const f of [-0.45, -0.22, 0, 0.22, 0.45]) {
    const px = pose.x + Math.cos(pose.th) * f * t.length, py = pose.y + Math.sin(pose.th) * f * t.length;
    for (const o of circles) { const dx = px - o.x, dy = py - o.y, d = Math.hypot(dx, dy), m = o.r + r; if (d < m && d > 1e-4) consider(dx / d, dy / d, m - d); }
    for (const b of rects) {
      const qx = clamp(px, b.x0, b.x1), qy = clamp(py, b.y0, b.y1); let dx = px - qx, dy = py - qy, d = Math.hypot(dx, dy);
      if (d < r) { if (d < 1e-4) { dx = px - b.x; dy = py - b.y; d = Math.hypot(dx, dy) || 1; } consider(dx / d, dy / d, r - d + 1e-3); }
    }
  }
  return best;
}

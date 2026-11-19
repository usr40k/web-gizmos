// Trailer geometry shared by physics and drawing. Pure functions, no imports.
// A hitch sits behind the tractor/vehicle centre; the trailer pivots around it. Units: tiles.
export const JACKKNIFE = 1.45;                                   // max angle between vehicle and trailer (radians)
export const isFifth = (v) => v.coupling === 'fifth';
export const hitchOffset = (v) => -v.length * (isFifth(v) ? 0.3 : 0.55);          // distance behind the vehicle centre
export const gapOf = (v) => (isFifth(v) ? 0 : 0.4);                               // drawbar length (fifth wheel sits on top)
export const axleDist = (v, t) => (isFifth(v) ? 0.8 * t.length : 0.55 * t.length + gapOf(v));   // hitch -> trailer axle

// where the trailer body is: centre point + heading th
export function trailerPose(car, v, t, th) {
  const c = Math.cos(car.h), s = Math.sin(car.h), off = hitchOffset(v);
  const hx = car.x + off * c, hy = car.y + off * s, k = gapOf(v) + t.length / 2;
  return { hx, hy, x: hx - Math.cos(th) * k, y: hy - Math.sin(th) * k, th };
}

// reasons a vehicle cannot pull a trailer ('' = fine)
export function canTow(v, t) {
  if (!t) return '';
  if ((t.coupling || 'ball') !== (v.coupling || 'ball')) return t.coupling === 'fifth' ? 'needs a semi tractor' : 'semis cannot use a ball hitch';
  if (t.load > (v.tow ?? 0.4) + 1e-6) return 'too heavy for this vehicle';
  return '';
}

// advance trailer heading; hitch velocity = vehicle velocity + yaw rate x lever arm
export function stepTrailer(car, v, t, dt, yaw) {
  const c = Math.cos(car.h), s = Math.sin(car.h), off = hitchOffset(v);
  const ux = car.vx - yaw * off * s, uy = car.vy + yaw * off * c;
  const d = axleDist(v, t);
  car.th += (-ux * Math.sin(car.th) + uy * Math.cos(car.th)) / d * dt;
  let diff = Math.atan2(Math.sin(car.h - car.th), Math.cos(car.h - car.th)), jack = false;
  if (Math.abs(diff) > JACKKNIFE) { diff = Math.sign(diff) * JACKKNIFE; car.th = car.h - diff; jack = true; }
  return jack;
}

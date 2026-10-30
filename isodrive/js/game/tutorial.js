// First-run tutorial: a short list of steps, each with text and a completion check. Data-driven on purpose:
// to add or reorder a step, edit STEPS only. `done(game, st)` is polled; `guide(game)` returns {x,y} to point at.
// st = { x, y, coins } is a snapshot taken when the step starts.
const nearest = (game, kind) => game.world.findNearest(kind, game.car.x, game.car.y);
const door = (b) => (b ? { x: b.doorX, y: b.doorY } : null);

export const STEPS = [
  { id: 'drive',
    kbd: 'Welcome! Hold W (or the up arrow) to drive and A / D to steer. Space is a handbrake.',
    touch: 'Welcome! Hold GAS to drive and the arrow pads to steer. BRK is a handbrake.',
    done: (g, st) => Math.hypot(g.car.x - st.x, g.car.y - st.y) > 25 },
  { id: 'coin',
    kbd: 'Gold coins sit in lines on the roads. Drive through one to earn cash.',
    touch: 'Gold coins sit in lines on the roads. Drive through one to earn cash.',
    guide: (g) => (g.coins.length ? g.coins.reduce((a, c) => (Math.hypot(c.x - g.car.x, c.y - g.car.y) < Math.hypot(a.x - g.car.x, a.y - g.car.y) ? c : a)) : null),
    done: (g, st) => g.profile.stats.coins > st.coins },
  { id: 'fuel',
    kbd: 'Your tank drains as you drive. Pull up and stop in the ring at a gas station (FUEL sign), then press E to refuel. Fuel prices change by biome.',
    touch: 'Your tank drains as you drive. Pull up and stop in the ring at a gas station (FUEL sign), then tap the prompt to refuel. Prices change by biome.',
    guide: (g) => door(nearest(g, 'gas_station')),
    done: (g) => g.flags.refuel || (g.near && g.near.def.kind === 'gas_station') },
  { id: 'shop',
    kbd: 'Shops sell car parts, and every biome stocks different ones. Stop at a shop and press E to browse.',
    touch: 'Shops sell car parts, and every biome stocks different ones. Stop at a shop and tap the prompt to browse.',
    guide: (g) => door(nearest(g, 'shop')),
    done: (g) => g.flags.shop },
  { id: 'race',
    kbd: 'Races pay cash. Stop on a checkered race pad and press E to start a time trial.',
    touch: 'Races pay cash. Stop on a checkered race pad and tap the prompt to start a time trial.',
    guide: (g) => door(nearest(g, 'race_pad')),
    done: (g) => g.flags.raceStart },
  { id: 'finish',
    kbd: 'Drive through the glowing checkpoints in order. The arrow points to the next one. Beat the par time for a bonus!',
    touch: 'Drive through the glowing checkpoints in order. The arrow points to the next one. Beat the par time for a bonus!',
    done: (g) => g.flags.raceEnd },
  { id: 'end',
    kbd: 'That is everything. Garage (G) changes parts and paint, the menu has chat and controls, and the world goes on forever. Have fun!',
    touch: 'That is everything. MENU has the garage, chat and controls, and the world goes on forever. Have fun!',
    timeout: 9 },
];

export class Tutorial {
  constructor(game, ui) { this.game = game; this.ui = ui; this.i = -1; this.active = false; this.t = 0; this.chk = 0; }

  start() { this.active = true; this.game.flags = {}; this.i = -1; this.next(); }
  next() {
    this.i++;
    if (this.i >= STEPS.length) return this.finish();
    const g = this.game, c = g.car;
    this.st = { x: c.x, y: c.y, coins: g.profile.stats.coins };
    this.t = 0;
    // flags raised before a step began must not complete it (e.g. refuelled earlier); only 'end' timing differs
    if (STEPS[this.i].id === 'fuel') g.flags.refuel = false;
    if (STEPS[this.i].id === 'shop') g.flags.shop = false;
    if (STEPS[this.i].id === 'race') { g.flags.raceStart = false; }
    if (STEPS[this.i].id === 'finish') { g.flags.raceEnd = false; }
    this.show();
  }
  show() {
    const s = STEPS[this.i];
    const touch = document.body.classList.contains('touch');
    this.ui.tutorial({ text: touch ? s.touch : s.kbd, n: this.i + 1, total: STEPS.length, last: s.id === 'end' });
  }
  skip() { this.finish(true); }
  finish(skipped) {
    this.active = false; this.guide = null; this.ui.tutorial(null);
    this.game.profile.tut = true; this.game.markDirty(); this.game.save();
    if (!skipped) this.ui.banner('Tutorial complete!', 2500);
  }

  update(dt) {
    if (!this.active) { this.guide = null; return; }
    const s = STEPS[this.i], g = this.game;
    this.t += dt; this.chk += dt;
    if (s.timeout) { if (this.t > s.timeout) this.finish(); return; }
    if (this.chk < 0.25) return;
    this.chk = 0;
    this.guide = s.guide ? s.guide(g) : null;
    if (s.done(g, this.st)) { this.ui.pickup('Nice!'); this.next(); }
  }
}

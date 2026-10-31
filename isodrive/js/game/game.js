// Game orchestration: ties world, car, economy, races and networking together. No DOM here except through `ui`.
import { stepTrailer } from './trailer.js';
import { newCar, stepCar, carStats, fuelBurn, FUEL_BASE_PRICE } from './car.js';
import { Peers, packBeacon } from '../net/transport.js';
import { Tutorial } from './tutorial.js';

const COIN_VALUE = 10, COIN_R = 1.3, ZONE_R = 2.4;

export class Game {
  constructor({ reg, world, renderer, transport, profile, ui, room }) {
    Object.assign(this, { reg, world, renderer, transport, profile, ui, room });
    this.peers = new Peers();
    this.t = 0; this.now = Date.now();
    this.recompute();
    const sp = profile.pos && Number.isFinite(profile.pos.x) ? profile.pos : world.spawn();
    this.car = newCar({ x: sp.x, y: sp.y, h: sp.h || 0 });
    this.fuel = profile.fuel === null ? this.stats.fuelCap : Math.min(profile.fuel, this.stats.fuelCap);
    this.race = null; this.near = null; this.coins = []; this.wrecks = []; this.flags = {};
    this.tutorial = new Tutorial(this, ui);
    this.lastBiome = null; this.beaconT = 0; this.saveT = 0; this.dirty = false; this.strandedT = 0; this.speedMax = 0;
    transport.onBeacon = (id, d) => this.peers.update(id, d, Date.now());
    transport.onChat = (id, name, text) => ui.chat(name, text);
    transport.onStatus = (text, ok) => ui.status(text, ok);
  }

  recompute() { this.stats = carStats(this.reg, this.profile.equipped, this.profile.vehicle, this.profile.trailer); this.fuel = Math.min(this.fuel ?? Infinity, this.stats.fuelCap); }
  markDirty() { this.dirty = true; }

  // ------------------------------------------------------------------ per-frame
  update(dt, input) {
    this.t += dt; this.now = Date.now();
    const { car, world } = this;
    const h0 = car.h;
    const out = stepCar(car, input, dt, world, this.stats, this.fuel);
    if (this.stats.trailer) {
      if (car.th === undefined) car.th = car.h;
      const yaw = Math.atan2(Math.sin(car.h - h0), Math.cos(car.h - h0)) / dt;
      if (stepTrailer(car, this.stats.veh, this.stats.trailer, dt, yaw)) { const k = Math.max(0, 1 - 2.5 * dt); car.vx *= k; car.vy *= k; car.speed *= k; }
    } else car.th = undefined;
    this.fuel = Math.max(0, this.fuel - fuelBurn(this.stats, car.speed, out.thr) * dt);
    this.profile.stats.km += Math.abs(car.speed) * dt / 1000;
    this.speedMax = Math.max(this.speedMax, Math.abs(car.speed));
    if (out.hit > 6) this.ui.toast('Ouch!', 600);

    // biome banner
    const biome = car.biome;
    if (biome !== this.lastBiome) { if (this.lastBiome) this.ui.banner('Entering ' + biome.name); this.lastBiome = biome; }

    this.wrecks = world.wrecksNear(car.x - 30, car.y - 30, car.x + 30, car.y + 30, this.now);
    // coins
    this.coins = world.coinsNear(car.x - 22, car.y - 22, car.x + 22, car.y + 22, this.now);
    for (const c of this.coins) {
      if (Math.hypot(c.x - car.x, c.y - car.y) < COIN_R) {
        world.collectCoin(c.id, this.now); this.profile.cash += COIN_VALUE; this.profile.stats.coins++; this.markDirty(); this.ui.pickup('+$' + COIN_VALUE);
      }
    }

    // nearest interactable
    this.near = null;
    if (Math.abs(car.speed) < 4.5) {
      let best = ZONE_R;
      for (const b of world.buildingsInRect(car.x - 4, car.y - 4, car.x + 4, car.y + 4)) {
        if (b.def.kind === 'decor') continue;
        const d = Math.hypot(b.doorX - car.x, b.doorY - car.y);
        if (d < best) { best = d; this.near = b; }
      }
    }
    if (!this.near && Math.abs(car.speed) < 4.5) for (const w of this.wrecks) if (Math.hypot(w.x - car.x, w.y - car.y) < 4.5) { this.near = { wreck: w, def: { kind: 'wreck', name: w.def.name } }; break; }
    this.ui.prompt(this.near ? this.promptFor(this.near) : null);

    // race
    if (this.race) this.updateRace(dt);
    this.tutorial.update(dt);

    // out-of-fuel rescue prompt
    if (this.fuel <= 0 && Math.abs(car.speed) < 0.6) { this.strandedT += dt; if (this.strandedT > 2) this.ui.prompt({ text: `Out of fuel! Press T to call a tow ($${this.towCost()})`, action: () => this.tow() }); }
    else this.strandedT = 0;

    // network
    this.beaconT += dt * 1000;
    if (this.beaconT >= this.transport.beaconMs) { this.beaconT = 0; this.transport.sendBeacon(packBeacon(car, this.profile.name, this.profile.color, this.profile.vehicle, this.profile.trailer)); }
    this.ghosts = this.peers.tick(dt, this.now);

    // persistence
    this.saveT += dt;
    if (this.saveT > 12 && this.dirty) this.save();

    this.ui.hud({ cash: this.profile.cash, fuel: this.fuel, cap: this.stats.fuelCap, speed: Math.abs(car.speed), top: this.stats.topSpeed, road: car.onRoad, peers: this.ghosts.length, race: this.race, t: this.t });
  }

  save() {
    this.saveT = 0; this.dirty = false;
    this.profile.fuel = this.fuel; this.profile.pos = { x: +this.car.x.toFixed(1), y: +this.car.y.toFixed(1), h: +this.car.h.toFixed(2) };
    this.profile.rev++;
    this.transport.saveProfile(this.profile.toJSON());
  }

  // ------------------------------------------------------------------ interactions
  promptFor(b) {
    const d = b.def;
    if (d.kind === 'wreck') return { text: `[E] Salvage ${d.name}`, action: () => this.salvage(b.wreck) };
    if (d.kind === 'gas_station') {
      const need = this.stats.fuelCap - this.fuel;
      if (need < 0.5) return { text: d.name + ': tank is full' };
      const price = FUEL_BASE_PRICE * b.biome.fuelPrice;
      const cost = Math.ceil(need * price);
      return { text: `[E] Refuel ${need.toFixed(0)}L - $${cost}  (${d.name})`, action: () => this.refuel(b) };
    }
    if (d.kind === 'shop') return { text: `[E] Browse ${d.name}`, action: () => { this.flags.shop = true; this.ui.openShop(b, this); } };
    if (d.kind === 'dealer') return { text: `[E] Browse ${d.name}`, action: () => this.ui.openDealer(this) };
    if (d.kind === 'race_pad') {
      const r = this.reg.get('race', d.race);
      return this.race ? { text: '[E] Cancel current race', action: () => this.cancelRace('Race cancelled') } : { text: `[E] Start ${r.name} (par ${r.parTime}s, $${r.payout})`, action: () => this.startRace(b) };
    }
    return null;
  }
  interact() { if (this.near) { const p = this.promptFor(this.near); if (p && p.action) p.action(); } else if (this.fuel <= 0 && this.strandedT > 2) this.tow(); }

  salvage(w) {
    const k = 0.3 + 0.7 * w.loot, cash = Math.round(w.def.cash * k), litres = Math.round(w.def.fuel * k * 10) / 10;
    this.world.salvage(w.id, this.now);
    this.profile.cash += cash; this.fuel = Math.min(this.stats.fuelCap, this.fuel + litres);
    this.profile.stats.wrecks = (this.profile.stats.wrecks || 0) + 1; this.markDirty(); this.near = null;
    this.ui.toast(`Salvaged ${w.def.name}: +$${cash}${litres ? ', +' + litres.toFixed(0) + 'L fuel' : ''}`, 2500);
  }

  refuel(b) {
    const price = FUEL_BASE_PRICE * b.biome.fuelPrice;
    const need = this.stats.fuelCap - this.fuel;
    let litres = need;
    if (litres * price > this.profile.cash) litres = Math.floor(this.profile.cash / price);
    if (litres < 1) { this.ui.toast('Not enough cash for fuel', 1500); return; }
    const cost = Math.ceil(litres * price);
    this.profile.cash -= cost; this.fuel = Math.min(this.stats.fuelCap, this.fuel + litres); this.markDirty(); this.flags.refuel = true;
    this.ui.toast(`Bought ${litres.toFixed(0)}L for $${cost}`, 1500);
  }

  towCost() { return Math.min(this.profile.cash, 60); }
  tow() {
    if (this.fuel > 0.5) { this.ui.toast('You still have fuel', 1200); return; }
    const p = this.world.nearestRoadPoint(this.car.x, this.car.y);
    const cost = this.towCost();
    this.profile.cash -= cost; this.fuel = Math.min(this.stats.fuelCap, 6);
    Object.assign(this.car, { x: p.x, y: p.y, h: p.h, th: p.h, vx: 0, vy: 0, speed: 0 });
    this.ui.toast(`Towed to the road (-$${cost}, +6L)`, 2500); this.markDirty();
  }

  // Parts: buying and equipping go through here so stats and saves stay consistent.
  buy(partId) { const e = this.profile.buy(partId); if (!e) { this.recompute(); this.markDirty(); this.save(); } return e; }
  equip(partId) { if (this.profile.equip(partId)) { this.recompute(); this.markDirty(); this.save(); } }
  buyVehicle(id) { const e = this.profile.buyVehicle(id); if (!e) { this.recompute(); this.markDirty(); this.save(); } return e; }
  selectVehicle(id) { if (this.profile.selectVehicle(id)) { this.car.th = this.car.h; this.recompute(); this.markDirty(); this.save(); } }
  buyTrailer(id) { const e = this.profile.buyTrailer(id); if (!e) { this.markDirty(); this.save(); } return e; }
  hitch(id) { const e = this.profile.hitch(id); if (!e) { this.car.th = this.car.h; this.recompute(); this.markDirty(); this.save(); } return e; }
  setColor(c) { this.profile.color = c; this.markDirty(); }

  // ------------------------------------------------------------------ races
  startRace(b) {
    const def = this.reg.get('race', b.def.race);
    const points = this.world.raceCheckpoints(b, def);
    this.race = { def, points, idx: 0, t0: this.t, color: b.def.accent, bld: b, time: 0 };
    this.flags.raceStart = true; this.ui.banner(def.name + ' - GO!');
  }
  cancelRace(msg) { this.race = null; this.flags.raceEnd = true; this.ui.toast(msg, 1800); }
  updateRace(dt) {
    const r = this.race; r.time = this.t - r.t0;
    const p = r.points[r.idx];
    if (Math.hypot(p.x - this.car.x, p.y - this.car.y) < 3.2) {
      r.idx++;
      if (r.idx >= r.points.length) return this.finishRace();
      this.ui.pickup(`Checkpoint ${r.idx}/${r.points.length}`);
    }
    if (r.time > r.def.parTime * 3) this.cancelRace('Time ran out - race cancelled');
  }
  finishRace() {
    const r = this.race, def = r.def, time = r.time;
    const pay = Math.round(def.payout * Math.min(1.5, Math.max(0.25, def.parTime / time)));
    this.profile.cash += pay; this.profile.stats.races++;
    const prev = this.profile.best[def.id];
    const pb = !(prev <= time);
    if (pb) { this.profile.best[def.id] = +time.toFixed(2); this.transport.publishScore(def.id, +time.toFixed(2), this.profile.name); }
    this.ui.banner(`${def.name}: ${time.toFixed(1)}s  +$${pay}${pb ? '  NEW BEST!' : ''}`, 3500);
    this.race = null; this.flags.raceEnd = true; this.markDirty(); this.save();
  }
}

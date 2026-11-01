// All DOM UI. Rule: anything that can come from another player or a content pack goes in via textContent only.
import { CAR_COLORS } from '../game/profile.js';
import { SLOTS } from '../content/schema.js';
import { canTow } from '../game/trailer.js';

const $ = (id) => document.getElementById(id);
export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v !== undefined) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
}

const STAT_LABEL = { accel: 'Accel', topSpeed: 'Top speed', grip: 'Grip', offroad: 'Off-road', fuelCap: 'Tank', efficiency: 'Economy' };
const fmtStat = (k, v) => (k === 'offroad' || k === 'efficiency' ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}%` : `${v > 0 ? '+' : ''}${+v.toFixed(1)}${k === 'fuelCap' ? 'L' : ''}`);

export class UI {
  constructor() {
    this.game = null; this.modalOpen = false; this.onModal = () => {};
    this.promptState = null;
    $('prompt').addEventListener('click', () => { if (this.promptState && this.promptState.action) this.promptState.action(); });
    $('chatform').addEventListener('submit', (e) => {
      e.preventDefault();
      const i = $('chatinput'), text = i.value.trim().slice(0, 200);
      i.value = ''; i.blur();
      if (text && this.game) { this.game.transport.sendChat(text); this.chat(this.game.profile.name || 'me', text, true); }
    });
    $('menubtn').addEventListener('click', () => this.openMenu());
    $('chatbtn').addEventListener('click', () => this.openChat());
    $('chatinput').addEventListener('blur', () => setTimeout(() => $('chatform').classList.remove('open'), 150));
  }

  openChat() { $('chatform').classList.add('open'); $('chatinput').focus(); }

  // ---------------------------------------------------------------- small stuff
  toast(text, ms = 1500) {
    const t = el('div', { class: 'toast', text }); $('toasts').append(t);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), ms);
  }
  pickup(text) { this.toast(text, 700); }
  banner(text, ms = 2200) {
    const b = $('banner'); b.textContent = text; b.classList.add('show');
    clearTimeout(this.bt); this.bt = setTimeout(() => b.classList.remove('show'), ms);
  }
  status(text, ok) { const s = $('status'); s.textContent = text; s.classList.toggle('bad', !ok); }
  chat(name, text, mine) {
    const log = $('chatlog'), line = el('div', { class: 'chatline' + (mine ? ' mine' : '') });
    line.append(el('b', { text: name + ': ' }), document.createTextNode(text));
    log.append(line); while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => line.classList.add('old'), 12000);
  }
  prompt(p) {
    this.promptState = p;
    const e = $('prompt');
    if (!p || this.modalOpen) { e.classList.remove('show'); return; }
    if (e.textContent !== p.text) e.textContent = p.text;
    e.classList.add('show'); e.classList.toggle('action', !!p.action);
  }
  hud(s) {
    $('cash').textContent = '$' + Math.round(s.cash);
    const pct = Math.max(0, Math.min(1, s.fuel / s.cap));
    const f = $('fuelfill'); f.style.width = (pct * 100).toFixed(0) + '%';
    f.style.background = pct < 0.2 ? '#ff4a4a' : pct < 0.45 ? '#ffb340' : '#00ffff';
    $('fueltxt').textContent = s.fuel.toFixed(0) + '/' + s.cap.toFixed(0) + 'L';
    $('speed').textContent = Math.round(s.speed * 8) + ' km/h';
    $('peers').textContent = s.peers ? s.peers + ' other' + (s.peers > 1 ? 's' : '') + ' nearby' : '';
    const r = $('race');
    if (s.race) { r.classList.add('show'); r.textContent = `${s.race.def.name}  ${s.race.time.toFixed(1)}s  ${s.race.idx}/${s.race.points.length}  (par ${s.race.def.parTime}s)`; }
    else r.classList.remove('show');
  }
  contentProblems(reg) {
    const n = reg.errors.length;
    if (reg.errors.length || reg.warnings.length) {
      console.group('[isodrive] content problems'); reg.errors.forEach((e) => console.error(e)); reg.warnings.forEach((w) => console.warn(w)); console.groupEnd();
    }
    const b = $('problems');
    if (!n) { b.classList.remove('show'); return; }
    b.textContent = `${n} content problem${n > 1 ? 's' : ''} (affected items were skipped). Click for details.`;
    b.classList.add('show');
    b.onclick = () => this.modal('Content problems', el('pre', { class: 'problemlist', text: [...reg.errors.map((e) => 'ERROR: ' + e), ...reg.warnings.map((w) => 'warning: ' + w)].join('\n') }));
  }

  // ---------------------------------------------------------------- modal plumbing
  modal(title, body, { onClose, wide } = {}) {
    this.closeModal(true);
    const m = $('modal');
    m.replaceChildren(el('div', { class: 'panel' + (wide ? ' wide' : '') },
      el('div', { class: 'panelhead' }, el('h2', { text: title }), onClose === false ? null : el('button', { class: 'x', text: 'X', onclick: () => this.closeModal() })),
      body));
    m.classList.add('show'); this.modalOpen = true; this.onClose = onClose; this.onModal(true);
  }
  closeModal(silent) {
    if (!this.modalOpen) return;
    $('modal').classList.remove('show'); $('modal').replaceChildren(); this.modalOpen = false;
    const cb = this.onClose; this.onClose = null; if (cb && !silent) cb();
    this.onModal(false);
  }

  // ---------------------------------------------------------------- shop / garage
  openShop(b, game) { this.game = game; this.partsModal(b.def.name, game, b.biome.shopStock.map((id) => game.reg.get('part', id)).filter(Boolean), true); }
  openDealer(game) { this.game = game; this.modal('Auto Dealer', el('div', {}, this.vehiclesBlock(game, game.reg.list('vehicle').slice().sort((a, b) => a.price - b.price), true), this.trailersBlock(game, game.reg.list('trailer').slice().sort((a, b) => a.price - b.price), true))); }
  trailersBlock(game, list, dealer) {
    const body = el('div', { class: 'parts' });
    const render = () => {
      body.replaceChildren();
      const P = game.profile, veh = game.reg.get('vehicle', P.vehicle);
      if (!list.length) return;
      body.append(el('h3', { text: dealer ? 'trailers' : 'trailer' }));
      if (!dealer) body.append(el('div', { class: 'part' + (P.trailer ? '' : ' eq') }, el('div', { class: 'pinfo' }, el('b', { text: 'No trailer' })), el('button', { class: 'btn', disabled: !P.trailer, text: P.trailer ? 'Unhitch' : 'Hitched: none', onclick: () => { game.hitch(null); render(); } })));
      for (const t of list) {
        const have = P.trailers.has(t.id), cur = P.trailer === t.id, why = canTow(veh, t);
        const chips = el('div', { class: 'chips' }, ...[`${t.coupling === 'fifth' ? 'fifth wheel' : 'ball hitch'}`, `load ${t.load}`, `${t.length} long`].map((x) => el('span', { class: 'chip', text: x })));
        if (why) chips.append(el('span', { class: 'chip bad', text: why }));
        let btn;
        if (cur) btn = el('button', { class: 'btn', text: 'Unhitch', onclick: () => { game.hitch(null); render(); } });
        else if (have) btn = el('button', { class: 'btn', disabled: !!why, text: 'Hitch', onclick: () => { const e = game.hitch(t.id); this.toast(e || `Hitched ${t.name}`, 1400); render(); } });
        else btn = el('button', { class: 'btn buy', text: `Buy $${t.price}`, disabled: P.cash < t.price, onclick: () => { const e = game.buyTrailer(t.id); this.toast(e || `Bought ${t.name}`, 1400); render(); } });
        body.append(el('div', { class: 'part' + (cur ? ' eq' : '') }, el('div', { class: 'pinfo' }, el('b', { text: t.name }), t.desc ? el('small', { text: t.desc }) : null, chips), btn));
      }
    };
    render();
    return body;
  }
  vehiclesBlock(game, list, dealer) {
    const body = el('div', { class: 'parts' });
    const render = () => {
      body.replaceChildren();
      const P = game.profile;
      if (dealer) body.append(el('div', { class: 'cashline', text: `Cash: $${Math.round(P.cash)}` }));
      body.append(el('h3', { text: dealer ? 'vehicles' : 'vehicle' }));
      for (const v of list) {
        const have = P.garage.has(v.id), cur = P.vehicle === v.id;
        const chips = el('div', { class: 'chips' }, ...[`${v.topSpeed} top`, `${v.fuelCap}L tank`, `${v.l100} L/100km`, `range ~${Math.round(v.fuelCap / v.l100 * 100)} km`].map((t) => el('span', { class: 'chip', text: t })));
        let btn;
        if (cur) btn = el('button', { class: 'btn', disabled: true, text: 'Driving' });
        else if (have) btn = el('button', { class: 'btn', text: 'Drive', onclick: () => { game.selectVehicle(v.id); dealer ? render() : this.openGarage(game); } });
        else btn = el('button', { class: 'btn buy', text: `Buy $${v.price}`, disabled: P.cash < v.price, onclick: () => { const e = game.buyVehicle(v.id); this.toast(e || `Bought ${v.name}`, 1400); render(); } });
        body.append(el('div', { class: 'part' + (cur ? ' eq' : '') }, el('div', { class: 'pinfo' }, el('b', { text: v.name }), v.desc ? el('small', { text: v.desc }) : null, chips), btn));
      }
    };
    render();
    return body;
  }
  openGarage(game) {
    this.game = game;
    const owned = [...game.profile.owned].map((id) => game.reg.get('part', id)).filter(Boolean);
    this.partsModal('Garage', game, owned, false, game.reg.list('vehicle').filter((v) => game.profile.garage.has(v.id)));
  }
  partsModal(title, game, parts, shop, vehicles) {
    const body = el('div', { class: 'parts' });
    const render = () => {
      body.replaceChildren();
      const P = game.profile;
      body.append(el('div', { class: 'cashline', text: `Cash: $${Math.round(P.cash)}` }));
      if (!shop) body.append(this.colorRow(game));
      if (vehicles && vehicles.length > 1) { body.append(this.vehiclesBlock(game, vehicles, false)); }
      if (vehicles && game.profile.trailers.size) body.append(this.trailersBlock(game, game.reg.list('trailer').filter((t) => game.profile.trailers.has(t.id)), false));
      for (const slot of SLOTS) {
        const list = parts.filter((p) => p.slot === slot);
        if (!list.length) continue;
        body.append(el('h3', { text: slot }));
        for (const p of list) {
          const have = P.owned.has(p.id), eq = P.equipped[slot] === p.id;
          const stats = el('div', { class: 'chips' });
          for (const [k, v] of Object.entries(p.stats || {})) if (v) stats.append(el('span', { class: 'chip ' + (v > 0 ? 'good' : 'bad'), text: `${STAT_LABEL[k]} ${fmtStat(k, v)}` }));
          let btn;
          if (eq) btn = el('button', { class: 'btn', disabled: true, text: 'Equipped' });
          else if (have) btn = el('button', { class: 'btn', text: 'Equip', onclick: () => { game.equip(p.id); render(); } });
          else btn = el('button', { class: 'btn buy', text: `Buy $${p.price}`, disabled: P.cash < p.price, onclick: () => { const e = game.buy(p.id); this.toast(e || `Bought ${p.name}`, 1400); render(); } });
          body.append(el('div', { class: 'part' + (eq ? ' eq' : '') }, el('div', { class: 'pinfo' }, el('b', { text: p.name }), p.desc ? el('small', { text: p.desc }) : null, stats), btn));
        }
      }
      if (!shop) body.append(this.recordsBlock(game));
      if (shop && !parts.length) body.append(el('p', { text: 'Nothing for sale here.' }));
    };
    render();
    this.modal(title, body);
  }
  colorRow(game) {
    const row = el('div', { class: 'colors' });
    for (const c of CAR_COLORS) {
      const b = el('button', { class: 'swatch' + (game.profile.color === c ? ' sel' : ''), style: `background:${c}`, 'aria-label': 'car color ' + c });
      b.addEventListener('click', () => { game.setColor(c); [...row.children].forEach((x) => x.classList.toggle('sel', x === b)); });
      row.append(b);
    }
    return el('div', {}, el('h3', { text: 'paint' }), row);
  }
  recordsBlock(game) {
    const box = el('div', { class: 'records' }, el('h3', { text: 'records' }));
    const races = game.reg.list('race');
    for (const r of races) {
      const mine = game.profile.best[r.id];
      const line = el('div', { class: 'rec' }, el('b', { text: r.name }), el('span', { text: mine ? ` best ${mine.toFixed(1)}s` : ' no time yet' }));
      box.append(line);
      game.transport.getScores(r.id).then((s) => { if (s.length) line.append(el('small', { text: '  top: ' + s.slice(0, 3).map((e) => `${e.name} ${e.secs.toFixed(1)}s`).join(', ') })); });
    }
    return box;
  }

  // ---------------------------------------------------------------- menu
  openMenu() {
    const g = this.game; if (!g) return;
    const body = el('div', { class: 'menu' },
      el('p', { text: `Room: ${g.room}  |  ${g.transport.kind}${g.transport.userId ? '  |  ' + g.transport.userId : ''}` }),
      this.storageBlock(g),
      el('p', { text: `Races ${g.profile.stats.races}  |  Coins ${g.profile.stats.coins}  |  ${g.profile.stats.km.toFixed(1)} km` }),
      el('button', { class: 'btn', text: 'Garage (G)', onclick: () => this.openGarage(g) }),
      el('button', { class: 'btn', text: 'Controls', onclick: () => this.controls() }),
      document.fullscreenEnabled ? el('button', { class: 'btn', text: 'Toggle fullscreen', onclick: () => { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); this.closeModal(); } }) : null,
      g.transport.kind === 'matrix' ? el('button', { class: 'btn', text: 'Log out', onclick: async () => { g.save(); await g.transport.logout(); const { forgetMatrixSessions } = await import('../net/session.js'); forgetMatrixSessions(g.transport.base, g.transport.userId); location.href = location.pathname; } }) : null,
      el('button', { class: 'btn', text: 'Leave room', onclick: () => { g.save(); location.href = location.pathname; } }));
    this.modal('Menu', body);
  }
  // Where does this player's save live? Explains it plainly, and offers the fix when the room is not set up.
  storageBlock(g) {
    const t = g.transport, box = el('div', { class: 'storage' });
    if (t.kind !== 'matrix') { box.append(el('p', { text: 'Saved in this browser only.' })); return box; }
    const ok = t.saveMode === 'room' && t.portable && !t.needsSetup;
    const why = t.saveMode !== 'room' ? 'your save goes to your account (not portable)' : !t.portable ? 'the world seed is the room id (not portable)' : 'other players are not allowed to save in this room yet';
    box.append(el('p', { class: ok ? 'good' : 'warn', text: ok ? 'World and your save are stored in this room, so they move with the room.' : 'Room storage is not fully set up: ' + why + '.' }));
    if (t.needsSetup && t.canSetup) box.append(el('button', { class: 'btn buy', text: 'Set up this room (admin)', onclick: async (e) => {
      e.currentTarget.disabled = true; const r = await t.setupRoom();
      this.toast(r.ok ? 'Room set up: saves now live in the room' : 'Setup failed: ' + r.message, 3000); if (r.ok) g.save(); this.openMenu();
    } }));
    else if (t.needsSetup) box.append(el('small', { text: 'Ask a room admin to open Menu > Set up this room.' }));
    return box;
  }
  controls() {
    this.modal('Controls', el('div', { class: 'menu' },
      el('p', { text: document.body.classList.contains('touch') ? 'Touch: hold the arrow pads to steer, GAS to go, BRK for a handbrake drift, REV to brake and reverse. Tap the prompt at the bottom to refuel, shop or race.' : 'W/A/S/D or arrows: drive   Space: handbrake' }),
      el('p', { text: 'E / F: interact (refuel, shop, race)   G: garage   H: drop / hitch a trailer   T: call a tow when out of fuel' }),
      el('p', { text: 'Enter: chat   Esc: menu' }),
      el('p', { text: 'Fuel is the limit: find a gas station before the tank runs dry. Coins sit on the roads. Every biome sells different parts and charges a different fuel price.' })));
  }

  // ---------------------------------------------------------------- connect screen
  connect(defaults, reg, errorMsg = '', sessions = [], onForget = () => {}) {
    return new Promise((resolve) => {
      const d = defaults;
      const name = el('input', { id: 'f-name', maxlength: 16, value: d.name || '', placeholder: 'Your name', autocomplete: 'off' });
      const room = el('input', { id: 'f-room', value: d.room || 'lobby', autocomplete: 'off' });
      const hs = el('input', { id: 'f-hs', value: d.hs || '', placeholder: 'matrix.example.org', autocomplete: 'off' });
      const user = el('input', { id: 'f-user', value: d.user || '', placeholder: 'username or @user:server', autocomplete: 'username' });
      const pass = el('input', { id: 'f-pass', type: 'password', placeholder: 'password (never stored)', autocomplete: 'current-password' });
      const token = el('input', { id: 'f-token', type: 'password', placeholder: 'or access token', autocomplete: 'off' });
      const mroom = el('input', { id: 'f-mroom', value: d.mroom || '', placeholder: '#isodrive:matrix.example.org', autocomplete: 'off' });
      const mode = el('select', { id: 'f-mode' }, el('option', { value: 'local', text: 'Local (this browser)' }), el('option', { value: 'matrix', text: 'Matrix room' }));
      mode.value = d.mode === 'matrix' ? 'matrix' : 'local';
      const remember = el('input', { id: 'f-remember', type: 'checkbox', checked: true });
      const loginBox = el('div', {}, el('label', { text: 'Homeserver (optional if the account is @user:server)' }), hs, el('label', { text: 'Account' }), user, pass, token,
        el('label', { class: 'check' }, remember, document.createTextNode(' Stay logged in on this device (stores a login token, never your password)')));
      const acct = el('select', { id: 'f-acct' }, ...sessions.map((s, i) => el('option', { value: String(i), text: `${s.userId}  (${s.hs.replace(/^https?:\/\//, '')})` })), el('option', { value: 'new', text: 'Log in with another account...' }));
      const forget = el('button', { class: 'btn', type: 'button', id: 'f-forget', text: 'Forget this account', onclick: () => {
        const s = sessions[+acct.value]; if (!s) return; onForget(s); sessions.splice(+acct.value, 1); acct.querySelector(`option[value="${acct.value}"]`).remove(); acct.value = 'new'; syncAcct();
      } });
      const acctBox = el('div', {}, el('label', { text: 'Saved account' }), acct, forget);
      const syncAcct = () => { const saved = sessions.length && acct.value !== 'new'; acctBox.style.display = sessions.length ? '' : 'none'; loginBox.style.display = saved ? 'none' : ''; forget.style.display = saved ? '' : 'none'; };
      acct.addEventListener('change', syncAcct); syncAcct();
      const create = el('input', { id: 'f-create', type: 'checkbox' });
      const matrixBox = el('div', { class: 'mbox' }, acctBox, loginBox,
        el('label', { text: 'Room alias or id (persistent world = this room)' }), mroom,
        el('label', { class: 'check' }, create, document.createTextNode(' Create this room if it does not exist (needs an alias like #name:server)')),
        el('small', { text: 'Your password only goes to your own homeserver. The world, and your car, cash and parts, are stored in the room itself.' }));
      const localBox = el('div', { class: 'lbox' }, el('label', { text: 'Room name (same name in another tab = same world)' }), room);
      const err = el('div', { class: 'err', text: errorMsg });
      const sync = () => { matrixBox.style.display = mode.value === 'matrix' ? '' : 'none'; localBox.style.display = mode.value === 'local' ? '' : 'none'; };
      mode.addEventListener('change', sync); sync();
      const go = el('button', { class: 'btn buy', text: 'Drive', onclick: () => {
        if (!name.value.trim()) { err.textContent = 'Pick a name first'; return; }
        const savedSess = sessions.length && acct.value !== 'new' ? sessions[+acct.value] : null;
        resolve({ mode: mode.value, name: name.value.trim(), room: room.value.trim() || 'lobby', hs: hs.value.trim(), user: user.value.trim(), password: pass.value, token: token.value.trim(), mroom: mroom.value.trim(), session: savedSess, remember: remember.checked, create: create.checked });
        this.closeModal(true);
      } });
      this.connectErr = err; this.connectBtn = go;
      this.modal('Isodrive', el('div', { class: 'connect' },
        el('p', { class: 'tag', text: 'Pixel-isometric road trips across a procedural world. Drive, refuel, shop, race.' }),
        el('label', { text: 'Name' }), name, el('label', { text: 'Multiplayer' }), mode, localBox, matrixBox, err, go,
        el('small', { text: `${reg.list('biome').length} biomes, ${reg.list('part').length} parts loaded from ${reg.packs.length} content pack(s)` })), { onClose: false });
    });
  }
  showConnectError(msg) { if (this.connectErr) this.connectErr.textContent = msg; }
}

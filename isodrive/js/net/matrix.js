// Matrix transport. Uses a normal Matrix room as the multiplayer channel via the plain client-server REST API
// (no SDK needed, so it works on any homeserver and in plain browser JS).
//
//   what                 how it is stored                          why
//   -------------------  ----------------------------------------  ----------------------------------------
//   position beacons     custom room events dev.isodrive.beacon     lossy + frequent; rate-limited (see below)
//   chat                 normal m.room.message                      shows up in Element etc. too
//   player profile       per-ACCOUNT data  dev.isodrive.profile     private, persistent, no room permissions
//   leaderboard          room state dev.isodrive.score/<mxid>       shared; needs power level 0 for that type
//   world seed           the room id itself                         same room -> same world, nothing to sync
//
// Homeserver rate limits: Synapse defaults (~0.2 msg/s, burst 10) are far too low for beacons. On your own server
// raise rc_message (or exempt the users) - the client backs off automatically on 429 and says so in the HUD.
import { Transport, validBeacon } from './transport.js';

const enc = encodeURIComponent;
const BEACON = 'dev.isodrive.beacon', PROFILE = 'dev.isodrive.profile', SCORE = 'dev.isodrive.score';
const WORLD = 'dev.isodrive.world', SAVE = 'dev.isodrive.save';   // room state: world metadata, and one save per player (state_key = mxid)
const SAVE_LIMIT = 60000;                                              // Matrix events are capped at 65 KB

export class MatrixTransport extends Transport {
  constructor(opts) {
    super();
    this.kind = 'matrix';
    this.o = opts;                          // { homeserver, user, password | token, room }
    this.beaconMs = opts.beaconMs || 1000;
    this.base = '';
    this.running = false;
    this.txn = 0;
    this.sinceBeacon = 0;
    this.scores = new Map();                // mxid -> { name, best:{race:secs} }
    this.names = new Map();
    this.state = new Map();                 // 'type|state_key' -> content, for everything we read from the room
    this.saveMode = 'room';                 // 'room' (portable, in the room) or 'account' (fallback when we may not write room state)
    this.portable = false; this.canSetup = false; this.needsSetup = false;
  }

  async api(method, path, body, { retry = 3, signal } = {}) {
    for (let a = 0; ; a++) {
      let res;
      try {
        res = await fetch(this.base + '/_matrix/client/v3' + path, {
          method, signal,
          headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) { if (a >= retry) throw e; await sleep(500 * (a + 1)); continue; }
      let json = {};
      try { json = await res.json(); } catch { /* empty body */ }
      if (res.status === 429 && a < retry + 2) {
        const wait = Math.min(15000, json.retry_after_ms || 1000);
        this.beaconMs = Math.min(5000, Math.round(this.beaconMs * 1.5));
        this.onStatus(`Rate limited by homeserver - slowing updates to every ${(this.beaconMs / 1000).toFixed(1)}s`, true);
        await sleep(wait); continue;
      }
      if (!res.ok) { const err = new Error(json.error || res.statusText || 'HTTP ' + res.status); err.status = res.status; err.errcode = json.errcode; throw err; }
      return json;
    }
  }

  async connect({ room, name }) {
    const o = this.o;
    let hs = String(o.homeserver || '').trim().replace(/\/+$/, '');
    const uid = String(o.user || '').trim();
    if (!hs && uid.startsWith('@') && uid.includes(':')) hs = uid.split(':').slice(1).join(':');   // @user:domain is enough
    if (!hs) throw new Error('Homeserver URL is required');
    this.base = await discoverBase(hs);
    this.onStatus('Connecting to ' + this.base + '...', true);
    if (o.token) {
      this.token = o.token;
      let w;
      try { w = await this.api('GET', '/account/whoami', undefined, { retry: 1 }); }
      catch (e) { if (e.status === 401) { const err = new Error('Saved session expired - please log in again'); err.expired = true; throw err; } throw e; }
      this.userId = w.user_id; this.deviceId = w.device_id || o.deviceId || '';
    } else {
      if (!o.user || !o.password) throw new Error('User and password (or an access token) are required');
      const r = await this.api('POST', '/login', {
        type: 'm.login.password', identifier: { type: 'm.id.user', user: o.user }, password: o.password,
        initial_device_display_name: 'Isodrive', ...(o.deviceId ? { device_id: o.deviceId } : {}),
      }, { retry: 1 });
      this.token = r.access_token; this.userId = r.user_id; this.deviceId = r.device_id || '';
      if (o.onLogin) o.onLogin({ hs: this.base, userId: this.userId, token: this.token, deviceId: this.deviceId });
    }
    const roomArg = (room || o.room || '').trim();
    if (!roomArg) throw new Error('Room (alias like #race:server or room id) is required');
    let j;
    try { j = await this.api('POST', '/join/' + enc(roomArg), {}, { retry: 1 }); }
    catch (e) {
      if ((e.status === 404 || e.errcode === 'M_NOT_FOUND') && o.createIfMissing && /^#[^:]+:.+/.test(roomArg)) j = await this.createRoom(roomArg);
      else throw e;
    }
    this.roomId = j.room_id;
    this.displayName = name || this.userId;
    this.running = true;
    this.aborter = new AbortController();
    await this.loadRoomState();
    const seed = await this.ensureWorld();
    this.syncLoop();
    this.onStatus(`Matrix: ${this.userId} in ${roomArg}`, true);
    return { seed, userId: this.userId, displayName: this.displayName, portable: this.portable, saveMode: this.saveMode };
  }

  // ------------------------------------------------------------ sync
  async syncLoop() {
    const filter = JSON.stringify({
      presence: { types: [] }, account_data: { types: [] },
      room: { rooms: [this.roomId], ephemeral: { types: [] }, account_data: { types: [] },
        timeline: { limit: 30, types: [BEACON, 'm.room.message', SCORE, 'm.room.member'] }, state: { types: [SCORE, 'm.room.member'], lazy_load_members: true } },
    });
    let since = null, failures = 0, first = true;
    while (this.running) {
      try {
        const q = `?timeout=${first ? 0 : 20000}&filter=${enc(filter)}` + (since ? '&since=' + enc(since) : '');
        const r = await this.api('GET', '/sync' + q, undefined, { signal: this.aborter.signal });
        since = r.next_batch; failures = 0;
        const room = r.rooms && r.rooms.join && r.rooms.join[this.roomId];
        if (room) this.handleRoom(room, first);
        first = false;
      } catch (e) {
        if (!this.running) return;
        failures++;
        this.onStatus('Matrix sync error: ' + e.message + ' (retrying)', false);
        await sleep(Math.min(10000, 1000 * failures));
      }
    }
  }

  handleRoom(room, first) {
    const now = Date.now();
    for (const ev of (room.state && room.state.events) || []) this.handleState(ev);
    for (const ev of (room.timeline && room.timeline.events) || []) {
      if (ev.state_key !== undefined) { this.handleState(ev); continue; }
      if (ev.sender === this.userId) continue;
      const age = now - (ev.origin_server_ts || now);
      if (ev.type === BEACON) {
        if (age < 10000 && validBeacon(ev.content)) this.onBeacon(ev.sender, ev.content);
      } else if (ev.type === 'm.room.message' && ev.content && ev.content.msgtype === 'm.text' && !first && age < 60000) {
        const nm = this.names.get(ev.sender) || ev.sender.replace(/^@/, '').split(':')[0];
        this.onChat(ev.sender, nm, String(ev.content.body || '').slice(0, 200));
      }
    }
  }
  handleState(ev) {
    if (ev.type === 'm.room.member' && ev.content && ev.content.displayname) this.names.set(ev.state_key, ev.content.displayname);
    if (ev.type === SCORE && ev.content && typeof ev.content.best === 'object') this.scores.set(ev.state_key, { name: String(ev.content.name || ev.state_key).slice(0, 16), best: ev.content.best });
  }

  // ------------------------------------------------------------ sending
  txnId() { return `iso${Date.now().toString(36)}${(this.txn++).toString(36)}`; }
  sendBeacon(d) {
    if (!this.running || this.sending) return;
    this.sending = true;
    this.api('PUT', `/rooms/${enc(this.roomId)}/send/${BEACON}/${this.txnId()}`, d, { retry: 0 })
      .catch(() => { /* beacons are lossy by design */ }).finally(() => { this.sending = false; });
  }
  sendChat(text) {
    if (!this.running) return;
    this.api('PUT', `/rooms/${enc(this.roomId)}/send/m.room.message/${this.txnId()}`, { msgtype: 'm.text', body: text })
      .catch((e) => this.onStatus('Chat failed: ' + e.message, false));
  }

  // ------------------------------------------------------------ room state: world, permissions, saves
  async loadRoomState() {
    try {
      const st = await this.api('GET', `/rooms/${enc(this.roomId)}/state`, undefined, { retry: 1 });
      for (const ev of st) {
        this.handleState(ev);
        const mine = ev.type === SAVE && ev.state_key === this.userId;      // other players' saves are not needed
        if (ev.type === 'm.room.power_levels' || ev.type === WORLD || mine) this.state.set(`${ev.type}|${ev.state_key}`, ev.content);
      }
    } catch { /* leaderboard and saves are optional: fall back to account storage */ }
  }
  powerLevels() { return this.state.get('m.room.power_levels|') || null; }
  levelOf(uid) { const pl = this.powerLevels(); return !pl ? 0 : (pl.users && pl.users[uid] !== undefined ? pl.users[uid] : (pl.users_default ?? 0)); }
  levelNeeded(type) { const pl = this.powerLevels(); return !pl ? 100 : (pl.events && pl.events[type] !== undefined ? pl.events[type] : (pl.state_default ?? 50)); }
  can(type) { return this.levelOf(this.userId) >= this.levelNeeded(type); }

  // The world seed lives in the room (so the world survives the room being moved or re-aliased). If the room has none and
  // we may write it, create it. If we may not, fall back to the room id (works, but is NOT portable).
  async ensureWorld() {
    const read = () => { const w = this.state.get(WORLD + '|'); return w && typeof w.seed === 'string' && w.seed ? w.seed : null; };
    let seed = read();
    if (!seed && this.can(WORLD)) {
      const fresh = this.roomId;       // same value players already had, so an existing world does not change
      try {
        await this.api('PUT', `/rooms/${enc(this.roomId)}/state/${WORLD}/`, { v: 1, seed: fresh, created: Date.now() }, { retry: 1 });
        const back = await this.api('GET', `/rooms/${enc(this.roomId)}/state/${WORLD}/`, undefined, { retry: 1 }).catch(() => null);   // two first-joiners: the room's value wins
        seed = back && typeof back.seed === 'string' ? back.seed : fresh;
        this.state.set(WORLD + '|', { v: 1, seed });
      } catch { /* no permission after all */ }
    }
    this.portable = !!seed;
    this.refreshSetupState();
    return seed || this.roomId;
  }
  refreshSetupState() {
    const mayWrite = this.can(SAVE);
    this.saveMode = mayWrite ? 'room' : 'account';
    this.canSetup = this.levelOf(this.userId) >= this.levelNeeded('m.room.power_levels');
    const pl = this.powerLevels();
    const playersCanSave = !!pl && (pl.users_default ?? 0) >= this.levelNeeded(SAVE);      // an admin must also check what ordinary players may do
    this.needsSetup = !mayWrite || !this.portable || !playersCanSave;
  }
  // Room admins: allow every player to write their own save + score, and make sure the world seed exists.
  async setupRoom() {
    const pl = { ...(this.powerLevels() || {}) };
    pl.events = { ...(pl.events || {}), [SAVE]: 0, [SCORE]: 0 };
    try {
      await this.api('PUT', `/rooms/${enc(this.roomId)}/state/m.room.power_levels/`, pl, { retry: 1 });
      this.state.set('m.room.power_levels|', pl);
      if (!this.state.get(WORLD + '|')) await this.ensureWorldAfterSetup();
      this.refreshSetupState();
      return { ok: true, seed: (this.state.get(WORLD + '|') || {}).seed };
    } catch (e) { return { ok: false, message: e.message }; }
  }
  async ensureWorldAfterSetup() {
    const fresh = this.roomId;
    await this.api('PUT', `/rooms/${enc(this.roomId)}/state/${WORLD}/`, { v: 1, seed: fresh, created: Date.now() }, { retry: 1 });
    this.state.set(WORLD + '|', { v: 1, seed: fresh }); this.portable = true;
  }
  async createRoom(alias) {
    const local = alias.slice(1).split(':')[0];
    const ev = { 'm.room.name': 50, 'm.room.power_levels': 100, 'm.room.history_visibility': 100, 'm.room.canonical_alias': 50, 'm.room.avatar': 50, 'm.room.tombstone': 100, 'm.room.server_acl': 100, 'm.room.encryption': 100, 'm.room.topic': 50, [SAVE]: 0, [SCORE]: 0 };
    this.onStatus('Creating room ' + alias + '...', true);
    return this.api('POST', '/createRoom', {
      room_alias_name: local, name: local, topic: 'Isodrive world', preset: 'public_chat', visibility: 'private',
      power_level_content_override: { events: ev },       // events is replaced wholesale, so the defaults are repeated here
      initial_state: [{ type: WORLD, state_key: '', content: { v: 1, seed: randomSeed(), created: Date.now() } }],
    }, { retry: 0 });
  }

  // ------------------------------------------------------------ persistence (profile = the player's save)
  accountKey() { return `${SAVE}.${hash36(this.roomId)}`; }       // fallback storage, one per room so rooms never clash
  async loadProfile() {
    const candidates = [];
    const inRoom = this.state.get(`${SAVE}|${this.userId}`);
    if (inRoom && typeof inRoom === 'object') candidates.push({ data: inRoom, room: true });
    try { const a = await this.api('GET', `/user/${enc(this.userId)}/account_data/${enc(this.accountKey())}`, undefined, { retry: 1 }); if (a && typeof a === 'object') candidates.push({ data: a, room: false }); }
    catch (e) { if (e.status !== 404) this.onStatus('Could not read fallback save: ' + e.message, false); }
    if (!candidates.length) return {};
    candidates.sort((x, y) => ((y.data.rev || 0) - (x.data.rev || 0)) || (y.room - x.room));     // newest save wins, the room wins ties
    return candidates[0].data;
  }
  async saveProfile(json) {
    if (!this.running) return;
    const text = JSON.stringify(json);
    if (text.length > SAVE_LIMIT) { this.onStatus('Save is too large for a Matrix event (' + text.length + ' bytes)', false); return; }
    if (this.savingNow) { this.pendingSave = json; return; }
    this.savingNow = true;
    try {
      if (this.saveMode === 'room') {
        try { await this.api('PUT', `/rooms/${enc(this.roomId)}/state/${SAVE}/${enc(this.userId)}`, json, { retry: 1 }); this.state.set(`${SAVE}|${this.userId}`, json); return; }
        catch (e) { if (e.status !== 403) throw e; this.saveMode = 'account'; this.needsSetup = true; this.onStatus('Not allowed to save in this room - saving to your account instead (not portable)', false); }
      }
      await this.api('PUT', `/user/${enc(this.userId)}/account_data/${enc(this.accountKey())}`, json, { retry: 1 });
    } catch (e) { this.onStatus('Could not save: ' + e.message, false); }
    finally { this.savingNow = false; const next = this.pendingSave; this.pendingSave = null; if (next) this.saveProfile(next); }
  }
  async publishScore(raceId, secs, name) {
    const mine = this.scores.get(this.userId) || { name, best: {} };
    mine.name = name; mine.best = { ...mine.best, [raceId]: secs };
    this.scores.set(this.userId, mine);
    try { await this.api('PUT', `/rooms/${enc(this.roomId)}/state/${SCORE}/${enc(this.userId)}`, mine, { retry: 1 }); }
    catch (e) { this.onStatus(e.status === 403 ? 'Leaderboard needs room power level 0 for ' + SCORE + ' (see README)' : 'Score not shared: ' + e.message, false); }
  }
  async getScores(raceId) {
    return [...this.scores.values()].filter((s) => Number.isFinite(s.best[raceId])).map((s) => ({ name: s.name, secs: s.best[raceId] })).sort((a, b) => a.secs - b.secs).slice(0, 10);
  }

  static async revoke(sess) { const t = new MatrixTransport({}); t.base = await discoverBase(sess.hs); t.token = sess.token; await t.logout(); }

  // Invalidate this token on the server (used by "Log out / forget this device").
  async logout() { try { await this.api('POST', '/logout', {}, { retry: 0 }); } catch { /* already invalid */ } }

  disconnect() {
    this.running = false;
    if (this.aborter) this.aborter.abort();
  }
}
// "matrix.example.org" may be a delegated domain: ask its .well-known where the real homeserver lives.
export async function discoverBase(input) {
  if (/^https?:\/\//.test(input)) return input;
  try {
    const r = await fetch(`https://${input}/.well-known/matrix/client`, { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); const b = j && j['m.homeserver'] && j['m.homeserver'].base_url; if (typeof b === 'string' && /^https?:\/\//.test(b)) return b.replace(/\/+$/, ''); }
  } catch { /* no well-known, or CORS blocked it: use the domain directly */ }
  return 'https://' + input;
}
const randomSeed = () => { const a = new Uint32Array(3); crypto.getRandomValues(a); return 'w-' + [...a].map((n) => n.toString(36)).join(''); };
const hash36 = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

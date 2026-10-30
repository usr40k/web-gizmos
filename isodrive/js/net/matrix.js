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
    const j = await this.api('POST', '/join/' + enc(roomArg), {});
    this.roomId = j.room_id;
    this.displayName = name || this.userId;
    this.running = true;
    this.aborter = new AbortController();
    await this.loadScores();
    this.syncLoop();
    this.onStatus(`Matrix: ${this.userId} in ${roomArg}`, true);
    return { seed: this.roomId, userId: this.userId, displayName: this.displayName };
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

  // ------------------------------------------------------------ persistence
  async loadProfile() {
    try { return await this.api('GET', `/user/${enc(this.userId)}/account_data/${PROFILE}`, undefined, { retry: 1 }); }
    catch (e) { if (e.status === 404) return {}; this.onStatus('Could not load profile: ' + e.message, false); return {}; }
  }
  async saveProfile(json) {
    if (!this.running) return;
    try { await this.api('PUT', `/user/${enc(this.userId)}/account_data/${PROFILE}`, json, { retry: 1 }); }
    catch (e) { this.onStatus('Could not save profile: ' + e.message, false); }
  }
  async loadScores() {
    try {
      const st = await this.api('GET', `/rooms/${enc(this.roomId)}/state`, undefined, { retry: 1 });
      for (const ev of st) this.handleState(ev);
    } catch { /* leaderboard is optional */ }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

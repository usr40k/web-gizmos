#!/usr/bin/env node
// Minimal fake Matrix homeserver for testing the Matrix transport offline.   node tools/mock-homeserver.mjs [port]
// Implements what Isodrive uses: login/logout/whoami, rooms with power levels + aliases, createRoom, join, sync
// (long-poll), send, state read/write (with power-level and state_key rules), account data. NOT a real server.
// Options: { rateLimitFirst: n }   first n sends answer 429
//          { autoCreate: true }    joining an unknown alias creates a wide-open room (old tests); false = 404 like Synapse
import http from 'node:http';

const DEFAULT_EVENTS = { 'm.room.name': 50, 'm.room.power_levels': 100, 'm.room.history_visibility': 100, 'm.room.canonical_alias': 50, 'm.room.avatar': 50, 'm.room.tombstone': 100, 'm.room.server_acl': 100, 'm.room.encryption': 100, 'm.room.topic': 50 };

export function startMock(port = 0, { rateLimitFirst = 0, autoCreate = true } = {}) {
  const tokens = new Map(), devices = new Map(), logins = [], rooms = new Map(), aliases = new Map(), acct = new Map(), joined = new Map();
  let limited = rateLimitFirst, sentCount = 0, nextRoom = 1;
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(JSON.stringify(obj)); };

  function makeRoom(creator, { id, override = {}, initial = [], open = false, name } = {}) {
    id = id || `!room${nextRoom++}:mock`;
    const r = { id, creator, events: [], state: new Map(), open };
    rooms.set(id, r);
    const put = (type, key, content, sender = creator) => { const ev = { type, state_key: key, sender, content, origin_server_ts: Date.now() }; r.state.set(type + '|' + key, ev); r.events.push(ev); return ev; };
    r.put = put;
    put('m.room.create', '', { creator });
    put('m.room.power_levels', '', { users: { [creator]: 100 }, users_default: 0, events_default: 0, state_default: 50, events: { ...DEFAULT_EVENTS }, ...override });
    if (name) put('m.room.name', '', { name });
    for (const s of initial) put(s.type, s.state_key || '', s.content);
    return r;
  }
  const level = (r, uid) => { const pl = (r.state.get('m.room.power_levels|') || {}).content || {}; return (pl.users && pl.users[uid] !== undefined) ? pl.users[uid] : (pl.users_default ?? 0); };
  const needed = (r, type) => { const pl = (r.state.get('m.room.power_levels|') || {}).content || {}; return (pl.events && pl.events[type] !== undefined) ? pl.events[type] : (pl.state_default ?? 50); };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 200, {});
    const url = new URL(req.url, 'http://x'); const path = decodeURIComponent(url.pathname.replace('/_matrix/client/v3', ''));
    let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
    const tok = (req.headers.authorization || '').replace('Bearer ', ''); const who = tokens.get(tok);
    if (path === '/login' && req.method === 'POST') {
      const u = body.identifier && body.identifier.user; const id = u.startsWith('@') ? u : `@${u}:mock`;
      if (body.password !== 'pw-' + id.slice(1).split(':')[0]) return send(res, 403, { errcode: 'M_FORBIDDEN', error: 'Invalid password' });
      const t = 'tok_' + Math.random().toString(36).slice(2); const dev = body.device_id || 'DEV' + Math.random().toString(36).slice(2, 8).toUpperCase();
      tokens.set(t, id); devices.set(t, dev); logins.push({ id, dev }); return send(res, 200, { access_token: t, user_id: id, device_id: dev });
    }
    if (!who) return send(res, 401, { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown token' });
    if (path === '/account/whoami') return send(res, 200, { user_id: who, device_id: devices.get(tok) });
    if (path === '/logout') { tokens.delete(tok); return send(res, 200, {}); }
    if (path === '/createRoom' && req.method === 'POST') {
      if (body.room_alias_name && aliases.has(`#${body.room_alias_name}:mock`)) return send(res, 400, { errcode: 'M_ROOM_IN_USE', error: 'Room alias already taken' });
      const r = makeRoom(who, { override: body.power_level_content_override, initial: body.initial_state, name: body.name });
      if (body.room_alias_name) aliases.set(`#${body.room_alias_name}:mock`, r.id);
      (joined.get(who) || joined.set(who, new Set()).get(who)).add(r.id);
      r.put('m.room.member', who, { membership: 'join', displayname: who.slice(1).split(':')[0] }, who);
      return send(res, 200, { room_id: r.id });
    }
    let m;
    if ((m = path.match(/^\/join\/(.+)$/))) {
      let rid = m[1].startsWith('#') ? aliases.get(m[1]) : m[1];
      if (!rid || !rooms.has(rid)) {
        if (autoCreate && m[1].startsWith('#')) { const r = makeRoom('@admin:mock', { id: '!room1:mock', open: true }); aliases.set(m[1], r.id); rid = r.id; }
        else return send(res, 404, { errcode: 'M_NOT_FOUND', error: `Room alias ${m[1]} not found` });
      }
      const r = rooms.get(rid); (joined.get(who) || joined.set(who, new Set()).get(who)).add(rid);
      r.put('m.room.member', who, { membership: 'join', displayname: who.slice(1).split(':')[0] }, who);
      return send(res, 200, { room_id: rid });
    }
    if ((m = path.match(/^\/user\/([^/]+)\/account_data\/(.+)$/))) {
      const k = m[1] + '|' + m[2];
      if (m[1] !== who) return send(res, 403, { errcode: 'M_FORBIDDEN', error: 'not yours' });
      if (req.method === 'PUT') { acct.set(k, body); return send(res, 200, {}); }
      return acct.has(k) ? send(res, 200, acct.get(k)) : send(res, 404, { errcode: 'M_NOT_FOUND', error: 'Account data not found' });
    }
    if (path === '/sync') {
      let rid = null; try { rid = JSON.parse(url.searchParams.get('filter')).room.rooms[0]; } catch { /* no filter */ }
      const r = rooms.get(rid); if (!r) return send(res, 200, { next_batch: '0', rooms: {} });
      const since = url.searchParams.get('since'); const timeout = Math.min(+url.searchParams.get('timeout') || 0, 1500);
      const from = since === null ? Math.max(0, r.events.length - 30) : +since; const t0 = Date.now();
      while (since !== null && r.events.length <= from && Date.now() - t0 < timeout) await new Promise((x) => setTimeout(x, 40));
      return send(res, 200, { next_batch: String(r.events.length), rooms: { join: { [r.id]: { timeline: { events: r.events.slice(from) }, state: { events: since === null ? [...r.state.values()] : [] } } } } });
    }
    if ((m = path.match(/^\/rooms\/([^/]+)\/(.*)$/))) {
      const r = rooms.get(m[1]); if (!r) return send(res, 404, { errcode: 'M_NOT_FOUND', error: 'Unknown room' });
      const rest = m[2]; let k;
      if ((k = rest.match(/^send\/([^/]+)\/([^/]+)$/))) {
        if (limited > 0) { limited--; return send(res, 429, { errcode: 'M_LIMIT_EXCEEDED', error: 'Too many requests', retry_after_ms: 150 }); }
        sentCount++; r.events.push({ type: k[1], sender: who, content: body, event_id: '$' + r.events.length, origin_server_ts: Date.now() }); return send(res, 200, { event_id: '$' + r.events.length });
      }
      if ((k = rest.match(/^state\/([^/]+)\/?(.*)$/)) && req.method === 'PUT') {
        const [type, key] = [k[1], k[2]];
        if (!r.open) {
          if (type.startsWith('dev.isodrive') && key !== who && key !== '') return send(res, 403, { errcode: 'M_FORBIDDEN', error: 'state_key must be your own user id' });
          if (level(r, who) < needed(r, type)) return send(res, 403, { errcode: 'M_FORBIDDEN', error: `You don't have permission to send ${type} state (need ${needed(r, type)}, have ${level(r, who)})` });
        }
        r.put(type, key, body, who); return send(res, 200, { event_id: '$s' });
      }
      if ((k = rest.match(/^state\/([^/]+)\/?(.*)$/)) && req.method === 'GET') {
        const ev = r.state.get(k[1] + '|' + k[2]); return ev ? send(res, 200, ev.content) : send(res, 404, { errcode: 'M_NOT_FOUND', error: 'Event not found.' });
      }
      if (rest === 'state') return send(res, 200, [...r.state.values()]);
    }
    send(res, 404, { errcode: 'M_UNRECOGNIZED', error: 'Unknown ' + path });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port, sent: () => sentCount, logins, tokens, rooms, aliases, acct, close: () => server.close() })));
}

if (process.argv[1] && process.argv[1].endsWith('mock-homeserver.mjs')) {
  const { port } = await startMock(+process.argv[2] || 8008);
  console.log(`mock homeserver on http://127.0.0.1:${port}  (users: any name, password "pw-<name>")`);
}

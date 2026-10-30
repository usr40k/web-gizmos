#!/usr/bin/env node
// Minimal fake Matrix homeserver for testing the Matrix transport offline.   node tools/mock-homeserver.mjs [port]
// Implements just what Isodrive uses: login, whoami, join, sync (long-poll), send, state, account data. Not a real server!
import http from 'node:http';

export function startMock(port = 0, { rateLimitFirst = 0 } = {}) {
  const users = new Map(), tokens = new Map(), events = [], state = new Map(), acct = new Map();
  let limited = rateLimitFirst, sentCount = 0;
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(JSON.stringify(obj)); };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 200, {});
    const url = new URL(req.url, 'http://x'); const path = decodeURIComponent(url.pathname.replace('/_matrix/client/v3', ''));
    let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
    const who = tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
    if (path === '/login' && req.method === 'POST') {
      const u = body.identifier && body.identifier.user; const id = u.startsWith('@') ? u : `@${u}:mock`;
      if (body.password !== 'pw-' + id.slice(1).split(':')[0]) return send(res, 403, { errcode: 'M_FORBIDDEN', error: 'Invalid password' });
      const tok = 'tok_' + Math.random().toString(36).slice(2); tokens.set(tok, id); return send(res, 200, { access_token: tok, user_id: id });
    }
    if (!who) return send(res, 401, { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown token' });
    if (path === '/account/whoami') return send(res, 200, { user_id: who });
    if (path.startsWith('/join/')) { events.push({ type: 'm.room.member', state_key: who, sender: who, content: { membership: 'join', displayname: who.slice(1).split(':')[0] }, origin_server_ts: Date.now() }); state.set('m.room.member|' + who, events[events.length - 1]); return send(res, 200, { room_id: '!room1:mock' }); }
    let m;
    if ((m = path.match(/^\/rooms\/([^/]+)\/send\/([^/]+)\/([^/]+)$/))) {
      if (limited > 0) { limited--; return send(res, 429, { errcode: 'M_LIMIT_EXCEEDED', error: 'Too many requests', retry_after_ms: 150 }); }
      sentCount++; events.push({ type: m[2], sender: who, content: body, event_id: '$' + events.length, origin_server_ts: Date.now() }); return send(res, 200, { event_id: '$' + events.length });
    }
    if ((m = path.match(/^\/rooms\/([^/]+)\/state\/([^/]+)\/(.+)$/))) {
      if (m[2].startsWith('dev.isodrive') && m[3] !== who) return send(res, 403, { errcode: 'M_FORBIDDEN', error: 'state_key must be your own user id' });
      const ev = { type: m[2], state_key: m[3], sender: who, content: body, origin_server_ts: Date.now() }; state.set(m[2] + '|' + m[3], ev); events.push(ev); return send(res, 200, { event_id: '$s' });
    }
    if ((m = path.match(/^\/rooms\/([^/]+)\/state$/))) return send(res, 200, [...state.values()]);
    if ((m = path.match(/^\/user\/([^/]+)\/account_data\/(.+)$/))) {
      const k = m[1] + '|' + m[2];
      if (m[1] !== who) return send(res, 403, { errcode: 'M_FORBIDDEN', error: 'not yours' });
      if (req.method === 'PUT') { acct.set(k, body); return send(res, 200, {}); }
      return acct.has(k) ? send(res, 200, acct.get(k)) : send(res, 404, { errcode: 'M_NOT_FOUND', error: 'Account data not found' });
    }
    if (path === '/sync') {
      const since = url.searchParams.get('since'); const timeout = Math.min(+url.searchParams.get('timeout') || 0, 1500);
      const from = since === null ? Math.max(0, events.length - 30) : +since;
      const t0 = Date.now();
      while (since !== null && events.length <= from && Date.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 40));
      const slice = events.slice(from);
      const out = { next_batch: String(events.length), rooms: { join: { '!room1:mock': { timeline: { events: slice }, state: { events: since === null ? [...state.values()] : [] } } } } };
      return send(res, 200, out);
    }
    send(res, 404, { errcode: 'M_UNRECOGNIZED', error: 'Unknown ' + path });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port, sent: () => sentCount, close: () => server.close() })));
}

if (process.argv[1] && process.argv[1].endsWith('mock-homeserver.mjs')) {
  const { port } = await startMock(+process.argv[2] || 8008);
  console.log(`mock homeserver on http://127.0.0.1:${port}  (users: any name, password "pw-<name>")`);
}

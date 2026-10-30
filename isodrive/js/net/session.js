// Remembered Matrix logins. We store the ACCESS TOKEN and device id, never the password, so the page can resume
// without typing credentials. "Forget" removes it locally (and the game also logs the token out server-side).
// The token lives in this browser's localStorage, so it is only as safe as the browser profile: don't tick
// "remember" on a shared computer.
const KEY = 'isodrive:sessions';
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };
const keyOf = (s) => `${s.hs}|${s.userId}`;

export const listSessions = () => Object.values(read()).filter((s) => s && s.token && s.hs && s.userId).sort((a, b) => (b.ts || 0) - (a.ts || 0));
export function saveSession(s) { const all = read(); all[keyOf(s)] = { hs: s.hs, userId: s.userId, token: s.token, deviceId: s.deviceId || '', ts: Date.now() }; write(all); }
export function forgetSession(s) { const all = read(); delete all[keyOf(s)]; write(all); }
// Device ids are remembered per account even without a token, so repeated password logins reuse one device
// instead of piling up. Keys are "homeserver|user" in whichever form was typed, plus the canonical form.
const dk = (hs, user) => 'dev|' + String(hs).trim().toLowerCase().replace(/\/+$/, '') + '|' + String(user).trim().toLowerCase();
export function deviceFor(hs, user) { const all = read(); return (all[dk(hs, user)] || {}).id || ''; }
export function rememberDevice(pairs, id) { if (!id) return; const all = read(); for (const [hs, user] of pairs) all[dk(hs, user)] = { id }; write(all); }

// Offline / same-browser transport: tabs on the same machine see each other through BroadcastChannel.
// Also the fallback when you just want to drive around alone.
import { Transport, validBeacon } from './transport.js';
import { loadLocal } from '../game/profile.js';

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export class LocalTransport extends Transport {
  constructor() { super(); this.kind = 'local'; this.beaconMs = 100; }

  async connect({ room, name }) {
    this.room = room;
    this.profileKey = room + ':' + name;      // one profile per name per room, so two tabs are two players
    this.userId = 'local-' + Math.random().toString(36).slice(2, 8);
    this.displayName = name;
    if (typeof BroadcastChannel !== 'undefined') {
      this.ch = new BroadcastChannel('isodrive:' + room);
      this.ch.onmessage = (e) => {
        const m = e.data;
        if (!m || m.id === this.userId) return;
        if (m.t === 'b' && validBeacon(m.d)) this.onBeacon(m.id, m.d);
        else if (m.t === 'c' && typeof m.text === 'string') this.onChat(m.id, String(m.name || '?').slice(0, 16), m.text.slice(0, 200));
      };
    }
    this.onStatus('Local room "' + room + '" (this browser only)', true);
    return { seed: room, userId: this.userId, displayName: name };
  }
  sendBeacon(d) { if (this.ch) this.ch.postMessage({ t: 'b', id: this.userId, d }); }
  sendChat(text) { if (this.ch) this.ch.postMessage({ t: 'c', id: this.userId, name: this.displayName, text }); }
  async loadProfile() { return loadLocal(this.profileKey); }
  async saveProfile(json) { const s = store(); if (s) try { s.setItem('isodrive:profile:' + this.profileKey, JSON.stringify(json)); } catch { /* ignore */ } }
  async publishScore(raceId, secs, name) {
    const s = store(); if (!s) return;
    const k = `isodrive:scores:${this.room}:${raceId}`;
    let all = []; try { all = JSON.parse(s.getItem(k) || '[]'); } catch { /* ignore */ }
    all = all.filter((e) => e.name !== name); all.push({ name, secs });
    all.sort((a, b) => a.secs - b.secs);
    try { s.setItem(k, JSON.stringify(all.slice(0, 10))); } catch { /* ignore */ }
  }
  async getScores(raceId) {
    const s = store(); if (!s) return [];
    try { return JSON.parse(s.getItem(`isodrive:scores:${this.room}:${raceId}`) || '[]'); } catch { return []; }
  }
  disconnect() { if (this.ch) this.ch.close(); this.ch = null; }
}

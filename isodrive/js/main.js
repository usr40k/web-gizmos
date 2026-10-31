// Bootstrap: load content -> connect dialog -> transport -> world -> game loop.
import { loadContent } from './content/load.js';
import { World } from './world/world.js';
import { Renderer } from './render/renderer.js';
import { Game } from './game/game.js';
import { Input } from './game/input.js';
import { Profile, CAR_COLORS } from './game/profile.js';
import { LocalTransport } from './net/local.js';
import { MatrixTransport } from './net/matrix.js';
import { listSessions, saveSession, forgetSession, deviceFor, rememberDevice } from './net/session.js';
import { UI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const SETTINGS = 'isodrive:settings';
const loadSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS) || '{}'); } catch { return {}; } };
const saveSettings = (s) => { try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch { /* ignore */ } };

async function main() {
  if (matchMedia('(pointer: coarse)').matches || params.has('touch')) document.body.classList.add('touch');
  const ui = new UI();
  const reg = await loadContent({ extraNames: params.getAll('pack') });
  ui.contentProblems(reg);
  if (!reg.list('biome').length) { ui.modal('Cannot start', document.createTextNode('No valid biomes were loaded. Open the console for the content errors.'), { onClose: false }); return; }

  const saved = loadSettings();
  let defaults = { name: params.get('name') || saved.name, room: params.get('room') || saved.room, mode: params.get('mode') || saved.mode,
    hs: params.get('hs') || saved.hs, user: params.get('user') || saved.user, mroom: params.get('mroom') || saved.mroom };
  let choice = params.has('autostart') && defaults.name && (defaults.mode || 'local') === 'local' ? { ...defaults, mode: 'local', room: defaults.room || 'lobby' } : null;

  let transport, info, error = '';
  for (;;) {
    if (!choice) choice = await ui.connect(defaults, reg, error, listSessions(), (s) => { forgetSession(s); MatrixTransport.revoke(s).catch(() => {}); });
    defaults = { ...choice, password: undefined, token: undefined };
    saveSettings({ name: choice.name, room: choice.room, mode: choice.mode, hs: choice.hs, user: choice.user, mroom: choice.mroom });
    try {
      if (choice.mode === 'matrix') {
        const sess = choice.session;
        transport = new MatrixTransport({
          homeserver: sess ? sess.hs : choice.hs, user: choice.user, password: choice.password, room: choice.mroom, createIfMissing: !!choice.create,
          token: sess ? sess.token : choice.token, deviceId: sess ? sess.deviceId : deviceFor(choice.hs, choice.user),
          onLogin: (s) => { rememberDevice([[choice.hs, choice.user], [s.hs, s.userId]], s.deviceId); if (choice.remember) saveSession(s); },
        });
      } else transport = new LocalTransport();
      info = await transport.connect({ room: choice.mode === 'matrix' ? choice.mroom : choice.room, name: choice.name });
      break;
    } catch (e) {
      if (e.expired && choice && choice.session) {         // keep the device id and prefill the form for a quick re-login
        const d = choice.session; forgetSession(d); rememberDevice([[d.hs, d.userId]], d.deviceId);
        defaults = { ...defaults, mode: 'matrix', hs: d.hs, user: d.userId };
      }
      error = (e.expired ? '' : 'Could not connect: ') + e.message; choice = null;
    }
  }

  // profile/room identity: the world seed for Matrix (stable, lives in the room), the room name for local play
  const room = choice.mode === 'matrix' ? info.seed : choice.room;
  const data = await transport.loadProfile();
  const profile = new Profile(reg, data);
  profile.name = choice.name;
  if (!data || !data.color) profile.color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];

  const world = new World(reg, info.seed);
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas, world);
  addEventListener('resize', () => renderer.resize());

  let game;
  const input = new Input({
    interact: () => game && !ui.modalOpen && game.interact(),
    menu: () => (ui.modalOpen ? ui.closeModal() : ui.openMenu()),
    chat: () => { if (!ui.modalOpen) ui.openChat(); },
    tow: () => game && !ui.modalOpen && game.tow(),
    garage: () => game && (ui.modalOpen ? ui.closeModal() : ui.openGarage(game)),
  });
  ui.onModal = (open) => { input.enabled = !open; };
  game = new Game({ reg, world, renderer, transport, profile, ui, room });
  ui.game = game;
  document.getElementById('hudroot').classList.add('show');
  ui.status(transport.kind === 'matrix' ? `Matrix: ${info.userId}` : `Local room "${choice.room}"`, true);
  if (profile.stats.races + profile.stats.coins === 0 && !params.has('autostart')) ui.controls();

  const save = () => game.save();
  addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    game.update(dt, input.read());
    renderer.draw({ car: game.car, carColor: profile.color, veh: game.stats.veh, trailer: game.stats.trailer, ghosts: game.ghosts || [], wrecks: game.wrecks, race: game.race, near: game.near, coins: game.coins, camX: game.car.x, camY: game.car.y, t: game.t });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__iso = { game, world, reg, renderer, transport, ui, input };   // handy for the console and tests
}

main().catch((e) => {
  console.error(e);
  document.body.append(Object.assign(document.createElement('pre'), { textContent: 'Isodrive failed to start:\n' + (e && e.stack || e), style: 'color:#f88;padding:16px;white-space:pre-wrap' }));
});

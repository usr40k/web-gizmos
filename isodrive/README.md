# Isodrive

Pixel-isometric road trips across a procedurally generated world. Drive between biomes with very different
palettes and terrain, keep the tank filled (fuel prices differ per biome), collect coins, buy parts from
biome-specific shops, and run time trials. Multiplayer is optional and runs through a **Matrix room**.

No build step: static files, ES modules. Serve the repo root over http and open `isodrive/index.html`.

```
python3 -m http.server 8000      # from the repo root, then http://localhost:8000/isodrive/
```

Controls: W/A/S/D or arrows to drive, Space handbrake, E interact, G garage, T tow when out of fuel, Enter chat, Esc menu.
Touch controls appear on phones and tablets (add `?touch=1` to force them on a desktop browser).

## Layout

```
content/                 DATA ONLY. Add game content here (see CONTENT.md)
  manifest.js            which packs load
  packs/base.js          base game content, the best example of every type
  packs/_template.js     copy this to make a pack
js/content/              schema.js (single source of truth), validate.js, registry.js, load.js
js/world/world.js        seeded procedural world: biomes, roads, buildings, scenery, coins, race routes
js/game/                 car.js (physics), game.js (rules), profile.js (save data), input.js
js/render/               pixel.js (crisp drawing), sprites.js (shapes), renderer.js
js/net/                  transport.js (interface), local.js, matrix.js
js/ui/ui.js              all DOM UI (text only, never innerHTML)
tools/                   validate-content.mjs, mock-homeserver.mjs
```

## Multiplayer with Matrix

Pick "Matrix room" on the start screen, enter your homeserver, account and a room. Everyone who joins the same room
shares the same world (the world seed is the room id) and sees each other drive.

| What | Where it lives |
|------|----------------|
| Positions | custom room events `dev.isodrive.beacon`, about 1 per second, smoothed by dead reckoning |
| Chat | normal `m.room.message`, so it also shows up in Element |
| Your car, cash, parts, records | **your account data** `dev.isodrive.profile`, private and follows you across devices |
| Leaderboard | room state `dev.isodrive.score`, one state key per user |

Room setup (one time, on your own homeserver):

1. Create a room for the world. Anyone you want to play with joins it.
2. **Rate limit.** Synapse defaults (about 0.2 messages/s) are far too low for beacons. Raise `rc_message` in
   `homeserver.yaml` (for example `per_second: 5`, `burst_count: 20`) or exempt the player accounts. If you do not,
   the client backs off automatically (you will see "Rate limited" in the corner) and other cars move in jumpy steps.
3. **Leaderboard permission** (optional). In Element: `/devtools` -> Explore room state -> `m.room.power_levels` -> edit, and add
   `"dev.isodrive.score": 0` under `events`. Without it everything works except sharing best times.

Sessions: with "Stay logged in" ticked (default) the page keeps a login **token** and device id in this browser's localStorage,
so you resume with one click; the password is never stored. Untick it on shared computers. "Forget this account" deletes the
token and logs it out on the server. An expired token just sends you back to the login form. You can type `@user:server`
without a homeserver URL: the domain's `.well-known` is used to find it.

Notes: your password is sent only to the homeserver you type in. The page remembers homeserver, username and room name. This repo is public, so never commit credentials; there are none in this code.

Other transports (MQTT, a Cloudflare Worker with a Durable Object, WebRTC) only need a class implementing the interface
documented at the top of `js/net/transport.js`; nothing else in the game changes.

## Testing

```
node tools/validate-content.mjs                 # all content in the manifest
node tools/mock-homeserver.mjs 8008             # fake Matrix server for offline testing (users: any name, password pw-<name>)
```

Local mode (`Multiplayer: Local`) needs no server: two tabs with the same room name see each other through BroadcastChannel.
`?autostart=1&name=Me&room=test` skips the start screen in local mode.

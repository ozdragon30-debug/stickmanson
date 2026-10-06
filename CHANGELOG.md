# Changelog

## 2026 modernisation

### Phone performance pass

- Sprite sheets trimmed and repacked (`tools/trim-atlases.py`): player
  4085×6715 → 3072×2866, particles 4084×4174 → 2048×1866, death and blood
  likewise. GPU memory for these drops from ~205 MB to ~59 MB and every sheet
  now fits the 4096 px texture limit of mobile GPUs (larger sheets were
  re-uploaded piecemeal while drawing). Frames are placed exactly as before;
  verified pixel by pixel (the old sheets also bled a neighbour's row into a
  few frame edges, which is gone).
- Frame pacer (Settings → Video → Frame rate: Auto, the new default): runs at
  the screen's refresh rate; a device that keeps missing frames first lowers
  the render resolution one step, then holds a steady 60 fps on 120 Hz+
  screens. Smooth devices are never touched.
- Death animations also at 60 fps (in-between drawings, stricter quality
  threshold).
- Less work per frame: name tags pre-rendered, frame data cached, no per-frame
  allocations for in-betweens or lights, opaque canvas, sounds decoded two at
  a time instead of ~60 at once.

### Full screen and smoother frames

- Fill wide screens (default on, Settings → Video): phones in landscape and
  16:9 monitors use the whole screen. The extra width shows the map only,
  dimmed; players, pickups and effects stay clipped to the original 4:3 view,
  so nobody sees more of the action. HUD corners and touch sticks move out to
  the screen edges. Aiming is unchanged (measured from the view centre).
- Map rendering cached in 8×8-tile chunks; animated tiles still drawn every
  frame. Previously ~250 transformed tile draws per frame (≈80% of the frame).
- Android app: immersive full screen (status and navigation bars hidden,
  drawn under the camera cutout).

### 60 fps animations

- The hand-drawn 12 fps player animations are shown at 60 fps: 4 in-between
  drawings per frame pair, generated offline by optical-flow interpolation
  (`tools/gen-inbetweens.py`). Motions too large to track keep the original
  drawing instead of a ghosted blend.
- Drawing-only: frame indices, timing and animation events still run on the
  original frames (parity test unchanged). Settings → Video → Smooth
  animations. Sheets are split per weapon (6.9 MB total) and load on demand.

### High refresh rate

- Runs at the monitor's refresh rate (120/144/240 Hz); optional frame-rate
  limit in Settings → Video (240/144/120/60/30). Movement uses elapsed time,
  so speed is identical at any frame rate; a low cap no longer triggers
  adaptive resolution.
- Smoother scrolling: the camera snaps to device pixels instead of whole
  logical pixels, which on HiDPI screens moved the world in uneven 1–2 px
  steps per frame (judder at 120 Hz). Drawing only; aim is unaffected.

### Modern effects (render-only, Settings → Video → Modern effects)

- Soft drop shadows under characters, corpses and weapon pickups.
- Energy glow on laser sword, railgun and tesla helmet; red rim flash on hit.
- Muzzle light pools and additive flash bloom for firearms.
- Pickups: pulsing colour halo by weapon class and a contact shadow that
  shrinks as the weapon bobs, so it reads as floating.
- Soft ground light in each player's colour.
- Draw-only (`docs/js/utils/Fx.js`): parity and golden tests unchanged.
- Performance: every effect is drawn from small sprites rendered once; no
  per-frame canvas blur (`shadowBlur`) or full-screen gradient, which made
  phones stutter. Effects now cost ~2 ms/frame instead of ~11 ms (measured,
  emulated phone). In-between sheets are decoded off the main thread before
  first use (previously a one-off freeze the first time a weapon was drawn).

Everything below keeps **gameplay and physics identical** to the original —
proven by `npm run parity`, which runs the original game and this one side by
side (fake clock, seeded randomness) on 10 maps: 10,100 frames of movement and
285 weapon hit events, all identical. In addition
movement speed and 8-direction movement, collisions, hit shapes, damage,
cooldowns, weapon stats, field of view (960×720 logical view) and map data are
locked by `test/golden.json` (constants, 4 000 hit-shape cases, sub-tile walk
collision and line of sight on every map).

### Play anywhere
- Resolution-independent rendering: fills any window at 4:3, renders at the
  device pixel ratio (crisp on HiDPI/4K), fullscreen, no tile seams.
- Adaptive resolution: slow devices step the render scale down automatically.
- Touch controls (floating twin-stick), gamepad support, layout-independent
  keybinds (Turkish Q/F, AZERTY…), arrow keys. Analog input is quantised to the
  original 8 directions.
- Installable PWA with full offline play (service worker precaches the game).
- Screen wake lock and a portrait-mode hint on phones.
- Readable HUD on phones: health, timer, kill feed, chat, scoreboard, name
  tags and touch sticks scale up around their screen anchors (the world view
  is untouched; desktop is pixel-identical).
- Gamepad navigation of the menu and settings (D-pad, A, B, ←/→).

### Interface
- Start menu (name, server status, rooms, stats, controls, about).
- Tabbed settings: profile, controls, audio, video, HUD, language.
- HUD: health bar with damage trail, weapon slot, kill feed with weapon
  icons, hit markers, damage direction, death screen with killer, kill
  streaks, map title, FPS / ping, reconnect banner.
- Redesigned scoreboard (rank, K/D, map, time left, winner).
- English and Turkish UI (auto-detected; server chat lines translated).
- Chat uses a real text field (IME, paste, mobile keyboards); `!help`.
- Lifetime stats (kills, K/D, wins, best streak, favourite weapon, time).
- Offline map picker; touch quick-chat phrases; left-handed touch layout;
  AFK 💤 marker for players in the menu; tab-title alert when someone joins;
  settings button fades while the mouse is idle; reduced-motion support;
  client-side chat mute (`!mute`); first-game controls hint; recent rooms;
  'connect to server' field for static builds; iOS install help.

### Multiplayer
- Private rooms with invite links (`?room=code`).
- The static/GitHub Pages build can play online: `?server=https://host`
  (validated connection target only; the socket.io client is bundled).
- Offline/bot mode now plays in rounds with the same rules as the server.
- Smooth remote players; movement updates capped at ~60 Hz instead of the
  monitor refresh rate (240 Hz monitors used to flood the server).
- Reconnects replace your old socket immediately (no ghost copy, no lock-out
  from a full room), restore your name/colour and leave no ghost players.
- Unique player names per room; AFK marker; `/status` page for hosts;
  `docker compose up` with persisted bans.

### Audio
- Web Audio (decoded once, low latency), volume, mute (M), optional
  positional audio for other players' sounds, iOS interruption handling.

### Server
- Fixed crash: `weaponsData` was undefined (`!weapon`).
- Fixed admin escalation via a spoofed `X-Forwarded-For` header (and every
  player being admin behind a reverse proxy). `ADMIN_PASSWORD` + `!login`.
- Damage comes from the weapon table; hit rate bounded per weapon cooldown;
  all inputs validated; chat/rename rate limits; event flood guard; per-IP
  connection cap; persistent bans (`BANS_FILE`).
- gzip, cache + security headers, `/healthz`, graceful shutdown, Docker.
- Dependencies updated (express 4.22, socket.io 4.8, proxy-addr 2.0.8):
  11 advisories (incl. 1 critical published overnight) → 0.

### Performance
- Lossless sprite atlas optimisation: downloads 20.7 → 12.3 MB (WebP,
  pixel-identical), decoded GPU memory 369 → 307 MB.
- Spinner colour tint cached instead of a per-frame canvas filter (also fixes
  missing spinner colours in Safari).
- Map tile codes parsed once per map instead of every frame.

### Bug fixes (original code)
- First frame used an undefined timestamp (NaN position if a key was held).
- Keys stuck after Alt+Tab; weapon kept firing when the mouse was released
  outside the canvas; input applied one frame late.
- Legs kept running for up to 3 s after stopping.
- Pickup respawn timers leaked across map changes.
- Pickup sounds replayed for every player on join and round reset.
- Debug test map appeared in the normal map rotation.
- Bots kept the old map's coordinates after a server map change (often
  stuck in walls); respawned bots followed stale paths.
- A dead player's body picked up weapons; shot cooldown timers survived
  death/round reset; animations froze on wall-clock changes; a failed atlas
  load could leave a player dead forever.
- Reconnecting left ghost players / a frozen copy of yourself.
- Offline chat messages vanished; every hit requested a missing sound file.
- Any runtime exception stopped the game loop for good; it now recovers.
- Out-of-order map loads could leave the world on the wrong map.
- Found in browser playtests: settings renames reverted by Play; keyboard
  dead after closing settings; joins announced with the wrong name; no bots
  after the last opponent left; room UI on static builds; squashed map names
  (real names now come from `docs/data/maps/index.json`).

### Security
- Fixed: spoofed `X-Forwarded-For` granted admin; `?server=` script
  injection and `__proto__` player ids (found during review, never released).
- `LAN_ADMIN` switch (off in the Docker image).

### Robustness
- Reconnect grace (12 s) keeps your round score after a network blip; slow
  connections can't leave the client on a different map than the server;
  refused connections (room full/banned) fall back to an offline match with
  the reason shown; service worker only caches the game page as offline shell;
  slow networks wait for the server instead of dropping to offline mode.
- Keyboard accessibility: settings is a proper modal (focus in, inert menu,
  focus restored), arrow keys switch tabs, focus kept while rebinding.
- Verified by QA: no memory/CPU growth over long multi-round sessions.

### Developer experience
- `npm test`: golden gameplay lock, server integration (socket.io), input,
  i18n completeness; `npm run lint` (ESLint, undefined-global detection);
  `npm run e2e` headless-Chromium smoke test; GitHub Actions CI; Dependabot;
  `npm run precache` for the offline file list; `ARCHITECTURE.md`.

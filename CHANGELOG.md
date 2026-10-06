# Changelog

## 2026 modernisation

Everything below keeps **gameplay and physics identical** to the original:
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
- Dependencies updated (express 4.22, socket.io 4.8): 10 advisories → 0.

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
  injection (found during review, never released).

### Developer experience
- `npm test`: golden gameplay lock, server integration (socket.io), input,
  i18n completeness; `npm run lint` (ESLint, undefined-global detection);
  `npm run e2e` headless-Chromium smoke test; GitHub Actions CI; Dependabot;
  `npm run precache` for the offline file list; `ARCHITECTURE.md`.

# Architecture

## Layout

```
app.js              Express + socket.io server (HTTP, validation, limits, socket handlers)
server/Room.js      One game room: players, map rotation, round timer, pickups
server/models/      Server-side player record
docs/               The web client — served by app.js, or as-is by any static host
  index.html        Loads every script in order (no bundler, no modules)
  js/               Game code (see below)
  data/             weapons.json (shared with the server) and .dat maps
  sprites/ sounds/  Original assets (+ lossless WebP atlases)
  sw.js             Service worker (offline / installable PWA)
  precache.json     Files the service worker caches (npm run precache)
test/               Golden gameplay lock, server, input, i18n tests, e2e smoke
tools/              Asset packing scripts and the precache generator
```

## Client

Plain `<script>` files sharing globals, loaded in dependency order by
`docs/index.html`. ESLint collects every top-level declaration under
`docs/js` as a global, so a typo'd or missing global fails `npm run lint`.

| Area | Files |
|---|---|
| Gameplay core (locked) | `utils/Constants.js`, `utils/Physics.js`, `map/MapLoader.js`, `entity/Player.js` movement/hit code, `input/Keyboard.js` `keyEvents()`, `data/weapons.json` |
| Rendering | `viewport/Display.js` (logical 960×720 view → HiDPI canvas), `viewport/Camera.js`, `game.js` (`draw*`), `utils/TintCache.js` |
| Entities | `entity/*`, `spritesheet/AtlasSpritesheet.js` |
| Input | `input/Keyboard.js`, `Mouse.js` (pointer events), `Gamepad.js`, `Touch.js`, `InputMode.js` (analog → 8 directions) |
| UI | `ui/Menu.js`, `manager/SettingsManager.js`, `HudManager.js`, `ScoreboardManager.js`, `ChatManager.js`, `utils/I18n.js` |
| Networking | `manager/SocketManager.js`, `handler/PlayerHandler.js` |
| Offline / bots | `Bot.js`, `manager/BotManager.js` (bots + offline rounds), `utils/Pathfinder.js` |
| Other | `manager/SoundManager.js` (Web Audio), `StatsManager.js`, `PickupManager.js` |

### The gameplay lock

Anything that affects how the game *plays* lives in the "locked" files above.
`test/golden.json` fingerprints them (constants, weapon table, 4 000 hit-shape
cases, sub-tile walk collision, line of sight and parsing of every map). Every
modernisation layer sits around that core:

- **Display** keeps a fixed 960×720 logical view; only the backing-store
  resolution changes. Field of view and aim are therefore identical everywhere.
- **Analog input** (gamepad, touch) is quantised to the original 8 keyboard
  directions and drives the same `keyEvents()` movement code.
- **Network smoothing** only affects drawing; hit tests use the latest
  networked position, as the original did.

## Network protocol (socket.io)

Hit detection is client-side (the shooter's view decides), the victim's client
owns its health and reports its own death — the original design. The server
relays and validates.

| Client → server | Server → clients |
|---|---|
| `playerMovement {x,y,rotation}` (≤ 60 Hz) | `playerMoved` |
| `playedWalkingAnimation {rotation}` (≤ 20 Hz) | `playWalkingAnimation` |
| `playedShoot` | `playShoot` |
| `playerHit {playerId, weaponId}` | `playerGotHit {damage from weapons.json, attackerId}` |
| `iDied {killerId, weaponId}` | `playerDied {playerId, killerId, weaponId}`, `scoreUpdate` |
| `playerRespawn {position}` | `playerMoved` |
| `mapLoaded {weaponSpawns}` / `pickupWeapon {spawnIndex}` | `pickupState` / `pickupTaken` |
| `setName`, `playerIdentity`, `playerStatus {afk}` | `playerNameChanged`, `nameAssigned` (room-unique suffix), `playerIdentityUpdate`, `playerStatus` |
| `chatMessage {text}` | `chatMessage {name, hue, text}` |
| `latency` (ack) | — |
| — | `currentPlayers`, `gameState`, `newPlayer`, `playerDisconnected`, `roundEnd`, `roundStart`, `forceWeapon`, `kicked` |

Handshake query: `room` (private room code) and `session` (secret per-tab
token; a reconnect with the same token replaces its own ghost socket).

## Rooms and rounds

`server/Room.js` owns a room's players, map rotation, 5-minute rounds and pickup
timers. `public` always exists; `?room=<code>` creates private rooms on demand,
disposed when empty. Offline (no server) `BotManager` runs the same round cycle
locally.

## Offline / PWA

With no server (static hosting, file://, server down) the client starts a bot
match after 2 s. `sw.js` precaches everything in `precache.json` after the
first visit: code is network-first (never mixes versions), assets are
stale-while-revalidate.

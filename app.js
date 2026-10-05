const express = require("express");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server, {
  maxHttpBufferSize: 16 * 1024,   // game messages are tiny; refuse oversized payloads
  pingInterval: 10000,
  pingTimeout: 8000,
});

const Player = require("./server/models/Player");

// ── Configuration (environment variables) ────────────────────────────────────
const PORT            = process.env.PORT !== undefined && process.env.PORT !== '' ? parseInt(process.env.PORT, 10) : 1138;
const HOST            = process.env.HOST || undefined;
// Set TRUST_PROXY=1 when running behind a reverse proxy (nginx, Render, Fly…)
// so client IPs are read from X-Forwarded-For. Never trust that header otherwise:
// anyone can send it.
const TRUST_PROXY     = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
// Optional admin password: "!login <password>" in chat grants admin commands.
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || '';
const ROUND_DURATION_MS    = (parseInt(process.env.ROUND_SECONDS, 10) || 5 * 60) * 1000; // 5 minutes
const ROUND_END_DISPLAY_MS = 10 * 1000;    // 10 s scoreboard display

// Shared weapon definitions (same file the client uses).
const weaponsData = JSON.parse(fs.readFileSync(path.join(__dirname, "docs/data/weapons.json"), "utf8"));
const MAX_WEAPON_ID = weaponsData.length - 1;

// Convert a map filename like 'anarchystreets.dat' to 'Anarchystreets'.
function mapDisplayName(filename) {
  return filename.replace(/^_+/, '').replace(/\.dat$/i, '')
    .replace(/^./, c => c.toUpperCase());
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
if (TRUST_PROXY) app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.get("/healthz", (req, res) => {
  res.json({ ok: true, players: Object.keys(players).length, map: game.mapFile, phase: game.phase, uptime: Math.round(process.uptime()) });
});

app.use(express.static(path.join(__dirname, "docs"), {
  setHeaders(res, filePath) {
    // HTML, the service worker and its manifest must always revalidate so
    // updates roll out immediately; game assets can be cached briefly.
    if (/\.(html|webmanifest)$/.test(filePath) || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "docs/index.html"));
});

// Toggle debug map via the !debugmap admin command in chat.
let debugMapEnabled = false;
const DEBUG_MAP_FILE = 'debug.dat';

// Discover all available maps at startup. The debug test map is only used when
// explicitly enabled with !debugmap (it used to appear in the normal rotation).
const mapsDir = path.join(__dirname, "docs/data/maps");
const mapFiles = fs.readdirSync(mapsDir).filter(f => f.endsWith(".dat") && f !== DEBUG_MAP_FILE);

function pickMap(previous = null) {
  if (debugMapEnabled) return DEBUG_MAP_FILE;
  const pool = mapFiles.length > 1 ? mapFiles.filter(f => f !== previous) : mapFiles;
  return pool[Math.floor(Math.random() * pool.length)];
}

let players = {};
const bannedIps = new Set();

let game = {
  mapFile:      pickMap(),
  roundEndsAt:  Date.now() + ROUND_DURATION_MS,
  phase:        'playing', // 'playing' | 'roundEnd'
  pickups:      [],  // { weaponId, respawnTime, available, respawnAt }
  pickupTimers: {}, // spawnIndex → timeout handle
};

function getScores() {
  const scores = {};
  for (const id in players) {
    scores[id] = {
      name:         players[id].name,
      kills:        players[id].kills,
      deaths:       players[id].deaths,
      indicatorHue: players[id].indicatorHue ?? 0,
    };
  }
  return scores;
}

// ── Round lifecycle ──────────────────────────────────────────────────────────
let roundEndTimeout   = null;
let roundStartTimeout = null;

function endRound(message) {
  if (game.phase !== 'playing') return;
  if (roundEndTimeout) clearTimeout(roundEndTimeout);
  roundEndTimeout = null;
  game.phase = 'roundEnd';
  io.emit('roundEnd', { scores: getScores() });
  if (message) io.emit('chatMessage', { name: 'Server', text: message });
  if (roundStartTimeout) clearTimeout(roundStartTimeout);
  roundStartTimeout = setTimeout(startNewRound, ROUND_END_DISPLAY_MS);
}

function scheduleRoundEnd() {
  if (roundEndTimeout) clearTimeout(roundEndTimeout);
  const remaining = game.roundEndsAt - Date.now();
  roundEndTimeout = setTimeout(() => {
    endRound(`Round over! Next round starting in ${ROUND_END_DISPLAY_MS / 1000} seconds...`);
  }, Math.max(remaining, 0));
}

function startNewRound() {
  roundStartTimeout = null;
  game.mapFile     = pickMap(game.mapFile);
  game.roundEndsAt = Date.now() + ROUND_DURATION_MS;
  game.phase       = 'playing';

  // Cancel all pending pickup respawn timers and reset state.
  for (const idx in game.pickupTimers) clearTimeout(game.pickupTimers[idx]);
  game.pickupTimers = {};
  game.pickups = [];

  for (const id in players) {
    players[id].kills    = 0;
    players[id].deaths   = 0;
    players[id].weaponId = 0; // reset to fist on round start
  }

  io.emit('roundStart', {
    mapFile:     game.mapFile,
    roundEndsAt: game.roundEndsAt,
    scores:      getScores(),
  });
  io.emit('chatMessage', { name: 'Server', text: `Round started on ${mapDisplayName(game.mapFile)}!` });

  scheduleRoundEnd();
}

scheduleRoundEnd();

// ── Validation helpers ───────────────────────────────────────────────────────
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPos = p => p && isNum(p.x) && isNum(p.y) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6;
const validWeaponId = id => Number.isInteger(id) && id >= 0 && id <= MAX_WEAPON_ID;
// Strip control / bidi-override characters that could garble other players' screens.
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const RESERVED_NAMES = /^\s*(\[?admin\]?|server)\s*$/i;

function clientIp(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  const raw = (TRUST_PROXY && xff) ? String(xff).split(',')[0] : (socket.handshake.address || '');
  return raw.trim().replace(/^::ffff:/, '');
}

// Admin = direct LAN/localhost connection (not via a proxy), or logged in with ADMIN_PASSWORD.
function isAdmin(socket) {
  if (socket.data.isAdmin) return true;
  // A forwarded request came through a proxy: its socket address says nothing
  // about the real client, so it never gets LAN trust unless TRUST_PROXY is set.
  if (socket.handshake.headers['x-forwarded-for'] && !TRUST_PROXY) return false;
  const ip = clientIp(socket);
  return !ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost'
    || /^10\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    || /^192\.168\./.test(ip);
}

// Simple token bucket per socket for chat / renames.
function allow(socket, key, perWindow, windowMs) {
  const now = Date.now();
  const b = socket.data[key] || (socket.data[key] = { t: now, n: 0 });
  if (now - b.t > windowMs) { b.t = now; b.n = 0; }
  return ++b.n <= perWindow;
}

// ── Socket handlers ──────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  if (!process.env.QUIET) console.log("a user connected: ", socket.id);

  // Reject banned IPs immediately.
  const connIp = clientIp(socket);
  if (bannedIps.has(connIp)) {
    socket.emit('kicked', { reason: 'You are banned.' });
    socket.disconnect(true);
    return;
  }

  const p = new Player();
  p.name     = 'Player ' + socket.id.slice(0, 4);
  p.position = { x: 0, y: 0 };
  players[socket.id] = p;

  socket.emit("currentPlayers", players);
  socket.emit("gameState", {
    mapFile:     game.mapFile,
    roundEndsAt: game.roundEndsAt,
    phase:       game.phase,
    scores:      getScores(),
  });
  socket.broadcast.emit("newPlayer", { playerId: socket.id, name: p.name });
  io.emit("scoreUpdate", { scores: getScores() });

  // Announce the join once the client has sent its chosen name (or after a
  // short grace period), instead of announcing the placeholder "Player xxxx".
  const announceJoin = () => {
    if (socket.data.announced || !players[socket.id]) return;
    socket.data.announced = true;
    io.emit("chatMessage", { name: 'Server', text: `${players[socket.id].name} joined the game.` });
  };
  setTimeout(announceJoin, 2000);

  // Round-trip latency probe used by the client's ping display.
  socket.on("latency", (_t, ack) => { if (typeof ack === 'function') ack(); });

  socket.on("disconnect", () => {
    if (!process.env.QUIET) console.log("user disconnected: ", socket.id);
    const leavingName = players[socket.id]?.name ?? 'A player';
    delete players[socket.id];
    io.emit("playerDisconnected", socket.id);
    io.emit("scoreUpdate", { scores: getScores() });
    io.emit("chatMessage", { name: 'Server', text: `${leavingName} left the game.` });
  });

  socket.on("playerMovement", (movementData) => {
    if (!players[socket.id] || !isPos(movementData)) return;
    const pos = { x: movementData.x, y: movementData.y };
    if (isNum(movementData.rotation)) pos.rotation = movementData.rotation;
    players[socket.id].position = pos;
    socket.broadcast.emit("playerMoved", {
      playerId:  socket.id,
      playerPos: pos,
    });
  });

  socket.on("playedShoot", () => {
    socket.broadcast.emit("playShoot", { playerId: socket.id });
  });

  socket.on("playedWalkingAnimation", (walkingInfo) => {
    if (!walkingInfo || !isNum(walkingInfo.rotation)) return;
    socket.broadcast.emit("playWalkingAnimation", {
      playerId: socket.id,
      rotation: walkingInfo.rotation
    });
  });

  // Relay hit to all clients — the victim's client owns health tracking and reports death.
  // Damage is taken from the shared weapon table (honest clients send exactly that
  // value), and a hit on the same victim can't arrive faster than the weapon fires.
  socket.on("playerHit", (data) => {
    if (!data || !players[socket.id]) return;
    const { playerId: victimId, weaponId } = data;
    if (typeof victimId !== 'string' || !(victimId in players) || victimId === socket.id) return;
    if (game.phase !== 'playing') return;
    if (!validWeaponId(weaponId)) return;
    const weapon = weaponsData[weaponId];

    const lastHits = socket.data.lastHits || (socket.data.lastHits = {});
    const now = Date.now();
    if (now - (lastHits[victimId] || 0) < weapon.fireCooldown * 0.35) return;
    lastHits[victimId] = now;

    io.emit("playerGotHit", { playerId: victimId, damage: weapon.damage, weaponId, attackerId: socket.id });
  });

  // Victim's own client reports death once their local HP reaches zero.
  socket.on("iDied", (data) => {
    if (!players[socket.id]) return;
    if (game.phase !== 'playing') return;
    players[socket.id].deaths  += 1;
    players[socket.id].weaponId = 0; // reset to fist on death
    const killerId = (data && typeof data.killerId === 'string' && data.killerId !== socket.id && players[data.killerId])
      ? data.killerId : null;
    const weaponId = validWeaponId(data?.weaponId) ? data.weaponId : 0;
    if (killerId) players[killerId].kills += 1;
    io.emit("playerDied", { playerId: socket.id, killerId, weaponId });
    io.emit("scoreUpdate", { scores: getScores() });
  });

  socket.on("playerRespawn", (data) => {
    if (!players[socket.id] || !data || !isPos(data.position)) return;
    const pos = { x: data.position.x, y: data.position.y };
    players[socket.id].position = pos;
    socket.broadcast.emit("playerMoved", {
      playerId:  socket.id,
      playerPos: pos
    });
  });

  // Client sends its spinner identity once the map has loaded.
  socket.on("playerIdentity", (data) => {
    if (!players[socket.id] || !data) return;
    const hue   = (((data.hue | 0) % 360) + 360) % 360;
    const shape = Math.max(0, Math.min(255, data.shapeIndex | 0));
    players[socket.id].indicatorHue        = hue;
    players[socket.id].indicatorShapeIndex = shape;
    socket.broadcast.emit("playerIdentityUpdate", {
      playerId:            socket.id,
      indicatorHue:        hue,
      indicatorShapeIndex: shape,
    });
  });

  // Client finished parsing the map — send (or initialize) pickup state.
  socket.on("mapLoaded", (data) => {
    if (game.pickups.length === 0 && data && Array.isArray(data.weaponSpawns)
        && data.weaponSpawns.length && data.weaponSpawns.length <= 128) {
      const spawns = data.weaponSpawns.filter(ws => ws && validWeaponId(ws.weaponId) && isNum(ws.respawnTime));
      if (spawns.length === data.weaponSpawns.length) {
        game.pickups = spawns.map(ws => ({
          weaponId:    ws.weaponId,
          respawnTime: Math.max(1000, Math.min(600000, ws.respawnTime)),
          available:   true,
          respawnAt:   null,
        }));
      }
    }
    // Send current state so this client shows the right pickups.
    socket.emit("pickupState", game.pickups.map(p => ({ available: p.available, respawnAt: p.respawnAt })));
  });

  // Client player walked over a pickup.
  socket.on("pickupWeapon", (data) => {
    if (!data || !players[socket.id]) return;
    const { spawnIndex } = data;
    if (!Number.isInteger(spawnIndex)) return;
    const pickup = game.pickups[spawnIndex];
    if (!pickup || !pickup.available) return;

    pickup.available = false;
    pickup.respawnAt = Date.now() + pickup.respawnTime;
    players[socket.id].weaponId = pickup.weaponId;

    // Broadcast to others — the picking player already resolved this locally.
    socket.broadcast.emit("pickupTaken", { spawnIndex, playerId: socket.id, weaponId: pickup.weaponId });

    // Server resets availability after respawn so pickupState stays accurate for new joiners.
    const timer = setTimeout(() => {
      pickup.available = true;
      pickup.respawnAt = null;
      delete game.pickupTimers[spawnIndex];
      // No pickupRespawned emit — clients manage their own visibility timers.
    }, pickup.respawnTime);
    game.pickupTimers[spawnIndex] = timer;
  });

  socket.on("chatMessage", (data) => {
    if (!players[socket.id] || !data) return;
    const name = players[socket.id].name;
    const hue  = players[socket.id].indicatorHue ?? 0;
    const text = cleanText(data.text, 80);
    if (!text) return;

    if (text.startsWith('!')) {
      const parts = text.split(/\s+/);
      const cmd   = parts[0].toLowerCase();

      if (cmd === '!login') {
        if (ADMIN_PASSWORD && parts[1] === ADMIN_PASSWORD) {
          socket.data.isAdmin = true;
          socket.emit('chatMessage', { name: 'Server', text: 'Admin access granted.' });
        } else {
          socket.emit('chatMessage', { name: 'Server', text: 'Invalid admin password.' });
        }
        return;
      }

      // Admin commands — LAN clients or password-authenticated admins only.
      if (isAdmin(socket)) {
        if (cmd === '!next') {
          endRound();
          return;
        }

        if (cmd === '!kick' || cmd === '!ban') {
          const target = parts.slice(1).join(' ');
          for (const id in players) {
            if (players[id].name === target || id === target) {
              const s = io.sockets.sockets.get(id);
              if (cmd === '!ban' && s) {
                const banIp = clientIp(s);
                if (banIp) bannedIps.add(banIp);
              }
              io.to(id).emit('kicked', { reason: cmd === '!ban' ? 'Banned by admin.' : 'Kicked by admin.' });
              setTimeout(() => { const ss = io.sockets.sockets.get(id); if (ss) ss.disconnect(true); }, 500);
              io.emit('chatMessage', { name: '[Admin]', text: `${players[id].name} was ${cmd === '!ban' ? 'banned' : 'kicked'}.` });
              return;
            }
          }
          socket.emit('chatMessage', { name: 'Server', text: `No player named "${target}".` });
          return;
        }

        if (cmd === '!weapon') {
          const weaponId = parseInt(parts[1], 10);
          if (validWeaponId(weaponId)) {
            players[socket.id].weaponId = weaponId;
            socket.emit('forceWeapon', { weaponId });
          }
          return;
        }

        if (cmd === '!debugmap') {
          debugMapEnabled = !debugMapEnabled;
          socket.emit('chatMessage', { name: 'Server', text: `Debug map ${debugMapEnabled ? 'ON (debug.dat)' : 'OFF (random maps)'} — starting new round...` });
          endRound();
          return;
        }

        return; // ignore unknown ! commands from admins
      }
    }

    if (!allow(socket, 'chatBucket', 5, 5000)) {
      socket.emit('chatMessage', { name: 'Server', text: 'You are sending messages too fast.' });
      return;
    }
    io.emit("chatMessage", { name, hue, text });
  });

  socket.on("setName", (data) => {
    if (!players[socket.id] || !data) return;
    const name = cleanText(data.name, 20);
    if (!name || RESERVED_NAMES.test(name)) return;
    if (name === players[socket.id].name) { announceJoin(); return; }
    if (!allow(socket, 'nameBucket', 5, 10000)) return;
    players[socket.id].name = name;
    socket.broadcast.emit("playerNameChanged", { playerId: socket.id, name });
    io.emit("scoreUpdate", { scores: getScores() });
    announceJoin();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other server or run with PORT=<number> node app.js`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  if (!process.env.QUIET) console.log(`Stick Arena: Reborn listening on http://${HOST || 'localhost'}:${server.address().port}`);
});

// Graceful shutdown (Docker / systemd / Ctrl+C).
function shutdown(signal) {
  console.log(`${signal} received, shutting down…`);
  io.emit('chatMessage', { name: 'Server', text: 'Server is restarting…' });
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
if (require.main === module) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Exposed for integration tests.
module.exports = {
  server, io, players, weaponsData,
  close() {
    if (roundEndTimeout) clearTimeout(roundEndTimeout);
    if (roundStartTimeout) clearTimeout(roundStartTimeout);
    for (const idx in game.pickupTimers) clearTimeout(game.pickupTimers[idx]);
    io.close();
    return new Promise(r => server.close(() => r()));
  },
};

const express = require("express");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server, {
  maxHttpBufferSize: 16 * 1024,   // game messages are tiny; refuse oversized payloads
  // Allow browsers on other origins (e.g. the GitHub Pages build opened with
  // ?server=https://this-host) to connect. Restrict with CORS_ORIGIN=a,b.
  cors: { origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : true },
  pingInterval: 10000,
  pingTimeout: 8000,
});

const Player = require("./server/models/Player");
const { Room, DEBUG_MAP_FILE } = require("./server/Room");

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
const MAX_PLAYERS_PER_ROOM = parseInt(process.env.MAX_PLAYERS, 10) || 16;
// Behind a reverse proxy set TRUST_PROXY=1, otherwise every player shares the
// proxy's address and this becomes a server-wide cap.
const MAX_CONNECTIONS_PER_IP = parseInt(process.env.MAX_CONNECTIONS_PER_IP, 10) || 32;
// A legitimate client sends ≤ ~60 movement + ~20 leg + a few other events per
// second. Events beyond EVENTS_PER_SECOND are dropped; a client that keeps
// flooding (beyond 4× for 3 s) is disconnected.
const EVENTS_PER_SECOND = 200;

// Shared weapon definitions (same file the client uses).
const weaponsData = JSON.parse(fs.readFileSync(path.join(__dirname, "docs/data/weapons.json"), "utf8"));
const MAX_WEAPON_ID = weaponsData.length - 1;

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
  const pub = rooms.get(PUBLIC_ROOM);
  let total = 0;
  for (const r of rooms.values()) total += r.size;
  res.json({ ok: true, players: total, rooms: rooms.size, map: pub.game.mapFile, phase: pub.game.phase, uptime: Math.round(process.uptime()) });
});

// Human-readable status page for server hosts. Private room codes are never
// listed (they are the invite secret), only counted.
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get("/status", (req, res) => {
  const pub = rooms.get(PUBLIC_ROOM);
  const priv = [...rooms.values()].filter(r => r.id !== PUBLIC_ROOM);
  const left = Math.max(0, Math.round((pub.game.roundEndsAt - Date.now()) / 1000));
  const rows = Object.values(pub.players)
    .sort((a, b) => b.kills - a.kills)
    .map(p => `<tr><td>${esc(p.name)}${p.afk ? ' 💤' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`).join('')
    || '<tr><td colspan="3">No players right now</td></tr>';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><title>Stick Arena server status</title>
<style>body{font:15px system-ui,sans-serif;background:#0e1621;color:#c8d8e8;max-width:640px;margin:32px auto;padding:0 16px}
h1{color:#fff;font-size:22px}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #2d4060;text-align:left}
th{color:#7d93aa;font-size:12px;text-transform:uppercase}.k{color:#7d93aa}</style>
<h1>Stick Arena: Reborn — server status</h1>
<p><span class="k">Public room:</span> ${esc(pub.game.mapFile.replace(/\.dat$/, ''))} · ${pub.game.phase === 'playing' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : 'round over'}
 · <span class="k">Private rooms:</span> ${priv.length} (${priv.reduce((n, r) => n + r.size, 0)} players)
 · <span class="k">Uptime:</span> ${Math.round(process.uptime() / 60)} min</p>
<table><tr><th>Player</th><th>Kills</th><th>Deaths</th></tr>${rows}</table>`);
});

app.use(express.static(path.join(__dirname, "docs"), {
  setHeaders(res, filePath) {
    // Code must always revalidate so a deploy never mixes old and new scripts;
    // heavy assets (sprites, sounds, maps) can be cached briefly.
    if (/\.(html|webmanifest|js|css)$/.test(filePath) || (filePath.endsWith('.json') && !filePath.includes('sprites'))) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "docs/index.html"));
});

// Discover all available maps at startup (the debug map is opt-in via !debugmap).
const mapsDir = path.join(__dirname, "docs/data/maps");
const mapFiles = fs.readdirSync(mapsDir).filter(f => f.endsWith(".dat") && f !== DEBUG_MAP_FILE);

// Bans survive restarts when BANS_FILE is set (e.g. BANS_FILE=./data/bans.json).
const BANS_FILE = process.env.BANS_FILE || '';
const bannedIps = new Set();

// Brief network drops: a player who disconnects and comes back with the same
// session token within this window keeps their round score, and nobody sees
// "left"/"joined" spam. Key: `${roomId}|${session}`.
const RECONNECT_GRACE_MS = 12000;
const departed = new Map();
if (BANS_FILE) {
  try { for (const ip of JSON.parse(fs.readFileSync(BANS_FILE, 'utf8'))) bannedIps.add(String(ip)); }
  catch (e) { if (e.code !== 'ENOENT') console.warn(`Could not read ${BANS_FILE}:`, e.message); }
}
// Writes are serialised (and atomic via rename) so quick successive bans
// can't finish out of order and drop an entry.
let banWriting = false, banDirty = false;
function saveBans() {
  if (!BANS_FILE) return;
  if (banWriting) { banDirty = true; return; }
  banWriting = true;
  banDirty = false;
  const target = path.resolve(BANS_FILE);
  const tmp = target + '.tmp';
  fs.mkdir(path.dirname(target), { recursive: true }, () => {
    fs.writeFile(tmp, JSON.stringify([...bannedIps], null, 2), err => {
      const done = (e) => {
        if (e) console.warn(`Could not write ${BANS_FILE}:`, e.message);
        banWriting = false;
        if (banDirty) saveBans();
      };
      if (err) return done(err);
      fs.rename(tmp, target, done);
    });
  });
}

// ── Rooms ────────────────────────────────────────────────────────────────────
// "public" always exists; private rooms (?room=code) are created on demand and
// removed when the last player leaves.
const PUBLIC_ROOM = 'public';
const rooms = new Map();

function normaliseRoomId(raw) {
  const id = String(raw ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(id) ? id : PUBLIC_ROOM;
}

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id, { io, mapFiles, roundMs: ROUND_DURATION_MS, roundEndMs: ROUND_END_DISPLAY_MS });
    rooms.set(id, room);
  }
  return room;
}

function releaseRoom(room) {
  if (room.id !== PUBLIC_ROOM && room.size === 0) {
    room.dispose();
    rooms.delete(room.id);
  }
}

getRoom(PUBLIC_ROOM);

// ── Validation helpers ───────────────────────────────────────────────────────
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPos = p => p && isNum(p.x) && isNum(p.y) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6;
const validWeaponId = id => Number.isInteger(id) && id >= 0 && id <= MAX_WEAPON_ID;
// Strip control / bidi-override characters that could garble other players' screens.
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const RESERVED_NAMES = /^\s*(\[?admin\]?|server)\s*$/i;

// Behind a trusted proxy the real client is the entry the proxy appended, i.e.
// the right-most one; everything left of it is client-controlled.
function clientIp(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (TRUST_PROXY && xff) {
    const hops = String(xff).split(',').map(h => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1].replace(/^::ffff:/, '');
  }
  return (socket.handshake.address || '').trim().replace(/^::ffff:/, '');
}

// Admin = direct LAN/localhost connection (not via a proxy), or logged in with ADMIN_PASSWORD.
function isAdmin(socket) {
  if (socket.data.isAdmin) return true;
  // Behind a proxy (TRUST_PROXY, or any forwarded request) LAN trust is
  // meaningless: admins must use ADMIN_PASSWORD.
  if (TRUST_PROXY || socket.handshake.headers['x-forwarded-for']) return false;
  const ip = clientIp(socket);
  return ip === '::1' || ip === '127.0.0.1' || ip === 'localhost'
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

// ── Abuse limits ─────────────────────────────────────────────────────────────
const connectionsPerIp = new Map();

io.use((socket, next) => {
  const ip = clientIp(socket);
  const n = connectionsPerIp.get(ip) || 0;
  if (n >= MAX_CONNECTIONS_PER_IP) return next(new Error('Too many connections from your address.'));
  connectionsPerIp.set(ip, n + 1);
  socket.once('disconnect', () => {
    const left = (connectionsPerIp.get(ip) || 1) - 1;
    if (left <= 0) connectionsPerIp.delete(ip); else connectionsPerIp.set(ip, left);
  });
  next();
});

function installFloodGuard(socket) {
  let windowStart = Date.now(), count = 0, strikes = 0;
  socket.use((packet, next) => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      strikes = count > EVENTS_PER_SECOND * 4 ? strikes + 1 : 0;
      if (strikes >= 3) { socket.disconnect(true); return; }
      windowStart = now;
      count = 0;
    }
    if (++count > EVENTS_PER_SECOND) return; // drop silently
    next();
  });
}

// ── Socket handlers ──────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  installFloodGuard(socket);
  if (!process.env.QUIET) console.log("a user connected: ", socket.id);

  // Reject banned IPs immediately.
  const connIp = clientIp(socket);
  if (bannedIps.has(connIp)) {
    socket.emit('kicked', { reason: 'You are banned.' });
    socket.disconnect(true);
    return;
  }

  const room = getRoom(normaliseRoomId(socket.handshake.query?.room));

  // Reconnect after a silent drop (Wi-Fi ↔ mobile switch…): the old socket can
  // linger for up to pingInterval + pingTimeout as a frozen ghost that also
  // occupies a room slot. Each tab sends a secret random session token; a new
  // connection with the same token in the same room replaces the ghost at once.
  const session = socket.handshake.query?.session;
  if (typeof session === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(session)) {
    socket.data.session = session;
    for (const [id, other] of io.sockets.sockets) {
      if (id !== socket.id && other.data.session === session && other.data.room === room) {
        other.data.replaced = true;
        socket.data.announced = true; // quiet rejoin: no "joined"/"left" chat spam
        other.disconnect(true);
      }
    }
  }

  if (room.size >= MAX_PLAYERS_PER_ROOM) {
    socket.emit('kicked', { reason: 'This room is full.' });
    socket.disconnect(true);
    releaseRoom(room);
    return;
  }
  socket.join(room.id);
  socket.data.room = room;
  const players = room.players;
  const game = room.game;   // NB: room.game is mutated in place, never replaced

  const p = new Player();
  p.name     = 'Player ' + socket.id.slice(0, 4);
  p.position = { x: 0, y: 0 };
  const graceKey = socket.data.session ? `${room.id}|${socket.data.session}` : null;
  const returning = graceKey && departed.get(graceKey);
  if (returning) {
    clearTimeout(returning.timer);
    departed.delete(graceKey);
    if (returning.round === room.roundId) { p.kills = returning.kills; p.deaths = returning.deaths; }
    p.name = returning.name;
    socket.data.announced = true; // quiet rejoin
  }
  players[socket.id] = p;

  socket.emit("currentPlayers", players);
  socket.emit("gameState", {
    mapFile:     game.mapFile,
    roundEndsAt: game.roundEndsAt,
    phase:       game.phase,
    scores:      room.getScores(),
  });
  socket.to(room.id).emit("newPlayer", { playerId: socket.id, name: p.name });
  room.emit("scoreUpdate", { scores: room.getScores() });

  // Announce the join when the player actually enters the game (first
  // playerStatus {afk:false}, i.e. Play pressed — by then the name typed in the
  // menu has been sent), with a fallback for clients that never report it.
  const announceJoin = () => {
    if (socket.data.announced || !players[socket.id]) return;
    socket.data.announced = true;
    room.emit("chatMessage", { name: 'Server', text: `${players[socket.id].name} joined the game.` });
  };
  setTimeout(announceJoin, 30000);

  // Round-trip latency probe used by the client's ping display.
  socket.on("latency", (_t, ack) => { if (typeof ack === 'function') ack(); });

  socket.on("disconnect", () => {
    if (!process.env.QUIET) console.log("user disconnected: ", socket.id);
    const leaving = players[socket.id];
    const leavingName = leaving?.name ?? 'A player';
    delete players[socket.id];
    room.emit("playerDisconnected", socket.id);
    room.emit("scoreUpdate", { scores: room.getScores() });
    if (socket.data.replaced) { releaseRoom(room); return; }
    const graceKey = socket.data.session ? `${room.id}|${socket.data.session}` : null;
    if (graceKey && leaving) {
      // Hold the score (and the room) briefly in case this was a network blip.
      const timer = setTimeout(() => {
        departed.delete(graceKey);
        room.emit("chatMessage", { name: 'Server', text: `${leavingName} left the game.` });
        releaseRoom(room);
      }, RECONNECT_GRACE_MS);
      if (timer.unref) timer.unref();
      departed.set(graceKey, { kills: leaving.kills, deaths: leaving.deaths, name: leavingName, round: room.roundId, timer });
      return;
    }
    room.emit("chatMessage", { name: 'Server', text: `${leavingName} left the game.` });
    releaseRoom(room);
  });

  socket.on("playerMovement", (movementData) => {
    if (!players[socket.id] || !isPos(movementData)) return;
    const pos = { x: movementData.x, y: movementData.y };
    if (isNum(movementData.rotation)) pos.rotation = movementData.rotation;
    players[socket.id].position = pos;
    socket.to(room.id).emit("playerMoved", {
      playerId:  socket.id,
      playerPos: pos,
    });
  });

  socket.on("playedShoot", () => {
    socket.to(room.id).emit("playShoot", { playerId: socket.id });
  });

  socket.on("playedWalkingAnimation", (walkingInfo) => {
    if (!walkingInfo || !isNum(walkingInfo.rotation)) return;
    socket.to(room.id).emit("playWalkingAnimation", {
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

    // Token bucket per victim: refills one hit per weapon cooldown, holds two,
    // so genuine hits bunched up by network jitter still all count.
    const buckets = socket.data.hitBuckets || (socket.data.hitBuckets = {});
    const now = Date.now();
    const bk = buckets[victimId] || (buckets[victimId] = { tokens: 2, t: now });
    bk.tokens = Math.min(2, bk.tokens + (now - bk.t) / weapon.fireCooldown);
    bk.t = now;
    if (bk.tokens < 1) return;
    bk.tokens -= 1;

    room.emit("playerGotHit", { playerId: victimId, damage: weapon.damage, weaponId, attackerId: socket.id });
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
    room.emit("playerDied", { playerId: socket.id, killerId, weaponId });
    room.emit("scoreUpdate", { scores: room.getScores() });
  });

  socket.on("playerRespawn", (data) => {
    if (!players[socket.id] || !data || !isPos(data.position)) return;
    const pos = { x: data.position.x, y: data.position.y };
    players[socket.id].position = pos;
    socket.to(room.id).emit("playerMoved", {
      playerId:  socket.id,
      playerPos: pos
    });
  });

  // AFK flag (menu open / tab hidden) — purely informational for other players.
  socket.on("playerStatus", (data) => {
    if (!players[socket.id] || !data) return;
    const afk = data.afk === true;
    if (!afk) announceJoin();
    if (players[socket.id].afk === afk) return;
    players[socket.id].afk = afk;
    const broadcast = () => {
      if (players[socket.id]) socket.to(room.id).emit("playerStatus", { playerId: socket.id, afk: players[socket.id].afk });
    };
    if (allow(socket, 'statusBucket', 10, 5000)) { broadcast(); return; }
    // Rate limited: still deliver the final state once the window has passed.
    if (!socket.data.afkPending) {
      socket.data.afkPending = setTimeout(() => { socket.data.afkPending = null; broadcast(); }, 5000);
    }
  });

  // Client sends its spinner identity once the map has loaded.
  socket.on("playerIdentity", (data) => {
    if (!players[socket.id] || !data) return;
    const hue   = (((data.hue | 0) % 360) + 360) % 360;
    const shape = Math.max(0, Math.min(255, data.shapeIndex | 0));
    players[socket.id].indicatorHue        = hue;
    players[socket.id].indicatorShapeIndex = shape;
    socket.to(room.id).emit("playerIdentityUpdate", {
      playerId:            socket.id,
      indicatorHue:        hue,
      indicatorShapeIndex: shape,
    });
    room.emit("scoreUpdate", { scores: room.getScores() }); // scoreboard name colours
  });

  // Client finished parsing the map — send (or initialize) pickup state.
  socket.on("mapLoaded", (data) => {
    if (game.pickups.length === 0 && data && Array.isArray(data.weaponSpawns)
        && data.weaponSpawns.length && data.weaponSpawns.length <= 128) {
      // Maps may reference weapon ids the weapon table doesn't define (e.g. 13);
      // the client simply doesn't render those, so accept any small id here.
      const spawns = data.weaponSpawns.filter(ws => ws && Number.isInteger(ws.weaponId) && ws.weaponId >= 0 && ws.weaponId < 256 && isNum(ws.respawnTime));
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
    socket.to(room.id).emit("pickupTaken", { spawnIndex, playerId: socket.id, weaponId: pickup.weaponId });

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

      if (cmd === '!help') return; // the client prints its own help text

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
          room.endRound();
          return;
        }

        if (cmd === '!kick' || cmd === '!ban') {
          const target = parts.slice(1).join(' ');
          for (const id in players) {
            if (players[id].name === target || id === target) {
              const s = io.sockets.sockets.get(id);
              if (cmd === '!ban' && s) {
                const banIp = clientIp(s);
                if (banIp) { bannedIps.add(banIp); saveBans(); }
              }
              io.to(id).emit('kicked', { reason: cmd === '!ban' ? 'Banned by admin.' : 'Kicked by admin.' });
              setTimeout(() => { const ss = io.sockets.sockets.get(id); if (ss) ss.disconnect(true); }, 500);
              room.emit('chatMessage', { name: '[Admin]', text: `${players[id].name} was ${cmd === '!ban' ? 'banned' : 'kicked'}.` });
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
          room.debugMapEnabled = !room.debugMapEnabled;
          socket.emit('chatMessage', { name: 'Server', text: `Debug map ${room.debugMapEnabled ? 'ON (debug.dat)' : 'OFF (random maps)'} — starting new round...` });
          room.endRound();
          return;
        }

        return; // ignore unknown ! commands from admins
      }
    }

    if (!allow(socket, 'chatBucket', 5, 5000)) {
      socket.emit('chatMessage', { name: 'Server', text: 'You are sending messages too fast.' });
      return;
    }
    room.emit("chatMessage", { name, hue, text });
  });

  socket.on("setName", (data) => {
    if (!players[socket.id] || !data) return;
    let name = cleanText(data.name, 20);
    if (!name || RESERVED_NAMES.test(name)) {
      // Tell the client which name it really has, so it doesn't show "Server" locally.
      socket.emit('nameAssigned', { name: players[socket.id].name });
      return;
    }
    if (name !== players[socket.id].name && !allow(socket, 'nameBucket', 5, 10000)) return;
    // Names are unique within a room (chat "you" detection and !kick rely on it).
    const taken = n => Object.entries(players).some(([id, pl]) => id !== socket.id && pl.name.toLowerCase() === n.toLowerCase());
    if (taken(name)) {
      let i = 2, candidate;
      do { candidate = `${name.slice(0, 17).trimEnd()} ${i++}`; } while (taken(candidate) && i < 100);
      name = candidate;
      socket.emit('nameAssigned', { name });
    }
    if (name === players[socket.id].name) return;
    const previous = players[socket.id].name;
    players[socket.id].name = name;
    socket.to(room.id).emit("playerNameChanged", { playerId: socket.id, name });
    room.emit("scoreUpdate", { scores: room.getScores() });
    if (socket.data.announced) room.emit("chatMessage", { name: 'Server', text: `${previous} is now known as ${name}.` });
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
  server, io, rooms, weaponsData,
  player(id) { for (const r of rooms.values()) if (r.players[id]) return r.players[id]; return null; },
  close() {
    for (const d of departed.values()) clearTimeout(d.timer);
    for (const r of rooms.values()) r.dispose();
    io.close();
    return new Promise(r => server.close(() => r()));
  },
};

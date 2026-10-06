// Gameplay regression guard for the engine rewrite.
//
// Runs a BASE version of the game (default: the last version before the
// rewrite, commit 9948cb8 = tag stable-before-rewrite) and the current
// working tree side by side in headless Chromium, with a fake clock, seeded
// randomness and manual frame stepping, and compares — frame for frame — on
// the game's own maps:
//   • map parsing (size, obstacle grid, spawns, weapon spawns)
//   • the player's movement for a scripted input sequence (walls, corners,
//     diagonals, every walk speed)
//   • hit events of every weapon, aimed in 16 directions, at a ring of targets
//   • damage, death and respawn timing of the local player
//   • a full bot match (positions, health, weapons, kills) for 40 seconds
// Any difference fails. Run: npm run regression   (BASE=<commit> to change)
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('node:assert');
/* global __step, __fakeTimers, __reseed */
const { chromium } = require('playwright');

const BASE = process.env.BASE || '9948cb8';
const ROOT = path.join(__dirname, '..', '..');

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(dir, u.endsWith('/') ? u + 'index.html' : u);
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const INIT = () => {
  let seed = 9001;
  Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__reseed = s => { seed = s; };
  let now = 1000;
  performance.now = () => now;
  Date.now = () => 1700000000000 + now;
  const cbs = [];
  window.requestAnimationFrame = cb => { cbs.push(cb); return cbs.length; };
  // Once the game has loaded, setTimeout callbacks (weapon cooldowns,
  // respawns…) also run on the fake clock.
  const timers = [];
  let tid = 1e6;
  const realClear = window.clearTimeout.bind(window);
  window.__fakeTimers = () => {
    window.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.push({ id, at: now + (+ms || 0), fn: () => fn(...a) }); return id; };
    window.clearTimeout = id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); else realClear(id); };
  };
  const runTimers = () => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      if (!timers.length || timers[0].at > now) break;
      timers.shift().fn();
    }
  };
  window.__step = (n = 1) => { for (let i = 0; i < n; i++) { now += 1000 / 60; runTimers(); const list = cbs.splice(0); list.forEach(cb => cb(now)); } };
};

const MAPS = ['asphaltstreets.dat', 'officefloor.dat', 'orbitstation.dat', 'hedgemaze.dat', 'shipyard.dat', 'rooftops.dat', 'thepitarena.dat', 'metroline.dat'];
const BOT_MAPS = ['asphaltstreets.dat', 'hedgemaze.dat', 'foundry.dat', 'stonekeep.dat', 'containerport.dat', 'orbitstation.dat'];
const SCRIPT = [ // [keys, frames, weaponIdOrNull]
  [['right'], 90], [['down'], 70], [['left', 'up'], 80], [['up'], 70, 3], [['right', 'down'], 120],
  [['left'], 100, 10], [['down', 'left'], 90], [['up', 'right'], 110, 0], [['right'], 140], [['up'], 150],
  [['left', 'down'], 120, 11], [['down'], 160], [['right', 'up'], 130, 7], [['left'], 200],
];
const r6 = v => +(+v).toFixed(5);

async function run(url) {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 960, height: 720 } })).newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(INIT);
  await p.goto(url);
  await p.waitForFunction(() => typeof loopStarted !== 'undefined' && loopStarted && map.ready && playerManager.mainPlayer, null, { timeout: 30000, polling: 200 });
  await p.evaluate(() => { window.draw = () => {}; __fakeTimers(); });
  const out = { parse: {}, traj: {}, hits: {}, life: {}, bots: {} };

  for (const m of MAPS) {
    await p.evaluate(async (m) => {
      if (botManager.active) botManager.despawn();
      for (const id of Object.keys(playerManager.getPlayers())) playerManager.removePlayer(id);
      await loadMap(m);
      __reseed(77);
      const me = playerManager.mainPlayer, sp = map.spawnPoints[0];
      me.forceRespawn([sp]);
      for (const k in keys) keys[k] = false;
    }, m);
    out.parse[m] = await p.evaluate(() => JSON.stringify([map.width, map.height,
      obstacleGrid.map(t => (t ? t.c : 0)).join(''), map.spawnPoints, map.weaponSpawns || null]));
    await p.evaluate(() => __step(2));
    const traj = [];
    for (const [ks, frames, wid] of SCRIPT) {
      await p.evaluate(([ks, wid]) => { for (const k in keys) keys[k] = false; for (const k of ks) keys[k] = true; if (wid != null) playerManager.mainPlayer.equipWeapon(wid, true); }, [ks, wid]);
      for (let f = 0; f < frames; f += 10) {
        traj.push(...await p.evaluate(() => { const r = []; for (let i = 0; i < 10; i++) { __step(1); const b = playerManager.mainPlayer.body; r.push([b.x, b.y]); } return r; }));
      }
    }
    out.traj[m] = traj.map(([x, y]) => [r6(x), r6(y)]);

    // Every weapon, 16 aim directions, a ring of targets.
    out.hits[m] = await p.evaluate(() => {
      for (const k in keys) keys[k] = false;
      const me = playerManager.mainPlayer, sp = map.spawnPoints[0];
      me.body.setPosition(sp.x, sp.y);
      const offs = [];
      for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12, d = 30 + (k % 6) * 60; offs.push([Math.cos(a) * d, Math.sin(a) * d]); }
      offs.forEach(([dx, dy], i) => playerManager.addPlayer('dummy' + i, new Player(sp.x + dx, sp.y + dy)));
      const log = [];
      const orig = socketManager.emit.bind(socketManager);
      socketManager.emit = (e, d) => { if (e === 'playerHit') log.push(`${d.playerId}:${d.damage}`); return orig(e, d); };
      const res = {};
      for (let wid = 0; wid <= 12; wid++) {
        for (let dir = 0; dir < 16; dir++) {
          log.length = 0;
          me.equipWeapon(wid, true);
          me.body.setRotation(dir * Math.PI / 8 + Math.PI / 2 + 0.013);
          me.canShoot = true;
          me.shoot();
          __step(40);
          res[wid + '/' + dir] = log.slice().sort().join(',');
        }
      }
      socketManager.emit = orig;
      for (let i = 0; i < offs.length; i++) playerManager.removePlayer('dummy' + i);
      return res;
    });

    // Damage → death → respawn timing of the local player.
    out.life[m] = await p.evaluate(() => {
      const me = playerManager.mainPlayer, t = [];
      me.forceRespawn([map.spawnPoints[0]]);
      for (let k = 0; k < 9; k++) {
        me.showHitsplat(13, 2, null);
        if (me.health <= 0 && !me.isRespawning) me.death();
        __step(5);
        t.push([+me.health.toFixed(4), me.isRespawning]);
      }
      let frames = 0;
      while (me.isRespawning && frames < 600) { __step(1); frames++; }
      t.push(['respawnFrames', frames, me.health]);
      return t;
    });
  }

  // Bot matches.
  for (const m of BOT_MAPS) {
    out.bots[m] = await p.evaluate(async (m) => {
      __reseed(1234);
      await botManager.startOfflineRound(m);
      __reseed(4321);
      const me = playerManager.mainPlayer;
      me.forceRespawn([map.spawnPoints[0]]);
      const rec = [];
      if (!Player.prototype.__counted) {
        const sh = Player.prototype.shoot;
        Player.prototype.shoot = function (...a) { (window.__shots = window.__shots || []).push([this.name, performance.now()]); return sh.apply(this, a); };
        Player.prototype.__counted = true;
      }
      window.__shots = [];
      for (let f = 0; f < 3600; f += 15) {
        __step(15);
        me.health = 100;   // keep the local player alive and standing still
        const row = [];
        for (const [id, bot] of Object.entries(botManager.bots).sort()) {
          const b = bot.player.body;
          row.push([id, +b.x.toFixed(3), +b.y.toFixed(3), +bot.player.health.toFixed(3), bot.player.currentWeapon.id, bot.kills, bot.deaths, bot.player.isRespawning]);
        }
        rec.push(row);
      }
      return { rec, shots: window.__shots };
    }, m);
  }
  await b.close();
  return { out, errors };
}

function firstDiff(a, b, label) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) return 0;
  let i = 0;
  while (i < sa.length && sa[i] === sb[i]) i++;
  console.log(`DIFF ${label}\n  base: …${sa.slice(Math.max(0, i - 120), i + 120)}\n  now:  …${sb.slice(Math.max(0, i - 120), i + 120)}`);
  return 1;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-regress-'));
  const tar = execFileSync('git', ['archive', BASE, 'docs'], { cwd: ROOT, maxBuffer: 1 << 30 });
  fs.writeFileSync(path.join(tmp, 'base.tar'), tar);
  execFileSync('tar', ['-xf', 'base.tar'], { cwd: tmp });
  const baseSrv = await serve(path.join(tmp, 'docs'));
  const curSrv = await serve(path.join(ROOT, 'docs'));
  try {
    const A = await run(`http://127.0.0.1:${baseSrv.address().port}/?play`);
    const B = await run(`http://127.0.0.1:${curSrv.address().port}/?play`);
    let diffs = 0, checks = 0;
    for (const part of ['parse', 'traj', 'hits', 'life', 'bots']) {
      for (const m of Object.keys(A.out[part])) { checks++; diffs += firstDiff(A.out[part][m], B.out[part][m], `${part} ${m}`); }
    }
    const hitEvents = Object.values(A.out.hits).reduce((n, h) => n + Object.values(h).filter(Boolean).join(',').split(',').filter(Boolean).length, 0);
    const frames = Object.values(A.out.traj).reduce((n, t) => n + t.length, 0);
    if (process.env.REGRESSION_DEBUG) for (const [m, r] of Object.entries(B.out.bots)) console.log(m, r.shots.length, 'shots', JSON.stringify(r.rec[r.rec.length - 1]));
    console.log(`regression vs ${BASE}: ${checks} checks, ${diffs} differ (${frames} movement frames, ${hitEvents} hits, ${BOT_MAPS.length} bot matches)`);
    assert.deepStrictEqual(B.errors, [], 'page errors in the current version');
    assert.strictEqual(diffs, 0, 'gameplay differs from ' + BASE);
    assert.ok(hitEvents > 200, 'the hit test produced hits');
    console.log('regression: OK — gameplay identical to ' + BASE);
  } finally {
    baseSrv.close(); curSrv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });

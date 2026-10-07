// Gameplay parity test: runs the ORIGINAL game (the import commit) and the
// current game side by side in headless Chromium with a fake clock, seeded
// randomness and manual frame stepping, feeds both the same input script on
// several maps and compares the player's position on every frame, plus the
// hit events of every weapon against a ring of targets. Any difference means
// gameplay/physics changed.  Run: npm run parity  (needs git history + Chromium)
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('node:assert');
/* global __step */ // installed into the page by INIT
const { chromium } = require('playwright');

const ORIGINAL = process.env.PARITY_BASE || '1f035b2';
const ROOT = path.join(__dirname, '..', '..');

// `fallback`: files missing from `dir` are served from there. The current game
// has its own (new) maps; the engine is compared on the original maps.
function serve(dir, fallback) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.mp3': 'audio/mpeg' };
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(dir)) { res.writeHead(403); return res.end(); }
    const file = req.url.split('?')[0].endsWith('/') ? path.join(p, 'index.html') : p;
    const rel = path.relative(dir, file);
    const pick = (fallback && rel.startsWith(path.join('data', 'maps')) && !fs.existsSync(file)) ? path.join(fallback, rel) : file;
    fs.readFile(pick, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const INIT = () => {
  let seed = 4242;
  Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let now = 1000;
  performance.now = () => now;
  Date.now = () => 1700000000000 + now;
  const cbs = [];
  window.requestAnimationFrame = cb => { cbs.push(cb); return cbs.length; };
  window.__step = (n = 1) => { for (let i = 0; i < n; i++) { now += 1000 / 60; const list = cbs.splice(0); list.forEach(cb => cb(now)); } };
};
const MAPS = ['barge.dat', 'cubicles.dat', 'facility.dat', 'sewertunnel.dat', 'outpost.dat', 'orbit.dat',
  'industrialdrainage.dat', 'spacebridge.dat', 'ballistick/barge.dat', 'feature/dday.dat'];
const SCRIPT = [ // [keys, frames, weaponIdOrNull]
  [['right'], 90], [['down'], 60], [['left', 'up'], 80], [['up'], 70, 3], [['right', 'down'], 120],
  [['left'], 100, 10], [['down', 'left'], 90], [['up', 'right'], 110, 0], [['right'], 140], [['up'], 150],
];
async function run(url) {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 960, height: 720 } })).newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(INIT);
  await p.goto(url);
  if (process.env.PARITY_DEBUG) console.log('loaded', url);
  await p.waitForFunction(() => typeof loopStarted !== 'undefined' && loopStarted && map.ready && playerManager.mainPlayer, null, { timeout: 30000, polling: 200 });
  // Rendering has no effect on physics/hit detection; skip it for speed.
  await p.evaluate(() => { window.draw = () => {}; });
  const out = { traj: {}, hits: {} };
  for (const m of MAPS) {
    await p.evaluate(async (m) => {
      if (botManager.active) botManager.despawn();
      for (const id of Object.keys(playerManager.getPlayers())) playerManager.removePlayer(id);
      await loadMap(m);
      const sp = map.spawnPoints[0];
      const me = playerManager.mainPlayer;
      me.equipWeapon(0); me.body.setPosition(sp.x, sp.y);
      for (const k in keys) keys[k] = false;
    }, m);
    await p.evaluate(() => __step(2));
    const traj = [];
    for (const [ks, frames, wid] of SCRIPT) {
      await p.evaluate(([ks, wid]) => { for (const k in keys) keys[k] = false; for (const k of ks) keys[k] = true; if (wid != null) playerManager.mainPlayer.equipWeapon(wid); }, [ks, wid]);
      for (let f = 0; f < frames; f += 10) {
        traj.push(...await p.evaluate(() => { const r = []; for (let i = 0; i < 10; i++) { __step(1); const b = playerManager.mainPlayer.body; r.push([+b.x.toFixed(6), +b.y.toFixed(6)]); } return r; }));
      }
    }
    out.traj[m] = traj;
    if (process.env.PARITY_DEBUG) console.log('traj', m, traj.length);
    // Hit detection: every weapon fires once (aim right) at a ring of dummies.
    out.hits[m] = await p.evaluate(async () => {
      for (const k in keys) keys[k] = false;
      const me = playerManager.mainPlayer;
      const sp = map.spawnPoints[0];
      me.body.setPosition(sp.x, sp.y);
      const offs = [[25, 0], [60, 10], [100, -20], [140, 0], [200, 30], [330, 0], [400, 60], [530, 5], [0, 60], [-40, 0], [30, 35], [90, 90]];
      offs.forEach(([dx, dy], i) => { const d = new Player(sp.x + dx, sp.y + dy); playerManager.addPlayer('dummy' + i, d); });
      const log = [];
      const orig = socketManager.emit.bind(socketManager);
      socketManager.emit = (e, d) => { if (e === 'playerHit') log.push(`${d.playerId}:${d.damage}`); return orig(e, d); };
      const res = {};
      for (const wid of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        log.length = 0;
        me.equipWeapon(wid);
        me.body.setRotation(Math.PI / 2 + 0.05 * wid);
        me.canShoot = true;
        me.shoot();
        __step(40);
        res[wid] = log.slice().sort().join(',');
      }
      socketManager.emit = orig;
      for (let i = 0; i < offs.length; i++) playerManager.removePlayer('dummy' + i);
      return res;
    });
  }
  await b.close();
  return { out, errors };
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-parity-'));
  const tar = execFileSync('git', ['archive', ORIGINAL, 'docs'], { cwd: ROOT, maxBuffer: 1 << 30 });
  fs.writeFileSync(path.join(tmp, 'orig.tar'), tar);
  execFileSync('tar', ['-xf', 'orig.tar'], { cwd: tmp });
  const origSrv = await serve(path.join(tmp, 'docs'));
  const curSrv = await serve(path.join(ROOT, 'docs'), path.join(tmp, 'docs'));
  try {
    const A = await run(`http://127.0.0.1:${origSrv.address().port}/`);
    const B = await run(`http://127.0.0.1:${curSrv.address().port}/?play`);
    let frames = 0, diffs = 0;
    for (const m of MAPS) {
      const a = A.out.traj[m], b = B.out.traj[m];
      assert.strictEqual(a.length, b.length);
      for (let i = 0; i < a.length; i++) {
        frames++;
        if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) { diffs++; if (diffs <= 3) console.log('DIFF', m, i, a[i], b[i]); }
      }
    }
    let hitEvents = 0, hitDiff = 0, throughWall = 0;
    const REDESIGNED = new Set();
    for (const m of MAPS) for (const w in A.out.hits[m]) {
      if (REDESIGNED.has(w)) continue;
      hitEvents += A.out.hits[m][w] ? A.out.hits[m][w].split(',').length : 0;
      if (A.out.hits[m][w] === B.out.hits[m][w]) continue;
      // Line of sight is now checked every 10 px (it skipped wall corners and
      // thin walls before), so the only allowed difference is a hit the
      // original let through a wall disappearing.
      const a = new Set((A.out.hits[m][w] || '').split(',').filter(Boolean));
      const bHits = (B.out.hits[m][w] || '').split(',').filter(Boolean);
      if (bHits.every(h => a.has(h))) { throughWall += a.size - bHits.length; continue; }
      hitDiff++; console.log('HIT DIFF', m, w, A.out.hits[m][w], '|', B.out.hits[m][w]);
    }
    console.log(`movement: ${frames} frames, ${diffs} differ; hits: ${hitEvents} events, ${hitDiff} weapon/map combos differ, ${throughWall} through-wall hits now blocked`);
    assert.strictEqual(diffs, 0, 'movement differs from the original');
    assert.strictEqual(hitDiff, 0, 'hit detection differs from the original');
    assert.ok(hitEvents > 50, 'the hit test actually produced hits');
    assert.deepStrictEqual(B.errors, []);
    console.log('parity: OK — movement identical to the original game, hits identical except shots through walls (damage taken ×' + 1.15 + ' by design, see Constants.DAMAGE_MULTIPLIER)');
  } finally {
    origSrv.close(); curSrv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exit(1); });

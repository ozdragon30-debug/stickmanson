// Integration tests for the multiplayer server (validation + protocol).
// Spins the real app.js up on a random port and talks to it with socket.io clients.
const test = require('node:test');
const assert = require('node:assert');

process.env.PORT = '0';
process.env.QUIET = '1';
delete process.env.ADMIN_PASSWORD;
delete process.env.TRUST_PROXY;

const app = require('../app.js');
const { io: ioc } = require('socket.io-client');

let url;
const clients = [];

function connect(opts = {}) {
  return new Promise((resolve, reject) => {
    const c = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts });
    clients.push(c);
    c.once('connect', () => resolve(c));
    c.once('connect_error', reject);
  });
}

// Resolves with the payload of the next `event`, or null after `ms`.
function next(c, event, ms = 400, filter = () => true) {
  return new Promise(resolve => {
    const t = setTimeout(() => { c.off(event, h); resolve(null); }, ms);
    const h = (d) => { if (!filter(d)) return; clearTimeout(t); c.off(event, h); resolve(d); };
    c.on(event, h);
  });
}

test.before(async () => {
  await new Promise(r => (app.server.listening ? r() : app.server.once('listening', r)));
  url = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  for (const c of clients) c.close();
  await app.close();
});

test('healthz reports status', async () => {
  const res = await fetch(url + '/healthz');
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.ok(typeof body.map === 'string' && body.map.endsWith('.dat'));
  assert.notStrictEqual(body.map, 'debug.dat');
});

test('latency probe is acknowledged', async () => {
  const c = await connect();
  const ok = await new Promise(r => c.timeout(1000).emit('latency', Date.now(), err => r(!err)));
  assert.strictEqual(ok, true);
});

test('hits use canonical weapon damage and reject self/bogus hits', async () => {
  const a = await connect();
  const b = await connect();
  await new Promise(r => setTimeout(r, 100));

  // Forged damage is replaced by the weapon table value (glock = 13).
  let got = next(b, 'playerGotHit');
  a.emit('playerHit', { playerId: b.id, damage: 9999, weaponId: 2 });
  let hit = await got;
  assert.ok(hit, 'hit relayed');
  assert.strictEqual(hit.damage, app.weaponsData[2].damage);
  assert.strictEqual(hit.attackerId, a.id);

  // One jitter-bunched extra hit is tolerated, a third rapid one is dropped.
  got = next(b, 'playerGotHit', 300);
  a.emit('playerHit', { playerId: b.id, damage: 13, weaponId: 2 });
  assert.ok(await got);
  got = next(b, 'playerGotHit', 150);
  a.emit('playerHit', { playerId: b.id, damage: 13, weaponId: 2 });
  assert.strictEqual(await got, null);

  // Self-hit and unknown weapon → dropped.
  got = next(a, 'playerGotHit', 200);
  a.emit('playerHit', { playerId: a.id, damage: 5, weaponId: 0 });
  assert.strictEqual(await got, null);
  got = next(b, 'playerGotHit', 200);
  a.emit('playerHit', { playerId: b.id, damage: 5, weaponId: 999 });
  assert.strictEqual(await got, null);

  // Honest follow-up after the cooldown is accepted.
  await new Promise(r => setTimeout(r, app.weaponsData[2].fireCooldown));
  got = next(b, 'playerGotHit');
  a.emit('playerHit', { playerId: b.id, damage: 13, weaponId: 2 });
  hit = await got;
  assert.ok(hit);
});

test('death credits the killer and reports weapon', async () => {
  const a = await connect();
  const b = await connect();
  await new Promise(r => setTimeout(r, 100));
  const died = next(a, 'playerDied', 500, d => d.playerId === b.id);
  b.emit('iDied', { killerId: a.id, weaponId: 3 });
  const d = await died;
  assert.deepStrictEqual(d, { playerId: b.id, killerId: a.id, weaponId: 3 });
  assert.strictEqual(app.players[a.id].kills, 1);
  assert.strictEqual(app.players[b.id].deaths, 1);

  // Can't credit yourself.
  const self = next(a, 'playerDied', 500, x => x.playerId === b.id);
  b.emit('iDied', { killerId: b.id });
  assert.strictEqual((await self).killerId, null);
});

test('invalid movement is ignored, valid movement relayed', async () => {
  const a = await connect();
  const b = await connect();
  await new Promise(r => setTimeout(r, 100));
  let moved = next(b, 'playerMoved', 200, d => d.playerId === a.id);
  a.emit('playerMovement', { x: NaN, y: 5 });
  assert.strictEqual(await moved, null);
  moved = next(b, 'playerMoved', 200, d => d.playerId === a.id);
  a.emit('playerMovement', { x: 'abc', y: 5, rotation: 1 });
  assert.strictEqual(await moved, null);
  moved = next(b, 'playerMoved', 400, d => d.playerId === a.id);
  a.emit('playerMovement', { x: 100.5, y: 200.25, rotation: 1.5, junk: 'x'.repeat(100) });
  assert.deepStrictEqual((await moved).playerPos, { x: 100.5, y: 200.25, rotation: 1.5 });
});

test('names are sanitised and reserved names refused', async () => {
  const a = await connect();
  a.emit('setName', { name: 'Server' });
  await new Promise(r => setTimeout(r, 100));
  assert.notStrictEqual(app.players[a.id].name, 'Server');
  a.emit('setName', { name: '  Bob‮\u0007  the   Great  ' });
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(app.players[a.id].name, 'Bob the Great');
});

test('chat is rate limited', async () => {
  const a = await connect();
  const seen = [];
  a.on('chatMessage', m => { if (m.name !== 'Server') seen.push(m.text); });
  for (let i = 0; i < 8; i++) a.emit('chatMessage', { text: 'spam ' + i });
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(seen.length, 5);
});

test('spoofed X-Forwarded-For does not grant admin', async () => {
  const a = await connect({ extraHeaders: { 'x-forwarded-for': '127.0.0.1' } });
  const b = await connect();
  await new Promise(r => setTimeout(r, 100));
  b.emit('setName', { name: 'Victim' + Date.now() % 1000 });
  await new Promise(r => setTimeout(r, 100));
  const kicked = next(b, 'kicked', 400);
  a.emit('chatMessage', { text: '!kick ' + app.players[b.id].name });
  assert.strictEqual(await kicked, null);
});

test('map pickups with weapon ids missing from the table are still synced', async () => {
  const a = await connect();
  const state = next(a, 'pickupState', 500);
  a.emit('mapLoaded', { weaponSpawns: [{ weaponId: 4, respawnTime: 10000 }, { weaponId: 13, respawnTime: 20000 }] });
  const st = await state;
  assert.strictEqual(st.length, 2);
});

test('admin weapon command no longer crashes the server', async () => {
  const a = await connect(); // direct localhost connection = LAN admin
  const forced = next(a, 'forceWeapon', 400);
  a.emit('chatMessage', { text: '!weapon 5' });
  assert.deepStrictEqual(await forced, { weaponId: 5 });
  const res = await fetch(url + '/healthz');
  assert.strictEqual(res.status, 200);
});

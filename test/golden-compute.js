// Computes a fingerprint of every gameplay-relevant calculation. The output is
// compared against test/golden.json so any refactor that alters physics,
// collision, hit detection, map parsing or weapon stats fails the test suite.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, createContext, load, rng, listMaps } = require('./harness');

const r6 = n => Math.round(n * 1e6) / 1e6;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function compute() {
  const ctx = createContext();
  load(ctx, 'js/utils/Constants.js');
  load(ctx, 'js/utils/Physics.js');
  load(ctx, 'js/map/MapLoader.js');
  const { Physics, Constants, MapLoader } = ctx;
  const out = {};

  out.constants = {
    SPEED: Constants.SPEED,
    HEAD_RADIUS: Constants.STICK_FIGURE_HEAD_RADIUS,
    TO_RADIANS: Constants.TO_RADIANS,
  };

  out.weapons = hash(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/weapons.json'), 'utf8')));

  // Hit-shape tests over many deterministic random configurations.
  const rand = rng(1138);
  const hits = [];
  for (let i = 0; i < 4000; i++) {
    const o = { x: rand() * 1000, y: rand() * 1000 };
    const t = { x: o.x + (rand() - 0.5) * 900, y: o.y + (rand() - 0.5) * 900 };
    const rot = (rand() - 0.5) * 4 * Math.PI;
    const range = 30 + rand() * 600;
    const spread = 10 + rand() * 120;
    const rect = {
      topLeft: { x: o.x + 25, y: o.y }, topRight: { x: o.x + 50, y: o.y },
      bottomLeft: { x: o.x + 25, y: o.y + 449 }, bottomRight: { x: o.x + 50, y: o.y + 449 },
    };
    for (const k in rect) Object.assign(rect[k], Physics.rotatePoint(o.x, o.y, rect[k].x, rect[k].y, rot));
    hits.push([
      Physics.isRayHit(o, t, rot, range),
      Physics.isConeHit(o, t, rot, range, spread),
      Physics.isCircleHit(o, t, range),
      Physics.isCircleCollidingRect(t, rect),
      r6(Physics.distance(o, t)),
    ]);
  }
  out.hitShapes = hash(hits);

  // Sub-tile walk-collision for every collision class × rotation × flip.
  const walk = [];
  for (let c = 0; c <= 9; c++) for (let r = 0; r < 4; r++) for (let f = 0; f < 4; f++)
    for (let y = 0; y < 50; y += 2.5) for (let x = 0; x < 50; x += 2.5)
      walk.push(Physics.isTileWalkBlocked({ c, r, f }, x, y) ? 1 : 0);
  out.walkCollision = hash(walk.join(''));

  // Map parsing + line-of-sight on every shipped map.
  out.maps = {};
  for (const file of listMaps()) {
    const m = new MapLoader();
    m._parse(fs.readFileSync(path.join(ROOT, 'data/maps', file), 'utf8'));
    ctx.map = { ready: true, width: m.width, height: m.height };
    ctx.obstacleGrid = m.collisionMap;
    const mr = rng(file.length * 7919);
    const los = [];
    for (let i = 0; i < 300; i++) {
      const a = { x: mr() * m.width * 50, y: mr() * m.height * 50 };
      const b = { x: mr() * m.width * 50, y: mr() * m.height * 50 };
      los.push(Physics.checkForObstacles(a, b) ? 1 : 0);
    }
    out.maps[file] = hash({
      w: m.width, h: m.height, name: m.name, tiles: m.tiles, col: m.collisionMap,
      sp: m.spawnPoints, ws: m.weaponSpawns, los: los.join(''),
    });
  }
  return out;
}

module.exports = { compute };

if (require.main === module) {
  const file = path.join(__dirname, 'golden.json');
  fs.writeFileSync(file, JSON.stringify(compute(), null, 2) + '\n');
  console.log('Wrote', file);
}

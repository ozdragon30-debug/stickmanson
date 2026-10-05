// Gameplay lock: physics, collision, hit detection, map data and weapon stats
// must stay byte-for-byte identical to the original game.
const test = require('node:test');
const assert = require('node:assert');
const golden = require('./golden.json');
const { compute } = require('./golden-compute');

const actual = compute();

test('core constants unchanged', () => assert.deepStrictEqual(actual.constants, golden.constants));
test('weapon stats unchanged', () => assert.strictEqual(actual.weapons, golden.weapons));
test('hit shapes unchanged', () => assert.strictEqual(actual.hitShapes, golden.hitShapes));
test('walk collision unchanged', () => assert.strictEqual(actual.walkCollision, golden.walkCollision));
for (const file of Object.keys(golden.maps)) {
  test(`map ${file} parses identically`, () => assert.strictEqual(actual.maps[file], golden.maps[file]));
}

test('service worker precache list matches the files on disk (run: npm run precache)', () => {
  const { build } = require('../tools/gen-precache');
  const onDisk = require('../docs/precache.json');
  assert.deepStrictEqual(onDisk.files, build().files);
});

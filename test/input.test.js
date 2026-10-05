// Unit tests for input helpers that must preserve the original 8-way movement.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./harness');

const ctx = { window: { matchMedia: () => ({ matches: false }) }, Math, console };
ctx.matchMedia = ctx.window.matchMedia;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/input/InputMode.js'), 'utf8') + '\nglobalThis.directionToKeys = directionToKeys;', ctx);
// Keyboard.js only declares helpers at top level, so it can be evaluated with light stubs.
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/input/Keyboard.js'), 'utf8') + '\nglobalThis.keyLabel = keyLabel; globalThis.CODE_RE = CODE_RE;', ctx);
// migrateBind lives in SettingsManager.js next to DOM code; evaluate just that function.
const sm = fs.readFileSync(path.join(ROOT, 'js/manager/SettingsManager.js'), 'utf8');
vm.runInContext(sm.match(/const DEFAULT_SETTINGS = \{[\s\S]*?\n\};\n/)[0] + sm.match(/const LEGACY_DEFAULTS[\s\S]*?function migrateBind[\s\S]*?\n}\n/)[0] + '\nglobalThis.migrateBind = migrateBind;', ctx);

const dirs = k => ['up', 'down', 'left', 'right'].filter(d => k[d]).join('+') || 'none';

test('analog input quantises to exactly the 8 keyboard directions', () => {
  const cases = [
    [[1, 0], 'right'], [[-1, 0], 'left'], [[0, -1], 'up'], [[0, 1], 'down'],
    [[1, -1], 'up+right'], [[-1, -1], 'up+left'], [[1, 1], 'down+right'], [[-1, 1], 'down+left'],
    [[0.95, 0.3], 'right'], [[0.3, 0.95], 'down'], [[0.7, 0.6], 'down+right'],
  ];
  for (const [[x, y], want] of cases) assert.strictEqual(dirs(ctx.directionToKeys(x, y, 0.3)), want, `${x},${y}`);
});

test('analog dead zone yields no movement', () => {
  assert.strictEqual(dirs(ctx.directionToKeys(0.1, -0.1, 0.35)), 'none');
});

test('every analog angle maps to a valid keyboard combo (never opposite keys)', () => {
  for (let a = 0; a < 360; a += 0.5) {
    const r = a * Math.PI / 180;
    const k = ctx.directionToKeys(Math.cos(r), Math.sin(r), 0.2);
    assert.ok(!(k.up && k.down) && !(k.left && k.right), `angle ${a}`);
    assert.ok(k.up || k.down || k.left || k.right, `angle ${a}`);
  }
});

test('old default binds migrate to layout-independent codes', () => {
  assert.strictEqual(ctx.migrateBind('up', 'w'), 'KeyW');
  assert.strictEqual(ctx.migrateBind('right', 'd'), 'KeyD');
  assert.strictEqual(ctx.migrateBind('shoot', ' '), 'Space');
  assert.strictEqual(ctx.migrateBind('sprint', 'Shift'), 'ShiftLeft');
  assert.strictEqual(ctx.migrateBind('up', 'KeyQ'), 'KeyQ');
});

test('custom legacy binds are kept as key values (AZERTY "z" stays the Z key)', () => {
  assert.strictEqual(ctx.migrateBind('up', 'z'), 'z');
  assert.strictEqual(ctx.migrateBind('left', 'q'), 'q');
  assert.strictEqual(ctx.migrateBind('up', 'ı'), 'ı');
});

test('key labels are human readable', () => {
  assert.strictEqual(ctx.keyLabel('KeyW'), 'W');
  assert.strictEqual(ctx.keyLabel('Space'), 'Space');
  assert.strictEqual(ctx.keyLabel('ArrowUp'), '↑');
  assert.strictEqual(ctx.keyLabel('ShiftLeft'), 'Shift Left');
  assert.strictEqual(ctx.keyLabel(''), '—');
  assert.ok(ctx.CODE_RE.test('KeyW') && !ctx.CODE_RE.test('w'));
});

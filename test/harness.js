// Loads browser-global game scripts into an isolated Node VM context so the
// pure-logic parts (physics, map parsing, weapon data) can be tested headlessly.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'docs');

function createContext(extra = {}) {
  const ctx = {
    console, Math, JSON, Object, Array, Number, String, Set, Map, Promise,
    fetch: () => new Promise(() => {}),   // never resolves; tests inject data directly
    obstacleGrid: [],
    map: { ready: false, width: 0, height: 0 },
    ...extra,
  };
  vm.createContext(ctx);
  return ctx;
}

function load(ctx, rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // Classes declared at top level are not attached to the context object, so
  // re-export them explicitly.
  const names = [...code.matchAll(/^class (\w+)/gm)].map(m => m[1]);
  vm.runInContext(code + '\n' + names.map(n => `globalThis.${n} = ${n};`).join('\n'), ctx, { filename: rel });
  return ctx;
}

// Deterministic PRNG (mulberry32) so golden inputs are reproducible.
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function listMaps() {
  const dir = path.join(ROOT, 'data', 'maps');
  const out = [];
  (function walk(d, prefix) {
    for (const f of fs.readdirSync(d).sort()) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) walk(full, prefix + f + '/');
      else if (f.endsWith('.dat')) out.push(prefix + f);
    }
  })(dir, '');
  return out;
}

module.exports = { ROOT, createContext, load, rng, listMaps };

// Every UI string must exist in both languages with the same {placeholders},
// and every t('key') used in the client must be defined.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./harness');

const ctx = { navigator: { languages: ['en'] }, document: { documentElement: {}, querySelectorAll: () => [] }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/utils/I18n.js'), 'utf8') + '\nglobalThis.I18N = I18N; globalThis.I18N_CHAT_TR = I18N_CHAT_TR; globalThis.t = t; globalThis.i18n = i18n;', ctx);
const { I18N } = ctx;
const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('English and Turkish define the same keys', () => {
  assert.deepStrictEqual(Object.keys(I18N.tr).sort(), Object.keys(I18N.en).sort());
});

test('placeholders match across languages', () => {
  for (const k of Object.keys(I18N.en)) assert.strictEqual(vars(I18N.tr[k]), vars(I18N.en[k]), k);
});

test('every key used in the client is defined', () => {
  const used = new Set();
  const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|html)$/.test(f) && f !== 'I18n.js') {
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-html|-title)?="([\w.]+)"/g)) used.add(m[1]);
  } } };
  walk(ROOT);
  const missing = [...used].filter(k => !(k in I18N.en) && !/^hud\.streak\.$/.test(k));
  assert.deepStrictEqual(missing, []);
});

test('server chat lines are translated to Turkish', () => {
  ctx.i18n.lang = 'tr';
  assert.strictEqual(ctx.i18n.chat('Alice joined the game.'), 'Alice oyuna katıldı.');
  assert.strictEqual(ctx.i18n.chat('Round started on Barge!'), 'Tur başladı: Barge!');
  assert.strictEqual(ctx.i18n.chat('Round over! Next round starting in 10 seconds...'), 'Tur bitti! Yeni tur 10 saniye içinde başlıyor...');
  assert.strictEqual(ctx.i18n.chat('hello'), 'hello');
  ctx.i18n.lang = 'en';
  assert.strictEqual(ctx.i18n.chat('Alice joined the game.'), 'Alice joined the game.');
});

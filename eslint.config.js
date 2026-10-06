// ESLint flat config.
// The client is plain <script> files sharing globals (no modules), so the set of
// cross-file globals is collected from every top-level declaration in docs/js.
const fs = require('fs');
const path = require('path');
const globals = require('globals');

function clientGlobals() {
  const out = {};
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/^(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) out[m[1]] = 'writable';
      }
    }
  };
  walk(path.join(__dirname, 'docs/js'));
  return out;
}

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-redeclare': 'off',          // top-level script globals are "redeclared" via the globals list
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-cond-assign': 'error',
  'eqeqeq': ['warn', 'smart'],
};

module.exports = [
  { ignores: ['node_modules/**', 'tools/**', 'docs/js/vendor/**', 'build/**', 'android/**'] },
  {
    files: ['docs/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, io: 'readonly', ...clientGlobals() },
    },
    rules: {
      ...rules,
      'no-unused-vars': 'off', // cross-file globals look "unused" per file
      // t() is the global translate function: a local `t` silently breaks it.
      'no-restricted-syntax': ['error',
        { selector: "VariableDeclarator[id.name='t']", message: 'Do not shadow the global t() translation function.' },
        { selector: ":function > Identifier.params[name='t']", message: 'Do not shadow the global t() translation function.' }],
    },
  },
  {
    files: ['docs/js/utils/Physics.js', 'docs/js/utils/I18n.js'],
    rules: { 'no-restricted-syntax': 'off' }, // no t() calls here; Physics' `t` is locked by the golden tests
  },
  {
    files: ['app.js', 'server/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
  {
    // Browser-evaluated callbacks (page.evaluate) reference game globals.
    files: ['test/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...clientGlobals() } },
  },
  {
    files: ['docs/sw.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.serviceworker } },
    rules,
  },
];

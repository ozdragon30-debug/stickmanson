// Generates docs/precache.json: every file the service worker should cache for
// full offline play. Run after adding/removing game files:  npm run precache
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'docs');
const SKIP = [/\.png$/i, /^precache\.json$/, /^sw\.js$/, /\.md$/];
// The PNG atlases are only a fallback for browsers without WebP; icons are needed.
const KEEP = [/^icons\//];

function walk(dir, prefix = '') {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix + name;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, rel + '/'));
    else if (KEEP.some(r => r.test(rel)) || !SKIP.some(r => r.test(rel))) out.push(rel);
  }
  return out;
}

function build() {
  return { files: walk(ROOT) };
}

module.exports = { build };

if (require.main === module) {
  const data = build();
  fs.writeFileSync(path.join(ROOT, 'precache.json'), JSON.stringify(data, null, 1) + '\n');
  console.log(`precache.json: ${data.files.length} files`);
}

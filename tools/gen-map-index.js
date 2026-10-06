// Generates docs/data/maps/index.json: { "<file>": "<map name from inf=>" } for
// every map, so the server and the offline map picker can show real names
// ("Battleground Base (by cadaver999)") without parsing every .dat file.
// Run after adding maps:  npm run maps
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'docs', 'data', 'maps');

function build() {
  const out = {};
  (function walk(d, prefix) {
    for (const f of fs.readdirSync(d).sort()) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) walk(full, prefix + f + '/');
      else if (f.endsWith('.dat')) {
        const m = fs.readFileSync(full, 'utf8').match(/inf=\d+\s+\d+\s+([^\n&\r]+)/i);
        out[prefix + f] = m ? m[1].trim() : f.replace(/\.dat$/, '');
      }
    }
  })(DIR, '');
  return out;
}

module.exports = { build };

if (require.main === module) {
  const data = build();
  fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(data, null, 1) + '\n');
  console.log(`maps/index.json: ${Object.keys(data).length} maps`);
}

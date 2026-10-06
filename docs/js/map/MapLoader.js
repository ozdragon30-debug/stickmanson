// Map files (.dat): a text file of `key=value` sections separated by '&'.
//
//   inf=   W H Map name
//   tiles= one 6-character code per tile, row by row: TTT R F C
//            TTT  tile key (only used for animated water now)
//            R    rotation, quarter turns (0–3)
//            F    flip: 0 none, 1 horizontal, 2 vertical, 3 both
//            C    collision: 0–2 open, 3 solid (blocks bullets too),
//                 4 blocks walking only, 5–9 partly solid (see Physics)
//   sp=    spawn points "x y" in tile-corner pixels ("0 0" = unused)
//   ws=    weapon spawns "x y weaponId respawnSeconds" ("0 0 …" = unused)
//   rt=    round time (s)     ts= team setting (0 = free for all)
//   bg=    painted background image, bgpad= tiles of surroundings in it,
//   bgpx=  its pixels per tile
class MapLoader {
  constructor() {
    this.ready = false;
    this.width = 0;
    this.height = 0;
    this.name = '';
    this.tiles = [];          // tile codes
    this.collisionMap = [];   // per tile {c, r, f}
    this.spawnPoints = [];    // [{x, y}] tile centres
    this.weaponSpawns = [];   // [{x, y, weaponId, respawnTime (ms)}]
    this.bgImage = null;      // painted background (drawing only)
    this.bgFile = null;
    this.bgPad = 0;
    this.bgPx = 0;
  }

  async load(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load map: ${url}`);
    this._parse(await resp.text());
    if (this.bgFile) {
      // Decode before the map goes live so the first frames don't stall.
      const img = new Image();
      img.decoding = 'async';
      img.src = url.slice(0, url.lastIndexOf('/') + 1) + this.bgFile;
      try { await img.decode(); this.bgImage = img; } catch (e) { console.error('Map background failed to load:', e); }
    }
    this.ready = true;
  }

  // Splits the file into its sections (first occurrence of each key wins).
  static sections(text) {
    const out = {};
    for (const part of text.split('&')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      if (key && !(key in out)) out[key] = part.slice(eq + 1);
    }
    return out;
  }

  // Numbers on the first line of a section ("" when it starts on a new line).
  static numbers(value) {
    const line = (value || '').split('\n')[0].trim();
    return line ? line.split(/\s+/).map(Number) : [];
  }

  _parse(text) {
    const sec = MapLoader.sections(text.replace(/\r/g, '').trim());

    const inf = /^(\d+)\s+(\d+)\s+([^\n]+)/.exec(sec.inf || '');
    if (!inf) throw new Error('inf= line not found in .dat');
    this.width = parseInt(inf[1], 10);
    this.height = parseInt(inf[2], 10);
    this.name = inf[3].trim();

    if (sec.tiles === undefined) throw new Error('&tiles= block not found');
    this.tiles = sec.tiles.trim().split(/\s+/).filter(Boolean);
    const digit = (code, i) => parseInt(code[i], 10) || 0;
    this.collisionMap = this.tiles.map(code => ({ c: digit(code, 5), r: digit(code, 3) % 4, f: digit(code, 4) % 4 }));

    // Positions in the file are tile corners; the game uses tile centres.
    const half = 25;
    this.spawnPoints = [];
    const sp = MapLoader.numbers(sec.sp);
    for (let i = 0; i + 1 < sp.length; i += 2) {
      if (sp[i] || sp[i + 1]) this.spawnPoints.push({ x: sp[i] + half, y: sp[i + 1] + half });
    }

    this.weaponSpawns = [];
    const ws = MapLoader.numbers(sec.ws);
    for (let i = 0; i + 3 < ws.length; i += 4) {
      if (ws[i] || ws[i + 1]) {
        this.weaponSpawns.push({ x: ws[i] + half, y: ws[i + 1] + half, weaponId: ws[i + 2], respawnTime: (ws[i + 3] || 10) * 1000 });
      }
    }

    const bg = /^\s*([\w.-]+)/.exec(sec.bg || '');
    this.bgFile = bg ? bg[1] : null;
    this.bgPad = parseInt((/^\s*(\d+)/.exec(sec.bgpad || '') || [])[1] || '0', 10);
    this.bgPx = parseInt((/^\s*(\d+)/.exec(sec.bgpx || '') || [])[1] || '0', 10);
  }
}

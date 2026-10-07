class AtlasSpritesheet {
  // opts.renderer: draw frames from code (render/Emblems.js); the JSON then
  //   only holds animation timing.  opts.image: an already-drawn canvas.
  constructor(name, imageUrl, jsonData, opts = {}) {
    this.spritesheetName = name;
    this.renderer = opts.renderer || null;
    if (opts.image || !imageUrl) {
      this.image = opts.image || document.createElement('canvas');
      this.image.complete = true;
      this.image.naturalWidth = this.image.width || 1;
    } else {
      this.image = new Image();
      this.image.decoding = 'async';
      // Prefer the WebP copy; fall back to the PNG if the browser can't decode it.
      const webp = imageUrl.replace(/\.png$/, '.webp');
      if (webp !== imageUrl) {
        this.image.onerror = () => { this.image.onerror = null; this.image.src = imageUrl; };
        this.image.src = webp;
      } else {
        this.image.src = imageUrl;
      }
    }
    this.frames = {};
    this.animationMap = {};  // name -> { fps, frames: [frameKey, ...], offset?: [x, y] }
    this.animationNames = []; // Object.keys(animationMap), cached (used every frame)
    this.setOrigins = {};
    this.ready = false;

    const load = (data) => {
      const rawFrames = data.frames || {};
      this.frames = rawFrames;
      for (const anim of (data.animations || [])) {
        const frames = typeof anim.frames === 'number' ? [...Array(anim.frames).keys()] : anim.frames;
        this.animationMap[anim.name] = { fps: anim.fps, frames, offset: anim.offset || null, pinned: anim.pinned || false };
      }
      this.animationNames = Object.keys(this.animationMap);
      this.tileAnimations = data.tileAnimations || {};
      this.setOrigins = data.set_origins || {};
      this.ready = true;
    };

    if (typeof jsonData === 'object' && jsonData !== null) {
      // Inline data — synchronous, no fetch needed.
      load(jsonData);
    } else {
      // URL string — fetch asynchronously.
      fetch(jsonData)
        .then(r => r.json())
        .then(load)
        .catch(err => { this.failed = true; console.error(`[Atlas] failed to load ${name}:`, err); });
    }
  }

  getAnimation(name) {
    return this.animationMap[name] || null;
  }

  // Returns { x, y, w, h, origin, tx, ty, sw, sh } for a given animation frame.
  // origin is the single {ox, oy} anchor from set_origins (or a sensible default).
  //
  // Trimmed sheets (tools/trim-atlases.py) store only the opaque part of each
  // frame: sw×sh is the original frame size and (tx, ty) where the stored
  // pixels sat inside it. The origin is shifted to match, so drawing at
  // -origin with w×h puts every pixel exactly where the untrimmed frame did.
  // Results are cached: this runs several times per player per frame.
  getFrameData(animName, frameIndex) {
    const anim = this.animationMap[animName];
    if (!anim || !anim.frames.length) return null;
    const i = Math.max(0, frameIndex) % anim.frames.length;
    const cache = anim._fd || (anim._fd = []);
    if (cache[i] !== undefined) return cache[i];
    const key = anim.frames[i];
    if (this.renderer) return (cache[i] = AtlasSpritesheet.NO_FRAME);
    const raw = this.frames[key];
    if (!raw) return (cache[i] = null);

    // Support both {x,y,w,h} and {frame:{x,y,w,h}} formats
    const f = (raw.frame !== undefined) ? raw.frame : raw;
    const tx = raw.tx || 0, ty = raw.ty || 0;
    const sw = raw.sw || f.w, sh = raw.sh || f.h;
    const so = this.setOrigins[animName] || {};
    // Single origin — falls back to per-frame baked origin then center-bottom
    const o = (so.ox != null) ? so : (raw.origin || { ox: Math.round(sw / 2), oy: Math.round(sh * 0.95) });
    const origin = (tx || ty) ? { ox: o.ox - tx, oy: o.oy - ty } : o;

    return (cache[i] = { x: f.x, y: f.y, w: f.w, h: f.h, origin, tx, ty, sw, sh });
  }

  // Returns tile frame {x,y,w,h} from the map atlas by 3-char tile key (e.g. "0B0").
  getMapTileFrame(tileKey) {
    const key = tileKey + '.png';
    const raw = this.frames[key];
    if (!raw) return null;
    return (raw.frame !== undefined) ? raw.frame : raw;
  }

  // Like getMapTileFrame but advances through animation frames using a wall-clock
  // timestamp (milliseconds, as supplied by requestAnimationFrame).
  getAnimatedMapTileFrame(tileKey, nowMs) {
    const anim = this.tileAnimations[tileKey];
    let key;
    if (anim && anim.frames.length > 1) {
      const frameIndex = Math.floor((nowMs / 1000) * anim.fps) % anim.frames.length;
      key = anim.frames[frameIndex];
    } else {
      key = tileKey + '.png';
    }
    const raw = this.frames[key];
    if (!raw) return null;
    return (raw.frame !== undefined) ? raw.frame : raw;
  }
}

// Singleton indicator (spinner) atlas
AtlasSpritesheet.NO_FRAME = Object.freeze({ x: 0, y: 0, w: 1, h: 1, origin: { ox: 0, oy: 0 }, tx: 0, ty: 0, sw: 1, sh: 1 });

// Stick Clash's own spinners (64, tinted per player), cursors, blood and heart.
const indicatorAtlas = (() => {
  const { canvas, data } = Emblems.buildSpinnerSheet();
  return new AtlasSpritesheet('indicator', null, data, { image: canvas });
})();

// Singleton player atlas loaded once
const playerAtlas = new AtlasSpritesheet(
  'player',
  'sprites/player/spritesheet.png',
  'sprites/player/spritesheet.json'
);

// Singleton death atlas loaded once
const deathAtlas = new AtlasSpritesheet(
  'death',
  'sprites/death/spritesheet.png',
  'sprites/death/spritesheet.json'
);

// Singleton pickup atlas loaded once
const pickupAtlas = new AtlasSpritesheet(
  'pickup',
  'sprites/pickup/spritesheet.png',
  'sprites/pickup/spritesheet.json'
);

// Singleton heartbeat atlas (HUD health indicator)
const heartbeatAtlas = new AtlasSpritesheet('heartbeat', null, { animations: Emblems.HEART_ANIMS }, { renderer: Emblems.heart });

// Singleton blood atlas loaded once
const bloodAtlas = new AtlasSpritesheet('blood', null, { animations: Emblems.BLOOD_ANIMS }, { renderer: Emblems.blood });

// Singleton map atlas loaded once
// Map tiles: only the animated water of the painted Stick Clash maps (the
// rest of each map is its background picture).
const mapAtlas = new AtlasSpritesheet('map', 'sprites/maps/water.png', 'sprites/maps/water.json');

const cursorAtlas = (() => {
  const { canvas, data } = Emblems.buildCursorSheet();
  return new AtlasSpritesheet('cursor', null, data, { image: canvas });
})();

// Singleton particle atlas — muzzle flash / shoot effect sprites
const particleAtlas = new AtlasSpritesheet(
  'particles',
  'sprites/particles/spritesheet.png',
  'sprites/particles/spritesheet.json'
);

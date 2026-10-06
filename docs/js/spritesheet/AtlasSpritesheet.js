// A sprite sheet: named animations (fps + frame list) plus either an image
// with frame rectangles, or a code renderer that draws any animation at a
// given progress (see render/StickFigure.js, render/Emblems.js).
//
//   new AtlasSpritesheet(name, imageUrl, json, opts)
//     json        object or URL: { frames, animations: [{name, fps, frames, offset?, pinned?}],
//                 set_origins?, tileAnimations? }; `frames` of an animation may
//                 be a count (frames 0…n-1) or a list of frame keys
//     opts.renderer  draw from code; the JSON then only carries timing
//     opts.image     an already-drawn canvas to use as the sheet
class AtlasSpritesheet {
  constructor(name, imageUrl, jsonData, opts = {}) {
    this.spritesheetName = name;
    this.renderer = opts.renderer || null;
    this.image = AtlasSpritesheet._sheetImage(imageUrl, opts.image);
    this.frames = {};
    this.animationMap = {};      // name → { fps, frames, offset, pinned }
    this.animationNames = [];
    this.setOrigins = {};
    this.tileAnimations = {};
    this.ready = false;
    if (jsonData && typeof jsonData === 'object') {
      this._load(jsonData);
    } else {
      fetch(jsonData).then(r => r.json()).then(d => this._load(d)).catch(err => {
        this.failed = true;
        console.error(`[Atlas] failed to load ${name}:`, err);
      });
    }
  }

  // A canvas (given or blank) behaves like a loaded image; image files are
  // fetched as WebP first, falling back to the PNG.
  static _sheetImage(url, given) {
    if (given || !url) {
      const c = given || document.createElement('canvas');
      c.complete = true;
      c.naturalWidth = c.width || 1;
      return c;
    }
    const img = new Image();
    img.decoding = 'async';
    const webp = url.replace(/\.png$/, '.webp');
    if (webp !== url) img.onerror = () => { img.onerror = null; img.src = url; };
    img.src = webp;
    return img;
  }

  _load(data) {
    this.frames = data.frames || {};
    for (const a of data.animations || []) {
      const frames = typeof a.frames === 'number' ? [...Array(a.frames).keys()] : a.frames;
      this.animationMap[a.name] = { fps: a.fps, frames, offset: a.offset || null, pinned: a.pinned || false };
    }
    this.animationNames = Object.keys(this.animationMap);
    this.tileAnimations = data.tileAnimations || {};
    this.setOrigins = data.set_origins || {};
    this.ready = true;
  }

  getAnimation(name) {
    return this.animationMap[name] || null;
  }

  // Drawing data of one frame: source rect, origin (pivot) and, for trimmed
  // frames, where the kept part sits in the untrimmed frame (tx, ty, sw, sh).
  // Results are cached per animation.
  getFrameData(animName, frameIndex) {
    const anim = this.animationMap[animName];
    if (!anim || !anim.frames.length) return null;
    const i = Math.max(0, frameIndex) % anim.frames.length;
    const cache = anim._fd || (anim._fd = []);
    if (cache[i] === undefined) cache[i] = this._frameData(animName, anim.frames[i]);
    return cache[i];
  }

  _frameData(animName, key) {
    if (this.renderer) return AtlasSpritesheet.NO_FRAME;
    const raw = this.frames[key];
    if (!raw) return null;
    const rect = raw.frame !== undefined ? raw.frame : raw;
    const tx = raw.tx || 0, ty = raw.ty || 0;
    const sw = raw.sw || rect.w, sh = raw.sh || rect.h;
    const set = this.setOrigins[animName] || {};
    const base = set.ox != null ? set : (raw.origin || { ox: Math.round(sw / 2), oy: Math.round(sh * 0.95) });
    const origin = tx || ty ? { ox: base.ox - tx, oy: base.oy - ty } : base;
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, origin, tx, ty, sw, sh };
  }

  _rect(key) {
    const raw = this.frames[key];
    return raw ? (raw.frame !== undefined ? raw.frame : raw) : null;
  }

  getMapTileFrame(tileKey) {
    return this._rect(tileKey + '.png');
  }

  // Animated map tiles (water) step through their frames on the wall clock.
  getAnimatedMapTileFrame(tileKey, nowMs) {
    const anim = this.tileAnimations[tileKey];
    if (!anim || anim.frames.length <= 1) return this._rect(tileKey + '.png');
    return this._rect(anim.frames[Math.floor((nowMs / 1000) * anim.fps) % anim.frames.length]);
  }
}

AtlasSpritesheet.NO_FRAME = Object.freeze({ x: 0, y: 0, w: 1, h: 1, origin: { ox: 0, oy: 0 }, tx: 0, ty: 0, sw: 1, sh: 1 });

// ── The game's sheets ────────────────────────────────────────────────────────
const fromCanvas = (name, build) => {
  const { canvas, data } = build();
  return new AtlasSpritesheet(name, null, data, { image: canvas });
};

const indicatorAtlas = fromCanvas('indicator', Emblems.buildSpinnerSheet);   // spinners (tinted per player)
const playerAtlas = new AtlasSpritesheet('player', null, 'data/anims/player.json', { renderer: StickFigure.body });
const deathAtlas = new AtlasSpritesheet('death', null, 'data/anims/death.json', { renderer: StickFigure.death });
const pickupAtlas = fromCanvas('pickup', WeaponArt.buildPickupSheet);
const heartbeatAtlas = new AtlasSpritesheet('heartbeat', null, { animations: Emblems.HEART_ANIMS }, { renderer: Emblems.heart });
const bloodAtlas = new AtlasSpritesheet('blood', null, { animations: Emblems.BLOOD_ANIMS }, { renderer: Emblems.blood });
const mapAtlas = new AtlasSpritesheet('map', 'sprites/maps/atlas.png', 'sprites/maps/atlas.json');   // animated water
const cursorAtlas = fromCanvas('cursor', Emblems.buildCursorSheet);
const particleAtlas = new AtlasSpritesheet('particles', null, 'data/anims/particles.json', { renderer: StickFigure.particles });

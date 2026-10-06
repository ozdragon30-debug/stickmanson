// Modern render-only effects: soft shadows, weapon glow, muzzle light, hit
// flash and pickup halos. Everything is drawn from small sprites
// rendered once (no per-frame canvas blur, gradients or filters, which made
// phones stutter). Everything here only changes how things are
// *drawn*: no positions, timings, hit shapes or game state are read back from it,
// so gameplay is identical with effects on or off (Settings → Video).

// Per-weapon light colour (r, g, b); weapons not listed cast no muzzle light.
const FX_MUZZLE = {
  glock:        [255, 196, 110],
  shotgun:      [255, 180, 90],
  ak47:         [255, 190, 100],
  chaingun:     [255, 186, 96],
  flamethrower: [255, 120, 40],
  railgun:      [120, 200, 255],
  tesla_helmet: [140, 170, 255],
};

// Weapons that cast a permanent coloured energy light while held.
const FX_GLOW = {
  laser_sword:  [255, 70, 70],
  railgun:      [90, 190, 255],
  tesla_helmet: [130, 160, 255],
};

// Pickup halo colours by weapon class.
const FX_PICKUP = {
  bat: [200, 200, 210], chainsaw: [255, 170, 60], katana: [220, 230, 255],
  sledgehammer: [200, 200, 210], laser_sword: [255, 80, 80],
  glock: [120, 220, 140], shotgun: [120, 220, 140], ak47: [120, 220, 140],
  chaingun: [255, 210, 90], flamethrower: [255, 120, 40],
  railgun: [90, 190, 255], tesla_helmet: [140, 160, 255],
};

// Small pre-rendered radial sprites, created on first use.
function fxSprite(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  cx.fillStyle = g;
  cx.fillRect(0, 0, size, size);
  return c;
}

const fx = {
  _lights: Object.create(null),
  _shadow: null,

  // On unless the player turned it off.
  get enabled() {
    return typeof settingsManager === 'undefined' || settingsManager.get('modernFx') !== false;
  },

  // Soft contact shadow under a character or object (light from the top-left).
  shadow(ctx, x, y, radius, alpha = 1) {
    if (!this._shadow) {
      this._shadow = fxSprite(64, [[0, 'rgba(0,0,0,0.5)'], [0.55, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._shadow, x - radius, y - radius * 0.8, radius * 2, radius * 1.6);
    ctx.restore();
  },

  // Additive coloured light pool (muzzle flashes, energy weapons, halos).
  light(ctx, x, y, radius, rgb, alpha) {
    if (alpha <= 0) return;
    const key = rgb.join(',');
    let spr = this._lights[key];
    if (!spr) {
      spr = this._lights[key] = fxSprite(128, [
        [0, `rgba(${key},1)`], [0.35, `rgba(${key},0.45)`], [1, `rgba(${key},0)`],
      ]);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(spr, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  },

  // HSL hue (s 80%, l 60%) → [r, g, b], matching the name-tag colours.
  hueRgb(h) {
    const s = 0.8, l = 0.6;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return [f(0), f(8), f(4)];
  },
};

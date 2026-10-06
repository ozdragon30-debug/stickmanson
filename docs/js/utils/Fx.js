// Modern render-only effects: soft shadows, weapon glow, muzzle light, hit rim,
// pickup halos and a vignette. Everything here only changes how things are
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

// Weapons whose sprite gets a permanent energy glow while held.
const FX_GLOW = {
  laser_sword:  'rgba(255,70,70,0.85)',
  railgun:      'rgba(90,190,255,0.7)',
  tesla_helmet: 'rgba(130,160,255,0.75)',
};

// Pickup halo colours by weapon class.
const FX_PICKUP = {
  bat: [200, 200, 210], chainsaw: [255, 170, 60], katana: [220, 230, 255],
  sledgehammer: [200, 200, 210], laser_sword: [255, 80, 80],
  glock: [120, 220, 140], shotgun: [120, 220, 140], ak47: [120, 220, 140],
  chaingun: [255, 210, 90], flamethrower: [255, 120, 40],
  railgun: [90, 190, 255], tesla_helmet: [140, 160, 255],
};

const fx = {
  _vignette: null,
  _vignetteKey: '',

  // On unless the player turned it off. Slow devices (adaptive resolution
  // already stepped down) keep the cheap effects but skip blurred shadows.
  get enabled() {
    return typeof settingsManager === 'undefined' || settingsManager.get('modernFx') !== false;
  },
  get lite() {
    return typeof display !== 'undefined' && display.dynamicCap !== Infinity;
  },

  // Device pixels per world unit for the current transform (shadow offsets and
  // blur are applied in device space, so they must be scaled by hand).
  _px(ctx) {
    const m = ctx.getTransform();
    return Math.hypot(m.a, m.b) || 1;
  },

  // Light comes from the top-left: shadows fall down-right.
  setShadow(ctx, strength = 1) {
    const s = this._px(ctx);
    ctx.shadowColor = `rgba(0,0,0,${0.55 * strength})`;
    ctx.shadowOffsetX = 4 * s;
    ctx.shadowOffsetY = 6 * s;
    ctx.shadowBlur = this.lite ? 0 : 6 * s;
  },

  setGlow(ctx, color, radius) {
    const s = this._px(ctx);
    ctx.shadowColor = color;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    ctx.shadowBlur = radius * s;
  },

  clearShadow(ctx) {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  },

  // Additive radial light pool (muzzle flashes, energy weapons).
  light(ctx, x, y, radius, rgb, alpha) {
    if (alpha <= 0) return;
    const [r, g, b] = rgb;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    grad.addColorStop(0.35, `rgba(${r},${g},${b},${alpha * 0.45})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
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

  // Screen-space vignette over the world (under the HUD). Cached per size.
  vignette(ctx) {
    const key = `${VIEW_W}x${VIEW_H}`;
    if (this._vignetteKey !== key) {
      const r = Math.hypot(VIEW_W, VIEW_H) / 2;
      const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, r * 0.55, VIEW_W / 2, VIEW_H / 2, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.38)');
      this._vignette = g;
      this._vignetteKey = key;
    }
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  },
};

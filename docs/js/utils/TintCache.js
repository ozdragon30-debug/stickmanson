// TintCache – pre-computes hue-tinted copies of sprite frames.
//
// The spinner indicator used `ctx.filter = 'sepia(1) saturate(5) hue-rotate(Hdeg)'`
// every frame for every player. Canvas filters are slow (a full offscreen pass per
// draw) and unsupported in some browsers (e.g. older Safari, where spinners lost
// their colour). Here the exact same CSS filter colour matrices are applied once
// per (frame, hue) on the CPU and cached, so drawing is a plain drawImage.

class TintCache {
  constructor() {
    this.cache = new Map();
    this.maxEntries = 2048;
  }

  static _mul(m, r, g, b) {
    return [
      m[0] * r + m[1] * g + m[2] * b,
      m[3] * r + m[4] * g + m[5] * b,
      m[6] * r + m[7] * g + m[8] * b,
    ];
  }

  static _clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  // Filter Effects spec matrices for sepia(1), saturate(5), hue-rotate(deg).
  static _matrices(hueDeg) {
    const sepia = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
    const s = 5;
    const sat = [
      0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
      0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
      0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
    ];
    const a = hueDeg * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
    const hue = [
      0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928,
      0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283,
      0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072,
    ];
    return [sepia, sat, hue];
  }

  // Returns { canvas, x, y } holding the tinted frame f = {x, y, w, h} of atlas.image.
  get(atlas, f, hueDeg) {
    const hue = Math.round(hueDeg) % 360;
    const key = `${atlas.spritesheetName}|${f.x},${f.y},${f.w},${f.h}|${hue}`;
    let hit = this.cache.get(key);
    if (hit) return hit;
    // Don't bake (and cache forever) a blank frame while the atlas is still loading.
    if (!atlas.image.complete || !atlas.image.naturalWidth) return null;

    const c = document.createElement('canvas');
    c.width = Math.max(1, f.w);
    c.height = Math.max(1, f.h);
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(atlas.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    try {
      const img = cx.getImageData(0, 0, c.width, c.height);
      const d = img.data;
      const mats = TintCache._matrices(hue);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        let r = d[i], g = d[i + 1], b = d[i + 2];
        for (const m of mats) {
          [r, g, b] = TintCache._mul(m, r, g, b);
          r = TintCache._clamp(r); g = TintCache._clamp(g); b = TintCache._clamp(b);
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      cx.putImageData(img, 0, 0);
    } catch (e) {
      // Tainted canvas (file:// on some browsers) – fall back to the GPU filter.
      cx.clearRect(0, 0, c.width, c.height);
      cx.filter = `sepia(1) saturate(5) hue-rotate(${hue}deg)`;
      cx.drawImage(atlas.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    }

    if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value);
    hit = { canvas: c, x: 0, y: 0 };
    this.cache.set(key, hit);
    return hit;
  }
}

const tintCache = new TintCache();

// Spinners, cursors, blood splats and the HUD heart, drawn from code (no
// image files), all original designs.
//
// Spinners are drawn in greys so TintCache can colour them with the player's
// hue; they are single frames that the game rotates. Blood and the heart are
// renderers (draw(ctx, anim, p)) driven by the usual animation timing.

const Emblems = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const easeOut = u => 1 - Math.pow(1 - u, 3);
  const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = seed => () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return seed / 4294967296; };

  // ── Spinners ──────────────────────────────────────────────────────────────
  const SPIN = 96, R = 40;
  const INK = 'rgba(20,20,22,0.9)';
  function shade(c, r0, r1) {
    const g = c.createRadialGradient(0, 0, r0, 0, 0, r1);
    g.addColorStop(0, '#bdbdbd'); g.addColorStop(0.55, '#9a9a9a'); g.addColorStop(1, '#6e6e6e');
    return g;
  }
  function finish(c, fill, lw = 1.4) {
    c.fillStyle = fill; c.fill();
    c.lineWidth = lw; c.strokeStyle = INK; c.stroke();
  }

  // One ring of a spinner. f = family, n = count, r = radius, s = size factor.
  function ring(c, f, n, r, s) {
    const fill = shade(c, r * 0.4, r * 1.1);
    for (let k = 0; k < n; k++) {
      c.save(); c.rotate(k * TAU / n);
      c.beginPath();
      switch (f) {
        case 0:   // beads
          c.arc(0, -r, 4.5 * s, 0, TAU); break;
        case 1: { // curved blades
          c.moveTo(0, -r * 0.45);
          c.quadraticCurveTo(r * 0.55, -r * 0.75, r * 0.2, -r);
          c.quadraticCurveTo(r * 0.3, -r * 0.7, -2 * s, -r * 0.45);
          break;
        }
        case 2: { // arc segments
          const a = TAU / n * 0.32;
          c.arc(0, 0, r, -Math.PI / 2 - a, -Math.PI / 2 + a);
          c.arc(0, 0, r - 6 * s, -Math.PI / 2 + a, -Math.PI / 2 - a, true);
          c.closePath(); break;
        }
        case 3:   // arrowheads chasing each other
          c.moveTo(9 * s, -r); c.lineTo(-6 * s, -r - 6 * s); c.lineTo(-2 * s, -r); c.lineTo(-6 * s, -r + 6 * s); c.closePath(); break;
        case 4:   // star points
          c.moveTo(0, -r); c.lineTo(5 * s, -r * 0.62); c.lineTo(-5 * s, -r * 0.62); c.closePath(); break;
        case 5:   // gear teeth (ring drawn below)
          c.rect(-3.5 * s, -r - 5 * s, 7 * s, 8 * s); break;
        case 6: { // comets
          c.arc(0, -r, 4 * s, 0, TAU);
          c.moveTo(0, -r - 4 * s);
          c.arc(0, 0, r + 4 * s, -Math.PI / 2, -Math.PI / 2 - 0.55, true);
          c.arc(0, 0, r - 1, -Math.PI / 2 - 0.55, -Math.PI / 2, false);
          break;
        }
        case 7:   // chevrons
          c.moveTo(-7 * s, -r + 5 * s); c.lineTo(0, -r - 3 * s); c.lineTo(7 * s, -r + 5 * s);
          c.lineTo(7 * s, -r + 10 * s); c.lineTo(0, -r + 2 * s); c.lineTo(-7 * s, -r + 10 * s); c.closePath(); break;
      }
      finish(c, fill);
      c.restore();
    }
    if (f === 5 || f === 6) {           // gear body / comet track
      c.beginPath(); c.arc(0, 0, r, 0, TAU);
      if (f === 5) { c.arc(0, 0, r - 5 * s, 0, TAU, true); finish(c, fill); }
      else { c.lineWidth = 1.2; c.strokeStyle = 'rgba(160,160,160,0.6)'; c.stroke(); }
    }
  }

  const COUNTS = [3, 4, 5, 6, 3, 8, 4, 6];
  function spinner(c, i) {
    const f = i % 8, v = i >> 3;
    const n = f === 5 ? 10 + v : COUNTS[(v + f) % 8];
    const tier = i < 4 ? 0 : i < 28 ? 1 : i < 48 ? 2 : 3;
    if (tier === 3) {                                  // soft halo
      const g = c.createRadialGradient(0, 0, R * 0.55, 0, 0, R + 6);
      g.addColorStop(0, 'rgba(200,200,200,0)'); g.addColorStop(0.75, 'rgba(210,210,210,0.35)'); g.addColorStop(1, 'rgba(210,210,210,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, R + 6, 0, TAU); c.fill();
    }
    ring(c, f, n, R - 4, 1 + (v % 3) * 0.12);
    if (tier >= 2) {                                   // counter ring inside
      c.save(); c.rotate(Math.PI / n);
      ring(c, (f + 3) % 8, Math.max(3, n - 1), R * 0.62, 0.7);
      c.restore();
    }
    if (tier === 3) {                                  // core sparks
      c.save(); c.rotate(0.3);
      ring(c, (f + 5) % 8, 3, R * 0.34, 0.5);
      c.restore();
    }
  }

  function buildSpinnerSheet() {
    const COLS = 8, N = 64;
    const canvas = document.createElement('canvas');
    canvas.width = COLS * SPIN; canvas.height = Math.ceil(N / COLS) * SPIN;
    const c = canvas.getContext('2d');
    const frames = {}, animations = [];
    for (let i = 0; i < N; i++) {
      const x = (i % COLS) * SPIN, y = Math.floor(i / COLS) * SPIN;
      c.save(); c.translate(x + SPIN / 2, y + SPIN / 2); spinner(c, i); c.restore();
      const name = 'spinner_' + String(i).padStart(2, '0');
      frames[name + '_0'] = { x, y, w: SPIN, h: SPIN };
      animations.push({ name, fps: 24, frames: [name + '_0'] });
    }
    return { canvas, data: { frames, animations } };
  }

  // ── Cursors ───────────────────────────────────────────────────────────────
  const CUR = 34;
  const CURSORS = [
    c => { plus(c, 4, 11); dot(c, 1.6); },
    c => { circ(c, 9); dot(c, 1.8, '#ff4a4a'); },
    c => { for (let k = 0; k < 4; k++) { c.save(); c.rotate(k * Math.PI / 2); stroke(c, [[-11, -6], [-11, -11], [-6, -11]]); c.restore(); } dot(c, 1.5); },
    c => { stroke(c, [[0, -10], [9, 6], [-9, 6]], true); dot(c, 1.5, '#4af0ff'); },
    c => { circ(c, 3.2); },
    c => { c.save(); c.rotate(Math.PI / 4); plus(c, 3, 10); c.restore(); },
    c => { circ(c, 10); plus(c, 7, 14); },
    c => { stroke(c, [[0, -10], [10, 0], [0, 10], [-10, 0]], true); dot(c, 1.5); },
    c => { circ(c, 11); circ(c, 5); },
    c => { circ(c, 12); plus(c, 1, 15); dot(c, 1.6, '#ff4a4a'); },
    c => { for (let k = 0; k < 4; k++) { c.save(); c.rotate(k * Math.PI / 2); stroke(c, [[-4, -13], [0, -8], [4, -13]]); c.restore(); } },
    c => { stroke(c, [[-5, -11], [-11, -11], [-11, 11], [-5, 11]]); stroke(c, [[5, -11], [11, -11], [11, 11], [5, 11]]); dot(c, 1.8, '#7dff6a'); },
  ];
  function outlined(c, draw) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineWidth = 4.2; draw(); c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 1.8; draw(); c.stroke();
  }
  function plus(c, gap, len) {
    outlined(c, () => { c.beginPath(); for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(x * gap, y * gap); c.lineTo(x * len, y * len); } });
  }
  function circ(c, r) { outlined(c, () => { c.beginPath(); c.arc(0, 0, r, 0, TAU); }); }
  function stroke(c, pts, close) {
    outlined(c, () => { c.beginPath(); pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); if (close) c.closePath(); });
  }
  function dot(c, r, col = '#fff') {
    c.beginPath(); c.arc(0, 0, r + 1.2, 0, TAU); c.fillStyle = 'rgba(0,0,0,0.85)'; c.fill();
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = col; c.fill();
  }

  function buildCursorSheet() {
    const canvas = document.createElement('canvas');
    canvas.width = CURSORS.length * CUR; canvas.height = CUR;
    const c = canvas.getContext('2d');
    const frames = {}, animations = [];
    CURSORS.forEach((draw, i) => {
      c.save(); c.translate(i * CUR + CUR / 2, CUR / 2); draw(c); c.restore();
      const name = 'cursor_' + String(i).padStart(2, '0');
      frames[name + '_0'] = { x: i * CUR, y: 0, w: CUR, h: CUR };
      animations.push({ name, fps: 12, frames: [name + '_0'] });
    });
    return { canvas, data: { frames, animations } };
  }

  // ── Blood ─────────────────────────────────────────────────────────────────
  // Names keep the weapon families: bullet / shotgun / bat / knife / sword.
  const BLOOD_ANIMS = ['blood_bullet_0', 'blood_bullet_1', 'blood_bullet_2', 'blood_shotgun_0', 'blood_shotgun_1',
    'blood_shotgun_2', 'blood_bat_0', 'blood_bat_1', 'blood_knife_0', 'blood_sword_0']
    .map(name => ({ name, fps: 12, frames: 12 }));
  const BLOOD = { bullet: [10, 34, 2.2], shotgun: [18, 46, 2.4], bat: [14, 40, 3.2], knife: [9, 30, 2], sword: [12, 44, 2.4] };
  const bloodCache = {};
  function bloodSpec(anim) {
    if (bloodCache[anim]) return bloodCache[anim];
    const r = rng(hashStr(anim)), [n, reach, size] = BLOOD[anim.split('_')[1]] || BLOOD.bullet;
    const slash = /knife|sword/.test(anim), dir = r() * TAU;
    const drops = [];
    for (let k = 0; k < n; k++) {
      const a = slash ? dir + (r() - 0.5) * 0.9 + (k % 2 ? Math.PI : 0) : r() * TAU;
      drops.push({ a, d: reach * (0.35 + r() * 0.65), s: size * (0.5 + r()), e: 1 + r() * 1.6 });
    }
    return (bloodCache[anim] = { drops, core: size * 3.2 });
  }
  const blood = {
    draw(c, anim, p) {
      const { drops, core } = bloodSpec(anim);
      const out = easeOut(seg(p, 0, 0.35)), fade = 1 - seg(p, 0.55, 1);
      if (fade <= 0) return;
      c.save();
      c.globalAlpha = fade;
      c.fillStyle = '#7d0a0a';
      c.beginPath(); c.arc(0, 0, core * (0.6 + 0.4 * out), 0, TAU); c.fill();
      for (const d of drops) {
        const x = Math.cos(d.a) * d.d * out, y = Math.sin(d.a) * d.d * out;
        c.save(); c.translate(x, y); c.rotate(d.a);
        c.beginPath(); c.ellipse(0, 0, d.s * d.e, d.s, 0, 0, TAU);
        c.fillStyle = '#9e1111'; c.fill();
        c.restore();
      }
      c.fillStyle = 'rgba(230,60,60,0.55)';
      c.beginPath(); c.arc(-core * 0.25, -core * 0.25, core * 0.35 * (0.6 + 0.4 * out), 0, TAU); c.fill();
      c.restore();
    },
  };

  // ── HUD heart ─────────────────────────────────────────────────────────────
  const HEART_ANIMS = [
    { name: 'heartbeat_healthy', fps: 28, frames: 28 },
    { name: 'heartbeat_impacted', fps: 36, frames: 36 },
    { name: 'heartbeat_critical', fps: 64, frames: 64 },
  ];
  const BEATS = { heartbeat_healthy: 1, heartbeat_impacted: 1.5, heartbeat_critical: 2.5 };
  function heartPath(c, s) {
    c.beginPath();
    c.moveTo(0, 7 * s);
    c.bezierCurveTo(-13 * s, -1 * s, -9 * s, -12 * s, 0, -5 * s);
    c.bezierCurveTo(9 * s, -12 * s, 13 * s, -1 * s, 0, 7 * s);
    c.closePath();
  }
  const heart = {
    draw(c, anim, p) {
      const beats = BEATS[anim] || 1, crit = anim === 'heartbeat_critical';
      const ph = (p * beats) % 1;
      const pulse = Math.max(0, Math.sin(seg(ph, 0, 0.18) * Math.PI)) + 0.6 * Math.max(0, Math.sin(seg(ph, 0.22, 0.38) * Math.PI));
      const s = 1 + 0.16 * pulse;
      const g = c.createLinearGradient(0, -10, 0, 8);
      g.addColorStop(0, crit ? '#ff6a6a' : '#ff4d4d'); g.addColorStop(1, crit ? '#7a0000' : '#a30d0d');
      heartPath(c, s);
      c.fillStyle = g; c.fill();
      c.lineWidth = 1.6; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.stroke();
      c.beginPath(); c.ellipse(-4.5 * s, -4 * s, 2.6 * s, 1.6 * s, -0.6, 0, TAU);
      c.fillStyle = 'rgba(255,255,255,0.55)'; c.fill();
    },
  };

  return { buildSpinnerSheet, buildCursorSheet, blood, BLOOD_ANIMS, heart, HEART_ANIMS };
})();

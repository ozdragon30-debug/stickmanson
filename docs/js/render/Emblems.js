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
    g.addColorStop(0, '#6e6e6e'); g.addColorStop(0.55, '#363636'); g.addColorStop(1, '#181818');
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

  // Figurative motifs (drawn upright in a ~20 px box, centred, "up" = -Y),
  // shaded in greys so the player's hue tints them; outlined for contrast.
  function metal(c, r) {
    const g = c.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#787878'); g.addColorStop(0.4, '#3c3c3c'); g.addColorStop(1, '#161616');
    return g;
  }
  function done(c, r, lw = 1.3) {
    c.fillStyle = metal(c, r); c.fill();
    c.lineWidth = lw; c.strokeStyle = INK; c.lineJoin = 'round'; c.stroke();
  }
  function shine(c, x, y, rx, ry, a = -0.6) {
    c.beginPath(); c.ellipse(x, y, rx, ry, a, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.55)'; c.fill();
  }
  function hole(c, x, y, rx, ry = rx) {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fillStyle = 'rgba(25,25,28,0.92)'; c.fill();
  }
  const MOTIFS = {
    star(c) {
      c.beginPath();
      for (let k = 0; k < 10; k++) { const r = k % 2 ? 4.2 : 10, a = k * Math.PI / 5; c.lineTo(Math.sin(a) * r, -Math.cos(a) * r); }
      c.closePath(); done(c, 10); shine(c, -2, -3, 2.2, 1.2);
    },
    heart(c) {
      c.beginPath(); c.moveTo(0, 8);
      c.bezierCurveTo(-12, 0, -8, -11, 0, -4.5); c.bezierCurveTo(8, -11, 12, 0, 0, 8);
      done(c, 10); shine(c, -4, -4, 2.4, 1.4);
    },
    skull(c) {
      c.beginPath(); c.arc(0, -2, 8.5, Math.PI * 0.85, Math.PI * 0.15);
      c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); done(c, 9);
      hole(c, -3.2, -1.5, 2.6, 3); hole(c, 3.2, -1.5, 2.6, 3);
      c.beginPath(); c.moveTo(0, 2); c.lineTo(-1.3, 4); c.lineTo(1.3, 4); c.closePath(); c.fillStyle = 'rgba(25,25,28,0.9)'; c.fill();
      for (const x of [-2.5, 0, 2.5]) { c.beginPath(); c.moveTo(x, 6); c.lineTo(x, 8.5); c.strokeStyle = INK; c.lineWidth = 1; c.stroke(); }
      shine(c, -3.5, -7, 2.4, 1.2);
    },
    flame(c) {
      c.beginPath(); c.moveTo(0, 9);
      c.bezierCurveTo(-9, 7, -8, -2, -2, -6); c.bezierCurveTo(-2, -2, 0, -1, 1, -3);
      c.bezierCurveTo(1, -7, 3, -9, 2, -11); c.bezierCurveTo(9, -5, 9, 6, 0, 9);
      done(c, 10);
      c.beginPath(); c.moveTo(0, 7); c.bezierCurveTo(-4, 5, -3, 0, 0, -2); c.bezierCurveTo(3, 1, 4, 5, 0, 7);
      c.fillStyle = 'rgba(255,255,255,0.65)'; c.fill();
    },
    bolt(c) {
      c.beginPath(); c.moveTo(3, -11); c.lineTo(-6, 1); c.lineTo(-0.5, 1); c.lineTo(-3, 11); c.lineTo(6, -2); c.lineTo(0.5, -2); c.closePath();
      done(c, 10); shine(c, 0, -6, 1.2, 2.4, 0.5);
    },
    leaf(c) {
      c.beginPath(); c.moveTo(0, 10); c.quadraticCurveTo(-10, 0, 0, -10); c.quadraticCurveTo(10, 0, 0, 10); done(c, 10);
      c.beginPath(); c.moveTo(0, 9); c.lineTo(0, -8);
      for (const y of [-4, 0, 4]) { c.moveTo(0, y + 2); c.lineTo(-4, y - 1); c.moveTo(0, y + 2); c.lineTo(4, y - 1); }
      c.strokeStyle = 'rgba(30,30,32,0.7)'; c.lineWidth = 0.9; c.stroke();
    },
    crown(c) {
      c.beginPath(); c.moveTo(-9, 6); c.lineTo(-10, -6); c.lineTo(-5, -1); c.lineTo(0, -9); c.lineTo(5, -1); c.lineTo(10, -6); c.lineTo(9, 6); c.closePath();
      done(c, 10); c.beginPath(); c.rect(-9, 3, 18, 4); done(c, 9, 1);
      for (const [x, y] of [[-10, -6], [0, -9], [10, -6]]) { c.beginPath(); c.arc(x, y, 1.8, 0, TAU); c.fillStyle = '#fff'; c.fill(); }
      hole(c, 0, 5, 1.4);
    },
    wing(c) {
      c.beginPath(); c.moveTo(-8, 8); c.bezierCurveTo(-10, -4, 0, -11, 10, -10);
      c.bezierCurveTo(7, -6, 8, -4, 5, -2); c.bezierCurveTo(6, 0, 5, 2, 2, 3); c.bezierCurveTo(2, 6, 0, 7, -8, 8); done(c, 10);
      c.beginPath(); c.moveTo(-6, 6); c.quadraticCurveTo(-4, -3, 7, -8); c.moveTo(-5, 7); c.quadraticCurveTo(0, 0, 4, -2);
      c.strokeStyle = 'rgba(30,30,32,0.6)'; c.lineWidth = 0.9; c.stroke();
    },
    gem(c) {
      c.beginPath(); c.moveTo(-9, -3); c.lineTo(-5, -8); c.lineTo(5, -8); c.lineTo(9, -3); c.lineTo(0, 10); c.closePath(); done(c, 10);
      c.beginPath(); c.moveTo(-9, -3); c.lineTo(9, -3); c.moveTo(-3, -8); c.lineTo(-4, -3); c.lineTo(0, 10); c.lineTo(4, -3); c.lineTo(3, -8);
      c.strokeStyle = 'rgba(30,30,32,0.6)'; c.lineWidth = 0.8; c.stroke();
      c.beginPath(); c.moveTo(-5, -7); c.lineTo(-3, -7); c.lineTo(-4, -4); c.closePath(); c.fillStyle = '#fff'; c.fill();
    },
    snow(c) {
      c.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        c.save(); c.rotate(k * Math.PI / 3);
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -10); c.moveTo(0, -6); c.lineTo(-3, -9); c.moveTo(0, -6); c.lineTo(3, -9);
        c.strokeStyle = INK; c.lineWidth = 3.4; c.stroke(); c.strokeStyle = '#d8d8d8'; c.lineWidth = 1.6; c.stroke();
        c.restore();
      }
    },
    moon(c) {
      c.beginPath(); c.arc(0, 0, 10, -2.2, 2.2, false); c.arc(4, 0, 8, 1.9, -1.9, true); c.closePath(); done(c, 10);
      shine(c, -6, -2, 1.4, 3, 0.2);
    },
    clover(c) {
      for (let k = 0; k < 4; k++) { c.save(); c.rotate(k * Math.PI / 2); c.beginPath(); c.arc(-2.6, -5, 3.8, 0, TAU); c.arc(2.6, -5, 3.8, 0, TAU); done(c, 9); c.restore(); }
      hole(c, 0, 0, 1.5);
    },
    paw(c) {
      c.beginPath(); c.ellipse(0, 4, 6, 5, 0, 0, TAU); done(c, 8);
      for (const [x, y] of [[-7, -2], [-3, -7], [3, -7], [7, -2]]) { c.beginPath(); c.ellipse(x, y, 2.4, 3, x * 0.06, 0, TAU); done(c, 4, 1); }
    },
    butterfly(c) {
      for (const sx of [-1, 1]) {
        c.save(); c.scale(sx, 1);
        c.beginPath(); c.moveTo(0, -1); c.bezierCurveTo(4, -12, 12, -10, 10, -3); c.bezierCurveTo(9, 0, 5, 0, 0, 0); done(c, 10);
        c.beginPath(); c.moveTo(0, 1); c.bezierCurveTo(6, 1, 9, 5, 7, 8); c.bezierCurveTo(5, 10, 2, 7, 0, 2); done(c, 8);
        hole(c, 6, -5, 1.6);
        c.restore();
      }
      c.beginPath(); c.ellipse(0, 0, 1.4, 6, 0, 0, TAU); c.fillStyle = INK; c.fill();
    },
    sword(c) {
      c.beginPath(); c.moveTo(0, -11); c.lineTo(2, -8); c.lineTo(2, 3); c.lineTo(-2, 3); c.lineTo(-2, -8); c.closePath(); done(c, 10, 1.1);
      c.beginPath(); c.rect(-6, 3, 12, 2.4); done(c, 6, 1);
      c.beginPath(); c.rect(-1.3, 5.4, 2.6, 4.5); c.fillStyle = '#3a3a3e'; c.fill();
      c.beginPath(); c.arc(0, 10.6, 1.8, 0, TAU); done(c, 2, 1);
      c.beginPath(); c.moveTo(-0.6, -8); c.lineTo(-0.6, 2); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 0.8; c.stroke();
    },
    eye(c) {
      c.beginPath(); c.moveTo(-11, 0); c.quadraticCurveTo(0, -11, 11, 0); c.quadraticCurveTo(0, 11, -11, 0); done(c, 10);
      c.beginPath(); c.arc(0, 0, 4.6, 0, TAU); c.fillStyle = '#6a6a6a'; c.fill(); c.strokeStyle = INK; c.lineWidth = 1; c.stroke();
      hole(c, 0, 0, 2.2); shine(c, -1.6, -1.8, 1.2, 0.9);
    },
  };
  const MOTIF_NAMES = Object.keys(MOTIFS);

  function motif(c, name, x, y, ang, sc) {
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(sc, sc);
    MOTIFS[name](c);
    c.restore();
  }
  function orbit(c, name, n, r, sc, phase = 0) {
    for (let k = 0; k < n; k++) {
      const a = phase + k * TAU / n;
      motif(c, name, Math.sin(a) * r, -Math.cos(a) * r, a, sc);
    }
  }
  function track(c, r, w = 1.4, alpha = 0.55) {
    c.beginPath(); c.arc(0, 0, r, 0, TAU);
    c.strokeStyle = INK; c.lineWidth = w + 2; c.stroke();
    c.strokeStyle = `rgba(200,200,200,${alpha})`; c.lineWidth = w; c.stroke();
  }
  function beads(c, n, r, size) {
    for (let k = 0; k < n; k++) {
      const a = k * TAU / n;
      c.beginPath(); c.arc(Math.sin(a) * r, -Math.cos(a) * r, size, 0, TAU); done(c, size, 1);
    }
  }
  function halo(c, r) {
    const g = c.createRadialGradient(0, 0, r * 0.5, 0, 0, r + 6);
    g.addColorStop(0, 'rgba(210,210,210,0)'); g.addColorStop(0.78, 'rgba(225,225,225,0.4)'); g.addColorStop(1, 'rgba(225,225,225,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, r + 6, 0, TAU); c.fill();
  }

  function spinner(c, i) {
    if (i < 4) {                                       // free starters: plain shapes
      ring(c, i, [8, 6, 6, 6][i], R - 8, 1.45);
      return;
    }
    if (i < 28) {                                      // tier 1: one motif orbiting
      const m = MOTIF_NAMES[(i - 4) % 16], n = i - 4 < 16 ? 6 : 8;
      orbit(c, m, n, R - 10, 1.3);
      return;
    }
    if (i < 48) {                                      // tier 2: motifs + bead ring + inner counter ring
      const j = i - 28, m = MOTIF_NAMES[(j * 5 + 3) % 16], m2 = MOTIF_NAMES[(j * 7 + 9) % 16];
      track(c, R - 6, 1.6, 0.5);
      beads(c, 12, R - 6, 1.7);
      orbit(c, m, j % 2 ? 4 : 5, R - 6, 1.0);
      orbit(c, m2, 3, R * 0.42, 0.62, Math.PI / 3);
      return;
    }
    // tier 3: legendary — halo, ornate double ring, big motifs, core emblem.
    const j = i - 48, m = MOTIF_NAMES[j], m2 = MOTIF_NAMES[(j + 8) % 16];
    halo(c, R);
    track(c, R - 3, 2.2, 0.7); track(c, R - 10, 1, 0.4);
    beads(c, 16, R - 3, 1.5);
    orbit(c, m, 3, R - 7, 1.35);
    orbit(c, m2, 6, R * 0.5, 0.55, Math.PI / 6);
    motif(c, m, 0, 0, 0, 0.75);
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

// Pets: small companions that trot after their owner, drawn from code
// (top-down, facing -Y). Each pet gives one small perk (see ShopManager.PETS).
//
// Pets.draw(ctx, id, time, moving) draws pet `id` at the origin.

const Pets = (() => {
  const TAU = Math.PI * 2;
  const INK = 'rgba(12,12,14,0.9)';

  function blob(c, x, y, rx, ry, fill, a = 0) {
    c.beginPath(); c.ellipse(x, y, rx, ry, a, 0, TAU);
    c.fillStyle = fill; c.fill(); c.lineWidth = 1.2; c.strokeStyle = INK; c.stroke();
  }
  function tri(c, pts, fill) {
    c.beginPath(); c.moveTo(pts[0], pts[1]); c.lineTo(pts[2], pts[3]); c.lineTo(pts[4], pts[5]); c.closePath();
    c.fillStyle = fill; c.fill(); c.lineWidth = 1.1; c.strokeStyle = INK; c.stroke();
  }
  function tail(c, x, y, len, sway, w, col, tip) {
    c.beginPath(); c.moveTo(x, y);
    c.quadraticCurveTo(x + sway * len * 0.6, y + len * 0.5, x + sway * len * 0.2, y + len);
    c.lineCap = 'round'; c.strokeStyle = INK; c.lineWidth = w + 2.4; c.stroke();
    c.strokeStyle = col; c.lineWidth = w; c.stroke();
    if (tip) { c.beginPath(); c.arc(x + sway * len * 0.2, y + len, w * 0.6, 0, TAU); c.fillStyle = tip; c.fill(); }
  }
  function eyes(c, y, dx, r = 1.3, col = '#111') {
    for (const s of [-1, 1]) { c.beginPath(); c.arc(s * dx, y, r, 0, TAU); c.fillStyle = col; c.fill(); }
  }
  const legsAnim = (c, time, moving, col, xs, ys) => {
    const s = moving ? Math.sin(time * 14) * 2.2 : 0;
    xs.forEach((x, k) => blob(c, x, ys[k] + (k % 2 ? s : -s), 2, 2.6, col));
  };

  const DRAW = [
    // 0 cat
    (c, time, mv) => {
      tail(c, 0, 7, 12, Math.sin(time * 3), 2.6, '#d8893a');
      legsAnim(c, time, mv, '#c27530', [-4, 4, -4, 4], [-3, -3, 6, 6]);
      blob(c, 0, 2, 6, 8, '#e09445');
      c.strokeStyle = 'rgba(120,60,20,0.6)'; c.lineWidth = 1.2;
      for (const y of [0, 3, 6]) { c.beginPath(); c.moveTo(-4, y); c.lineTo(4, y); c.stroke(); }
      blob(c, 0, -7, 5.5, 5, '#e8a052');
      tri(c, [-5, -9, -4, -14, -1, -11], '#e8a052'); tri(c, [5, -9, 4, -14, 1, -11], '#e8a052');
      eyes(c, -8.5, 2.2, 1.1, '#2e7d32');
    },
    // 1 dog
    (c, time, mv) => {
      tail(c, 0, 8, 7, Math.sin(time * 9), 2.4, '#8a5a32');
      legsAnim(c, time, mv, '#6e4526', [-4.5, 4.5, -4.5, 4.5], [-3, -3, 6, 6]);
      blob(c, 0, 2, 6.5, 8.5, '#9b6a3e');
      blob(c, 0, -8, 5.5, 5.5, '#a87447');
      blob(c, -5, -7, 2.2, 4, '#5e3a1e', 0.3); blob(c, 5, -7, 2.2, 4, '#5e3a1e', -0.3);
      blob(c, 0, -12.5, 2.4, 2, '#c99a6a'); c.beginPath(); c.arc(0, -13.5, 1, 0, TAU); c.fillStyle = '#111'; c.fill();
      eyes(c, -9, 2.2);
    },
    // 2 crow (flies)
    (c, time, mv) => {
      const f = Math.sin(time * (mv ? 16 : 6)) * (mv ? 1 : 0.4);
      for (const s of [-1, 1]) {
        c.save(); c.scale(s, 1); c.rotate(-0.2 - 0.5 * f);
        c.beginPath(); c.moveTo(2, -2); c.quadraticCurveTo(14, -4, 16, 4); c.quadraticCurveTo(9, 2, 2, 4); c.closePath();
        c.fillStyle = '#1e2228'; c.fill(); c.strokeStyle = INK; c.lineWidth = 1; c.stroke();
        c.restore();
      }
      tri(c, [-3, 6, 3, 6, 0, 13], '#1a1d22');
      blob(c, 0, 0, 4, 7, '#262b33');
      blob(c, 0, -7, 3.6, 3.6, '#2c323b');
      tri(c, [-1.4, -10, 1.4, -10, 0, -14], '#d9a632');
      eyes(c, -8, 1.6, 0.9, '#ffd54a');
    },
    // 3 slime
    (c, time) => {
      const sq = 1 + 0.12 * Math.sin(time * 6);
      c.save(); c.scale(sq, 2 - sq);
      const g = c.createRadialGradient(-3, -4, 1, 0, 0, 11);
      g.addColorStop(0, '#c8ffb0'); g.addColorStop(0.5, '#62d14a'); g.addColorStop(1, '#2f8a24');
      c.beginPath(); c.ellipse(0, 0, 10, 9, 0, 0, TAU); c.fillStyle = g; c.globalAlpha = 0.92; c.fill(); c.globalAlpha = 1;
      c.lineWidth = 1.3; c.strokeStyle = INK; c.stroke();
      c.beginPath(); c.ellipse(-3.5, -4, 3, 1.8, -0.5, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
      c.restore();
      eyes(c, -3, 3, 1.6);
    },
    // 4 drone
    (c, time) => {
      c.strokeStyle = INK; c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(-8, -8); c.lineTo(8, 8); c.moveTo(8, -8); c.lineTo(-8, 8); c.stroke();
      for (const [x, y] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
        c.save(); c.translate(x, y); c.rotate(time * 40);
        c.beginPath(); c.ellipse(0, 0, 6, 1.4, 0, 0, TAU); c.fillStyle = 'rgba(200,210,220,0.55)'; c.fill();
        c.restore();
        c.beginPath(); c.arc(x, y, 1.8, 0, TAU); c.fillStyle = '#333'; c.fill();
      }
      c.beginPath(); c.roundRect ? c.roundRect(-5, -6, 10, 12, 3) : c.rect(-5, -6, 10, 12);
      c.fillStyle = '#7b8794'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = INK; c.stroke();
      const on = Math.sin(time * 5) > 0;
      c.beginPath(); c.arc(0, -3, 2, 0, TAU); c.fillStyle = on ? '#4af0ff' : '#1f6f7a'; c.fill();
    },
    // 5 ghost
    (c, time) => {
      c.save(); c.globalAlpha = 0.85;
      c.beginPath(); c.moveTo(-8, 6); c.lineTo(-8, -2); c.arc(0, -2, 8, Math.PI, 0); c.lineTo(8, 6);
      for (let k = 0; k <= 4; k++) c.lineTo(8 - k * 4, 6 + (k % 2 ? -2 : 2) * Math.sin(time * 6 + k));
      c.closePath();
      c.fillStyle = '#eef3ff'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = 'rgba(40,50,80,0.8)'; c.stroke();
      c.restore();
      eyes(c, -3, 3, 1.7, '#2a2f45');
      c.beginPath(); c.ellipse(0, 1.5, 1.6, 2, 0, 0, TAU); c.fillStyle = '#2a2f45'; c.fill();
    },
    // 6 fox
    (c, time, mv) => {
      tail(c, 0, 7, 13, Math.sin(time * 4), 4.2, '#e0672a', '#f6f2ea');
      legsAnim(c, time, mv, '#3a2418', [-4, 4, -4, 4], [-3, -3, 6, 6]);
      blob(c, 0, 2, 5.5, 8, '#e46f2e');
      blob(c, 0, -7.5, 5, 4.8, '#ec7a36');
      tri(c, [-1.5, -11, 1.5, -11, 0, -15], '#f6f2ea');
      tri(c, [-5, -9, -5, -15, -1.5, -11], '#ec7a36'); tri(c, [5, -9, 5, -15, 1.5, -11], '#ec7a36');
      eyes(c, -8.5, 2.2, 1);
    },
    // 7 dragon whelp
    (c, time, mv) => {
      const f = Math.sin(time * (mv ? 12 : 4));
      for (const s of [-1, 1]) {
        c.save(); c.scale(s, 1); c.rotate(-0.1 - 0.35 * f);
        c.beginPath(); c.moveTo(3, -2); c.lineTo(15, -7); c.lineTo(13, 0); c.lineTo(16, 3); c.lineTo(10, 3); c.lineTo(3, 4); c.closePath();
        c.fillStyle = '#8a1f1f'; c.fill(); c.lineWidth = 1; c.strokeStyle = INK; c.stroke();
        c.restore();
      }
      tail(c, 0, 7, 11, Math.sin(time * 3), 2.6, '#b42a2a');
      blob(c, 0, 1, 5, 8, '#c7302e');
      c.fillStyle = '#f0c048';
      for (const y of [-2, 2, 6]) { c.beginPath(); c.moveTo(-1.4, y); c.lineTo(0, y - 2.4); c.lineTo(1.4, y); c.fill(); }
      blob(c, 0, -8, 4.5, 4.5, '#d33a36');
      tri(c, [-3, -10, -4.5, -15, -1, -11], '#f0c048'); tri(c, [3, -10, 4.5, -15, 1, -11], '#f0c048');
      eyes(c, -8.5, 2, 1, '#ffde59');
    },
  ];

  function draw(c, id, time, moving) {
    const f = DRAW[id];
    if (f) f(c, time, moving);
  }
  // Floating pets don't get a ground-contact bob.
  const FLYING = new Set([2, 4, 5, 7]);
  return { draw, count: DRAW.length, FLYING };
})();

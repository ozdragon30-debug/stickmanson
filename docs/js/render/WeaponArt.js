// Weapon pickups (floor items, HUD and kill-feed icons), drawn from code —
// Stick Clash designs. Frame names and sizes match the old pickup sheet so
// nothing else changes; the weapons in the players' hands are untouched.
//
// Each weapon is drawn lying along +X, centred at the origin, then turned to
// fit its frame.

const WeaponArt = (() => {
  const TAU = Math.PI * 2;
  const INK = '#121216';

  function lin(c, x0, y0, x1, y1, stops) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    stops.forEach((s, k) => g.addColorStop(k / (stops.length - 1), s));
    return g;
  }
  // Fill + ink outline of the current path.
  function ink(c, fill, lw = 1.3) {
    c.fillStyle = fill; c.fill();
    c.lineJoin = 'round'; c.lineWidth = lw; c.strokeStyle = INK; c.stroke();
  }
  function box(c, x, y, w, h, fill, r = 0, lw) {
    c.beginPath();
    if (r && c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
    ink(c, fill, lw);
  }
  function poly(c, pts, fill, lw) {
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k], pts[k + 1]);
    c.closePath(); ink(c, fill, lw);
  }
  function dot(c, x, y, r, fill) { c.beginPath(); c.arc(x, y, r, 0, TAU); ink(c, fill, 1); }
  function gloss(c, x, y, w) {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y);
    c.lineCap = 'round'; c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1; c.stroke();
  }
  const steel = (c, y, h) => lin(c, 0, y, 0, y + h, ['#f4f7fa', '#b7c0ca', '#6c7682']);
  const gun = (c, y, h) => lin(c, 0, y, 0, y + h, ['#5c636d', '#2e333a', '#17191d']);
  const wood = (c, y, h) => lin(c, 0, y, 0, y + h, ['#d99a5b', '#a5652e', '#6d3e19']);

  const DRAW = {
    katana(c) {
      // Curved blade, round guard, wrapped grip.
      c.beginPath();
      c.moveTo(-6, -1.6); c.quadraticCurveTo(14, -4.5, 34, -1); c.lineTo(31, 1.6); c.quadraticCurveTo(12, -0.8, -6, 1.6); c.closePath();
      ink(c, steel(c, -4, 6), 1.1);
      c.beginPath(); c.moveTo(-4, -0.6); c.quadraticCurveTo(14, -3.2, 30, -0.4);
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 0.8; c.stroke();
      c.beginPath(); c.ellipse(-7, 0, 2.2, 5.2, 0, 0, TAU); ink(c, '#c9a032', 1.1);
      box(c, -27, -2.4, 19, 4.8, '#2a1d3a', 2, 1.1);
      c.strokeStyle = '#d8d0ea'; c.lineWidth = 0.9;
      for (let x = -25; x < -9; x += 3.4) { c.beginPath(); c.moveTo(x, -2.2); c.lineTo(x + 1.7, 2.2); c.moveTo(x + 1.7, -2.2); c.lineTo(x, 2.2); c.stroke(); }
      dot(c, -28.5, 0, 2.2, '#c9a032');
    },
    sledgehammer(c) {
      box(c, -26, -2, 40, 4, wood(c, -2, 4), 2, 1.1);
      c.strokeStyle = 'rgba(60,30,10,0.5)'; c.lineWidth = 0.7;
      c.beginPath(); c.moveTo(-22, 0); c.lineTo(8, 0.5); c.stroke();
      box(c, -27, -2.6, 8, 5.2, '#2b2e33', 2, 1);         // grip
      box(c, 10, -11, 13, 22, steel(c, -11, 22), 2.5, 1.4);
      box(c, 8, -12, 3, 24, '#5b6470', 1, 1);
      gloss(c, 12, -8, 8);
    },
    shotgun(c) {
      box(c, -6, -5.2, 36, 3.2, gun(c, -5.2, 3.2), 1, 1);   // barrel
      box(c, -6, -2.2, 30, 2.8, gun(c, -2.2, 2.8), 1, 1);   // magazine tube
      box(c, 8, -3.2, 13, 5, wood(c, -3.2, 5), 2, 1);       // pump
      c.strokeStyle = 'rgba(40,20,5,0.6)'; c.lineWidth = 0.8;
      for (let x = 10; x < 20; x += 2.4) { c.beginPath(); c.moveTo(x, -2.8); c.lineTo(x, 1.4); c.stroke(); }
      box(c, -14, -5.6, 10, 7, gun(c, -5.6, 7), 1.5, 1.1);  // receiver
      poly(c, [-14, -4.4, -33, 0, -34, 6.5, -28, 6.5, -14, 2], wood(c, -5, 12), 1.2);  // stock
      c.beginPath(); c.arc(-10, 2.6, 2.6, 0, Math.PI); c.strokeStyle = INK; c.lineWidth = 1.1; c.stroke();
      gloss(c, -4, -4.4, 30);
    },
    glock(c) {
      poly(c, [-10, -5, 11, -5, 11, -0.5, -2, -0.5, -4, 9, -11, 8, -8, -0.5, -10, -0.5], gun(c, -5, 14), 1.2);
      box(c, -10, -6.4, 21.5, 4.4, lin(c, 0, -6.4, 0, -2, ['#7b838e', '#3c424a']), 1.2, 1.1);  // slide
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 0.7;
      for (let x = -8; x < -3; x += 1.6) { c.beginPath(); c.moveTo(x, -6); c.lineTo(x, -2.6); c.stroke(); }
      c.beginPath(); c.arc(-1.2, 0.6, 2.6, 0, Math.PI); c.strokeStyle = INK; c.lineWidth = 1; c.stroke();
      box(c, 8.5, -7.6, 1.6, 1.6, '#f2c94c', 0, 0.6);
    },
    bat(c) {
      c.beginPath();
      c.moveTo(-24, -1.5); c.lineTo(-2, -2.4); c.quadraticCurveTo(14, -5.2, 24, -4.6);
      c.quadraticCurveTo(28, 0, 24, 4.6); c.quadraticCurveTo(14, 5.2, -2, 2.4); c.lineTo(-24, 1.5); c.closePath();
      ink(c, lin(c, 0, -5, 0, 5, ['#f0d7a6', '#c99b5e', '#8a5f2c']), 1.2);
      box(c, -25, -2.2, 14, 4.4, '#1f5fa8', 1.5, 1);        // grip tape
      c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 0.7;
      for (let x = -23; x < -12; x += 2.6) { c.beginPath(); c.moveTo(x, -2); c.lineTo(x + 1.6, 2); c.stroke(); }
      dot(c, -26.5, 0, 2.6, '#c99b5e');
      gloss(c, 2, -2, 18);
    },
    ak47(c) {
      box(c, 8, -3.6, 18, 2, gun(c, -3.6, 2), 0.8, 0.9);    // barrel
      box(c, 2, -4.4, 11, 4, wood(c, -4.4, 4), 1.5, 1);     // handguard
      box(c, -10, -5.2, 13, 6.4, gun(c, -5.2, 6.4), 1.2, 1.1);  // receiver
      c.beginPath(); c.moveTo(-1, 1); c.quadraticCurveTo(0, 7, 5, 11); c.lineTo(9, 9.4); c.quadraticCurveTo(4.6, 6, 4.6, 1); c.closePath();
      ink(c, gun(c, 1, 10), 1.1);                           // curved magazine
      poly(c, [-8, 1, -6, 7.5, -3, 7.5, -4, 1], '#2a1c12', 1);  // grip
      poly(c, [-10, -4.6, -26, -1.6, -27, 4.6, -22, 4.6, -10, 0.6], wood(c, -5, 10), 1.2);  // stock
      box(c, 22, -6.2, 1.4, 2.6, '#2e333a', 0, 0.7);        // front sight
      gloss(c, 3, -3.6, 9);
    },
    chaingun(c) {
      // Drawn along +X; the frame is tall, so it is turned upright.
      for (const y of [-6, -2, 2, 6]) box(c, 2, y - 1.6, 34, 3.2, gun(c, y - 1.6, 3.2), 1, 0.9);
      for (const x of [14, 30]) box(c, x, -9, 3, 18, '#8d96a2', 1, 1);
      box(c, -12, -11, 16, 22, lin(c, 0, -11, 0, 11, ['#9aa3ae', '#525a64', '#272b31']), 3, 1.4);
      box(c, -22, -8, 11, 16, gun(c, -8, 16), 2, 1.2);
      poly(c, [-20, 8, -14, 8, -16, 17, -24, 17], '#2a2d33', 1.1);   // grip
      box(c, -40, -6, 18, 12, lin(c, 0, -6, 0, 6, ['#d9a032', '#9a6a12']), 2, 1.2);  // ammo box
      c.strokeStyle = 'rgba(60,40,0,0.6)'; c.lineWidth = 0.8;
      for (let x = -37; x < -24; x += 3) { c.beginPath(); c.moveTo(x, -5); c.lineTo(x, 5); c.stroke(); }
      gloss(c, -9, -8, 10);
    },
    chainsaw(c) {
      // Bar with teeth.
      c.beginPath(); c.moveTo(2, -4.5); c.lineTo(30, -4.5); c.arc(30, 0, 4.5, -Math.PI / 2, Math.PI / 2); c.lineTo(2, 4.5); c.closePath();
      ink(c, steel(c, -4.5, 9), 1.2);
      c.fillStyle = '#2e333a';
      for (let x = 4; x < 32; x += 3.6) {
        c.beginPath(); c.moveTo(x, -4.5); c.lineTo(x + 1.8, -7.4); c.lineTo(x + 3.2, -4.5); c.fill();
        c.beginPath(); c.moveTo(x, 4.5); c.lineTo(x + 1.8, 7.4); c.lineTo(x + 3.2, 4.5); c.fill();
      }
      // Engine body + handles.
      box(c, -16, -9, 20, 18, lin(c, 0, -9, 0, 9, ['#ffd166', '#f2a516', '#b86a00']), 4, 1.4);
      box(c, -12, -5, 9, 6, '#2b2e33', 1.5, 1);
      c.fillStyle = '#6a6f78';
      for (let y = -4; y < 1; y += 2) c.fillRect(-11, y, 7, 0.9);
      c.beginPath(); c.moveTo(-6, -9); c.quadraticCurveTo(-4, -16, 4, -10);
      c.lineCap = 'round'; c.strokeStyle = INK; c.lineWidth = 4.2; c.stroke(); c.strokeStyle = '#33373e'; c.lineWidth = 2.2; c.stroke();
      box(c, -27, -3, 12, 6, '#2b2e33', 2, 1.1);
      gloss(c, -13, -7, 12);
    },
    flamethrower(c) {
      // Two fuel tanks on a frame, hose to the nozzle gun.
      for (const y of [-12, 0]) {
        box(c, -24, y, 24, 11, lin(c, 0, y, 0, y + 11, ['#9be08a', '#4c9e3c', '#255c1d']), 5.5, 1.3);
        box(c, -1, y + 3, 3, 5, '#c9ccd2', 1, 0.9);
        c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(-20, y + 2, 14, 1.3);
        c.fillStyle = '#ffd34d'; c.fillRect(-16, y + 4.6, 6, 2.2);
      }
      c.beginPath(); c.moveTo(1, -6.5); c.bezierCurveTo(10, -12, 8, 10, 4, 14);
      c.lineCap = 'round'; c.strokeStyle = INK; c.lineWidth = 4; c.stroke(); c.strokeStyle = '#4a4f57'; c.lineWidth = 2; c.stroke();
      box(c, 2, 12, 24, 5, gun(c, 12, 5), 1.5, 1.1);
      box(c, 24, 11, 6, 7, lin(c, 0, 11, 0, 18, ['#c9ccd2', '#6f7682']), 1, 1);
      poly(c, [6, 17, 10, 17, 9, 23, 5, 23], '#2a2d33', 1);
      c.beginPath(); c.arc(32, 14.5, 2.2, 0, TAU); c.fillStyle = 'rgba(255,140,40,0.85)'; c.fill();
    },
    laser_sword(c) {
      // Glowing blade (kept red to match the weapon in hand) on a new hilt.
      c.save();
      c.shadowColor = 'rgba(255,60,60,0.9)'; c.shadowBlur = 7;
      c.beginPath(); c.moveTo(0, -2.6); c.lineTo(32, -2.6); c.arc(32, 0, 2.6, -Math.PI / 2, Math.PI / 2); c.lineTo(0, 2.6); c.closePath();
      c.fillStyle = '#ff3b3b'; c.fill();
      c.restore();
      box(c, 0, -1.1, 32, 2.2, '#fff1f1', 1.1, 0);
      box(c, -22, -3.2, 22, 6.4, lin(c, 0, -3.2, 0, 3.2, ['#e8ecf2', '#8b95a3', '#3b4250']), 1.5, 1.2);
      box(c, -2, -4.4, 4, 8.8, '#2a2f38', 1, 1);
      c.fillStyle = '#1b1e24';
      for (let x = -19; x < -6; x += 3.2) c.fillRect(x, -3.2, 1.6, 6.4);
      dot(c, -13, -3.6, 1.3, '#4ce1ff');
      box(c, -25, -2.6, 3.4, 5.2, '#2a2f38', 1, 1);
    },
    railgun(c) {
      // Long rails with glowing coils, drawn along +X and turned upright.
      box(c, 4, -6, 30, 3, gun(c, -6, 3), 1, 1);
      box(c, 4, 3, 30, 3, gun(c, 3, 3), 1, 1);
      c.fillStyle = 'rgba(80,220,255,0.9)'; c.fillRect(6, -2.6, 28, 5.2);
      c.fillStyle = 'rgba(220,250,255,0.9)'; c.fillRect(6, -0.8, 28, 1.6);
      for (const x of [10, 18, 26]) box(c, x, -8, 3.4, 16, lin(c, 0, -8, 0, 8, ['#d9b3ff', '#7c4fd0', '#3b1f75']), 1.2, 1);
      box(c, -18, -9, 22, 18, lin(c, 0, -9, 0, 9, ['#c6ccd6', '#6f7887', '#363c47']), 3, 1.4);
      dot(c, -7, 0, 3.4, '#4ce1ff');
      poly(c, [-14, 9, -8, 9, -10, 17, -16, 17], '#2a2d33', 1.1);
      box(c, -32, -5, 14, 10, gun(c, -5, 10), 2, 1.2);
      gloss(c, -15, -6.5, 16);
    },
    tesla_helmet(c) {
      // Upright helmet (not turned) with a coil and sparks.
      c.beginPath(); c.arc(0, 5, 17, Math.PI, 0); c.lineTo(17, 8); c.lineTo(-17, 8); c.closePath();
      ink(c, lin(c, 0, -12, 0, 8, ['#eef2f7', '#a9b3c0', '#5c6573']), 1.4);
      box(c, -19, 6, 38, 5, '#3a404a', 2.5, 1.2);
      c.fillStyle = '#ffd34d';
      for (const x of [-12, -4, 4, 12]) { c.beginPath(); c.arc(x, 8.5, 1.3, 0, TAU); c.fill(); }
      box(c, -3, -18, 6, 8, '#8a5a2c', 1.5, 1);
      c.strokeStyle = '#d9a032'; c.lineWidth = 1;
      for (let y = -17; y < -10; y += 1.8) { c.beginPath(); c.moveTo(-3, y); c.lineTo(3, y + 0.8); c.stroke(); }
      dot(c, 0, -20, 3.2, '#9be7ff');
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (const [pts, w] of [[[-3, -21, -8, -19, -10, -23, -16, -20], 1.4], [[3, -21, 9, -22, 10, -18, 17, -19], 1.4]]) {
        c.beginPath(); c.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k], pts[k + 1]);
        c.strokeStyle = 'rgba(120,220,255,0.55)'; c.lineWidth = w + 2; c.stroke();
        c.strokeStyle = '#f2fbff'; c.lineWidth = w; c.stroke();
      }
      c.beginPath(); c.ellipse(-7, -4, 4, 2, -0.5, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fill();
    },
  };

  // name -> [frame w, frame h, angle, scale]
  const LAYOUT = {
    katana:       [73, 50, -0.42, 1.12],
    sledgehammer: [62, 50, -0.55, 1.05],
    shotgun:      [70, 50, -0.4, 1.0],
    glock:        [50, 50, -0.3, 1.25],
    bat:          [55, 50, -0.45, 1.0],
    ak47:         [55, 50, -0.4, 0.95],
    chaingun:     [50, 85, -Math.PI / 2, 1.0],
    chainsaw:     [72, 57, -0.4, 1.05],
    flamethrower: [67, 63, -0.3, 1.1],
    laser_sword:  [72, 53, -0.5, 1.15],
    railgun:      [50, 73, -Math.PI / 2, 1.0],
    tesla_helmet: [52, 46, 0, 1.05],
  };

  function buildSheet() {
    const PAD = 4;
    const names = Object.keys(LAYOUT);
    const canvas = document.createElement('canvas');
    canvas.width = names.reduce((s, n) => s + LAYOUT[n][0] + PAD, PAD);
    canvas.height = Math.max(...names.map(n => LAYOUT[n][1])) + PAD * 2;
    const c = canvas.getContext('2d');
    const frames = {}, animations = [];
    let x = PAD;
    for (const name of names) {
      const [w, h, ang, sc] = LAYOUT[name];
      c.save();
      c.beginPath(); c.rect(x, PAD, w, h); c.clip();
      c.translate(x + w / 2, PAD + h / 2); c.rotate(ang); c.scale(sc, sc);
      DRAW[name](c);
      c.restore();
      const key = name + '_pickup_000';
      frames[key] = { x, y: PAD, w, h };
      animations.push({ name: name + '_pickup', fps: 1, frames: [key] });
      x += w + PAD;
    }
    return { canvas, data: { frames, animations } };
  }

  return { buildSheet };
})();

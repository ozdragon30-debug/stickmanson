// Weapon artwork, drawn from code (no image files).
//
// Every weapon is drawn in its own local space: the grip (where the hand
// holds it) is at (0, 0) and the weapon points "forward" along -Y. Units are
// world pixels. `time` is a time in seconds for moving parts (chains, barrels).
// The same drawings are used in the player's hands, as floor pickups and as HUD
// icons. Gameplay never reads anything from here.

const WeaponArt = (() => {
  const OUT = 'rgba(8,10,14,0.9)';

  function poly(c, pts, fill, stroke = OUT, lw = 1.1) {
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
    c.fillStyle = fill; c.fill();
    if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
  }
  function rect(c, x, y, w, h, fill, stroke = OUT, r = 0) {
    c.beginPath();
    if (r && c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
    c.fillStyle = fill; c.fill();
    if (stroke) { c.lineWidth = 1.1; c.strokeStyle = stroke; c.stroke(); }
  }
  function circle(c, x, y, r, fill, stroke = OUT) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = fill; c.fill();
    if (stroke) { c.lineWidth = 1.1; c.strokeStyle = stroke; c.stroke(); }
  }
  function vgrad(c, x0, x1, a, b, mid) {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, a); if (mid) g.addColorStop(0.45, mid); g.addColorStop(1, b);
    return g;
  }
  function line(c, x0, y0, x1, y1, color, w) {
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
    c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.stroke();
  }

  const W = {
    bat(c) {
      // Tapered wooden bat with a taped handle.
      poly(c, [-1.8, 12, 1.8, 12, 2.2, -10, 4, -60, 3.4, -72, -3.4, -72, -4, -60, -2.2, -10],
        vgrad(c, -4, 4, '#8f5a2a', '#6d3f18', '#e0ad6c'));
      rect(c, -2.3, -2, 4.6, 14, '#22252b', OUT, 1.5);
      for (let y = 0; y < 12; y += 3) line(c, -2, y, 2, y + 1.5, 'rgba(255,255,255,0.18)', 0.8);
      circle(c, 0, 13, 2.6, '#1b1d21');
      return 72;
    },

    glock(c) {
      rect(c, -2.4, -6, 4.8, 10, '#1a1c20', OUT, 1);        // grip
      rect(c, -3, -26, 6, 22, vgrad(c, -3, 3, '#30353d', '#1f2328', '#5a626e'), OUT, 1.2); // slide
      for (let y = -12; y < -5; y += 2) line(c, -2.4, y, 2.4, y, 'rgba(255,255,255,0.15)', 0.6);
      rect(c, -1, -28, 2, 2.5, '#0e0f12', null);             // muzzle
      return 28;
    },

    shotgun(c, time, kick = 0) {
      poly(c, [-3, 4, 3, 4, 4.2, 22, -4.2, 22], vgrad(c, -4, 4, '#6e4220', '#4f2d14', '#a8693a')); // stock
      rect(c, -3.3, -12, 6.6, 17, '#2b2e33', OUT, 1.5);      // receiver
      rect(c, -1.8, -50, 3.6, 40, vgrad(c, -2, 2, '#3a3e45', '#1c1e22', '#6b7380'), OUT, 1); // barrel
      rect(c, 2, -44, 2.4, 30, '#24272b', OUT, 1);           // magazine tube
      rect(c, -3.8, -30 + kick * 6, 7.6, 12, vgrad(c, -4, 4, '#7a4b25', '#57331a', '#b07a48'), OUT, 2); // pump
      return 50;
    },

    ak47(c) {
      poly(c, [-2.6, 4, 2.6, 4, 3.6, 21, -3.6, 21], vgrad(c, -4, 4, '#8a4f22', '#5e3313', '#c47f43')); // stock
      rect(c, -3.2, -14, 6.4, 19, '#26292e', OUT, 1.2);      // receiver
      // Curved magazine sticking out to the right.
      c.beginPath(); c.moveTo(3, -10); c.quadraticCurveTo(11, -8, 13, 1); c.lineTo(9.5, 2.5);
      c.quadraticCurveTo(8, -4, 3, -4); c.closePath();
      c.fillStyle = '#2c2f34'; c.fill(); c.lineWidth = 1; c.strokeStyle = OUT; c.stroke();
      rect(c, -2.8, -33, 5.6, 19, vgrad(c, -3, 3, '#8a4f22', '#5e3313', '#c47f43'), OUT, 1.5); // handguard
      rect(c, -1, -54, 2, 21, '#1b1d20', OUT, 0.5);          // barrel
      rect(c, -1.8, -52, 3.6, 3, '#1b1d20', null);           // front sight
      line(c, 0, -14, 0, 4, 'rgba(255,255,255,0.12)', 0.8);
      return 54;
    },

    chaingun(c, time, spin = 0) {
      // Ammo box on the back with a brass belt feeding the gun.
      rect(c, -15, 9, 15, 13, vgrad(c, -15, 0, '#4f7a3c', '#33532a', '#6f9c56'), OUT, 2);
      c.beginPath(); c.moveTo(-1, 14); c.bezierCurveTo(14, 16, 14, -2, 7, -6);
      c.strokeStyle = '#7a6230'; c.lineWidth = 4; c.lineCap = 'round'; c.stroke();
      c.setLineDash([1.6, 1.6]); c.strokeStyle = '#e1b955'; c.lineWidth = 3; c.stroke(); c.setLineDash([]);
      rect(c, -7, -24, 14, 27, vgrad(c, -7, 7, '#4a4f57', '#2b2e33', '#7c8591'), OUT, 3); // body
      // Six barrels seen from above: the visible three slide as they spin.
      for (let i = 0; i < 3; i++) {
        const x = -4.5 + ((i * 4.5 + spin * 4.5) % 13.5);
        rect(c, x - 1.3, -60, 2.6, 37, '#24272b', OUT, 1);
      }
      rect(c, -7, -54, 14, 4, '#3b4047', OUT, 1);            // shroud rings
      rect(c, -7, -34, 14, 4, '#3b4047', OUT, 1);
      return 60;
    },

    chainsaw(c, time, rev = 0) {
      // Guide bar with moving teeth.
      rect(c, -4, -66, 8, 56, vgrad(c, -4, 4, '#8d949c', '#c9cfd6', '#eef2f5'), OUT, 4);
      const off = (time * (rev ? 90 : 12)) % 5;
      c.fillStyle = '#3a3d42';
      for (let y = -64 + off; y < -12; y += 5) {
        c.beginPath(); c.moveTo(-4, y); c.lineTo(-6.2, y + 1.6); c.lineTo(-4, y + 3.2); c.fill();
        c.beginPath(); c.moveTo(4, y + 2.5); c.lineTo(6.2, y + 4.1); c.lineTo(4, y + 5.7); c.fill();
      }
      rect(c, -8.5, -14, 17, 18, vgrad(c, -8, 8, '#d65a1c', '#9c3a0f', '#f38a46'), OUT, 3); // engine
      rect(c, -5, -11, 10, 5, '#2a2c30', null, 1);
      c.beginPath(); c.arc(0, 7, 6, Math.PI, 0); c.strokeStyle = '#2a2c30'; c.lineWidth = 2.5; c.stroke(); // handle
      return 66;
    },

    flamethrower(c, time) {
      // Twin fuel tanks on the back and a hose to the nozzle.
      for (const x of [-8, 8]) {
        rect(c, x - 6, 8, 12, 17, vgrad(c, x - 6, x + 6, '#c2401f', '#7d2210', '#ff7a4d'), OUT, 6);
        rect(c, x - 2, 6, 4, 3, '#555a61', OUT, 1);
      }
      c.beginPath(); c.moveTo(8, 9); c.bezierCurveTo(16, -2, 10, -10, 3, -12);
      c.strokeStyle = '#2b2d31'; c.lineWidth = 3; c.lineCap = 'round'; c.stroke();
      rect(c, -3.2, -34, 6.4, 34, vgrad(c, -3, 3, '#5d636b', '#33373d', '#8f97a1'), OUT, 2);
      rect(c, -2.2, -42, 4.4, 9, '#2a2c30', OUT, 1);          // nozzle
      const flick = 0.75 + 0.25 * Math.sin(time * 30);
      circle(c, 0, -43, 1.8 * flick, '#7fd3ff', null);          // pilot light
      return 42;
    },

    katana(c) {
      rect(c, -1.9, -2, 3.8, 15, '#1d1f24', OUT, 1.5);        // wrapped handle
      for (let y = 0; y < 12; y += 3) { line(c, -1.6, y, 1.6, y + 2, '#c9a64b', 0.7); line(c, 1.6, y, -1.6, y + 2, '#c9a64b', 0.7); }
      c.beginPath(); c.ellipse(0, -3, 5, 2.2, 0, 0, Math.PI * 2);   // guard
      c.fillStyle = '#c8a24a'; c.fill(); c.lineWidth = 1; c.strokeStyle = OUT; c.stroke();
      // Slightly curved blade.
      c.beginPath(); c.moveTo(-1.6, -5); c.quadraticCurveTo(-3.4, -50, -1, -88);
      c.lineTo(1.6, -82); c.quadraticCurveTo(0.6, -48, 1.8, -5); c.closePath();
      c.fillStyle = vgrad(c, -3, 2, '#9aa3ad', '#f4f7fa', '#dfe5eb'); c.fill();
      c.lineWidth = 0.9; c.strokeStyle = 'rgba(30,35,45,0.9)'; c.stroke();
      line(c, -0.6, -8, -1.2, -78, 'rgba(255,255,255,0.7)', 0.6);
      return 88;
    },

    laser_sword(c, time, swing = 0) {
      // Glowing blade (additive) on a metal hilt.
      c.save();
      c.globalCompositeOperation = 'lighter';
      const pulse = 0.85 + 0.15 * Math.sin(time * 25);
      line(c, 0, -6, 0, -86, `rgba(255,40,40,${0.28 * pulse + 0.15 * swing})`, 11);
      line(c, 0, -6, 0, -86, `rgba(255,70,70,${0.55 * pulse})`, 6);
      c.restore();
      line(c, 0, -6, 0, -86, '#fff4f4', 2.6);
      rect(c, -2.2, -6, 4.4, 19, vgrad(c, -2, 2, '#7c838c', '#3b3f45', '#c3c9d0'), OUT, 1.5);
      for (const y of [-2, 3, 8]) rect(c, -2.6, y, 5.2, 1.6, '#1d1f23', null);
      return 86;
    },

    railgun(c, time, charge = 0) {
      rect(c, -6.5, -40, 13, 46, vgrad(c, -6, 6, '#3d424a', '#24272c', '#6c7581'), OUT, 3);  // body
      rect(c, 3.5, -30, 3, 20, '#b0322f', null, 1);             // accent panel
      for (const y of [-12, -20, -28, -36]) {
        line(c, -6.5, y, 6.5, y, `rgba(79,227,255,${0.55 + 0.45 * charge})`, 1.8);
      }
      rect(c, -4.5, -60, 2.6, 22, '#2a2d32', OUT, 1);          // twin rails
      rect(c, 1.9, -60, 2.6, 22, '#2a2d32', OUT, 1);
      if (charge > 0) {
        c.save(); c.globalCompositeOperation = 'lighter';
        line(c, 0, -58, 0, -42, `rgba(120,230,255,${0.6 * charge})`, 3);
        c.restore();
      }
      return 60;
    },

    // k < 1 foreshortens the hammer (seen from above while it is raised or
    // resting on the shoulder): the handle shortens, the head stays readable.
    sledgehammer(c, time, k = 1) {
      const L = 86 * k, hy = -90.5 * k, ky = Math.max(0.62, k);
      rect(c, -1.8, -L, 3.6, L + 14, vgrad(c, -2, 2, '#7a522c', '#5a3a1d', '#a87a4c'), OUT, 1.5); // handle
      rect(c, -2.2, 6, 4.4, 8, '#202226', OUT, 1);
      c.save(); c.translate(0, hy); c.scale(1, ky);
      rect(c, -15, -7.5, 30, 15, vgrad(c, -15, 15, '#6f757d', '#4a4f56', '#c2c8cf'), OUT, 2);    // head
      rect(c, -15, -7.5, 4, 15, '#3a3e44', null);
      rect(c, 11, -7.5, 4, 15, '#3a3e44', null);
      c.restore();
      return -hy + 7.5 * ky;
    },

    // Worn on the head (drawn by the figure); this is the floor/HUD version.
    tesla_helmet(c, time) {
      circle(c, 0, 0, 15, vgrad(c, -15, 15, '#7f8791', '#4c525a', '#c8ced5'));
      c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.strokeStyle = '#c4782f'; c.lineWidth = 2.4; c.stroke();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        circle(c, Math.cos(a) * 15, Math.sin(a) * 15, 3, '#c4782f');
      }
      circle(c, 0, 0, 3.2, '#4fe3ff', null);
      return 15;
    },
  };

  // Floor pickups / HUD icons: each weapon laid horizontally (pointing right).
  const PICKUPS = ['bat', 'glock', 'shotgun', 'ak47', 'chaingun', 'chainsaw', 'flamethrower',
    'katana', 'laser_sword', 'railgun', 'sledgehammer', 'tesla_helmet'];
  // Visual extent of each weapon in its local space: [minY, maxY, halfWidth].
  const EXTENT = {
    bat: [-72, 15, 5], glock: [-28, 5, 4], shotgun: [-50, 22, 5], ak47: [-54, 21, 13],
    chaingun: [-60, 22, 15], chainsaw: [-66, 13, 9], flamethrower: [-44, 25, 15],
    katana: [-88, 13, 6], laser_sword: [-88, 13, 6], railgun: [-60, 6, 7],
    sledgehammer: [-98, 14, 15], tesla_helmet: [-16, 16, 16],
  };

  function buildPickupSheet() {
    const pad = 4, scale = 0.8;
    const frames = {}, animations = [];
    const items = PICKUPS.map(name => {
      const [y0, y1, hw] = EXTENT[name];
      const rotate = name !== 'tesla_helmet';
      const w = Math.ceil((rotate ? (y1 - y0) : hw * 2) * scale) + pad * 2;
      const h = Math.ceil((rotate ? hw * 2 : (y1 - y0)) * scale) + pad * 2;
      return { name, w, h, y0, y1, hw, rotate };
    });
    const sheetW = items.reduce((s, i) => s + i.w + 2, 0);
    const sheetH = Math.max(...items.map(i => i.h));
    const canvas = document.createElement('canvas');
    canvas.width = sheetW; canvas.height = sheetH;
    const c = canvas.getContext('2d');
    let x = 0;
    for (const it of items) {
      c.save();
      c.translate(x + it.w / 2, it.h / 2);
      c.scale(scale, scale);
      if (it.rotate) c.rotate(Math.PI / 2);          // forward (-Y) → right
      c.translate(0, -(it.y0 + it.y1) / 2);
      W[it.name](c, 0);
      c.restore();
      const key = it.name + '_pickup_000';
      frames[key] = { x, y: 0, w: it.w, h: it.h };
      animations.push({ name: it.name + '_pickup', fps: 12, frames: [key] });
      x += it.w + 2;
    }
    return { canvas, data: { frames, animations } };
  }

  return { draw: W, buildPickupSheet };
})();

// The stick figure, drawn from code (no image files): body + weapon, legs,
// death animations and weapon effects (muzzle flashes, tracers, beams…).
//
// Each renderer draws one animation at progress p (0 → 1 over its whole
// length) in local space: origin at the centre of the head, facing -Y. The
// animation timing itself (frame counts, fps, when a shot happens, when an
// animation ends) still comes from data/anims/*.json and AtlasGameObject, so
// gameplay is exactly as before; only the pictures are new. Because poses are
// computed for any p, motion is smooth at every frame rate.

const StickFigure = (() => {
  const HEAD = 12.5;          // head radius
  const SHOULDER = 13;        // shoulder half-width (just outside the head)
  const SEG = 13;             // upper / lower arm length
  const INK = '#07090c';
  const LIMB = 3.9;           // limb line width
  const SIZE = 1.15;          // weapon drawing scale

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const lerp = (a, b, u) => a + (b - a) * u;
  const easeOut = u => 1 - Math.pow(1 - u, 3);
  const easeInOut = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const now = () => performance.now() / 1000;

  // Small deterministic noise so lightning/flames don't need Math.random.
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function limb(c, x0, y0, x1, y1, bendSign) {
    // Two-segment limb with the elbow/knee bending to one side.
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
    c.beginPath();
    c.moveTo(x0, y0);
    if (d < SEG * 2) {
      const h = Math.sqrt(SEG * SEG - (d / 2) * (d / 2));
      const mx = (x0 + x1) / 2 + (-dy / d) * h * bendSign;
      const my = (y0 + y1) / 2 + (dx / d) * h * bendSign;
      c.lineTo(mx, my);
    }
    c.lineTo(x1, y1);
    c.strokeStyle = INK; c.lineWidth = LIMB; c.lineCap = 'round'; c.lineJoin = 'round';
    c.stroke();
  }

  function hand(c, x, y) {
    c.beginPath(); c.arc(x, y, 3.3, 0, Math.PI * 2); c.fillStyle = INK; c.fill();
  }

  function head(c) {
    const g = c.createRadialGradient(-4, -4, 1, 0, 0, HEAD);
    g.addColorStop(0, '#2b3038'); g.addColorStop(0.45, '#0b0d11'); g.addColorStop(1, '#000');
    c.beginPath(); c.arc(0, 0, HEAD, 0, Math.PI * 2);
    c.fillStyle = g; c.fill();
  }

  // Arms reach from the shoulders to the hands.
  function arms(c, rh, lh) {
    if (rh) { limb(c, SHOULDER, 2, rh[0], rh[1], -1); hand(c, rh[0], rh[1]); }
    if (lh) { limb(c, -SHOULDER, 2, lh[0], lh[1], 1); hand(c, lh[0], lh[1]); }
  }

  function weaponAt(c, name, gx, gy, ang, ...args) {
    c.save(); c.translate(gx, gy); c.rotate(ang); c.scale(SIZE, SIZE);
    const len = WeaponArt.draw[name](c, now(), ...args) * SIZE;
    c.restore();
    return len;
  }
  const along = (gx, gy, ang, d) => { const [x, y] = rot(0, -d, ang); return [gx + x, gy + y]; };

  // Swing trail: a fading wedge between two angles around a pivot.
  function trail(c, px, py, a0, a1, r0, r1, rgb, alpha) {
    if (alpha <= 0.01 || Math.abs(a1 - a0) < 0.05) return;
    const s = Math.min(a0, a1) - Math.PI / 2, e = Math.max(a0, a1) - Math.PI / 2;
    const g = c.createRadialGradient(px, py, r0, px, py, r1);
    g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.75, `rgba(${rgb},${alpha})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.beginPath(); c.arc(px, py, r1, s, e); c.arc(px, py, r0, e, s, true); c.closePath();
    c.fillStyle = g; c.fill();
  }

  // ── Poses ─────────────────────────────────────────────────────────────────
  const breathe = (k = 1) => Math.sin(now() * 2.3) * 0.9 * k;

  const TWO_HANDED = { ak47: 25, shotgun: 27, chaingun: 14, railgun: 24, flamethrower: 22 };

  function drawGun(c, w, kind, p, moving) {
    let gx = 8, gy = -17 + breathe() + (moving ? Math.sin(now() * 10) * 0.8 : 0), ang = 0.02 * Math.sin(now() * 1.7);
    let extra = 0;
    const shooting = kind === 'shoot';
    if (shooting) {
      const k = p < 0.05 ? p / 0.05 : Math.max(0, 1 - (p - 0.05) / 0.22);
      const kick = { ak47: 4, shotgun: 7, chaingun: 2, railgun: 9, flamethrower: 1 }[w];
      gy += kick * k; ang -= 0.05 * k;
      if (w === 'shotgun') extra = Math.sin(Math.PI * seg(p, 0.28, 0.5));          // pump
      if (w === 'railgun') {
        extra = 1 - seg(p, 0, 0.12);                                                 // charge glow
        const r = Math.sin(Math.PI * seg(p, 0.35, 0.85));                            // reload
        ang += 0.55 * r; gx += 4 * r; gy += 3 * r;
      }
      if (w === 'chaingun') { gx += Math.sin(now() * 95) * 0.7; gy += Math.cos(now() * 83) * 0.7; }
    }
    if (w === 'chaingun') extra = now() * (shooting ? 14 : 0.6);
    if (w === 'railgun' && !shooting) extra = 0.25 + 0.15 * Math.sin(now() * 3);

    const len = weaponAt(c, w, gx, gy, ang, extra);
    const fore = TWO_HANDED[w] - (w === 'shotgun' ? -extra * 6 : 0);
    const lh = w === 'chaingun' ? [gx - 8, gy - 8] : along(gx - 1, gy, ang, fore);
    arms(c, [gx + 1, gy + 1], lh);
    if (w === 'flamethrower' && shooting && p > 0.02 && p < 0.92) {
      const [mx, my] = along(gx, gy, ang, len + 2);
      flames(c, mx, my, ang, Math.min(1, seg(p, 0.02, 0.1)) * (1 - seg(p, 0.75, 0.92)));
    }
  }

  function flames(c, x, y, ang, k) {
    if (k <= 0) return;
    const time = now();
    c.save();
    c.translate(x, y); c.rotate(ang);
    c.globalCompositeOperation = 'lighter';
    // Jet core: a tapered cone that flickers.
    const len = 70 + 10 * Math.sin(time * 40);
    const g = c.createLinearGradient(0, 0, 0, -len);
    g.addColorStop(0, `rgba(170,230,255,${0.9 * k})`); g.addColorStop(0.15, `rgba(255,240,170,${0.9 * k})`);
    g.addColorStop(0.6, `rgba(255,150,40,${0.7 * k})`); g.addColorStop(1, 'rgba(255,80,20,0)');
    c.beginPath(); c.moveTo(-2, 0); c.quadraticCurveTo(-9, -len * 0.5, 0, -len); c.quadraticCurveTo(9, -len * 0.5, 2, 0);
    c.fillStyle = g; c.fill();
    // Rolling fire balls further out, turning to smoke.
    for (let i = 0; i < 22; i++) {
      const d = ((time * 320 + i * 37) % 210);
      const f = d / 210;
      const side = (hash(i * 13 + Math.floor((time * 320 + i * 37) / 210)) - 0.5) * d * 0.38;
      const r = 4 + d * 0.12;
      const col = f < 0.25 ? '255,235,160' : f < 0.6 ? '255,145,40' : '210,70,25';
      const a = k * (1 - f) * (f < 0.1 ? f * 10 : 1) * 0.6;
      const rg = c.createRadialGradient(side, -d, 0, side, -d, r);
      rg.addColorStop(0, `rgba(${col},${a})`); rg.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = rg;
      c.fillRect(side - r, -d - r, r * 2, r * 2);
    }
    c.restore();
  }

  function drawGlock(c, kind, p) {
    let e = 0, kick = 0;
    if (kind === 'shoot') {
      e = easeOut(seg(p, 0, 0.1)) * (1 - easeInOut(seg(p, 0.72, 1)));
      kick = p < 0.15 ? 1 - p / 0.15 : 0;
    }
    const gx = lerp(15, 3, e), gy = lerp(-15 + breathe(), -34, e) + 4 * kick;
    const ang = lerp(0.12, 0, e) - 0.12 * kick;
    weaponAt(c, 'glock', gx, gy, ang);
    const lh = e > 0.3 ? [gx - 4, gy + 3] : [-15, -8 + breathe(0.6)];
    arms(c, [gx, gy + 1], lh);
  }

  function drawFist(c, kind, n, p) {
    const b = breathe();
    let R = [14, -17 + b], L = [-12, -19 - b];
    if (kind === 'walk') {
      const s = Math.sin(now() * 9);
      R = [15, -10 + 8 * s]; L = [-15, -10 - 8 * s];
    }
    if (kind === 'shoot') {
      const e = Math.sin(Math.PI * seg(p, 0, 0.42));
      if (n === 1) R = [lerp(R[0], 3, e), lerp(R[1], -36, e)];
      else if (n === 2) L = [lerp(L[0], -3, e), lerp(L[1], -36, e)];
      else {
        const a = lerp(1.3, -0.5, easeOut(seg(p, 0, 0.3))) ;
        const [x, y] = rot(0, -30, a);
        R = [lerp(R[0], x, e), lerp(R[1], y - 2, e)];
      }
    }
    arms(c, R, L);
  }

  // Melee swings: the grip moves on a circle around the chest; `a` is the
  // weapon's angle (0 = straight ahead, + = to the right).
  function swingPose(a, reach = 24) {
    const [x, y] = rot(0, -reach, a);
    return [x, y - 3];
  }

  const SWINGS = {
    // [windup angle, end angle] per shoot animation.
    bat_shoot: [-2.1, 1.8],
    katana_shoot1: [1.9, -1.9], katana_shoot2: [-1.9, 1.9],
    laser_sword_shoot1: [1.9, -1.9], laser_sword_shoot2: [-1.9, 1.9],
  };
  const IDLE = {
    bat: { a: -1.15, g: [-13, -15] },
    katana: { a: -2.6, g: [-18, -6] },
    laser_sword: { a: -2.6, g: [-18, -6] },
  };

  function drawBlade(c, w, anim, kind, p) {
    const idle = IDLE[w];
    const b = breathe();
    let a = idle.a + 0.03 * Math.sin(now() * 1.9), gx = idle.g[0], gy = idle.g[1] + b;
    let trailFrom = null, swingK = 0;
    const sw = SWINGS[anim];
    if (kind === 'shoot' && sw) {
      const [a0, a1] = sw;
      const w1 = seg(p, 0, 0.07), s1 = seg(p, 0.07, 0.2), back = seg(p, 0.42, 0.68);
      if (p < 0.07) a = lerp(idle.a, a0, easeOut(w1));
      else if (p < 0.42) a = lerp(a0, a1, easeOut(s1));
      else a = lerp(a1, idle.a, easeInOut(back));
      [gx, gy] = p < 0.42 || back < 1 ? swingPose(a) : [gx, gy];
      if (back > 0) { gx = lerp(swingPose(a1)[0], idle.g[0], easeInOut(back)); gy = lerp(swingPose(a1)[1], idle.g[1], easeInOut(back)); }
      if (p >= 0.07 && p < 0.32) { trailFrom = lerp(a0, a, 0.15); swingK = 1 - seg(p, 0.2, 0.32); }
    } else if (kind === 'shoot') {
      // Thrust (katana/laser 3rd variant).
      const e = easeOut(seg(p, 0.04, 0.14)) * (1 - easeInOut(seg(p, 0.32, 0.55)));
      a = lerp(idle.a, 0, Math.min(1, seg(p, 0, 0.08) * (1 - seg(p, 0.45, 0.6))));
      gx = lerp(idle.g[0], 3, Math.min(1, seg(p, 0, 0.08))); gy = lerp(-18, -38, e);
      if (p > 0.55) { gx = lerp(2, idle.g[0], seg(p, 0.55, 0.65)); gy = lerp(gy, idle.g[1], seg(p, 0.55, 0.65)); }
    }
    const len = { bat: 72, katana: 88, laser_sword: 86 }[w];
    if (trailFrom !== null) {
      const rgb = w === 'laser_sword' ? '255,60,60' : w === 'bat' ? '255,236,190' : '225,235,255';
      trail(c, 0, -3, trailFrom, a, 24, 24 + len * 1.15, rgb, 0.35 * swingK);
    }
    weaponAt(c, w, gx, gy, a, swingK);
    const [lx, ly] = along(gx, gy, a, w === 'bat' ? -7 : -8);
    arms(c, [gx, gy], [lx, ly]);
  }

  function drawChainsaw(c, kind, p) {
    let gx = 7, gy = -19 + breathe(), ang = 0.12, rev = 0;
    if (kind === 'shoot') {
      const e = easeOut(seg(p, 0, 0.12)) * (1 - easeInOut(seg(p, 0.6, 0.82)));
      gy -= 12 * e; ang = lerp(0.12, 0, e); rev = p < 0.7 ? 1 : 0;
      gx += Math.sin(now() * 110) * 0.8 * e; gy += Math.cos(now() * 97) * 0.8 * e;
    }
    weaponAt(c, 'chainsaw', gx, gy, ang, rev);
    arms(c, [gx + 6, gy + 4], [gx - 6, gy + 5]);
  }

  function drawSledge(c, kind, p) {
    let a = 2.5 + 0.03 * Math.sin(now() * 1.6), gx = 16, gy = -8 + breathe();
    if (kind === 'shoot') {
      const up = seg(p, 0, 0.12), slam = seg(p, 0.12, 0.18), back = seg(p, 0.5, 0.75);
      if (p < 0.12) a = lerp(2.5, 3.5, easeOut(up));
      else if (p < 0.5) a = lerp(3.5, Math.PI * 2, easeOut(slam));
      else a = lerp(Math.PI * 2, 2.5 + Math.PI * 2, easeInOut(back));
      const reach = p < 0.12 ? 18 : p < 0.5 ? lerp(18, 26, slam) : lerp(26, 18, back);
      [gx, gy] = swingPose(a, reach);
      if (p >= 0.12 && p < 0.24) trail(c, 0, -3, 3.5, a, 20, 112, '230,230,230', 0.3 * (1 - seg(p, 0.18, 0.24)));
    }
    weaponAt(c, 'sledgehammer', gx, gy, a);
    const [lx, ly] = along(gx, gy, a, -9);
    arms(c, [gx, gy], [lx, ly]);
  }

  function drawTesla(c, kind, p) {
    let R = [17, -10 + breathe()], L = [-17, -10 - breathe()];
    let zap = 0;
    if (kind === 'shoot') {
      const e = Math.sin(Math.PI * seg(p, 0, 0.5));
      R = [lerp(17, 22, e), lerp(-10, -20, e)]; L = [lerp(-17, -22, e), lerp(-10, -20, e)];
      zap = 1 - seg(p, 0.05, 0.45);
    }
    arms(c, R, L);
    return zap;
  }

  function lightning(c, radius, k, seed) {
    if (k <= 0) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const ring = c.createRadialGradient(0, 0, radius * 0.6, 0, 0, radius);
    ring.addColorStop(0, 'rgba(120,200,255,0)'); ring.addColorStop(1, `rgba(140,210,255,${0.35 * k})`);
    c.fillStyle = ring; c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 7; i++) {
      let a = (i / 7) * Math.PI * 2 + hash(seed + i) * 0.6;
      let x = 0, y = 0;
      c.beginPath(); c.moveTo(0, 0);
      for (let s = 1; s <= 6; s++) {
        const r = (s / 6) * radius;
        a += (hash(seed * 3 + i * 7 + s) - 0.5) * 0.7;
        x = Math.cos(a) * r; y = Math.sin(a) * r;
        c.lineTo(x, y);
      }
      c.strokeStyle = `rgba(150,215,255,${0.85 * k})`; c.lineWidth = 2.4; c.lineJoin = 'round'; c.stroke();
      c.strokeStyle = `rgba(255,255,255,${k})`; c.lineWidth = 1; c.stroke();
    }
    c.restore();
  }

  // ── Renderers (AtlasSpritesheet `renderer` hook) ──────────────────────────
  const body = {
    draw(c, anim, p) {
      if (anim === 'walk' || anim === 'run') return legs(c, anim, p);
      const m = /^(.*)_(idle|walk|shoot)(\d?)$/.exec(anim);
      if (!m) return;
      const [, w, kind, nStr] = m;
      const n = +nStr || 1;
      const moving = kind === 'walk';
      let zap = 0;
      if (w === 'fist') drawFist(c, kind, n, p);
      else if (w === 'glock') drawGlock(c, kind, p);
      else if (TWO_HANDED[w] !== undefined) drawGun(c, w, kind, p, moving);
      else if (IDLE[w]) drawBlade(c, w, anim, kind, p);
      else if (w === 'chainsaw') drawChainsaw(c, kind, p);
      else if (w === 'sledgehammer') drawSledge(c, kind, p);
      else if (w === 'tesla_helmet') zap = drawTesla(c, kind, p);
      head(c);
      if (w === 'tesla_helmet') {
        c.save(); c.scale(0.92, 0.92); WeaponArt.draw.tesla_helmet(c, now()); c.restore();
        lightning(c, 75, zap, Math.floor(now() * 24));
        if (!zap && Math.sin(now() * 7) > 0.92) lightning(c, 18, 0.5, Math.floor(now() * 24));
      }
    },
  };

  function legs(c, anim, p) {
    const run = anim === 'run';
    const s = Math.sin(p * Math.PI * 2), L = run ? 17 : 12;
    limb(c, -4.5, 3, -5, 4 - L * s, 1);
    limb(c, 4.5, 3, 5, 4 + L * s, -1);
  }

  // Deaths: knocked back, limbs sprawl, the body lies flat, then fades.
  const DEATH = [
    { push: 22, spin: 0.4, arms: [2.2, -2.4], legs: [0.35, -0.5] },
    { push: 30, spin: -0.7, arms: [1.7, -2.8], legs: [0.6, -0.2] },
    { push: 16, spin: 1.2, arms: [2.6, -1.9], legs: [0.2, -0.7] },
    { push: 10, spin: 0, arms: [1.4, -1.4], legs: [0.45, -0.45] },
    { push: 26, spin: -1.6, arms: [2.9, -2.2], legs: [0.75, -0.3] },
    { push: 12, spin: 2.4, arms: [2.0, -2.0], legs: [0.3, -0.3] },
    { push: 34, spin: 0.9, arms: [2.4, -2.6], legs: [0.5, -0.65] },
    { push: 20, spin: -2.8, arms: [1.9, -2.5], legs: [0.6, -0.4] },
  ];
  const death = {
    draw(c, anim, p) {
      const v = DEATH[(+anim.slice(6) || 0) % DEATH.length];
      const fall = easeOut(seg(p, 0, 0.3));
      const fade = 1 - seg(p, 0.82, 1);
      c.save();
      c.globalAlpha *= fade;
      // Blood pool spreading under the body.
      const pool = easeOut(seg(p, 0.15, 0.7));
      if (pool > 0) {
        c.save(); c.translate(0, v.push * fall + 8);
        c.scale(1, 0.8);
        c.beginPath(); c.arc(0, 0, 6 + 16 * pool, 0, Math.PI * 2);
        c.fillStyle = 'rgba(110,8,10,0.55)'; c.fill();
        c.restore();
      }
      c.translate(0, v.push * fall);
      c.rotate(v.spin * fall);
      const torso = 22 * fall;                       // body appears as it falls flat
      c.strokeStyle = INK; c.lineWidth = LIMB; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, HEAD + torso); c.stroke();
      const hip = HEAD + torso;
      const arm = a => { const [x, y] = rot(0, -SEG * 1.9, a * fall + (1 - fall) * Math.sign(a) * 0.6); limb(c, 0, HEAD + 2, x, HEAD + 2 + y * fall, a > 0 ? -1 : 1); };
      arm(v.arms[0]); arm(v.arms[1]);
      const leg = a => { const [x, y] = rot(0, SEG * 1.9, a); limb(c, 0, hip, x * fall, hip + y * fall, a > 0 ? 1 : -1); };
      leg(v.legs[0]); leg(v.legs[1]);
      head(c);
      c.restore();
    },
  };

  // Shot effects. Non-pinned effects are drawn from the head (the muzzle
  // distance comes from the firing pose); the sledgehammer impact is pinned
  // to where the hammer lands.
  const MUZZLE = { glock_particle: 66, shotgun_particle: 75, ak47_particle: 80, railgun_particle: 86 };
  const RANGE = { glock_particle: 538, shotgun_particle: 338, ak47_particle: 525, railgun_particle: 475 };

  function flash(c, y, k, size) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(0, y, 0, 0, y, size);
    g.addColorStop(0, `rgba(255,255,230,${k})`); g.addColorStop(0.35, `rgba(255,200,90,${0.8 * k})`); g.addColorStop(1, 'rgba(255,120,20,0)');
    c.fillStyle = g;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, r = i % 2 ? size * 0.45 : size * (i === 5 ? 1.6 : 1);
      c.lineTo(Math.sin(a) * r * 0.7, y - Math.cos(a) * r);
    }
    c.closePath(); c.fill();
    c.restore();
  }
  function tracer(c, y0, len, ang, k, width = 1.6) {
    const [x1, y1] = rot(0, -len, ang);
    const g = c.createLinearGradient(0, y0, x1, y0 + y1);
    g.addColorStop(0, `rgba(255,240,200,${0.9 * k})`); g.addColorStop(1, 'rgba(255,220,150,0)');
    c.beginPath(); c.moveTo(0, y0); c.lineTo(x1, y0 + y1);
    c.strokeStyle = g; c.lineWidth = width; c.lineCap = 'round'; c.stroke();
  }

  const particles = {
    draw(c, anim, p) {
      if (anim === 'sledgehammer_particle') {
        // Impact on landing (the hammer hits ~1/3 into this effect).
        const q = seg(p, 0.33, 0.75);
        if (q <= 0 || q >= 1) return;
        const k = 1 - q;
        c.beginPath(); c.arc(0, 0, 10 + 60 * easeOut(q), 0, Math.PI * 2);
        c.strokeStyle = `rgba(235,225,205,${0.7 * k})`; c.lineWidth = 4 * k + 1; c.stroke();
        for (let i = 0; i < 10; i++) {
          const a = i * 0.63 + 0.3, r = 8 + 46 * easeOut(q) * (0.6 + hash(i) * 0.6);
          c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, 2.4 * k + 0.5, 0, Math.PI * 2);
          c.fillStyle = `rgba(160,140,115,${0.8 * k})`; c.fill();
        }
        return;
      }
      const y = -MUZZLE[anim];
      if (anim === 'railgun_particle') {
        const k = 1 - seg(p, 0, 0.4);
        if (k <= 0) return;
        c.save(); c.globalCompositeOperation = 'lighter';
        const len = RANGE[anim];
        for (const [w, col] of [[14 * k, `rgba(60,170,255,${0.25 * k})`], [6 * k, `rgba(120,220,255,${0.7 * k})`], [2, `rgba(255,255,255,${k})`]]) {
          c.beginPath(); c.moveTo(0, y); c.lineTo(0, y - len);
          c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.stroke();
        }
        for (let i = 0; i < 9; i++) {                 // spiral rings along the beam
          const d = (i / 9) * len, r = 4 + 3 * Math.sin(i * 1.7 + p * 20);
          c.beginPath(); c.ellipse(0, y - d, r * 1.6, r * 0.5, 0, 0, Math.PI * 2);
          c.strokeStyle = `rgba(150,230,255,${0.6 * k})`; c.lineWidth = 1.2; c.stroke();
        }
        c.restore();
        flash(c, y, k, 12);
        return;
      }
      const k = 1 - seg(p, 0, 0.16);
      if (k <= 0) return;
      if (anim === 'shotgun_particle') {
        for (let i = -3; i <= 3; i++) tracer(c, y, RANGE[anim] * (0.75 + hash(i + 9) * 0.25), i * 0.1, k * 0.8, 1.2);
        flash(c, y, k, 15);
        // Smoke puff drifting forward.
        const sp = seg(p, 0.05, 0.5);
        if (sp > 0 && sp < 1) {
          c.beginPath(); c.arc(0, y - 10 - 20 * sp, 6 + 12 * sp, 0, Math.PI * 2);
          c.fillStyle = `rgba(190,190,190,${0.25 * (1 - sp)})`; c.fill();
        }
        return;
      }
      tracer(c, y, RANGE[anim], 0, k);
      flash(c, y, k, anim === 'glock_particle' ? 9 : 11);
    },
  };

  return { body, death, particles };
})();

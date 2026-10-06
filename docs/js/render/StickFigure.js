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

  // Shoot animation lengths in seconds ((frames - 1) / fps, data/anims/player.json):
  // swings are timed in seconds so a full slash fits inside the weapon's
  // cooldown (katana fires every 0.37 s), at any animation length.
  const SHOOT_DUR = {
    bat_shoot: 24 / 12, katana_shoot1: 46 / 12, katana_shoot2: 34 / 12, katana_shoot3: 34 / 12,
    laser_sword_shoot1: 22 / 12, laser_sword_shoot2: 30 / 12, laser_sword_shoot3: 28 / 12,
  };

  // Slash effect: a bright crescent swept by the blade tip out to the weapon's
  // reach, with a softer wedge behind it.
  const SLASH = {
    katana: { rgb: '230,240,255', core: '255,255,255', add: false },
    laser_sword: { rgb: '255,50,50', core: '255,235,235', add: true },
    bat: { rgb: '255,230,180', core: '255,250,235', add: false },
  };
  function slash(c, w, a0, a1, r1, k) {
    if (k <= 0.01 || Math.abs(a1 - a0) < 0.05) return;
    const S = SLASH[w], px = 0, py = -3;
    const s0 = Math.min(a0, a1) - Math.PI / 2, s1 = Math.max(a0, a1) - Math.PI / 2;
    const lead = a1 - Math.PI / 2, ccw = a1 < a0;
    c.save();
    if (S.add) c.globalCompositeOperation = 'lighter';
    // Wedge.
    const g = c.createRadialGradient(px, py, r1 * 0.3, px, py, r1 + 6);
    g.addColorStop(0, `rgba(${S.rgb},0)`); g.addColorStop(0.8, `rgba(${S.rgb},${0.22 * k})`); g.addColorStop(1, `rgba(${S.rgb},0)`);
    c.beginPath(); c.arc(px, py, r1 + 6, s0, s1); c.arc(px, py, r1 * 0.3, s1, s0, true); c.closePath();
    c.fillStyle = g; c.fill();
    // Crescent at the tip: thick at the blade, thinning towards the start.
    const N = 14;
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N;
      const t0 = ccw ? s1 - (s1 - s0) * u0 : s0 + (s1 - s0) * u0;
      const t1 = ccw ? s1 - (s1 - s0) * u1 : s0 + (s1 - s0) * u1;
      const near = ccw ? u1 : 1 - u0;   // 0 at the start of the swing, 1 at the blade
      const wv = (1 - Math.abs(near - 1)) ;
      c.beginPath(); c.arc(px, py, r1 - 3, Math.min(t0, t1), Math.max(t0, t1));
      c.strokeStyle = `rgba(${S.rgb},${0.75 * k * wv})`; c.lineWidth = 2 + 7 * wv * k; c.lineCap = 'round'; c.stroke();
      c.strokeStyle = `rgba(${S.core},${0.9 * k * wv})`; c.lineWidth = 1 + 2.5 * wv * k; c.stroke();
    }
    // Sparkle at the leading tip.
    const tx = px + Math.cos(lead) * (r1 - 3), ty = py + Math.sin(lead) * (r1 - 3);
    const sg = c.createRadialGradient(tx, ty, 0, tx, ty, 10 + 6 * k);
    sg.addColorStop(0, `rgba(${S.core},${0.9 * k})`); sg.addColorStop(1, `rgba(${S.rgb},0)`);
    c.fillStyle = sg; c.beginPath(); c.arc(tx, ty, 10 + 6 * k, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function drawBlade(c, w, anim, kind, p) {
    const idle = IDLE[w];
    const b = breathe();
    let a = idle.a + 0.03 * Math.sin(now() * 1.9), gx = idle.g[0], gy = idle.g[1] + b;
    let trailFrom = null, swingK = 0;
    const sw = SWINGS[anim];
    const s = p * (SHOOT_DUR[anim] || 2);         // seconds since the attack began
    const REACH = 27;                              // arms fully extended while slashing
    if (kind === 'shoot' && sw) {
      const [a0, a1] = sw;
      if (s < 0.05) {                              // wind-up
        a = lerp(idle.a, a0, easeOut(s / 0.05));
        const [px, py] = swingPose(a, REACH);
        gx = lerp(idle.g[0], px, s / 0.05); gy = lerp(idle.g[1], py, s / 0.05);
      } else if (s < 0.24) {                       // slash, then a short follow-through hold
        a = lerp(a0, a1, easeOut(seg(s, 0.05, 0.15)));
        [gx, gy] = swingPose(a, REACH);
      } else {                                     // recover
        const back = easeInOut(seg(s, 0.24, 0.36));
        a = lerp(a1, idle.a, back);
        const [px, py] = swingPose(a1, REACH);
        gx = lerp(px, idle.g[0], back); gy = lerp(py, idle.g[1], back);
      }
      if (s >= 0.05 && s < 0.34) { trailFrom = a0; swingK = 1 - seg(s, 0.15, 0.34); }
    } else if (kind === 'shoot') {
      // Thrust (katana/laser 3rd variant): straight out to full reach and back.
      const e = easeOut(seg(s, 0.02, 0.08)) * (1 - easeInOut(seg(s, 0.2, 0.32)));
      a = lerp(idle.a, 0, Math.min(1, seg(s, 0, 0.04) * (1 - seg(s, 0.26, 0.34))));
      gx = lerp(idle.g[0], 3, Math.min(1, seg(s, 0, 0.04))); gy = lerp(-18, -40, e);
      if (s > 0.32) { gx = lerp(2, idle.g[0], seg(s, 0.32, 0.4)); gy = lerp(gy, idle.g[1], seg(s, 0.32, 0.4)); }
      swingK = e * (1 - seg(s, 0.12, 0.26));
    }
    const len = { bat: 72, katana: 88, laser_sword: 86 }[w];
    // Tip radius ≈ the hit range (bat 138, katana/laser 125 world px).
    const tipR = REACH + 3 + len * SIZE;
    if (trailFrom !== null) slash(c, w, trailFrom, a, tipR, swingK);
    else if (kind === 'shoot' && swingK > 0) {      // thrust streak
      c.save(); if (SLASH[w].add) c.globalCompositeOperation = 'lighter';
      const g = c.createLinearGradient(0, -20, 0, -tipR - 6);
      g.addColorStop(0, `rgba(${SLASH[w].rgb},0)`); g.addColorStop(1, `rgba(${SLASH[w].core},${0.8 * swingK})`);
      c.beginPath(); c.moveTo(-5, -30); c.lineTo(0, -tipR - 8); c.lineTo(5, -30); c.closePath(); c.fillStyle = g; c.fill();
      c.restore();
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

  // Sledgehammer: rests on the right shoulder; on attack it is lifted over the
  // head and slammed straight ahead with the arms fully extended (the hit
  // lands ~0.13 s in), held a moment, then hauled back onto the shoulder.
  // p spans the 74-frame shoot animation (~6 s), so 0.01 ≈ 60 ms.
  const SLEDGE_REST = { g: [14, -9], a: 2.75, k: 0.42 };
  const SLEDGE_HIT = { g: [3, -25], a: 0, k: 0.65 };
  function sledgePose(from, to, u) {
    // Over-the-head arc: shorten towards vertical, flip direction, lengthen.
    const half = u < 0.5, v = half ? u * 2 : (u - 0.5) * 2;
    const k = half ? lerp(from.k, 0.06, v) : lerp(0.06, to.k, v);
    const a = half ? from.a : to.a;
    const gx = lerp(from.g[0], to.g[0], u), gy = lerp(from.g[1], to.g[1], u) - 8 * Math.sin(Math.PI * u);
    return { gx, gy, a, k };
  }
  function drawSledge(c, kind, p) {
    const sway = 0.03 * Math.sin(now() * 1.6), b = breathe();
    let pose = { gx: SLEDGE_REST.g[0], gy: SLEDGE_REST.g[1] + b, a: SLEDGE_REST.a + sway, k: SLEDGE_REST.k };
    if (kind === 'walk') pose.gy += 1.5 * Math.sin(now() * 9);
    if (kind === 'shoot') {
      if (p < 0.022) pose = sledgePose(SLEDGE_REST, SLEDGE_HIT, Math.pow(seg(p, 0, 0.022), 1.6));
      else if (p < 0.09) {
        const j = 1 - seg(p, 0.022, 0.035);            // impact jolt
        pose = { gx: SLEDGE_HIT.g[0], gy: SLEDGE_HIT.g[1] + 2 * j, a: 0.04 * j * Math.sin(p * 900), k: SLEDGE_HIT.k };
      } else if (p < 0.25) pose = sledgePose(SLEDGE_HIT, SLEDGE_REST, easeInOut(seg(p, 0.09, 0.25)));
      if (p > 0.012 && p < 0.03) {                    // brief motion streak on the way down
        const k = 1 - seg(p, 0.022, 0.03);
        c.save(); c.globalAlpha = 0.18 * k;
        c.fillStyle = '#e8e8e8'; c.beginPath(); c.ellipse(2, -60, 16, 34, 0, 0, Math.PI * 2); c.fill();
        c.restore();
      }
    }
    weaponAt(c, 'sledgehammer', pose.gx, pose.gy, pose.a, pose.k);
    const [lx, ly] = along(pose.gx, pose.gy, pose.a, -8);
    arms(c, [pose.gx, pose.gy], [lx, ly]);
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

  // ── Hit effects on the victim (melee) ─────────────────────────────────────
  // u: 0 → 1 over HIT_TIME; ang: direction the blow came from (radians, world).
  const HIT_TIME = { katana: 0.32, laser_sword: 0.4, bat: 0.3, fist: 0.22, sledgehammer: 0.45, chainsaw: 0.3 };
  function hit(c, w, u, ang, seed) {
    if (u >= 1) return;
    const k = 1 - u;
    c.save();
    c.rotate(ang);                               // +X = direction of the blow
    if (w === 'katana' || w === 'laser_sword') {
      const laser = w === 'laser_sword';
      if (laser) c.globalCompositeOperation = 'lighter';
      const rgb = laser ? '255,60,50' : '220,235,255', core = laser ? '255,230,220' : '255,255,255';
      const L = 46 * Math.min(1, u * 6);         // the cut opens fast
      for (const [off, tilt] of [[0, 0.55], [5, -0.5]].slice(0, laser ? 1 : 2)) {
        c.save(); c.rotate(Math.PI / 2 + tilt); c.translate(0, off);
        c.beginPath(); c.moveTo(-L, 0); c.quadraticCurveTo(0, -4 * k, L, 0); c.quadraticCurveTo(0, 4 * k, -L, 0);
        c.fillStyle = `rgba(${core},${0.95 * k})`; c.fill();
        c.lineWidth = laser ? 7 * k : 3 * k; c.strokeStyle = `rgba(${rgb},${0.6 * k})`; c.stroke();
        c.restore();
      }
      for (let i = 0; i < 9; i++) {              // sparks / embers flying on
        const a = (hash(seed + i) - 0.5) * 1.6, d = 10 + 44 * easeOut(u) * (0.5 + hash(seed * 3 + i));
        c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d, 1.8 * k + 0.4, 0, Math.PI * 2);
        c.fillStyle = `rgba(${laser ? '255,150,90' : '255,245,200'},${k})`; c.fill();
      }
    } else if (w === 'chainsaw') {
      for (let i = 0; i < 12; i++) {
        const a = (hash(seed + i) - 0.5) * 1.4, d = 8 + 40 * u * (0.4 + hash(seed + 7 * i));
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x - Math.cos(a) * 6, y - Math.sin(a) * 6);
        c.strokeStyle = `rgba(255,${180 + 60 * hash(i)},80,${k})`; c.lineWidth = 1.6; c.stroke();
      }
    } else {
      // Blunt: a star burst, a dust ring and speed lines.
      const big = w === 'sledgehammer' ? 1.6 : w === 'bat' ? 1.15 : 0.8;
      c.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8, r = (i % 2 ? 7 : 18) * big * (0.6 + 0.6 * easeOut(Math.min(1, u * 4)));
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fillStyle = `rgba(255,240,200,${0.85 * k * k})`; c.fill();
      c.beginPath(); c.arc(0, 0, (14 + 36 * easeOut(u)) * big, 0, Math.PI * 2);
      c.strokeStyle = `rgba(235,225,205,${0.6 * k})`; c.lineWidth = 3 * k + 1; c.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6 - 0.5) * 1.6, r0 = (16 + 30 * u) * big;
        c.beginPath(); c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(Math.cos(a) * (r0 + 12 * big), Math.sin(a) * (r0 + 12 * big));
        c.strokeStyle = `rgba(255,255,255,${0.8 * k})`; c.lineWidth = 2; c.stroke();
      }
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
        // Impact as the hammer lands (~0.13 s in).
        const q = seg(p, 0.04, 0.3);
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

  return { body, death, particles, hit, HIT_TIME };
})();

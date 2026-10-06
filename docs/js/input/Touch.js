// Touch controls – floating twin-stick layout for phones and tablets.
//   • Left half: drag to move (quantised to the original 8 directions).
//   • Right half: drag to aim; while the stick is pushed past the dead zone the
//     weapon fires. A quick tap fires once in the current facing direction.
//   • Toolbar under the health bar: settings, chat, scoreboard.

class TouchInput {
  static DEAD = 14;     // px (view space) before a stick registers
  static RADIUS = 58;   // visual/max stick radius in view px

  constructor() {
    this.keys = { up: false, down: false, left: false, right: false, shoot: false };
    this.move = null;   // { id, ox, oy, x, y }
    this.aim  = null;   // { id, ox, oy, x, y, t }
    this._tapUntil = 0;
    this.layer = document.getElementById('touch-layer');
    this.enabled = false;
    if (!this.layer) return;

    this._buildButtons();
    const opts = { passive: false };
    this.layer.addEventListener('pointerdown', e => this._down(e), opts);
    window.addEventListener('pointermove', e => this._move(e), opts);
    window.addEventListener('pointerup', e => this._up(e), opts);
    window.addEventListener('pointercancel', e => this._up(e), opts);
    // Any real touch anywhere flips input mode to touch.
    window.addEventListener('touchstart', () => inputMode.set('touch'), { passive: true, capture: true });
  }

  // In-game toolbar (top-left, under the health bar): settings, chat and
  // scoreboard, with SVG icons (emoji glyphs differ between phones).
  _buildButtons() {
    const ICONS = {
      settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.1 4.6-1.6-.9a6.9 6.9 0 0 0 0-2.4l1.6-.9a.6.6 0 0 0 .2-.8l-1.6-2.8a.6.6 0 0 0-.8-.2l-1.6.9a7 7 0 0 0-2.1-1.2V3a.6.6 0 0 0-.6-.6h-3.2a.6.6 0 0 0-.6.6v1.8a7 7 0 0 0-2.1 1.2l-1.6-.9a.6.6 0 0 0-.8.2L2.7 8.1a.6.6 0 0 0 .2.8l1.6.9a6.9 6.9 0 0 0 0 2.4l-1.6.9a.6.6 0 0 0-.2.8l1.6 2.8c.2.3.5.4.8.2l1.6-.9a7 7 0 0 0 2.1 1.2V21c0 .3.3.6.6.6h3.2c.3 0 .6-.3.6-.6v-1.8a7 7 0 0 0 2.1-1.2l1.6.9c.3.2.6.1.8-.2l1.6-2.8a.6.6 0 0 0-.2-.8Z"/>',
      chat: '<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 6.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"/>',
      scores: '<path d="M7 3h10v3h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 13H8a4 4 0 0 1-4-4V6h3V3Zm0 5H6v1a2 2 0 0 0 1 1.7V8Zm10 0v2.7A2 2 0 0 0 18 9V8h-1Z"/>',
    };
    const bar = document.createElement('div');
    bar.className = 'touch-bar';
    this.layer.appendChild(bar);
    const mk = (icon, labelKey, onDown) => {
      const b = document.createElement('div');
      b.className = 'touch-btn';
      b.setAttribute('role', 'button');
      b.dataset.label = labelKey;
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
      b.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); onDown(b); });
      bar.appendChild(b);
      return b;
    };
    mk('settings', 'menu.settings', () => settingsManager.open());
    mk('chat', 'touch.chat', () => { if (typeof chatManager !== 'undefined') chatManager.open(); });
    // Tap to show / hide the scoreboard (holding a button is awkward on glass).
    this._sbBtn = mk('scores', 'touch.scores', b => {
      scoreboardManager.tabHeld = !scoreboardManager.tabHeld;
      b.classList.toggle('pressed', scoreboardManager.tabHeld);
    });
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.layer) this.layer.classList.toggle('active', on);
    document.body.classList.toggle('touch-ui', on); // hides the desktop gear button
    if (!on) this._reset();
  }

  _reset() {
    this.move = this.aim = null;
    for (const k in this.keys) this.keys[k] = false;
  }

  _down(e) {
    // "Always on" touch controls must not swallow mouse clicks.
    if (e.pointerType === 'mouse') { if (typeof onMouseDown === 'function') onMouseDown(e); return; }
    e.preventDefault();
    inputMode.set('touch');
    if (typeof isUiBlocking === 'function' && isUiBlocking()) return;
    const p = display.toView(e.clientX, e.clientY);
    const r = this.layer.getBoundingClientRect();
    let leftSide = (e.clientX - r.left) < r.width / 2;
    if (settingsManager.get('touchLeftHanded')) leftSide = !leftSide; // move with the right thumb
    const s = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, t: performance.now() };
    if (leftSide && !this.move) this.move = s;
    else if (!leftSide && !this.aim) this.aim = s;
    try { this.layer.setPointerCapture(e.pointerId); } catch (_) {}
  }

  _move(e) {
    const s = (this.move && this.move.id === e.pointerId) ? this.move
            : (this.aim && this.aim.id === e.pointerId) ? this.aim : null;
    if (!s) return;
    e.preventDefault();
    const p = display.toView(e.clientX, e.clientY);
    s.x = p.x; s.y = p.y;
    // Let a floating stick follow the thumb if dragged far beyond its radius.
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), max = TouchInput.radius() * 1.6;
    if (d > max) { s.ox = s.x - dx / d * max; s.oy = s.y - dy / d * max; }
  }

  _up(e) {
    if (this.move && this.move.id === e.pointerId) this.move = null;
    if (this.aim && this.aim.id === e.pointerId) {
      const a = this.aim;
      const quick = performance.now() - a.t < 220 && Math.hypot(a.x - a.ox, a.y - a.oy) < TouchInput.DEAD;
      if (quick) this._tapUntil = performance.now() + 90; // single shot
      this.aim = null;
    }
  }

  update() {
    if (!this.enabled) return;
    const blocked = (typeof isUiBlocking === 'function' && isUiBlocking()) ||
                    (typeof chatManager !== 'undefined' && chatManager.isOpen);
    if (blocked) { for (const k in this.keys) this.keys[k] = false; return; }

    const mv = this.move ? directionToKeys(this.move.x - this.move.ox, this.move.y - this.move.oy, TouchInput.DEAD)
                         : { up: false, down: false, left: false, right: false };
    Object.assign(this.keys, mv);

    let firing = false;
    if (this.aim) {
      const dx = this.aim.x - this.aim.ox, dy = this.aim.y - this.aim.oy;
      if (Math.hypot(dx, dy) >= TouchInput.DEAD) {
        const d = Math.hypot(dx, dy);
        const vx = VIEW_W / 2 + dx / d * 150, vy = VIEW_H / 2 + dy / d * 150;
        mouseScreenX = vx; mouseScreenY = vy;
        aimAtViewPoint(vx, vy);
        firing = true;
      }
    }
    this.keys.shoot = firing || performance.now() < this._tapUntil;
  }

  // Visual stick radius in view px: bigger on phones so it matches a thumb.
  static radius() { return TouchInput.RADIUS * (display.uiScale || 1); }

  // Drawn in screen space by the HUD: a base pad with a ring, a knob that
  // follows the thumb, and an icon (move: arrows, aim: crosshair). Idle pads
  // sit in the corners so players know where to put their thumbs.
  draw(ctx) {
    if (!this.enabled) return;
    if (this._sbBtn && !scoreboardManager.tabHeld) this._sbBtn.classList.remove('pressed');
    const R = TouchInput.radius();
    const u = display.uiScale || 1;
    const swap = settingsManager.get('touchLeftHanded');
    const ex = display.extraX || 0, ey = display.extraY || 0;
    const inset = 62 + R, hy = VIEW_H + ey - 70 - R;
    const homeMove = { x: swap ? VIEW_W + ex - inset : inset - ex, y: hy };
    const homeAim  = { x: swap ? inset - ex : VIEW_W + ex - inset, y: hy };
    ctx.save();
    this._pad(ctx, this.move, homeMove, R, u, 'move');
    this._pad(ctx, this.aim, homeAim, R, u, 'aim');
    ctx.restore();
  }

  _pad(ctx, s, home, R, u, kind) {
    const active = !!s;
    const ox = active ? s.ox : home.x, oy = active ? s.oy : home.y;
    let dx = 0, dy = 0;
    if (active) {
      dx = s.x - s.ox; dy = s.y - s.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    }
    const engaged = active && Math.hypot(dx, dy) >= TouchInput.DEAD;
    const col = kind === 'move' ? [143, 198, 255] : [255, 120, 110];
    const rgba = a => `rgba(${col[0]},${col[1]},${col[2]},${a})`;
    const k = active ? 1 : 0.55;  // idle pads are quieter

    // Base disc + ring.
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(8,14,22,${0.42 * k})`;
    ctx.beginPath(); ctx.arc(ox, oy, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = rgba(0.55 * k);
    ctx.stroke();
    ctx.lineWidth = 1 * u;
    ctx.strokeStyle = `rgba(255,255,255,${0.12 * k})`;
    ctx.beginPath(); ctx.arc(ox, oy, R * 0.62, 0, Math.PI * 2); ctx.stroke();

    // Move: 8 direction marks; the one being pushed lights up.
    if (kind === 'move') {
      const dirIdx = engaged ? Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) : null;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const on = dirIdx !== null && ((dirIdx + 8) % 8) === i;
        ctx.fillStyle = on ? rgba(1) : `rgba(255,255,255,${0.35 * k})`;
        const r = R * 0.84, w = (on ? 7 : 4.5) * u;
        ctx.save();
        ctx.translate(ox + Math.cos(a) * r, oy + Math.sin(a) * r);
        ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(-w * 0.6, -w * 0.8); ctx.lineTo(-w * 0.6, w * 0.8); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    } else if (engaged) {
      // Aim: a line towards where the shots go.
      const d = Math.hypot(dx, dy);
      ctx.strokeStyle = rgba(0.6);
      ctx.lineWidth = 2 * u;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + dx / d * R * 1.25, oy + dy / d * R * 1.25); ctx.stroke();
    }

    // Knob.
    const kx = ox + dx, ky = oy + dy, kr = R * 0.42;
    const firing = kind === 'aim' && engaged;
    if (firing) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 70);
      ctx.fillStyle = rgba(0.18 + 0.17 * pulse);
      ctx.beginPath(); ctx.arc(kx, ky, kr * 1.55, 0, Math.PI * 2); ctx.fill();
    }
    const g = ctx.createRadialGradient(kx - kr * 0.35, ky - kr * 0.4, kr * 0.1, kx, ky, kr);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * k})`);
    g.addColorStop(1, rgba(0.85 * k));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = `rgba(0,0,0,${0.35 * k})`;
    ctx.stroke();

    // Icon on the knob.
    ctx.strokeStyle = `rgba(10,20,32,${0.85 * k})`;
    ctx.fillStyle = `rgba(10,20,32,${0.85 * k})`;
    ctx.lineWidth = 2 * u;
    const ir = kr * 0.55;
    if (kind === 'move') {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, w = 3.2 * u;
        ctx.save(); ctx.translate(kx + Math.cos(a) * ir, ky + Math.sin(a) * ir); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(-w, -w); ctx.lineTo(-w, w); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.beginPath(); ctx.arc(kx, ky, ir * 0.75, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(kx - ir * 1.2, ky); ctx.lineTo(kx - ir * 0.35, ky);
      ctx.moveTo(kx + ir * 0.35, ky); ctx.lineTo(kx + ir * 1.2, ky);
      ctx.moveTo(kx, ky - ir * 1.2); ctx.lineTo(kx, ky - ir * 0.35);
      ctx.moveTo(kx, ky + ir * 0.35); ctx.lineTo(kx, ky + ir * 1.2);
      ctx.stroke();
    }

    // Label under idle pads.
    if (!active) {
      const label = t(kind === 'move' ? 'hud.move' : 'hud.aim');
      ctx.font = `600 ${Math.round(11 * u)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.strokeText(label, ox, oy + R + 16 * u);
      ctx.fillText(label, ox, oy + R + 16 * u);
    }
  }
}

const touchInput = new TouchInput();

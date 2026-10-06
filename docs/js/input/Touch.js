// Touch controls – floating twin-stick layout for phones and tablets.
//   • Left half: drag to move (quantised to the original 8 directions).
//   • Right half: drag to aim; while the stick is pushed past the dead zone the
//     weapon fires. A quick tap fires once in the current facing direction.
//   • Small buttons: chat and scoreboard.

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

  _buildButtons() {
    const mk = (label, title, css) => {
      const b = document.createElement('div');
      b.className = 'touch-btn';
      b.textContent = label;
      b.title = title;
      Object.assign(b.style, css);
      this.layer.appendChild(b);
      return b;
    };
    const chat = mk('💬', 'Chat', { right: '16px', top: '64px' });
    chat.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      if (typeof chatManager !== 'undefined') chatManager.open();
    });
    const sb = mk('☰', 'Scoreboard', { right: '16px', top: '118px' });
    sb.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      sb.classList.add('pressed');
      scoreboardManager.tabHeld = true;
      const up = () => {
        sb.classList.remove('pressed');
        scoreboardManager.tabHeld = false;
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.layer) this.layer.classList.toggle('active', on);
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

  // Drawn in screen space by the HUD.
  draw(ctx) {
    if (!this.enabled) return;
    const R = TouchInput.radius();
    const u = display.uiScale || 1;
    const stick = (s, color) => {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#0a1420';
      ctx.beginPath(); ctx.arc(s.ox, s.oy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.6; ctx.stroke();
      let dx = s.x - s.ox, dy = s.y - s.oy; const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      ctx.globalAlpha = 0.7; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(s.ox + dx, s.oy + dy, R * 0.42, 0, Math.PI * 2); ctx.fill();
    };
    ctx.save();
    if (this.move) stick(this.move, '#8fc6ff');
    if (this.aim) stick(this.aim, '#ff9a8f');
    // Idle hints so new players know where to put their thumbs.
    if (!this.move && !this.aim) {
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      const swap = settingsManager.get('touchLeftHanded');
      const inset = 70 + R, hy = VIEW_H - 80 - R;
      const mx = swap ? VIEW_W - inset : inset, ax = swap ? inset : VIEW_W - inset;
      ctx.beginPath(); ctx.arc(mx, hy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(ax, hy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.45; ctx.fillStyle = '#fff'; ctx.font = `${Math.round(13 * u)}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(t('hud.move'), mx, hy + 4 * u);
      ctx.fillText(t('hud.aim'), ax, hy + 4 * u);
    }
    ctx.restore();
  }
}

const touchInput = new TouchInput();

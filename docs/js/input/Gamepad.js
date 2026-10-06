// Gamepad support (standard mapping): left stick / D-pad move, right stick aims,
// RT / A / RB attack, View/Back holds the scoreboard, Start opens settings.

class GamepadInput {
  constructor() {
    this.keys = { up: false, down: false, left: false, right: false, shoot: false };
    this.connectedName = null;
    this._prevButtons = [];
    this._scoreboardHeld = false;
    window.addEventListener('gamepadconnected', e => {
      this.connectedName = e.gamepad.id;
      if (typeof chatManager !== 'undefined') chatManager.addMessage('Server', 'Gamepad connected.', null);
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.connectedName = null;
      this._release();
    });
  }

  _pad() {
    if (!navigator.getGamepads) return null;
    // Only the W3C "standard" layout has known stick/trigger positions; other
    // mappings put triggers on axes 2/3 (resting at -1), which would hijack aim.
    for (const p of navigator.getGamepads()) if (p && p.connected && p.mapping === 'standard') return p;
    return null;
  }

  _release() {
    for (const k in this.keys) this.keys[k] = false;
    if (this._scoreboardHeld && typeof scoreboardManager !== 'undefined') scoreboardManager.tabHeld = false;
    this._scoreboardHeld = false;
  }

  // Edge + auto-repeat for held directions (400 ms delay, then every 110 ms).
  _repeat(dir, held) {
    const now = performance.now();
    this._rep = this._rep || {};
    if (!held) { delete this._rep[dir]; return false; }
    const r = this._rep[dir];
    if (!r) { this._rep[dir] = now + 400; return true; }
    if (now >= r) { this._rep[dir] = now + 110; return true; }
    return false;
  }

  _navigateUi(p, root, b, edge) {
    const ay = p.axes[1] || 0, axx = p.axes[0] || 0;
    const up = this._repeat('up', b(12) || ay < -0.6);
    const down = this._repeat('down', b(13) || ay > 0.6);
    const left = this._repeat('left', b(14) || axx < -0.6);
    const right = this._repeat('right', b(15) || axx > 0.6);
    this._release();
    inputMode.set('gamepad');

    const items = [...root.querySelectorAll('button, input, select, summary')]
      .filter(el => !el.disabled && el.offsetParent !== null && !el.closest('[hidden]'));
    if (!items.length) return;
    let i = items.indexOf(document.activeElement);
    const focus = (j) => { const el = items[(j + items.length) % items.length]; el.focus({ preventScroll: false }); el.scrollIntoView({ block: 'nearest' }); };

    if (up) { focus(i < 0 ? 0 : i - 1); return; }
    if (down) { focus(i < 0 ? 0 : i + 1); return; }

    const el = i >= 0 ? items[i] : null;
    if ((left || right) && el) {
      const d = right ? 1 : -1;
      if (el.type === 'range') {
        el.value = String(Math.max(+el.min, Math.min(+el.max, +el.value + d * 5)));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.tagName === 'SELECT') {
        el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + d));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        focus(i + d);
      }
      return;
    }

    if (edge(0)) {
      const target = el || root.querySelector('.menu-play:not([disabled])') || items[0];
      const wasMenu = typeof menu !== 'undefined' && menu.isOpen;
      target.click();
      // Starting the game with A must not also fire a shot.
      if (wasMenu && !menu.isOpen) this._suppressA = true;
      return;
    }
    if (edge(1) || edge(9)) {               // B / Start: back out
      if (settingsManager.isOpen()) settingsManager.close();
      else if (typeof menu !== 'undefined' && menu.isOpen && edge(9)) menu.play();
    }
  }

  rumble(strong = 0.5, weak = 0.3, ms = 120) {
    const p = this._pad();
    const act = p && p.vibrationActuator;
    if (act && act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }

  poll() {
    const p = this._pad();
    if (!p) { if (this.connectedName === null) return; this._release(); return; }
    this.connectedName = p.id;

    const b = i => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.3));
    const edge = i => b(i) && !this._prevButtons[i];

    // Menus: D-pad / left stick move focus, A activates, B closes, ←/→ adjust.
    const uiRoot = settingsManager.isOpen() ? settingsManager._panel
                 : (typeof menu !== 'undefined' && menu.isOpen) ? menu.el : null;
    if (uiRoot && !(typeof chatManager !== 'undefined' && chatManager.isOpen)) {
      this._navigateUi(p, uiRoot, b, edge);
      this._prevButtons = p.buttons.map(x => x.pressed);
      return;
    }

    // Start → settings (edge-triggered so holding doesn't flicker).
    if (edge(9) && typeof settingsManager !== 'undefined') {
      if (typeof menu !== 'undefined' && menu.isOpen) menu.play();
      else settingsManager.toggle();
    }

    const blocked = (typeof isUiBlocking === 'function' && isUiBlocking()) ||
                    (typeof chatManager !== 'undefined' && chatManager.isOpen);
    if (blocked) {
      this._release();
      this._prevButtons = p.buttons.map(x => x.pressed);
      return;
    }

    // Movement: D-pad wins over the stick.
    const dpad = { up: b(12), down: b(13), left: b(14), right: b(15) };
    const stick = directionToKeys(p.axes[0] || 0, p.axes[1] || 0, 0.35);
    const anyDpad = dpad.up || dpad.down || dpad.left || dpad.right;
    const mv = anyDpad ? dpad : stick;
    Object.assign(this.keys, mv);

    // Aim with the right stick; the aim persists when the stick is released.
    const ax = p.axes[2] || 0, ay = p.axes[3] || 0;
    const mag = Math.hypot(ax, ay);
    let active = anyDpad || stick.up || stick.down || stick.left || stick.right;
    if (mag > 0.3) {
      active = true;
      const r = 150;
      const vx = VIEW_W / 2 + (ax / mag) * r, vy = VIEW_H / 2 + (ay / mag) * r;
      mouseScreenX = vx; mouseScreenY = vy;
      aimAtViewPoint(vx, vy);
    }

    if (this._suppressA && !b(0)) this._suppressA = false;
    this.keys.shoot = b(7) || (b(0) && !this._suppressA) || b(5);
    if (this.keys.shoot) active = true;

    // View/Back held → scoreboard.
    const sb = b(8);
    if (sb !== this._scoreboardHeld && typeof scoreboardManager !== 'undefined') {
      scoreboardManager.tabHeld = sb;
      this._scoreboardHeld = sb;
    }

    if (active) inputMode.set('gamepad');
    this._prevButtons = p.buttons.map(x => x.pressed);
  }
}

const gamepadInput = new GamepadInput();

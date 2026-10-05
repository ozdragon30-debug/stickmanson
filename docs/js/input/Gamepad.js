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
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  _release() {
    for (const k in this.keys) this.keys[k] = false;
    if (this._scoreboardHeld && typeof scoreboardManager !== 'undefined') scoreboardManager.tabHeld = false;
    this._scoreboardHeld = false;
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

    this.keys.shoot = b(7) || b(0) || b(5);
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

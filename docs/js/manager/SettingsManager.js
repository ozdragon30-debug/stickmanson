// Player preferences: stored in localStorage and edited through the settings
// dialog (opened with Esc or the gear button). Everything in here is cosmetic
// or comfort related; none of it affects how a match plays out.

// Factory values. A handful of the identity fields are re-rolled at startup
// for brand-new players (see SettingsManager's constructor).
const DEFAULT_SETTINGS = {
  name:              'Player',
  cursorIndex:       0,
  spinnerShapeIndex: 0,
  spinnerHue:        0,

  volume:            0.5,
  muted:             false,
  spatialAudio:      true,

  renderQuality:     'auto',   // 'auto' | 'high' | 'low'
  viewMode:          'wide',   // 'wide' | 'classic' | 'off' (handled by Display.js)
  fpsLimit:          'auto',   // 'auto' | 'unlimited' | '240' | '144' | '120' | '60' | '30'
  pixelArt:          false,    // nearest-neighbour scaling for sprites
  modernFx:          true,     // shadows / glow / light passes (visual only)
  showFps:           false,
  showPing:          true,

  damageFlash:       true,
  hitMarkers:        true,
  killFeed:          true,

  touchControls:     'auto',   // 'auto' | 'on' | 'off'
  touchLeftHanded:   false,    // mirror the move and aim sticks
  language:          'auto',   // 'auto' | 'en' | 'tr'
  keybinds: {
    up:     'KeyW',
    left:   'KeyA',
    down:   'KeyS',
    right:  'KeyD',
    shoot:  'Space',
    sprint: 'ShiftLeft',
  },
};

// Older saves stored binds as KeyboardEvent.key values. Only the shipped
// defaults are upgraded to physical key codes; anything the player picked
// themselves stays as-is so keyMatches() keeps honouring their layout.
const LEGACY_DEFAULTS = { up: 'w', left: 'a', down: 's', right: 'd', shoot: ' ', sprint: 'Shift' };
function migrateBind(action, bound) {
  const wasOldDefault = typeof bound === 'string' && bound !== '' && LEGACY_DEFAULTS[action] === bound;
  return wasOldDefault ? DEFAULT_SETTINGS.keybinds[action] : bound;
}

class SettingsManager {
  static getInstance() {
    SettingsManager.instance ??= new SettingsManager();
    return SettingsManager.instance;
  }

  constructor() {
    const stored = SettingsManager._readStorage();

    // A first-time player gets a random look and name. The order of these
    // random draws is relied upon by the seeded regression run.
    if (stored.spinnerHue == null)        DEFAULT_SETTINGS.spinnerHue        = Math.floor(Math.random() * 360);
    if (stored.spinnerShapeIndex == null) DEFAULT_SETTINGS.spinnerShapeIndex = Math.floor(Math.random() * 4); // one of the free shapes
    if (stored.cursorIndex == null)       DEFAULT_SETTINGS.cursorIndex       = Math.floor(Math.random() * 8);
    if (!stored.name) DEFAULT_SETTINGS.name = 'Player' + Math.random().toString(36).slice(2, 5).toUpperCase();

    SettingsManager._upgradeLegacy(stored);

    this.settings    = SettingsManager._withDefaults(stored);
    this.isFirstRun  = !stored.name;
    this._isOpen     = false;
    this._awaitingBind = null;   // action currently waiting for a key press
    this._activeTab  = 'profile';
    this._subscribers = [];

    this._createDialog();
    this._createGearButton();
    this._persist();

    // Capture phase: we must see Esc / rebind presses before Keyboard.js does.
    document.addEventListener('keydown', ev => this._handleKeydown(ev), true);
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  static _readStorage() {
    try {
      return JSON.parse(localStorage.getItem('sar_settings') || '{}') || {};
    } catch (err) {
      return {};
    }
  }

  // Rewrites values written by older builds, in place.
  static _upgradeLegacy(stored) {
    if (stored.fpsLimit === 'off') stored.fpsLimit = 'auto';   // former name of the default mode
    if (stored.wideScreen === false && stored.viewMode == null) stored.viewMode = 'off';
    delete stored.wideScreen;
  }

  static _withDefaults(stored) {
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    const binds = { ...DEFAULT_SETTINGS.keybinds };
    for (const [action, bound] of Object.entries(stored.keybinds || {})) binds[action] = migrateBind(action, bound);
    merged.keybinds = binds;
    return merged;
  }

  _persist() {
    try {
      localStorage.setItem('sar_settings', JSON.stringify(this.settings));
    } catch (err) { /* storage unavailable: keep running with in-memory values */ }
  }

  // ── Read / write API ──────────────────────────────────────────────────────
  get name()              { return this.settings.name; }
  get cursorIndex()       { return this.settings.cursorIndex; }
  get spinnerShapeIndex() { return this.settings.spinnerShapeIndex; }
  get spinnerHue()        { return this.settings.spinnerHue; }

  isOpen()       { return this._isOpen; }
  get(key)       { return this.settings[key]; }
  getKey(action) { return this.settings.keybinds[action] ?? ''; }

  set(key, value) {
    this.settings[key] = value;
    this._persist();
    this._subscribers.forEach(cb => cb(key, value));
    if (this._isOpen) this._syncControls();
  }

  // Registers cb(key, value) for future changes. Unless immediate is false, cb
  // is also called right away for every current setting.
  onChange(cb, { immediate = true } = {}) {
    this._subscribers.push(cb);
    if (!immediate) return;
    for (const key in this.settings) cb(key, this.settings[key]);
  }

  setName(raw) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (name === '') return;
    this.settings.name = name;
    this._persist();
    if (typeof playerManager !== 'undefined' && playerManager.mainPlayer) playerManager.mainPlayer.name = name;
    if (typeof socketManager !== 'undefined') socketManager.emit('setName', { name });
  }

  // Everything except the player's identity (name, cursor, spinner) goes back
  // to its default, notifying subscribers per key.
  resetDefaults() {
    const preserved = new Set(['name', 'cursorIndex', 'spinnerShapeIndex', 'spinnerHue']);
    const factory = SettingsManager._withDefaults({});
    for (const key in factory) {
      if (!preserved.has(key)) this.set(key, factory[key]);
    }
    this.settings.keybinds = { ...DEFAULT_SETTINGS.keybinds };
    this._persist();
    this._refresh();
  }

  // ── Showing / hiding the dialog ───────────────────────────────────────────
  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  }

  open(tab) {
    this._isOpen = true;
    this._awaitingBind = null;
    if (tab) this._activeTab = tab;
    if (typeof onBlurHandler === 'function') onBlurHandler();
    this._returnFocus = document.activeElement;
    this._overlay.classList.add('open');
    // The dialog is modal, so the menu underneath must not be focusable.
    if (typeof menu !== 'undefined' && menu.el) menu.el.inert = true;
    this._refresh();
    const currentTab = this._panel.querySelector('.sar-tabs button.sel');
    if (currentTab) currentTab.focus({ preventScroll: true });
  }

  close() {
    this._isOpen = false;
    this._awaitingBind = null;
    this._overlay.classList.remove('open');

    // A name typed without pressing Enter still counts.
    const typed = this._panel.querySelector('#sar-name').value;
    if (typed.trim() && typed.trim() !== this.settings.name) this.setName(typed);
    this._pushIdentity();

    const menuPresent = typeof menu !== 'undefined';
    // Otherwise the menu's own name box would resend the old name on Play.
    if (menuPresent && menu.nameEl) menu.syncName();
    if (menuPresent && menu.el) menu.el.inert = false;

    const back = this._returnFocus;
    if (menuPresent && menu.isOpen && back && back.isConnected) {
      back.focus({ preventScroll: true });
    } else if (document.activeElement && document.activeElement !== document.body) {
      // During play a focused button would swallow game keys, so drop focus.
      document.activeElement.blur();
    }
    this._returnFocus = null;
  }

  // Sends name + spinner look to the local player and the server.
  _pushIdentity() {
    if (typeof playerManager === 'undefined' || !playerManager.mainPlayer) return;
    const me = playerManager.mainPlayer;
    me.name                = this.settings.name;
    me.indicatorHue        = this.settings.spinnerHue;
    me.indicatorShapeIndex = this.settings.spinnerShapeIndex;
    if (typeof socketManager === 'undefined') return;
    socketManager.emit('setName', { name: this.settings.name });
    socketManager.emit('playerIdentity', shopManager.identity());
  }

  // Like _pushIdentity but leaves the name alone; used after shop changes.
  _syncIdentity() {
    if (typeof playerManager === 'undefined' || !playerManager.mainPlayer) return;
    const me = playerManager.mainPlayer;
    // A different perk can lower max health: clamp so we never exceed it.
    if (!me.isRespawning) me.health = Math.min(me.health, me.maxHealth());
    me.indicatorHue        = this.settings.spinnerHue;
    me.indicatorShapeIndex = this.settings.spinnerShapeIndex;
    if (typeof socketManager !== 'undefined') socketManager.emit('playerIdentity', shopManager.identity());
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  _handleKeydown(ev) {
    if (this._awaitingBind) {
      this._captureBind(ev);
      return;
    }
    if (ev.key !== 'Escape') return;
    if (typeof chatManager !== 'undefined' && chatManager.isOpen) return;
    if (this._isOpen) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.close();
      return;
    }
    if (typeof menu !== 'undefined' && menu.isOpen) return; // the menu deals with Esc
    ev.preventDefault();
    this.open();
  }

  // The rebind press is swallowed completely. Esc, Enter (chat) and Tab are
  // reserved: they end the wait without changing anything.
  _captureBind(ev) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const action = this._awaitingBind;
    const reserved = ev.key === 'Escape' || ev.key === 'Enter' || ev.key === 'Tab';
    if (!reserved) {
      const binds = this.settings.keybinds;
      // One key, one action: clear the code from wherever it was bound before.
      for (const other in binds) if (binds[other] === ev.code) binds[other] = '';
      binds[action] = ev.code;
    }
    this._awaitingBind = null;
    this._persist();
    this._renderKeybinds();
    this._focusKeyButton(action);
  }

  // ── Dialog construction ───────────────────────────────────────────────────
  static _markup() {
    const check = (setting, body) =>
      `<label class="sar-check"><input type="checkbox" data-setting="${setting}"> ${body}</label>`;

    const profilePane = `
      <section data-pane="profile">
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-name" data-i18n="set.name">Player Name</label>
          <input id="sar-name" type="text" maxlength="20" autocomplete="nickname" class="sar-text">
        </div>
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-lang" data-i18n="set.language">Language</label>
          <select id="sar-lang" class="sar-select" data-setting="language">
            <option value="auto" data-i18n="set.lang.auto">Auto (browser)</option>
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
        </div>
        <div class="sar-sec">
          <div class="sar-lbl" data-i18n="set.cursor">Cursor</div>
          <div id="sar-cursor-grid" class="sar-grid"></div>
        </div>
        <div class="sar-sec">
          <div class="sar-lbl"><span data-i18n="set.spinner">Spinner Shape</span> — <span class="sar-coins" id="sar-coins"></span></div>
          <div class="sar-hint" data-i18n="shop.hint"></div>
          <div id="sar-spin-grid" class="sar-grid sar-scroll"></div>
          <div id="sar-spin-info" class="sar-spin-info"></div>
        </div>
        <div class="sar-sec">
          <div class="sar-lbl" data-i18n="shop.pet">Pet</div>
          <div class="sar-hint" data-i18n="shop.petHint"></div>
          <div id="sar-pet-grid" class="sar-grid"></div>
          <div id="sar-pet-info" class="sar-spin-info"></div>
        </div>
        <div class="sar-sec sar-vip">
          <div class="sar-lbl">VIP <span class="sar-vip-badge">★</span></div>
          <ul class="sar-vip-list">
            <li data-i18n="vip.coins">+20% coins from every kill and round</li>
            <li data-i18n="vip.name">Gold name above your player</li>
            <li data-i18n="vip.more">More VIP spinners and pets are coming</li>
          </ul>
          <button class="sar-btn sar-buy" id="sar-vip-btn" disabled></button>
        </div>
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-hue"><span data-i18n="set.color">Spinner Color</span> — <span id="sar-hue-lbl"></span></label>
          <input id="sar-hue" type="range" min="0" max="360" class="sar-range">
          <div class="sar-hue-bar"></div>
        </div>
      </section>`;

    const controlsPane = `
      <section data-pane="controls">
        <div class="sar-sec">
          <div class="sar-lbl"><span data-i18n="set.keybinds">Keybinds</span> <span class="sar-hint" data-i18n="set.arrows">(arrow keys always move too)</span></div>
          <div id="sar-keybinds"></div>
        </div>
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-touch" data-i18n="set.touch">Touch Controls</label>
          <select id="sar-touch" class="sar-select" data-setting="touchControls">
            <option value="auto" data-i18n="set.touch.auto">Auto (touch screens)</option>
            <option value="on" data-i18n="set.touch.on">Always on</option>
            <option value="off" data-i18n="set.touch.off">Off</option>
          </select>
          ${check('touchLeftHanded', '<span data-i18n="set.touch.left">Left-handed (aim with the left thumb)</span>')}
        </div>
        <div class="sar-sec sar-help">
          <div class="sar-lbl" data-i18n="set.gamepad">Gamepad</div>
          <span data-i18n="set.gamepad.help">Left stick / D-pad: move · Right stick: aim · RT / A: attack · Back/View: scoreboard · Start: settings</span>
          <div id="sar-pad-status" class="sar-hint"></div>
        </div>
      </section>`;

    const audioPane = `
      <section data-pane="audio">
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-volume"><span data-i18n="set.volume">Volume</span> — <span id="sar-vol-lbl"></span></label>
          <input id="sar-volume" type="range" min="0" max="100" class="sar-range">
        </div>
        ${check('muted', '<span data-i18n="set.mute">Mute all sounds</span> <kbd>M</kbd>')}
        ${check('spatialAudio', '<span data-i18n="set.spatial">Positional audio</span> <span class="sar-hint" data-i18n="set.spatial.hint">— pan &amp; soften other players\' sounds by distance</span>')}
      </section>`;

    const videoPane = `
      <section data-pane="video">
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-res" data-i18n="set.res">Render Resolution</label>
          <select id="sar-res" class="sar-select" data-setting="renderQuality">
            <option value="auto" data-i18n="set.res.auto">Auto (sharp, up to 2×)</option>
            <option value="high" data-i18n="set.res.high">High (native, up to 3×)</option>
            <option value="low" data-i18n="set.res.low">Low (1× – fastest)</option>
          </select>
        </div>
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-fps" data-i18n="set.fpsLimit">Frame rate limit</label>
          <select id="sar-fps" class="sar-select" data-setting="fpsLimit">
            <option value="auto" data-i18n="set.fpsLimit.auto">Auto (refresh rate, steady 60 if the device can't keep up)</option>
            <option value="unlimited" data-i18n="set.fpsLimit.off">Monitor refresh rate (unlimited)</option>
            ${['240', '144', '120', '60'].map(fps => `<option value="${fps}">${fps} FPS</option>`).join('')}
            <option value="30" data-i18n="set.fpsLimit.30">30 FPS (battery saver)</option>
          </select>
        </div>
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-view" data-i18n="set.view">Screen</label>
          <select id="sar-view" class="sar-select" data-setting="viewMode">
            <option value="wide" data-i18n="set.view.wide">Fill screen (bigger, same view area)</option>
            <option value="classic" data-i18n="set.view.classic">Classic 4:3 (dimmed map at the sides)</option>
            <option value="off" data-i18n="set.view.off">Classic 4:3 (black bars)</option>
          </select>
        </div>
        ${check('pixelArt', '<span data-i18n="set.pixel">Pixel-art scaling</span> <span class="sar-hint" data-i18n="set.pixel.hint">— crisp nearest-neighbour sprites</span>')}
        ${check('showFps', '<span data-i18n="set.fps">Show FPS</span>')}
        ${check('showPing', '<span data-i18n="set.ping">Show ping</span>')}
        <div class="sar-sec" style="margin-top:14px">
          <button id="sar-fullscreen" class="sar-btn"><span data-i18n="set.fullscreen">Toggle Fullscreen</span> <kbd>F11</kbd></button>
        </div>
      </section>`;

    const hudPane = `
      <section data-pane="hud">
        ${check('killFeed', '<span data-i18n="set.killfeed">Kill feed</span>')}
        ${check('hitMarkers', '<span data-i18n="set.hitmarkers">Hit markers</span>')}
        ${check('damageFlash', '<span data-i18n="set.damageflash">Damage flash</span>')}
      </section>`;

    return `
      <div class="sar-head">
        <span class="sar-title"><span data-i18n="set.title">Settings</span> <kbd>Esc</kbd></span>
        <button id="sar-close" class="sar-x" aria-label="Close settings">✕</button>
      </div>
      <nav class="sar-tabs" role="tablist">
        <button role="tab" data-tab="profile" data-i18n="set.tab.profile">Profile</button>
        <button role="tab" data-tab="controls" data-i18n="set.tab.controls">Controls</button>
        <button role="tab" data-tab="audio" data-i18n="set.tab.audio">Audio</button>
        <button role="tab" data-tab="video" data-i18n="set.tab.video">Video</button>
        <button role="tab" data-tab="hud" data-i18n="set.tab.hud">HUD</button>
      </nav>
      ${profilePane}
      ${controlsPane}
      ${audioPane}
      ${videoPane}
      ${hudPane}
      <div class="sar-foot">
        <button id="sar-reset" class="sar-btn sar-btn-ghost" data-i18n="set.reset">Reset to defaults</button>
        <span class="sar-foot-right">
          <button id="sar-menu" class="sar-btn sar-btn-ghost" data-i18n="set.menu">Main menu</button>
          <button id="sar-done" class="sar-btn" data-i18n="set.done">Done</button>
        </span>
      </div>`;
  }

  _createDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'sar-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Settings');
    // Keep presses away from the game canvas; a click on the backdrop closes.
    overlay.addEventListener('mousedown', ev => ev.stopPropagation());
    overlay.addEventListener('click', ev => { if (ev.target === overlay) this.close(); });

    const panel = document.createElement('div');
    panel.className = 'sar-panel';
    panel.innerHTML = SettingsManager._markup();
    const $ = sel => panel.querySelector(sel);

    $('#sar-close').onclick = () => this.close();
    $('#sar-done').onclick  = () => this.close();
    $('#sar-menu').onclick  = () => {
      this.close();
      if (typeof menu !== 'undefined') menu.open();
    };
    $('#sar-reset').onclick = () => this.resetDefaults();

    const fullscreenBtn = $('#sar-fullscreen');
    fullscreenBtn.onclick = () => toggleFullscreen();
    // The Android build is always fullscreen, and iPhones have no API for it.
    if (window.Capacitor || !document.fullscreenEnabled) fullscreenBtn.parentElement.hidden = true;

    this._wireTabs([...panel.querySelectorAll('.sar-tabs button')]);

    $('#sar-name').addEventListener('change', ev => this.setName(ev.target.value));
    $('#sar-hue').addEventListener('input', ev => {
      this.settings.spinnerHue = +ev.target.value;
      this._persist();
      this._updateHueLabel();
      this._renderSpinnerGrid();   // recolour the previews as the slider moves
      this._syncIdentity();
    });
    $('#sar-volume').addEventListener('input', ev => this.set('volume', +ev.target.value / 100));
    for (const control of panel.querySelectorAll('[data-setting]')) {
      control.addEventListener('change', () => {
        const value = control.type === 'checkbox' ? control.checked : control.value;
        this.set(control.dataset.setting, value);
      });
    }

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    i18n.applyDom(panel);
    this._overlay = overlay;
    this._panel   = panel;
  }

  // Click selects a tab; Left/Right arrows cycle through them (ARIA tabs pattern).
  _wireTabs(buttons) {
    const count = buttons.length;
    buttons.forEach((btn, idx) => {
      btn.onclick = () => {
        this._activeTab = btn.dataset.tab;
        this._showActiveTab();
      };
      btn.addEventListener('keydown', ev => {
        let step;
        if (ev.key === 'ArrowRight') step = 1;
        else if (ev.key === 'ArrowLeft') step = count - 1;
        else return;
        ev.preventDefault();
        const target = buttons[(idx + step) % count];
        target.focus();
        target.click();
      });
    });
  }

  // Floating ⚙ button. With a mouse it fades after 2.5 s of no movement.
  _createGearButton() {
    const gear = document.createElement('button');
    gear.className = 'sar-gear';
    gear.textContent = '⚙';
    gear.title = 'Settings [Esc]';
    gear.setAttribute('aria-label', 'Settings');
    gear.tabIndex = -1;
    gear.addEventListener('mousedown', ev => ev.stopPropagation());
    gear.addEventListener('touchstart', ev => ev.stopPropagation(), { passive: true });
    gear.addEventListener('click', () => this.toggle());
    (document.getElementById('stage') || document.body).appendChild(gear);
    this._gearBtn = gear;

    let fadeTimer = null;
    const fadeIfIdle = () => {
      const usingTouch = typeof inputMode !== 'undefined' && inputMode.mode === 'touch';
      if (!usingTouch && !this._isOpen) gear.classList.add('idle');
    };
    window.addEventListener('pointermove', ev => {
      if (ev.pointerType !== 'mouse') return;
      gear.classList.remove('idle');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(fadeIfIdle, 2500);
    });
    window.addEventListener('touchstart', () => gear.classList.remove('idle'), { passive: true });
  }

  // ── Bringing the dialog up to date ────────────────────────────────────────
  // Also called from game.js when the language changes.
  _refresh() {
    i18n.applyDom(this._panel);
    this._panel.querySelector('#sar-name').value = this.settings.name;
    this._panel.querySelector('#sar-hue').value  = this.settings.spinnerHue;
    this._updateHueLabel();
    this._syncControls();
    this._renderCursorGrid();
    this._renderSpinnerGrid();
    this._renderPetGrid();
    this._renderKeybinds();
    this._showActiveTab();
  }

  _showActiveTab() {
    const active = this._activeTab;
    for (const btn of this._panel.querySelectorAll('.sar-tabs button')) {
      const on = btn.dataset.tab === active;
      btn.classList.toggle('sel', on);
      btn.setAttribute('aria-selected', on);
    }
    for (const pane of this._panel.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== active;

    const padStatus = this._panel.querySelector('#sar-pad-status');
    if (!padStatus) return;
    const padName = typeof gamepadInput !== 'undefined' ? gamepadInput.connectedName : null;
    padStatus.textContent = padName ? t('set.gamepad.on', { name: padName }) : t('set.gamepad.none');
  }

  // Pushes stored values into the bound form controls and the volume slider.
  _syncControls() {
    for (const control of this._panel.querySelectorAll('[data-setting]')) {
      const value = this.settings[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = !!value;
      else control.value = value;
    }
    const percent = Math.round(this.settings.volume * 100);
    this._panel.querySelector('#sar-volume').value = percent;
    this._panel.querySelector('#sar-vol-lbl').textContent = percent + '%';
  }

  _updateHueLabel() {
    const label = this._panel.querySelector('#sar-hue-lbl');
    if (label) label.textContent = this.settings.spinnerHue + '°';
  }

  // Draws a sprite frame centred on a fresh square canvas.
  static _framePreview(source, frame, size, scale, alpha = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (source) {
      if (alpha !== 1) ctx.globalAlpha = alpha;
      const w = frame.w * scale, h = frame.h * scale;
      ctx.drawImage(source.image, source.x, source.y, frame.w, frame.h, (size - w) / 2, (size - h) / 2, w, h);
    }
    return canvas;
  }

  static _priceTag(price) {
    const tag = document.createElement('span');
    tag.className = 'sar-price';
    tag.textContent = price;
    return tag;
  }

  static _buyButton(price, onBuy) {
    const canAfford = shopManager.coins >= price;
    const btn = document.createElement('button');
    btn.className = 'sar-btn sar-buy';
    btn.textContent = canAfford ? `${t('shop.buy')} — ${price}` : `${t('shop.need')} (${price})`;
    btn.disabled = !canAfford;
    btn.onclick = onBuy;
    return btn;
  }

  // ── Cursor picker ─────────────────────────────────────────────────────────
  _renderCursorGrid() {
    const grid = this._panel.querySelector('#sar-cursor-grid');
    grid.innerHTML = '';
    const anims = Object.keys(cursorAtlas.animationMap);
    const chosen = this.settings.cursorIndex % anims.length;
    anims.forEach((anim, idx) => {
      const frame = cursorAtlas.getFrameData(anim, 0);
      if (!frame) return;
      const scale = Math.min(2.8, 34 / Math.max(frame.w, frame.h));
      const source = { image: cursorAtlas.image, x: frame.x, y: frame.y };
      const tile = document.createElement('button');
      tile.className = idx === chosen ? 'sar-tile sel' : 'sar-tile';
      tile.title = `Cursor ${idx + 1}`;
      tile.setAttribute('aria-label', `Cursor ${idx + 1}`);
      tile.appendChild(SettingsManager._framePreview(source, frame, 46, scale));
      tile.onclick = () => {
        this.settings.cursorIndex = idx;
        this._persist();
        grid.querySelectorAll('.sar-tile').forEach((el, j) => el.classList.toggle('sel', j === idx));
      };
      grid.appendChild(tile);
    });
  }

  // ── Spinner shop ──────────────────────────────────────────────────────────
  _renderSpinnerGrid() {
    const grid = this._panel.querySelector('#sar-spin-grid');
    grid.innerHTML = '';
    const anims = Object.keys(indicatorAtlas.animationMap);
    const equipped = this.settings.spinnerShapeIndex % anims.length;
    if (this._spinFocus == null) this._spinFocus = equipped;

    anims.forEach((anim, idx) => {
      const frame = indicatorAtlas.getFrameData(anim, 0);
      if (!frame) return;
      const owned = shopManager.owns(idx);
      const tinted = tintCache.get(indicatorAtlas, frame, this.settings.spinnerHue);
      const source = tinted && { image: tinted.canvas, x: tinted.x, y: tinted.y };
      const scale = Math.min(1.6, 40 / Math.max(frame.w, frame.h));
      const canvas = SettingsManager._framePreview(source, frame, 40, scale, owned ? 1 : 0.45);

      const perk = ShopManager.perk(idx);
      const classes = ['sar-tile', 'sar-tile-sm'];
      if (idx === equipped) classes.push('sel');
      if (!owned) classes.push('locked');
      if (idx === this._spinFocus) classes.push('focus');
      if (perk.stat) classes.push('perk-' + perk.stat);

      const tile = document.createElement('button');
      tile.className = classes.join(' ');
      tile.setAttribute('aria-label', `Spinner ${idx + 1}: ${ShopManager.perkLabel(idx)}`);
      tile.appendChild(canvas);
      if (!owned) tile.appendChild(SettingsManager._priceTag(perk.price));
      tile.onclick = () => {
        this._spinFocus = idx;
        if (shopManager.owns(idx)) this._equipSpinner(idx);
        this._renderSpinnerGrid();
      };
      grid.appendChild(tile);
    });
    this._renderSpinnerInfo();
  }

  _equipSpinner(idx) {
    this.settings.spinnerShapeIndex = idx;
    this._persist();
    this._syncIdentity();
  }

  // Coin balance plus details of the focused spinner (and a Buy button if locked).
  _renderSpinnerInfo() {
    const coinsEl = this._panel.querySelector('#sar-coins');
    if (coinsEl) coinsEl.textContent = `${t('shop.coins')}: ${shopManager.coins}`;
    const box = this._panel.querySelector('#sar-spin-info');
    if (!box) return;

    const idx = this._spinFocus ?? this.settings.spinnerShapeIndex;
    box.innerHTML = '';
    const summary = document.createElement('span');
    summary.textContent = `#${idx + 1} · ${ShopManager.perkLabel(idx)}`;
    box.appendChild(summary);

    if (!shopManager.owns(idx)) {
      box.appendChild(SettingsManager._buyButton(ShopManager.perk(idx).price, () => {
        if (!shopManager.buy(idx)) return;
        this._equipSpinner(idx);
        this._renderSpinnerGrid();
      }));
      return;
    }
    if (idx === this.settings.spinnerShapeIndex) {
      const note = document.createElement('span');
      note.className = 'sar-hint';
      note.textContent = ' ✓ ' + t('shop.equipped');
      box.appendChild(note);
    }
  }

  // ── Pet shop ──────────────────────────────────────────────────────────────
  // Slot -1 is "no pet", drawn as a crossed-out circle.
  _renderPetGrid() {
    const grid = this._panel.querySelector('#sar-pet-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (this._petFocus == null) this._petFocus = shopManager.pet;

    for (let id = -1; id < ShopManager.PETS.length; id++) {
      const owned = id === -1 || shopManager.ownsPet(id);
      const classes = ['sar-tile', 'sar-tile-pet'];
      if (id === shopManager.pet) classes.push('sel');
      if (!owned) classes.push('locked');
      if (id === this._petFocus) classes.push('focus');

      const tile = document.createElement('button');
      tile.className = classes.join(' ');
      tile.appendChild(SettingsManager._petPreview(id, owned));
      if (!owned) tile.appendChild(SettingsManager._priceTag(ShopManager.PETS[id].price));
      tile.setAttribute('aria-label', id < 0 ? t('shop.none') : t(ShopManager.PETS[id].name));
      tile.onclick = () => {
        this._petFocus = id;
        if (id === -1 || shopManager.ownsPet(id)) {
          shopManager.equipPet(id);
          this._syncIdentity();
        }
        this._renderPetGrid();
      };
      grid.appendChild(tile);
    }
    this._renderPetInfo();
  }

  static _petPreview(id, owned) {
    const canvas = document.createElement('canvas');
    canvas.width = 46;
    canvas.height = 46;
    const ctx = canvas.getContext('2d');
    if (id < 0) {
      ctx.strokeStyle = '#556677';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(23, 23, 10, 0, Math.PI * 2);
      ctx.moveTo(16, 30);
      ctx.lineTo(30, 16);
      ctx.stroke();
      return canvas;
    }
    ctx.translate(23, 25);
    ctx.scale(1.45, 1.45);
    if (!owned) ctx.globalAlpha = 0.55;
    Pets.draw(ctx, id, 0.4, false);
    return canvas;
  }

  // Focused pet's details / Buy button, and the VIP button caption.
  _renderPetInfo() {
    const vipBtn = this._panel.querySelector('#sar-vip-btn');
    if (vipBtn) vipBtn.textContent = shopManager.vip ? '★ ' + t('vip.active') : t('vip.soon');
    const box = this._panel.querySelector('#sar-pet-info');
    if (!box) return;

    const id = this._petFocus;
    box.innerHTML = '';
    const summary = document.createElement('span');
    summary.textContent = id < 0 ? t('shop.none') : `${t(ShopManager.PETS[id].name)} · ${ShopManager.petLabel(id)}`;
    box.appendChild(summary);
    if (id < 0 || shopManager.ownsPet(id)) return;

    box.appendChild(SettingsManager._buyButton(ShopManager.PETS[id].price, () => {
      if (!shopManager.buyPet(id)) return;
      this._syncIdentity();
      this._renderPetGrid();
      this._renderSpinnerInfo();
    }));
  }

  // ── Key bindings ──────────────────────────────────────────────────────────
  // Rows are rebuilt after every change, so focus is restored by action name.
  _focusKeyButton(action) {
    const btn = this._panel.querySelector(`.sar-key[data-action="${action}"]`);
    if (btn) btn.focus({ preventScroll: true });
  }

  _renderKeybinds() {
    const list = this._panel.querySelector('#sar-keybinds');
    list.innerHTML = '';
    const rows = [
      ['up',    t('set.bind.up')],
      ['left',  t('set.bind.left')],
      ['down',  t('set.bind.down')],
      ['right', t('set.bind.right')],
      ['shoot', t('set.bind.shoot')],
    ];
    for (const [action, caption] of rows) {
      const listening = this._awaitingBind === action;
      const keyBtn = document.createElement('button');
      keyBtn.className = listening ? 'sar-key listening' : 'sar-key';
      keyBtn.dataset.action = action;
      keyBtn.textContent = listening ? t('set.press') : keyLabel(this.settings.keybinds[action] ?? '');
      keyBtn.onclick = () => {
        this._awaitingBind = this._awaitingBind === action ? null : action;
        this._renderKeybinds();
        this._focusKeyButton(action);
      };

      const name = document.createElement('span');
      name.textContent = caption;
      const row = document.createElement('div');
      row.className = 'sar-bind';
      row.append(name, keyBtn);
      list.appendChild(row);
    }

    const note = document.createElement('div');
    note.className = 'sar-hint';
    note.style.marginTop = '8px';
    note.textContent = t('set.keys.extra');
    list.appendChild(note);
  }
}

// Fullscreens the whole page (not just the canvas) so the menu and this
// dialog stay visible; on phones it also tries to lock landscape.
function toggleFullscreen() {
  const doc = document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    return;
  }
  const root = doc.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) return;
  const pending = request.call(root, { navigationUI: 'hide' });
  const canLock = screen.orientation && screen.orientation.lock;
  if (pending && pending.then && canLock) {
    pending.then(() => screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  }
}

const settingsManager = SettingsManager.getInstance();

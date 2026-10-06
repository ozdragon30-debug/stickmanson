// ──────────────────────────────────────────────────────────────────────────────
//  SettingsManager – persists user prefs and renders the in-game settings panel.
//  Press Escape to open / close. Settings are saved to localStorage.
//  Only presentation / comfort options live here: nothing changes gameplay.
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  name:              'Player',
  cursorIndex:       0,
  spinnerShapeIndex: 0,
  spinnerHue:        0,
  // Audio
  volume:            0.5,
  muted:             false,
  spatialAudio:      true,
  // Video
  renderQuality:     'auto',   // auto | high | low
  pixelArt:          false,    // nearest-neighbour sprite scaling
  showFps:           false,
  showPing:          true,
  // HUD feedback
  damageFlash:       true,
  hitMarkers:        true,
  killFeed:          true,
  // Controls
  touchControls:     'auto',   // auto | on | off
  touchLeftHanded:   false,    // swap move / aim thumbs
  language:          'auto',   // auto | en | tr
  keybinds: {
    up:     'KeyW',
    left:   'KeyA',
    down:   'KeyS',
    right:  'KeyD',
    shoot:  'Space',
    sprint: 'ShiftLeft',
  },
};

// Convert a legacy KeyboardEvent.key bind (pre-2026 saves) to a layout-independent code.
// Only the old *defaults* are migrated: a custom bind like "z" on AZERTY must
// keep matching the key labelled Z, which keyMatches() does for legacy values.
const LEGACY_DEFAULTS = { up: 'w', left: 'a', down: 's', right: 'd', shoot: ' ', sprint: 'Shift' };
function migrateBind(action, v) {
  if (typeof v !== 'string' || !v) return v;
  if (LEGACY_DEFAULTS[action] !== undefined && v === LEGACY_DEFAULTS[action]) return DEFAULT_SETTINGS.keybinds[action];
  return v;
}

class SettingsManager {
  static getInstance() {
    if (!SettingsManager.instance) SettingsManager.instance = new SettingsManager();
    return SettingsManager.instance;
  }

  constructor() {
    const saved = this._loadRaw();
    // Randomise identity on very first load (no saved prefs).
    if (saved.spinnerHue        == null) DEFAULT_SETTINGS.spinnerHue        = Math.floor(Math.random() * 360);
    if (saved.spinnerShapeIndex == null) DEFAULT_SETTINGS.spinnerShapeIndex = Math.floor(Math.random() * 64);
    if (saved.cursorIndex       == null) DEFAULT_SETTINGS.cursorIndex       = Math.floor(Math.random() * 8);
    if (!saved.name)                     DEFAULT_SETTINGS.name              = 'Player' + Math.random().toString(36).slice(2, 5).toUpperCase();

    this.settings   = this._merge(saved);
    this.isFirstRun = !saved.name;
    this._isOpen    = false;
    this._rebinding = null;
    this._tab       = 'profile';
    this._listeners = [];
    this._buildUI();
    this._save();
    // Use capture phase so we intercept Escape / rebind before Keyboard.js sees it.
    document.addEventListener('keydown', e => this._onGlobalKey(e), true);
  }

  // ── Public getters ────────────────────────────────────────────────────────
  get name()              { return this.settings.name; }
  get cursorIndex()       { return this.settings.cursorIndex; }
  get spinnerShapeIndex() { return this.settings.spinnerShapeIndex; }
  get spinnerHue()        { return this.settings.spinnerHue; }
  isOpen()                { return this._isOpen; }
  getKey(action)          { return this.settings.keybinds[action] ?? ''; }
  get(key)                { return this.settings[key]; }

  set(key, value) {
    this.settings[key] = value;
    this._save();
    for (const fn of this._listeners) fn(key, value);
    if (this._isOpen) this._syncControls();
  }

  // fn(key, value) is called on every change; also invoked once per key immediately.
  onChange(fn, { immediate = true } = {}) {
    this._listeners.push(fn);
    if (immediate) for (const k in this.settings) fn(k, this.settings[k]);
  }

  setName(name) {
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!clean) return;
    this.settings.name = clean;
    this._save();
    if (typeof playerManager !== 'undefined' && playerManager.mainPlayer) playerManager.mainPlayer.name = clean;
    if (typeof socketManager !== 'undefined') socketManager.emit('setName', { name: clean });
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  _loadRaw() {
    try { return JSON.parse(localStorage.getItem('sar_settings') || '{}') || {}; }
    catch (e) { return {}; }
  }
  _merge(saved) {
    const s = { ...DEFAULT_SETTINGS, ...saved };
    s.keybinds = { ...DEFAULT_SETTINGS.keybinds };
    for (const [a, v] of Object.entries(saved.keybinds || {})) s.keybinds[a] = migrateBind(a, v);
    return s;
  }
  _save() {
    try { localStorage.setItem('sar_settings', JSON.stringify(this.settings)); } catch (e) {}
  }

  resetDefaults() {
    const keep = {
      name: this.settings.name, cursorIndex: this.settings.cursorIndex,
      spinnerShapeIndex: this.settings.spinnerShapeIndex, spinnerHue: this.settings.spinnerHue,
    };
    const fresh = this._merge({});
    for (const k in fresh) if (!(k in keep)) this.set(k, fresh[k]);
    this.settings.keybinds = { ...DEFAULT_SETTINGS.keybinds };
    this._save();
    this._refresh();
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  toggle() { this._isOpen ? this.close() : this.open(); }

  open(tab) {
    this._isOpen  = true;
    this._rebinding = null;
    if (tab) this._tab = tab;
    if (typeof onBlurHandler === 'function') onBlurHandler();
    this._overlay.classList.add('open');
    this._refresh();
  }

  close() {
    this._isOpen  = false;
    this._rebinding = null;
    this._overlay.classList.remove('open');
    // Commit any half-typed name.
    const nameEl = this._panel.querySelector('#sar-name');
    if (nameEl.value.trim() && nameEl.value.trim() !== this.settings.name) this.setName(nameEl.value);
    this._applyToPlayer();
    // Keep the main menu's name field in sync (it would otherwise push the old name back on Play).
    if (typeof menu !== 'undefined' && menu.nameEl) menu.syncName();
    // Don't leave keyboard focus on a settings control / the gear button:
    // game keys are ignored while a button has focus.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }

  _applyToPlayer() {
    if (typeof playerManager === 'undefined' || !playerManager.mainPlayer) return;
    const p = playerManager.mainPlayer;
    p.name                = this.settings.name;
    p.indicatorHue        = this.settings.spinnerHue;
    p.indicatorShapeIndex = this.settings.spinnerShapeIndex;
    if (typeof socketManager !== 'undefined') {
      socketManager.emit('setName',        { name:       this.settings.name });
      socketManager.emit('playerIdentity', { hue:        this.settings.spinnerHue,
                                             shapeIndex: this.settings.spinnerShapeIndex });
    }
  }

  // Sync only spinner identity (hue + shape) without touching the name.
  _syncIdentity() {
    if (typeof playerManager === 'undefined' || !playerManager.mainPlayer) return;
    playerManager.mainPlayer.indicatorHue        = this.settings.spinnerHue;
    playerManager.mainPlayer.indicatorShapeIndex = this.settings.spinnerShapeIndex;
    if (typeof socketManager !== 'undefined') {
      socketManager.emit('playerIdentity', { hue:        this.settings.spinnerHue,
                                             shapeIndex: this.settings.spinnerShapeIndex });
    }
  }

  // ── Global key listener (capture phase so we can intercept rebind) ─────────
  _onGlobalKey(e) {
    // If waiting for a rebind key, consume this event entirely.
    if (this._rebinding) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key !== 'Escape') {
        // Unbind the same key from any other action to avoid conflicts.
        for (const a in this.settings.keybinds) {
          if (this.settings.keybinds[a] === e.code) this.settings.keybinds[a] = '';
        }
        this.settings.keybinds[this._rebinding] = e.code;
      }
      this._rebinding = null;
      this._save();
      this._buildKeybinds();
      return;
    }
    if (e.key === 'Escape') {
      if (typeof chatManager !== 'undefined' && chatManager.isOpen) return;
      if (this._isOpen) { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
      if (typeof menu !== 'undefined' && menu.isOpen) return; // the menu handles Esc itself
      e.preventDefault();
      this.open();
    }
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────
  _buildUI() {
    const overlay = document.createElement('div');
    overlay.className = 'sar-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Settings');
    // Don't let clicks fall through to the canvas.
    overlay.addEventListener('mousedown', e => e.stopPropagation());
    overlay.addEventListener('click',     e => { if (e.target === overlay) this.close(); });

    const panel = document.createElement('div');
    panel.className = 'sar-panel';
    panel.innerHTML = `
      <div class="sar-head">
        <span class="sar-title"><span data-i18n="set.title">Settings</span> <kbd>Esc</kbd></span>
        <button id="sar-close" class="sar-x" aria-label="Close settings">✕</button>
      </div>
      <nav class="sar-tabs" role="tablist">
        <button data-tab="profile" data-i18n="set.tab.profile">Profile</button>
        <button data-tab="controls" data-i18n="set.tab.controls">Controls</button>
        <button data-tab="audio" data-i18n="set.tab.audio">Audio</button>
        <button data-tab="video" data-i18n="set.tab.video">Video</button>
        <button data-tab="hud" data-i18n="set.tab.hud">HUD</button>
      </nav>

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
          <div class="sar-lbl" data-i18n="set.spinner">Spinner Shape</div>
          <div id="sar-spin-grid" class="sar-grid sar-scroll"></div>
        </div>
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-hue"><span data-i18n="set.color">Spinner Color</span> — <span id="sar-hue-lbl"></span></label>
          <input id="sar-hue" type="range" min="0" max="360" class="sar-range">
          <div class="sar-hue-bar"></div>
        </div>
      </section>

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
          <label class="sar-check"><input type="checkbox" data-setting="touchLeftHanded"> <span data-i18n="set.touch.left">Left-handed (aim with the left thumb)</span></label>
        </div>
        <div class="sar-sec sar-help">
          <div class="sar-lbl" data-i18n="set.gamepad">Gamepad</div>
          <span data-i18n="set.gamepad.help">Left stick / D-pad: move · Right stick: aim · RT / A: attack · Back/View: scoreboard · Start: settings</span>
          <div id="sar-pad-status" class="sar-hint"></div>
        </div>
      </section>

      <section data-pane="audio">
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-volume"><span data-i18n="set.volume">Volume</span> — <span id="sar-vol-lbl"></span></label>
          <input id="sar-volume" type="range" min="0" max="100" class="sar-range">
        </div>
        <label class="sar-check"><input type="checkbox" data-setting="muted"> <span data-i18n="set.mute">Mute all sounds</span> <kbd>M</kbd></label>
        <label class="sar-check"><input type="checkbox" data-setting="spatialAudio"> <span data-i18n="set.spatial">Positional audio</span>
          <span class="sar-hint" data-i18n="set.spatial.hint">— pan &amp; soften other players' sounds by distance</span></label>
      </section>

      <section data-pane="video">
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-res" data-i18n="set.res">Render Resolution</label>
          <select id="sar-res" class="sar-select" data-setting="renderQuality">
            <option value="auto" data-i18n="set.res.auto">Auto (sharp, up to 2×)</option>
            <option value="high" data-i18n="set.res.high">High (native, up to 3×)</option>
            <option value="low" data-i18n="set.res.low">Low (1× – fastest)</option>
          </select>
        </div>
        <label class="sar-check"><input type="checkbox" data-setting="pixelArt"> <span data-i18n="set.pixel">Pixel-art scaling</span>
          <span class="sar-hint" data-i18n="set.pixel.hint">— crisp nearest-neighbour sprites</span></label>
        <label class="sar-check"><input type="checkbox" data-setting="showFps"> <span data-i18n="set.fps">Show FPS</span></label>
        <label class="sar-check"><input type="checkbox" data-setting="showPing"> <span data-i18n="set.ping">Show ping</span></label>
        <div class="sar-sec" style="margin-top:14px">
          <button id="sar-fullscreen" class="sar-btn"><span data-i18n="set.fullscreen">Toggle Fullscreen</span> <kbd>F11</kbd></button>
        </div>
      </section>

      <section data-pane="hud">
        <label class="sar-check"><input type="checkbox" data-setting="killFeed"> <span data-i18n="set.killfeed">Kill feed</span></label>
        <label class="sar-check"><input type="checkbox" data-setting="hitMarkers"> <span data-i18n="set.hitmarkers">Hit markers</span></label>
        <label class="sar-check"><input type="checkbox" data-setting="damageFlash"> <span data-i18n="set.damageflash">Damage flash</span></label>
      </section>

      <div class="sar-foot">
        <button id="sar-reset" class="sar-btn sar-btn-ghost" data-i18n="set.reset">Reset to defaults</button>
        <span class="sar-foot-right">
          <button id="sar-menu" class="sar-btn sar-btn-ghost" data-i18n="set.menu">Main menu</button>
          <button id="sar-done" class="sar-btn" data-i18n="set.done">Done</button>
        </span>
      </div>
    `;

    panel.querySelector('#sar-close').onclick = () => this.close();
    panel.querySelector('#sar-done').onclick  = () => this.close();
    panel.querySelector('#sar-menu').onclick  = () => { this.close(); if (typeof menu !== 'undefined') menu.open(); };
    panel.querySelector('#sar-reset').onclick = () => this.resetDefaults();
    panel.querySelector('#sar-fullscreen').onclick = () => toggleFullscreen();

    panel.querySelectorAll('.sar-tabs button').forEach(b => {
      b.onclick = () => { this._tab = b.dataset.tab; this._showTab(); };
    });

    panel.querySelector('#sar-name').addEventListener('change', e => this.setName(e.target.value));

    panel.querySelector('#sar-hue').addEventListener('input', e => {
      this.settings.spinnerHue = +e.target.value;
      this._save();
      this._refreshHueLbl();
      this._buildSpinnerPicker(); // live-preview the color change
      this._syncIdentity();
    });

    panel.querySelector('#sar-volume').addEventListener('input', e => {
      this.set('volume', +e.target.value / 100);
    });

    panel.querySelectorAll('[data-setting]').forEach(el => {
      el.addEventListener('change', () => {
        this.set(el.dataset.setting, el.type === 'checkbox' ? el.checked : el.value);
      });
    });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    i18n.applyDom(panel);
    this._overlay = overlay;
    this._panel   = panel;

    // ── Gear button ────────────────────────────────────────────────────────
    const gear = document.createElement('button');
    gear.className = 'sar-gear';
    gear.textContent = '⚙';
    gear.title = 'Settings [Esc]';
    gear.setAttribute('aria-label', 'Settings');
    gear.tabIndex = -1;
    gear.addEventListener('mousedown', e => e.stopPropagation());
    gear.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    gear.addEventListener('click', () => this.toggle());
    (document.getElementById('stage') || document.body).appendChild(gear);
    this._gearBtn = gear;

    // Auto-hide on desktop after 2.5 s without mouse movement (Esc still works).
    let idleTimer = null;
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      gear.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const touch = typeof inputMode !== 'undefined' && inputMode.mode === 'touch';
        if (!touch && !this._isOpen) gear.classList.add('idle');
      }, 2500);
    });
    window.addEventListener('touchstart', () => gear.classList.remove('idle'), { passive: true });
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  _refresh() {
    i18n.applyDom(this._panel);
    this._panel.querySelector('#sar-name').value = this.settings.name;
    this._panel.querySelector('#sar-hue').value  = this.settings.spinnerHue;
    this._refreshHueLbl();
    this._syncControls();
    this._buildCursorPicker();
    this._buildSpinnerPicker();
    this._buildKeybinds();
    this._showTab();
  }

  _showTab() {
    this._panel.querySelectorAll('.sar-tabs button').forEach(b => {
      b.classList.toggle('sel', b.dataset.tab === this._tab);
      b.setAttribute('aria-selected', b.dataset.tab === this._tab);
    });
    this._panel.querySelectorAll('[data-pane]').forEach(p => {
      p.hidden = p.dataset.pane !== this._tab;
    });
    const padEl = this._panel.querySelector('#sar-pad-status');
    if (padEl) {
      const pad = typeof gamepadInput !== 'undefined' ? gamepadInput.connectedName : null;
      padEl.textContent = pad ? t('set.gamepad.on', { name: pad }) : t('set.gamepad.none');
    }
  }

  _syncControls() {
    this._panel.querySelectorAll('[data-setting]').forEach(el => {
      const v = this.settings[el.dataset.setting];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    const vol = Math.round(this.settings.volume * 100);
    this._panel.querySelector('#sar-volume').value = vol;
    this._panel.querySelector('#sar-vol-lbl').textContent = vol + '%';
  }

  _refreshHueLbl() {
    const el = this._panel.querySelector('#sar-hue-lbl');
    if (el) el.textContent = this.settings.spinnerHue + '°';
  }

  // ── Cursor picker ─────────────────────────────────────────────────────────
  _buildCursorPicker() {
    const grid = this._panel.querySelector('#sar-cursor-grid');
    grid.innerHTML = '';
    const names = Object.keys(cursorAtlas.animationMap);
    names.forEach((anim, i) => {
      const fd = cursorAtlas.getFrameData(anim, 0);
      if (!fd) return;
      const scale = Math.min(2.8, 34 / Math.max(fd.w, fd.h));
      const c = document.createElement('canvas');
      c.width = 46; c.height = 46;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.drawImage(cursorAtlas.image,
        fd.x, fd.y, fd.w, fd.h,
        (46 - fd.w * scale) / 2, (46 - fd.h * scale) / 2,
        fd.w * scale, fd.h * scale);
      const tile = document.createElement('button');
      tile.className = 'sar-tile' + (i === this.settings.cursorIndex % names.length ? ' sel' : '');
      tile.title = `Cursor ${i + 1}`;
      tile.setAttribute('aria-label', `Cursor ${i + 1}`);
      tile.appendChild(c);
      tile.onclick = () => {
        this.settings.cursorIndex = i;
        this._save();
        grid.querySelectorAll('.sar-tile').forEach((el, j) => el.classList.toggle('sel', j === i));
      };
      grid.appendChild(tile);
    });
  }

  // ── Spinner picker ────────────────────────────────────────────────────────
  _buildSpinnerPicker() {
    const grid = this._panel.querySelector('#sar-spin-grid');
    grid.innerHTML = '';
    const names = Object.keys(indicatorAtlas.animationMap);
    const selIdx = this.settings.spinnerShapeIndex % names.length;
    names.forEach((anim, i) => {
      const fd = indicatorAtlas.getFrameData(anim, 0);
      if (!fd) return;
      const scale = Math.min(1.6, 32 / Math.max(fd.w, fd.h));
      const c = document.createElement('canvas');
      c.width = 40; c.height = 40;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      const src = tintCache.get(indicatorAtlas, fd, this.settings.spinnerHue);
      if (src) cx.drawImage(src.canvas, src.x, src.y, fd.w, fd.h,
        (40 - fd.w * scale) / 2, (40 - fd.h * scale) / 2,
        fd.w * scale, fd.h * scale);
      const tile = document.createElement('button');
      tile.className = 'sar-tile sar-tile-sm' + (i === selIdx ? ' sel' : '');
      tile.setAttribute('aria-label', `Spinner ${i + 1}`);
      tile.appendChild(c);
      tile.onclick = () => {
        this.settings.spinnerShapeIndex = i;
        this._save();
        this._syncIdentity();
        grid.querySelectorAll('.sar-tile').forEach((el, j) => el.classList.toggle('sel', j === i));
      };
      grid.appendChild(tile);
    });
  }

  // ── Keybind table ─────────────────────────────────────────────────────────
  _buildKeybinds() {
    const container = this._panel.querySelector('#sar-keybinds');
    container.innerHTML = '';
    const labels = {
      up:     t('set.bind.up'),
      left:   t('set.bind.left'),
      down:   t('set.bind.down'),
      right:  t('set.bind.right'),
      shoot:  t('set.bind.shoot'),
    };
    for (const [action, label] of Object.entries(labels)) {
      const current = this.settings.keybinds[action] ?? '';
      const row = document.createElement('div');
      row.className = 'sar-bind';
      const btn = document.createElement('button');
      btn.className = 'sar-key' + (this._rebinding === action ? ' listening' : '');
      btn.dataset.action = action;
      btn.textContent = this._rebinding === action ? t('set.press') : keyLabel(current);
      btn.onclick = () => {
        this._rebinding = this._rebinding === action ? null : action;
        this._buildKeybinds();
      };
      const lbl = document.createElement('span');
      lbl.textContent = label;
      row.appendChild(lbl);
      row.appendChild(btn);
      container.appendChild(row);
    }
    const extra = document.createElement('div');
    extra.className = 'sar-hint';
    extra.style.marginTop = '8px';
    extra.textContent = t('set.keys.extra');
    container.appendChild(extra);
  }
}

function toggleFullscreen() {
  // Fullscreen the whole document so overlays (settings, menu) stay visible.
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      const p = req.call(el, { navigationUI: 'hide' });
      // Lock to landscape on phones where supported.
      if (p && p.then && screen.orientation && screen.orientation.lock) {
        p.then(() => screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
      }
    }
  }
}

const settingsManager = SettingsManager.getInstance();

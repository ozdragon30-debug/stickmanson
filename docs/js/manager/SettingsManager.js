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
function migrateBind(v) {
  if (typeof v !== 'string' || !v) return v;
  if (/^[a-z]$/i.test(v)) return 'Key' + v.toUpperCase();
  if (/^\d$/.test(v)) return 'Digit' + v;
  if (v === ' ') return 'Space';
  if (v === 'Shift' || v === 'Control' || v === 'Alt') return v + 'Left';
  return v; // already a code, or a non-ASCII key we keep matching by value
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
    for (const [a, v] of Object.entries(saved.keybinds || {})) s.keybinds[a] = migrateBind(v);
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
      if (typeof menu !== 'undefined' && menu.isOpen) return;
      e.preventDefault();
      this.toggle();
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
        <span class="sar-title">Settings <kbd>Esc</kbd></span>
        <button id="sar-close" class="sar-x" aria-label="Close settings">✕</button>
      </div>
      <nav class="sar-tabs" role="tablist">
        <button data-tab="profile">Profile</button>
        <button data-tab="controls">Controls</button>
        <button data-tab="audio">Audio</button>
        <button data-tab="video">Video</button>
        <button data-tab="hud">HUD</button>
      </nav>

      <section data-pane="profile">
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-name">Player Name</label>
          <input id="sar-name" type="text" maxlength="20" autocomplete="nickname" class="sar-text">
        </div>
        <div class="sar-sec">
          <div class="sar-lbl">Cursor</div>
          <div id="sar-cursor-grid" class="sar-grid"></div>
        </div>
        <div class="sar-sec">
          <div class="sar-lbl">Spinner Shape</div>
          <div id="sar-spin-grid" class="sar-grid sar-scroll"></div>
        </div>
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-hue">Spinner Color — <span id="sar-hue-lbl"></span></label>
          <input id="sar-hue" type="range" min="0" max="360" class="sar-range">
          <div class="sar-hue-bar"></div>
        </div>
      </section>

      <section data-pane="controls">
        <div class="sar-sec">
          <div class="sar-lbl">Keybinds <span class="sar-hint">(arrow keys always move too)</span></div>
          <div id="sar-keybinds"></div>
        </div>
        <div class="sar-sec">
          <div class="sar-lbl">Touch Controls</div>
          <select id="sar-touch" class="sar-select" data-setting="touchControls">
            <option value="auto">Auto (touch screens)</option>
            <option value="on">Always on</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div class="sar-sec sar-help">
          <div class="sar-lbl">Gamepad</div>
          Left stick / D-pad: move · Right stick: aim · RT / A: attack · Back/View: scoreboard · Start: settings
          <div id="sar-pad-status" class="sar-hint"></div>
        </div>
      </section>

      <section data-pane="audio">
        <div class="sar-sec">
          <label class="sar-lbl" for="sar-volume">Volume — <span id="sar-vol-lbl"></span></label>
          <input id="sar-volume" type="range" min="0" max="100" class="sar-range">
        </div>
        <label class="sar-check"><input type="checkbox" data-setting="muted"> Mute all sounds <kbd>M</kbd></label>
        <label class="sar-check"><input type="checkbox" data-setting="spatialAudio"> Positional audio
          <span class="sar-hint">— pan &amp; soften other players' sounds by distance</span></label>
      </section>

      <section data-pane="video">
        <div class="sar-sec">
          <div class="sar-lbl">Render Resolution</div>
          <select class="sar-select" data-setting="renderQuality">
            <option value="auto">Auto (sharp, up to 2×)</option>
            <option value="high">High (native, up to 3×)</option>
            <option value="low">Low (1× – fastest)</option>
          </select>
        </div>
        <label class="sar-check"><input type="checkbox" data-setting="pixelArt"> Pixel-art scaling
          <span class="sar-hint">— crisp nearest-neighbour sprites</span></label>
        <label class="sar-check"><input type="checkbox" data-setting="showFps"> Show FPS</label>
        <label class="sar-check"><input type="checkbox" data-setting="showPing"> Show ping</label>
        <div class="sar-sec" style="margin-top:14px">
          <button id="sar-fullscreen" class="sar-btn">Toggle Fullscreen <kbd>F11</kbd></button>
        </div>
      </section>

      <section data-pane="hud">
        <label class="sar-check"><input type="checkbox" data-setting="killFeed"> Kill feed</label>
        <label class="sar-check"><input type="checkbox" data-setting="hitMarkers"> Hit markers</label>
        <label class="sar-check"><input type="checkbox" data-setting="damageFlash"> Damage flash</label>
      </section>

      <div class="sar-foot">
        <button id="sar-reset" class="sar-btn sar-btn-ghost">Reset to defaults</button>
        <button id="sar-done" class="sar-btn">Done</button>
      </div>
    `;

    panel.querySelector('#sar-close').onclick = () => this.close();
    panel.querySelector('#sar-done').onclick  = () => this.close();
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
    this._overlay = overlay;
    this._panel   = panel;

    // ── Gear button ────────────────────────────────────────────────────────
    const gear = document.createElement('button');
    gear.className = 'sar-gear';
    gear.textContent = '⚙';
    gear.title = 'Settings [Esc]';
    gear.setAttribute('aria-label', 'Settings');
    gear.addEventListener('mousedown', e => e.stopPropagation());
    gear.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    gear.addEventListener('click', () => this.toggle());
    (document.getElementById('stage') || document.body).appendChild(gear);
    this._gearBtn = gear;
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  _refresh() {
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
      padEl.textContent = pad ? `Connected: ${pad}` : 'No gamepad detected — press any button on it.';
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
        grid.querySelectorAll('.sar-tile').forEach((t, j) => t.classList.toggle('sel', j === i));
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
      cx.drawImage(src.canvas, src.x, src.y, fd.w, fd.h,
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
        grid.querySelectorAll('.sar-tile').forEach((t, j) => t.classList.toggle('sel', j === i));
      };
      grid.appendChild(tile);
    });
  }

  // ── Keybind table ─────────────────────────────────────────────────────────
  _buildKeybinds() {
    const container = this._panel.querySelector('#sar-keybinds');
    container.innerHTML = '';
    const labels = {
      up:     'Move Up',
      left:   'Move Left',
      down:   'Move Down',
      right:  'Move Right',
      shoot:  'Attack',
    };
    for (const [action, label] of Object.entries(labels)) {
      const current = this.settings.keybinds[action] ?? '';
      const row = document.createElement('div');
      row.className = 'sar-bind';
      const btn = document.createElement('button');
      btn.className = 'sar-key' + (this._rebinding === action ? ' listening' : '');
      btn.dataset.action = action;
      btn.textContent = this._rebinding === action ? 'Press a key…' : keyLabel(current);
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
    extra.textContent = 'Mouse: aim & attack · Enter: chat · Tab / Shift: scoreboard · M: mute';
    container.appendChild(extra);
  }
}

function toggleFullscreen() {
  const el = document.getElementById('stage') || document.documentElement;
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

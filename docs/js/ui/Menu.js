// Start / pause menu. Shown on load so the first click also unlocks Web Audio
// (browsers block sound until a user gesture), lets the player pick a name and
// shows whether a server is reachable.

class Menu {
  constructor() {
    this.el       = document.getElementById('menu');
    this.isOpen   = !!this.el && this.el.classList.contains('open');
    this.playBtn  = document.getElementById('menu-play');
    this.status   = document.getElementById('menu-status');
    this.nameEl   = document.getElementById('menu-name');
    this._ready   = false;
    this._installPrompt = null;
    if (!this.el) return;

    // ?play skips the menu (handy for kiosks / testing).
    if (new URLSearchParams(location.search).has('play')) this._hide();

    this.nameEl.value = settingsManager.name;
    this.nameEl.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') this.play();
    });
    this.nameEl.addEventListener('keyup', e => e.stopPropagation());
    this.playBtn.addEventListener('click', () => this.play());
    document.getElementById('menu-settings').addEventListener('click', () => settingsManager.open());
    document.getElementById('menu-fullscreen').addEventListener('click', () => toggleFullscreen());

    const install = document.getElementById('menu-install');
    // iOS Safari has no install prompt: explain "Add to Home Screen" instead.
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
    if (ios && !standalone && location.protocol === 'https:') {
      install.hidden = false;
      install.addEventListener('click', () => { if (!this._installPrompt) alert(t('menu.iosInstall')); });
    }
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this._installPrompt = e;
      install.hidden = false;
    });
    install.addEventListener('click', async () => {
      if (!this._installPrompt) return;
      this._installPrompt.prompt();
      await this._installPrompt.userChoice.catch(() => {});
      this._installPrompt = null;
      install.hidden = true;
    });

    this.mapEl = document.getElementById('menu-map');
    this.mapSelect = document.getElementById('menu-map-select');
    this._buildMapPicker();

    this.roomEl = document.getElementById('menu-room');
    this.roomLabel = document.getElementById('menu-room-label');
    this.roomBtn = document.getElementById('menu-room-btn');
    this.roomBtn.addEventListener('click', () => this._roomAction());

    const statsEl = document.getElementById('menu-stats');
    statsEl.addEventListener('toggle', () => { if (statsEl.open) this._renderStats(); });
    document.getElementById('menu-stats-reset').addEventListener('click', () => {
      if (confirm(t('stats.confirmReset'))) { statsManager.reset(); this._renderStats(); }
    });

    this.el.addEventListener('mousedown', e => e.stopPropagation());
    // Esc resumes the game from the menu (settings' own Esc handling skips while the menu is open).
    document.addEventListener('keydown', e => {
      if (this.isOpen && e.key === 'Escape' && this._ready && !settingsManager.isOpen()) { e.preventDefault(); this.play(); }
    });
    this._tick();
  }

  // Called by the game loop once assets + first map are loaded.
  setReady() {
    if (this._ready) return;
    this._ready = true;
    this.playBtn.disabled = false;
    this.playBtn.textContent = t('menu.play');
    if (this.isOpen && inputMode.mode !== 'touch') this.playBtn.focus({ preventScroll: true });
  }

  // Offline only: pick the map for the next round (or keep the random rotation).
  _buildMapPicker() {
    const groups = { '': [], 'feature/': [], 'ballistick/': [] };
    for (const f of BotManager.OFFLINE_MAPS) {
      if (f === 'debug.dat') continue;
      const g = f.startsWith('feature/') ? 'feature/' : f.startsWith('ballistick/') ? 'ballistick/' : '';
      groups[g].push(f);
    }
    const sel = this.mapSelect;
    const random = document.createElement('option');
    random.value = '';
    random.dataset.i18n = 'menu.map.random';
    sel.appendChild(random);
    for (const [g, files] of Object.entries(groups)) {
      const og = document.createElement('optgroup');
      og.label = g === '' ? 'Stick Arena' : g === 'feature/' ? 'Featured' : 'Ballistick';
      for (const f of files.sort()) {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = BotManager.mapLabel(f);
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    sel.addEventListener('keydown', e => e.stopPropagation());
  }

  play() {
    if (!this._ready) return;
    // Offline map choice: start a fresh round on the picked map.
    const picked = this.mapSelect && !this.mapEl.hidden ? this.mapSelect.value : '';
    botManager.preferredMap = picked || null;
    if (picked && picked !== botManager._currentMap && botManager.active && !socketManager.isConnected) {
      botManager.startOfflineRound(picked);
    }
    const name = this.nameEl.value.trim();
    if (name && name !== settingsManager.name) settingsManager.setName(name);
    soundManager._ensureContext();
    this._hide();
    if (typeof map !== 'undefined' && map.ready) hudManager.showMapTitle(map.name);
    this._keepAwake();
    this._firstRunHint();
    canvas.focus({ preventScroll: true });
    // Phones: go fullscreen + landscape on first play for a console-like feel.
    if (inputMode.mode === 'touch' && !document.fullscreenElement) toggleFullscreen();
  }

  // First game ever: show the controls for the device being used.
  _firstRunHint() {
    let seen = false;
    try { seen = localStorage.getItem('sar_hint_seen') === '1'; localStorage.setItem('sar_hint_seen', '1'); } catch (e) {}
    if (seen) return;
    const key = inputMode.mode === 'touch' ? 'hint.touch' : inputMode.mode === 'gamepad' ? 'hint.pad' : 'hint.keys';
    setTimeout(() => hudManager.flash(t('hint.title'), t(key), '#9fd3ff', 7000), 2800);
  }

  // Screen Wake Lock: phones shouldn't dim/sleep mid-match. The lock is
  // released automatically when the tab is hidden, so re-acquire on return.
  async _keepAwake() {
    if (!('wakeLock' in navigator)) return;
    if (!this._wakeHooked) {
      this._wakeHooked = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.isOpen) this._keepAwake();
      });
    }
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* denied (battery saver…) — retried on next visibility change */ }
  }

  _hide() {
    this.isOpen = false;
    this.el.classList.remove('open');
    if (typeof reportAfk === 'function') reportAfk(false);
    document.body.classList.remove('ui-open');
  }

  open() {
    this.isOpen = true;
    if (document.getElementById('menu-stats').open) this._renderStats();
    this.nameEl.value = settingsManager.name;
    this.el.classList.add('open');
    if (typeof onBlurHandler === 'function') onBlurHandler();
    if (typeof reportAfk === 'function') reportAfk(true);
  }

  _statusHtml() {
    if (socketManager.isConnected) {
      const n = Object.keys(scoreboardManager.scores || {}).filter(id => !botManager.isBot(id)).length;
      const others = Math.max(0, n - 1);
      const msg = others === 0 ? t('menu.status.online0')
                : others === 1 ? t('menu.status.online1') : t('menu.status.onlineN', { n: others });
      return `<span class="dot online"></span>${msg}`;
    }
    if (socketManager.socket && !botManager.active) return `<span class="dot"></span>${t('menu.status.connecting')}`;
    return `<span class="dot offline"></span>${t('menu.status.offline')}`;
  }

  _renderStats() {
    const table = this.el.querySelector('.menu-stats');
    table.innerHTML = '';
    for (const [k, v] of statsManager.rows()) {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.textContent = k;
      const b = document.createElement('td'); b.textContent = v;
      tr.append(a, b);
      table.appendChild(tr);
    }
  }

  // Public room → create a private one (new link); private room → share the link.
  async _roomAction() {
    if (!socketManager.room) {
      const code = Math.random().toString(36).slice(2, 8);
      const url = new URL(location.href);
      url.searchParams.set('room', code);
      location.href = url.toString();
      return;
    }
    const link = location.href;
    try {
      if (navigator.share && inputMode.mode === 'touch') {
        await navigator.share({ title: 'Stick Arena: Reborn', text: t('menu.room.shareText'), url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      this.roomBtn.textContent = t('menu.room.copied');
      setTimeout(() => this._renderRoom(true), 1500);
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user dismissed the share sheet
      window.prompt(t('menu.room.copy'), link);
    }
  }

  _renderRoom(force = false) {
    const online = socketManager.isConnected;
    this.roomEl.hidden = !online && !socketManager.room;
    if (this.roomEl.hidden) return;
    const label = socketManager.room
      ? t('menu.room.private', { code: socketManager.room })
      : t('menu.room.public');
    if (force || this.roomLabel.innerHTML !== label) this.roomLabel.innerHTML = label;
    const btn = socketManager.room ? t('menu.room.copy') : t('menu.room.create');
    if (force || (this.roomBtn.textContent !== btn && this.roomBtn.textContent !== t('menu.room.copied'))) this.roomBtn.textContent = btn;
  }

  _tick() {
    if (this.isOpen) {
      this._renderRoom();
      this.mapEl.hidden = socketManager.isConnected || !botManager.active;
      const html = this._statusHtml();
      if (this.status.innerHTML !== html) this.status.innerHTML = html;
      if (!this._ready) {
        const atlases = [playerAtlas, mapAtlas, deathAtlas, pickupAtlas, bloodAtlas, particleAtlas, indicatorAtlas, cursorAtlas, heartbeatAtlas];
        const done = atlases.filter(a => a.ready && a.image.complete).length;
        this.playBtn.textContent = t('menu.loading', { p: Math.round(done / atlases.length * 100) });
      }
    }
    setTimeout(() => this._tick(), 500);
  }
}

const menu = new Menu();

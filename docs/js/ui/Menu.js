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

  play() {
    if (!this._ready) return;
    const name = this.nameEl.value.trim();
    if (name && name !== settingsManager.name) settingsManager.setName(name);
    soundManager._ensureContext();
    this._hide();
    if (typeof map !== 'undefined' && map.ready) hudManager.showMapTitle(map.name);
    this._keepAwake();
    canvas.focus({ preventScroll: true });
    // Phones: go fullscreen + landscape on first play for a console-like feel.
    if (inputMode.mode === 'touch' && !document.fullscreenElement) toggleFullscreen();
  }

  // Screen Wake Lock: phones shouldn't dim/sleep mid-match. The lock is
  // released automatically when the tab is hidden, so re-acquire on return.
  async _keepAwake() {
    if (!('wakeLock' in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { return; }
    if (!this._wakeHooked) {
      this._wakeHooked = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.isOpen) this._keepAwake();
      });
    }
  }

  _hide() {
    this.isOpen = false;
    this.el.classList.remove('open');
    document.body.classList.remove('ui-open');
  }

  open() {
    this.isOpen = true;
    if (document.getElementById('menu-stats').open) this._renderStats();
    this.nameEl.value = settingsManager.name;
    this.el.classList.add('open');
    if (typeof onBlurHandler === 'function') onBlurHandler();
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

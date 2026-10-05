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

    this.el.addEventListener('mousedown', e => e.stopPropagation());
    this._tick();
  }

  // Called by the game loop once assets + first map are loaded.
  setReady() {
    if (this._ready) return;
    this._ready = true;
    this.playBtn.disabled = false;
    this.playBtn.textContent = 'Play';
    if (this.isOpen && inputMode.mode !== 'touch') this.playBtn.focus({ preventScroll: true });
  }

  play() {
    if (!this._ready) return;
    const name = this.nameEl.value.trim();
    if (name && name !== settingsManager.name) settingsManager.setName(name);
    soundManager._ensureContext();
    this._hide();
    canvas.focus({ preventScroll: true });
    // Phones: go fullscreen + landscape on first play for a console-like feel.
    if (inputMode.mode === 'touch' && !document.fullscreenElement) toggleFullscreen();
  }

  _hide() {
    this.isOpen = false;
    this.el.classList.remove('open');
    document.body.classList.remove('ui-open');
  }

  open() {
    this.isOpen = true;
    this.nameEl.value = settingsManager.name;
    this.el.classList.add('open');
    if (typeof onBlurHandler === 'function') onBlurHandler();
  }

  _statusHtml() {
    if (socketManager.isConnected) {
      const n = Object.keys(scoreboardManager.scores || {}).filter(id => !botManager.isBot(id)).length;
      const others = Math.max(0, n - 1);
      const who = others === 0 ? 'no other players yet — bots will keep you company'
                               : `${others} other player${others === 1 ? '' : 's'} online`;
      return `<span class="dot online"></span>Server online · ${who}`;
    }
    if (socketManager.socket && !botManager.active) return '<span class="dot"></span>Connecting to server…';
    return '<span class="dot offline"></span>Offline mode — play against bots';
  }

  _tick() {
    if (this.isOpen) {
      const html = this._statusHtml();
      if (this.status.innerHTML !== html) this.status.innerHTML = html;
      if (!this._ready) {
        const atlases = [playerAtlas, mapAtlas, deathAtlas, pickupAtlas, bloodAtlas, particleAtlas, indicatorAtlas, cursorAtlas, heartbeatAtlas];
        const done = atlases.filter(a => a.ready && a.image.complete).length;
        this.playBtn.textContent = `Loading… ${Math.round(done / atlases.length * 100)}%`;
      }
    }
    setTimeout(() => this._tick(), 500);
  }
}

const menu = new Menu();

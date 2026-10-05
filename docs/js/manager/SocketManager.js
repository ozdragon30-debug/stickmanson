class SocketManager {
  static getInstance() {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  constructor() {
    this.socket       = null;
    this.isConnected  = false;
    this.wasConnected = false;  // connected at least once (drives the "reconnecting" banner)
    this.ping         = null;   // round-trip ms, null when unknown
    this._pingTimer   = null;
    // Private room from the invite link (?room=code); the server falls back to
    // the public room for anything invalid.
    const room = new URLSearchParams(location.search).get('room');
    this.room = room && /^[a-z0-9][a-z0-9-]{0,23}$/i.test(room) && room.toLowerCase() !== 'public' ? room.toLowerCase() : null;
    // Secret per-tab token: lets the server replace our own ghost socket when we
    // reconnect after a silent network drop (never sent anywhere else).
    const bytes = new Uint8Array(18);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach((_, i) => { bytes[i] = Math.random() * 256; });
    this.session = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // socket.io is served by the Node server at /socket.io/socket.io.js.
    // On GitHub Pages or when the server is down that script 404s, leaving
    // `io` undefined.  We degrade gracefully to pure offline mode.
    if (typeof io !== 'undefined') {
      try {
        const opts = {
          query: this.room ? { room: this.room, session: this.session } : { session: this.session },
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        };
        this.socket = window.GAME_SERVER ? io(window.GAME_SERVER, opts) : io(opts);
        this.socket.on('connect', () => {
          this.isConnected = true;
          this.wasConnected = true;
          this._startPing();
        });
        // Middleware rejections (e.g. too many connections from this address)
        // are not retried automatically by socket.io: retry slowly ourselves.
        this.socket.on('connect_error', (err) => {
          if (this.socket.active) return; // socket.io is already retrying
          if (err && err.message && !this._warned && typeof chatManager !== 'undefined') {
            this._warned = true;
            chatManager.addMessage('Server', err.message, null);
          }
          setTimeout(() => { if (!this.socket.connected) this.socket.connect(); }, 10000);
        });
        this.socket.on('disconnect', () => {
          this.isConnected = false;
          this.ping = null;
          this._stopPing();
        });
      } catch (e) {
        console.warn('[SocketManager] Could not initialise socket.io:', e);
      }
    }
  }

  // Measures RTT with an acknowledged 'latency' event every 2 s.
  // Servers without the handler simply never ack, leaving ping unknown.
  _startPing() {
    this._stopPing();
    const probe = () => {
      if (!this.isConnected) return;
      const t0 = performance.now();
      this.socket.timeout(3000).emit('latency', Date.now(), (err) => {
        if (!err) this.ping = Math.round(performance.now() - t0);
      });
    };
    probe();
    this._pingTimer = setInterval(probe, 2000);
  }

  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  on(event, callback) {
    if (this.socket) this.socket.on(event, callback);
  }

  emit(event, data) {
    if (this.socket && this.isConnected) this.socket.emit(event, data);
  }
}

const socketManager = SocketManager.getInstance();

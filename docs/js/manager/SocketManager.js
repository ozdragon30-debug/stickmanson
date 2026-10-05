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
    this.room = room && /^[a-z0-9][a-z0-9-]{0,23}$/i.test(room) ? room.toLowerCase() : null;

    // socket.io is served by the Node server at /socket.io/socket.io.js.
    // On GitHub Pages or when the server is down that script 404s, leaving
    // `io` undefined.  We degrade gracefully to pure offline mode.
    if (typeof io !== 'undefined') {
      try {
        this.socket = io({
          query: this.room ? { room: this.room } : {},
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        });
        this.socket.on('connect', () => {
          this.isConnected = true;
          this.wasConnected = true;
          this._startPing();
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

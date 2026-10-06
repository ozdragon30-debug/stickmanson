// Connection to the game server (socket.io). Without a server — a static
// host, or the server is down — `io` is missing and the game simply stays in
// offline mode: on() and emit() become no-ops.
class SocketManager {
  static getInstance() {
    return SocketManager.instance || (SocketManager.instance = new SocketManager());
  }

  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.wasConnected = false;   // connected at least once ("reconnecting" banner)
    this.ping = null;            // round trip in ms, null when unknown
    this._pingTimer = null;
    this.room = SocketManager.roomFromUrl();
    this.session = SocketManager.newSessionToken();
    if (typeof io === 'undefined') return;
    try {
      const opts = {
        query: this.room ? { room: this.room, session: this.session } : { session: this.session },
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        autoConnect: false,      // game.js connects once every handler is registered
      };
      this.socket = window.GAME_SERVER ? io(window.GAME_SERVER, opts) : io(opts);
      this.socket.on('connect', () => {
        this.isConnected = this.wasConnected = true;
        this._startPing();
      });
      this.socket.on('connect_error', (err) => this._onConnectError(err));
      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.ping = null;
        this._stopPing();
      });
    } catch (e) {
      console.warn('[SocketManager] Could not initialise socket.io:', e);
    }
  }

  // Private room from an invite link (?room=code); "public" or junk → none.
  static roomFromUrl() {
    const room = (new URLSearchParams(location.search).get('room') || '').toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,23}$/.test(room) && room !== 'public' ? room : null;
  }

  // Secret per-tab token: lets the server replace our own stale socket after
  // a silent network drop. Never sent anywhere else.
  static newSessionToken() {
    const bytes = new Uint8Array(18);
    if (window.crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else bytes.forEach((_, i) => { bytes[i] = Math.random() * 256; });
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Rejections from server middleware (e.g. too many connections) aren't
  // retried by socket.io itself: say why once, then retry every 10 s.
  _onConnectError(err) {
    if (this.socket.active) return;
    if (err?.message && !this._warned && typeof chatManager !== 'undefined') {
      this._warned = true;
      chatManager.addMessage('Server', err.message, null);
    }
    setTimeout(() => { if (!this.socket.connected) this.socket.connect(); }, 10000);
  }

  // Round trip of an acknowledged 'latency' event every 2 s (servers without
  // the handler never answer, leaving the ping unknown).
  _startPing() {
    this._stopPing();
    const probe = () => {
      if (!this.isConnected) return;
      const sent = performance.now();
      this.socket.timeout(3000).emit('latency', Date.now(), (err) => {
        if (!err) this.ping = Math.round(performance.now() - sent);
      });
    };
    probe();
    this._pingTimer = setInterval(probe, 2000);
  }

  _stopPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  on(event, handler) { this.socket?.on(event, handler); }

  emit(event, data) {
    if (this.socket && this.isConnected) this.socket.emit(event, data);
  }
}

const socketManager = SocketManager.getInstance();

// SoundManager – low-latency Web Audio playback.
//
// Each sound is fetched and decoded once, then played through a shared gain
// node, replacing the original per-shot <audio> cloneNode() approach (which
// had noticeable latency and created garbage on every shot). Missing files are
// remembered so they are not re-requested every time.
//
// Optional positional audio: sounds emitted by other players are panned and
// attenuated by their distance from the local player. Attenuation is floored
// so distant gunfire is never silent (no information is removed).

class SoundManager {
  static getInstance() {
    if (!SoundManager.instance) SoundManager.instance = new SoundManager();
    return SoundManager.instance;
  }

  static MAX_VOICES_PER_SOUND = 6;

  constructor() {
    this.volume  = 0.5;     // master volume 0..1 (original default was 0.5)
    this.muted   = false;
    this.spatial = true;
    this.ctx     = null;
    this.master  = null;
    this.buffers = {};      // name -> AudioBuffer | null (missing) | Promise (loading)
    this.voices  = {};      // name -> active voice count
    this._fallback = {};    // HTMLAudio fallback cache when Web Audio is unavailable

    const unlock = () => this._ensureContext();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(ev, unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    });
  }

  _ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this._applyVolume();
    } catch (e) {
      this.ctx = null;
    }
    return this.ctx;
  }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this._applyVolume(); }
  setMuted(m)  { this.muted = !!m; this._applyVolume(); }
  setSpatial(s) { this.spatial = !!s; }

  _applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  // Fetch + decode a sound once. Resolves to an AudioBuffer or null.
  _load(name) {
    const cached = this.buffers[name];
    if (cached !== undefined) return cached instanceof Promise ? cached : Promise.resolve(cached);
    const p = fetch(`sounds/${name}.mp3`)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(buf => (buf && this.ctx ? this.ctx.decodeAudioData(buf) : null))
      .catch(() => null)
      .then(decoded => (this.buffers[name] = decoded));
    this.buffers[name] = p;
    return p;
  }

  preload(names) {
    if (!this._ensureContext()) return;
    for (const n of names) this._load(n);
  }

  // Gain/pan for a sound emitted at world position `pos` (null = non-positional).
  _spatialParams(pos) {
    const me = (typeof playerManager !== 'undefined') ? playerManager.mainPlayer : null;
    if (!this.spatial || !pos || !me) return { gain: 1, pan: 0 };
    const dx = pos.x - me.body.x;
    const dy = pos.y - me.body.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const gain = Math.max(0.2, 1 - Math.max(0, d - 250) / 1100);
    const pan  = Math.max(-0.75, Math.min(0.75, dx / 500));
    return { gain, pan };
  }

  play(name, pos = null) {
    if (this.muted || !name) return;
    const ctx = this._ensureContext();
    if (!ctx) return this._playFallback(name);

    const buf = this.buffers[name];
    if (buf === null) return;                       // known missing
    if (buf === undefined || buf instanceof Promise) {
      // First use: play once decoded, unless it arrives too late to make sense.
      const requested = performance.now();
      this._load(name).then(b => { if (b && performance.now() - requested < 250) this._start(name, b, pos); });
      return;
    }
    this._start(name, buf, pos);
  }

  _start(name, buffer, pos) {
    if ((this.voices[name] || 0) >= SoundManager.MAX_VOICES_PER_SOUND) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const { gain, pan } = this._spatialParams(pos);
    let node = src;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = gain;
      node.connect(g);
      node = g;
    }
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      node = p;
    }
    node.connect(this.master);
    this.voices[name] = (this.voices[name] || 0) + 1;
    src.onended = () => { this.voices[name]--; };
    src.start();
  }

  _playFallback(name) {
    if (!this._fallback[name]) this._fallback[name] = new Audio(`sounds/${name}.mp3`);
    const clone = this._fallback[name].cloneNode();
    clone.volume = this.volume;
    clone.play().catch(() => {});
  }

  playRandom(names, pos = null) {
    if (!names || !names.length) return;
    this.play(names[Math.floor(Math.random() * names.length)], pos);
  }
}

const soundManager = SoundManager.getInstance();

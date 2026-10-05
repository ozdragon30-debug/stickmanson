// A game room: its own players, map, round timer and pickup state.
// The public lobby is the room "public"; private rooms are created on demand
// from a shared link (?room=code) and removed once empty.

const DEBUG_MAP_FILE = 'debug.dat';

// Convert a map filename like 'anarchystreets.dat' to 'Anarchystreets'.
function mapDisplayName(filename) {
  return filename.replace(/^_+/, '').replace(/\.dat$/i, '')
    .replace(/^./, c => c.toUpperCase());
}

class Room {
  /**
   * @param {string} id
   * @param {object} opts { io, mapFiles, roundMs, roundEndMs }
   */
  constructor(id, { io, mapFiles, roundMs, roundEndMs }) {
    this.id = id;
    this.io = io;
    this.mapFiles = mapFiles;
    this.roundMs = roundMs;
    this.roundEndMs = roundEndMs;
    this.players = {};
    this.debugMapEnabled = false;
    this.roundEndTimeout = null;
    this.roundStartTimeout = null;
    this.game = {
      mapFile:      this.pickMap(),
      roundEndsAt:  Date.now() + roundMs,
      phase:        'playing', // 'playing' | 'roundEnd'
      pickups:      [],  // { weaponId, respawnTime, available, respawnAt }
      pickupTimers: {}, // spawnIndex → timeout handle
    };
    this.scheduleRoundEnd();
  }

  get size() { return Object.keys(this.players).length; }

  emit(event, data) { this.io.to(this.id).emit(event, data); }

  // The debug test map is only used when explicitly enabled with !debugmap, and
  // the same map is never picked twice in a row.
  pickMap(previous = null) {
    if (this.debugMapEnabled) return DEBUG_MAP_FILE;
    const pool = this.mapFiles.length > 1 ? this.mapFiles.filter(f => f !== previous) : this.mapFiles;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  getScores() {
    const scores = {};
    for (const id in this.players) {
      const p = this.players[id];
      scores[id] = {
        name:         p.name,
        kills:        p.kills,
        deaths:       p.deaths,
        indicatorHue: p.indicatorHue ?? 0,
      };
    }
    return scores;
  }

  // ── Round lifecycle ──────────────────────────────────────────────────────
  endRound(message) {
    const game = this.game;
    if (game.phase !== 'playing') return;
    if (this.roundEndTimeout) clearTimeout(this.roundEndTimeout);
    this.roundEndTimeout = null;
    game.phase = 'roundEnd';
    this.emit('roundEnd', { scores: this.getScores() });
    if (message) this.emit('chatMessage', { name: 'Server', text: message });
    if (this.roundStartTimeout) clearTimeout(this.roundStartTimeout);
    this.roundStartTimeout = setTimeout(() => this.startNewRound(), this.roundEndMs);
  }

  scheduleRoundEnd() {
    if (this.roundEndTimeout) clearTimeout(this.roundEndTimeout);
    const remaining = this.game.roundEndsAt - Date.now();
    this.roundEndTimeout = setTimeout(() => {
      this.endRound(`Round over! Next round starting in ${this.roundEndMs / 1000} seconds...`);
    }, Math.max(remaining, 0));
  }

  startNewRound() {
    const game = this.game;
    this.roundStartTimeout = null;
    game.mapFile     = this.pickMap(game.mapFile);
    game.roundEndsAt = Date.now() + this.roundMs;
    game.phase       = 'playing';

    // Cancel all pending pickup respawn timers and reset state.
    for (const idx in game.pickupTimers) clearTimeout(game.pickupTimers[idx]);
    game.pickupTimers = {};
    game.pickups = [];

    for (const id in this.players) {
      this.players[id].kills    = 0;
      this.players[id].deaths   = 0;
      this.players[id].weaponId = 0; // reset to fist on round start
    }

    this.emit('roundStart', {
      mapFile:     game.mapFile,
      roundEndsAt: game.roundEndsAt,
      scores:      this.getScores(),
    });
    this.emit('chatMessage', { name: 'Server', text: `Round started on ${mapDisplayName(game.mapFile)}!` });

    this.scheduleRoundEnd();
  }

  dispose() {
    if (this.roundEndTimeout) clearTimeout(this.roundEndTimeout);
    if (this.roundStartTimeout) clearTimeout(this.roundStartTimeout);
    for (const idx in this.game.pickupTimers) clearTimeout(this.game.pickupTimers[idx]);
    this.roundEndTimeout = this.roundStartTimeout = null;
  }
}

module.exports = { Room, DEBUG_MAP_FILE, mapDisplayName };

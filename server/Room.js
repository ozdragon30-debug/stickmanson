// One arena: the players in it, the map being played, the round clock and the
// weapon pickups lying around. "public" is the lobby everybody lands in;
// private rooms come from invite links (?room=code) and vanish once empty.

const DEBUG_MAP_FILE = 'debug.dat';

// Human titles for map files ("Anarchy Streets (by Bloodsyn)").
let mapTitles = {};
try {
  mapTitles = require('../docs/data/maps/index.json');
} catch (_err) {
  // No index: titles are derived from the file names instead.
}

// Title used in chat. Titles written all in lower case get capitalised words;
// maps missing from the index use their file name.
function mapDisplayName(file) {
  const title = mapTitles[file];
  if (title) return /[A-Z]/.test(title) ? title : title.replace(/\b\w/g, ch => ch.toUpperCase());
  const bare = file.replace(/^_+/, '').replace(/\.dat$/i, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

const PICKUP_RESPAWN_MIN_MS = 1000;
const PICKUP_RESPAWN_MAX_MS = 600000;

class Room {
  /**
   * @param {string} id   room code ("public" for the lobby)
   * @param {object} opts { io, mapFiles, roundMs, scoreboardMs }
   */
  constructor(id, { io, mapFiles, roundMs, scoreboardMs }) {
    this.id = id;
    this.io = io;
    this.mapFiles = mapFiles;
    this.roundMs = roundMs;
    this.scoreboardMs = scoreboardMs;

    // Keyed by socket id. No prototype, so ids like "__proto__" can't collide
    // with inherited keys.
    this.players = Object.create(null);
    // Bumped every round; a reconnecting player only gets their score back
    // inside the round they left.
    this.roundId = 0;
    this.debugMapEnabled = false;

    this.mapFile = this.chooseMap(null);
    this.phase = 'playing';          // 'playing' | 'roundEnd'
    this.roundEndsAt = Date.now() + roundMs;
    this.pickups = [];               // [{ weaponId, respawnTime, available, respawnAt }]
    this.pickupTimers = new Map();   // spawn index -> respawn timeout

    this.clockTimer = null;          // fires when the round runs out
    this.intermissionTimer = null;   // fires when the scoreboard pause is over
    this.armClock();
  }

  get size() { return Object.keys(this.players).length; }

  get isPlaying() { return this.phase === 'playing'; }

  broadcast(event, payload) { this.io.to(this.id).emit(event, payload); }

  announce(text) { this.broadcast('chatMessage', { name: 'Server', text }); }

  scores() {
    const table = {};
    for (const id in this.players) table[id] = this.players[id].scoreLine();
    return table;
  }

  pushScores() { this.broadcast('scoreUpdate', { scores: this.scores() }); }

  // A random map, never the one just played (unless it's the only one).
  // While the debug map is switched on it is used every round.
  chooseMap(previous) {
    if (this.debugMapEnabled) return DEBUG_MAP_FILE;
    const choices = this.mapFiles.length > 1 ? this.mapFiles.filter(f => f !== previous) : this.mapFiles;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  // ── Rounds ────────────────────────────────────────────────────────────────

  armClock() {
    clearTimeout(this.clockTimer);
    const wait = Math.max(this.roundEndsAt - Date.now(), 0);
    this.clockTimer = setTimeout(() => {
      this.finishRound(`Round over! Next round starting in ${this.scoreboardMs / 1000} seconds...`);
    }, wait);
  }

  // Stops play, shows the scoreboard and queues the next round. Does nothing
  // if the round is already over.
  finishRound(notice) {
    if (!this.isPlaying) return;
    clearTimeout(this.clockTimer);
    this.clockTimer = null;
    this.phase = 'roundEnd';
    this.broadcast('roundEnd', { scores: this.scores() });
    if (notice) this.announce(notice);
    clearTimeout(this.intermissionTimer);
    this.intermissionTimer = setTimeout(() => this.beginRound(), this.scoreboardMs);
  }

  beginRound() {
    this.intermissionTimer = null;
    this.roundId += 1;
    this.mapFile = this.chooseMap(this.mapFile);
    this.roundEndsAt = Date.now() + this.roundMs;
    this.phase = 'playing';
    this.clearPickups();
    for (const id in this.players) this.players[id].resetForRound();

    this.broadcast('roundStart', { mapFile: this.mapFile, roundEndsAt: this.roundEndsAt, scores: this.scores() });
    this.announce(`Round started on ${mapDisplayName(this.mapFile)}!`);
    this.armClock();
  }

  // ── Weapon pickups ────────────────────────────────────────────────────────
  // The server only learns the spawn list from the first client to load the
  // map; afterwards it tracks who took what so late joiners see the truth.

  // Adopts the spawn list a client reported, unless one is already known or
  // the list is malformed (every entry must be valid, or none is used).
  // Maps may use weapon ids the weapon table lacks (13, say); clients just
  // don't draw those, so any small id is accepted.
  learnPickups(spawns, isFiniteNumber) {
    if (this.pickups.length > 0) return;
    if (!Array.isArray(spawns) || spawns.length === 0 || spawns.length > 128) return;
    const sane = spawns.every(s => s
      && Number.isInteger(s.weaponId) && s.weaponId >= 0 && s.weaponId < 256
      && isFiniteNumber(s.respawnTime));
    if (!sane) return;
    this.pickups = spawns.map(s => ({
      weaponId: s.weaponId,
      respawnTime: Math.max(PICKUP_RESPAWN_MIN_MS, Math.min(PICKUP_RESPAWN_MAX_MS, s.respawnTime)),
      available: true,
      respawnAt: null,
    }));
  }

  pickupSnapshot() {
    return this.pickups.map(({ available, respawnAt }) => ({ available, respawnAt }));
  }

  // Marks a pickup as taken and returns it, or null when it doesn't exist or
  // somebody got there first. It becomes available again after its respawn
  // time (clients run their own timers, so nothing is announced then).
  takePickup(index) {
    const pickup = this.pickups[index];
    if (!pickup || !pickup.available) return null;
    pickup.available = false;
    pickup.respawnAt = Date.now() + pickup.respawnTime;
    this.pickupTimers.set(index, setTimeout(() => {
      pickup.available = true;
      pickup.respawnAt = null;
      this.pickupTimers.delete(index);
    }, pickup.respawnTime));
    return pickup;
  }

  clearPickups() {
    for (const timer of this.pickupTimers.values()) clearTimeout(timer);
    this.pickupTimers.clear();
    this.pickups = [];
  }

  // Stops every timer; called when the room is thrown away.
  dispose() {
    clearTimeout(this.clockTimer);
    clearTimeout(this.intermissionTimer);
    for (const timer of this.pickupTimers.values()) clearTimeout(timer);
    this.clockTimer = null;
    this.intermissionTimer = null;
  }
}

module.exports = { Room, DEBUG_MAP_FILE, mapDisplayName };

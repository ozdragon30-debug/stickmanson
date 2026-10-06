// Everything that happens on one accepted socket: joining its room, the game
// events it may send, and leaving again.
//
// The server is a relay with guard rails. Clients simulate the game, the
// server checks what they report, keeps scores, weapons and pickups honest,
// and forwards the result to the rest of the room.

const Player = require('./models/Player');
const { finite, isPoint, clamp, tidyText, isReservedName, ownKey } = require('./checks');
const { ActionWindow, HitBudget } = require('./throttle');
const { RejoinLedger } = require('./RoomRegistry');
const { runChatCommand } = require('./chatCommands');

const JOIN_ANNOUNCE_FALLBACK_MS = 30000;
const CHAT_MAX_LENGTH = 80;
const NAME_MAX_LENGTH = 20;
const AFK_RETRY_MS = 5000;

// Client event -> method handling it.
const INBOUND = {
  latency: 'onLatency',
  disconnect: 'onDisconnect',
  playerMovement: 'onMovement',
  playedShoot: 'onShot',
  playedWalkingAnimation: 'onWalkFrame',
  playerHit: 'onHit',
  iDied: 'onDeath',
  playerRespawn: 'onRespawn',
  playerStatus: 'onStatus',
  playerIdentity: 'onIdentity',
  mapLoaded: 'onMapLoaded',
  pickupWeapon: 'onPickup',
  chatMessage: 'onChat',
  setName: 'onSetName',
};

class ClientSession {
  constructor(game, socket, room) {
    this.game = game;
    this.socket = socket;
    this.room = room;
    this.id = socket.id;
    this.hitBudget = new HitBudget();
    this.chatWindow = new ActionWindow(5, 5000);
    this.renameWindow = new ActionWindow(5, 10000);
    this.statusWindow = new ActionWindow(10, 5000);
    this.afkRetry = null;
  }

  // Our player record; undefined once we've left.
  get player() { return this.room.players[this.id]; }

  get rejoinKey() {
    const token = this.socket.data.session;
    return token ? RejoinLedger.key(this.room.id, token) : null;
  }

  // To everyone else in the room.
  toOthers(event, payload) { this.socket.to(this.room.id).emit(event, payload); }

  start() {
    const { socket, room } = this;
    socket.join(room.id);
    socket.data.room = room;

    const player = new Player('Player ' + this.id.slice(0, 4), { x: 0, y: 0 });
    this.restoreAfterDrop(player);
    room.players[this.id] = player;

    socket.emit('currentPlayers', room.players);
    socket.emit('gameState', {
      mapFile: room.mapFile,
      roundEndsAt: room.roundEndsAt,
      phase: room.phase,
      scores: room.scores(),
    });
    this.toOthers('newPlayer', { playerId: this.id, name: player.name });
    room.pushScores();

    // The join is announced when the player leaves the menu (first
    // playerStatus with afk:false, by which time the chosen name has
    // arrived); clients that never say so are announced after a while.
    setTimeout(() => this.announceJoin(), JOIN_ANNOUNCE_FALLBACK_MS);

    for (const [event, method] of Object.entries(INBOUND)) {
      socket.on(event, (...args) => this[method](...args));
    }
  }

  // Back within the rejoin window: same name, and the score too if the round
  // hasn't changed. Nobody is told about the blip.
  restoreAfterDrop(player) {
    const key = this.rejoinKey;
    const held = key && this.game.ledger.claim(key);
    if (!held) return;
    if (held.round === this.room.roundId) {
      player.kills = held.kills;
      player.deaths = held.deaths;
    }
    player.name = held.name;
    this.socket.data.announced = true;
  }

  announceJoin() {
    if (this.socket.data.announced || !this.player) return;
    this.socket.data.announced = true;
    const name = this.player.name;
    // A reload under a new token: the old tab's "left" is still pending, so
    // both lines are skipped.
    if (this.game.ledger.forgetByName(this.room.id, name)) return;
    this.room.announce(`${name} joined the game.`);
  }

  // ── Connection ────────────────────────────────────────────────────────────

  // Round-trip probe behind the client's ping display.
  onLatency(_sentAt, ack) {
    if (typeof ack === 'function') ack();
  }

  onDisconnect() {
    const { game, room, socket } = this;
    game.log('user disconnected: ', this.id);
    const player = this.player;
    const name = player?.name ?? 'A player';
    delete room.players[this.id];
    room.broadcast('playerDisconnected', this.id);
    room.pushScores();

    // Taken over by a fresh socket of the same player: they're already back.
    if (socket.data.replaced) return;

    const sayGoodbye = () => room.announce(`${name} left the game.`);
    const key = this.rejoinKey;
    if (key && player) {
      // Maybe a network blip: keep the score (and the room) for a moment.
      game.ledger.hold(key, { kills: player.kills, deaths: player.deaths, name, round: room.roundId },
        game.config.rejoinWindowMs, () => {
          // Only if the room they left is still the one under that code.
          if (game.registry.isCurrent(room)) sayGoodbye();
          game.registry.closeIfEmpty(room);
        });
      return;
    }
    sayGoodbye();
    game.registry.closeIfEmpty(room);
  }

  // ── Movement and animation ───────────────────────────────────────────────

  onMovement(data) {
    if (!this.player || !isPoint(data)) return;
    const position = { x: data.x, y: data.y };
    if (finite(data.rotation)) position.rotation = data.rotation;
    this.player.position = position;
    this.toOthers('playerMoved', { playerId: this.id, playerPos: position });
  }

  onShot() {
    this.toOthers('playShoot', { playerId: this.id });
  }

  onWalkFrame(data) {
    if (!data || !finite(data.rotation)) return;
    this.toOthers('playWalkingAnimation', { playerId: this.id, rotation: data.rotation });
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  // An attacker's client reports a hit; the victim's client owns its health
  // and reports its own death. Damage always comes from the weapon table,
  // only for the weapon the server knows the attacker holds, and no faster
  // than that weapon can fire at the same victim.
  onHit(data) {
    const { room, game } = this;
    if (!data || !this.player) return;
    const victimId = data.playerId;
    const weaponId = data.weaponId;
    if (!ownKey(room.players, victimId) || victimId === this.id) return;
    if (!room.isPlaying) return;
    if (!game.isWeaponId(weaponId)) return;
    if (weaponId !== (this.player.weaponId ?? 0)) return;
    const weapon = game.weapons[weaponId];
    if (!this.hitBudget.spend(victimId, weapon.fireCooldown)) return;
    room.broadcast('playerGotHit', { playerId: victimId, damage: weapon.damage, weaponId, attackerId: this.id });
  }

  onDeath(data) {
    const { room, game } = this;
    const me = this.player;
    if (!me || !room.isPlaying) return;
    me.deaths += 1;
    me.weaponId = 0;   // the dead drop back to fists
    const claimed = data?.killerId;
    const killerId = claimed !== this.id && ownKey(room.players, claimed) ? claimed : null;
    const weaponId = game.isWeaponId(data?.weaponId) ? data.weaponId : 0;
    if (killerId) room.players[killerId].kills += 1;
    room.broadcast('playerDied', { playerId: this.id, killerId, weaponId });
    room.pushScores();
  }

  // Others keep showing the body until this arrives, so the respawn appears
  // at the same moment for everyone.
  onRespawn(data) {
    if (!this.player || !data || !isPoint(data.position)) return;
    const position = { x: data.position.x, y: data.position.y };
    this.player.position = position;
    this.toOthers('playerMoved', { playerId: this.id, playerPos: position });
    this.toOthers('playerRespawned', { playerId: this.id, playerPos: position });
  }

  // ── Presence and looks ────────────────────────────────────────────────────

  // Away flag (menu open or tab hidden), shown to other players only.
  onStatus(data) {
    const me = this.player;
    if (!me || !data) return;
    const afk = data.afk === true;
    if (!afk) this.announceJoin();
    if (me.afk === afk) return;
    me.afk = afk;
    const share = () => {
      if (this.player) this.toOthers('playerStatus', { playerId: this.id, afk: this.player.afk });
    };
    if (this.statusWindow.tryUse()) {
      share();
      return;
    }
    // Over the limit: send whatever the state is once the window has passed.
    if (!this.afkRetry) {
      this.afkRetry = setTimeout(() => {
        this.afkRetry = null;
        share();
      }, AFK_RETRY_MS);
    }
  }

  // Spinner colour/shape, pet and VIP badge, sent once the map has loaded.
  onIdentity(data) {
    const me = this.player;
    if (!me || !data) return;
    const look = {
      indicatorHue: (((data.hue | 0) % 360) + 360) % 360,
      indicatorShapeIndex: clamp(data.shapeIndex | 0, 0, 255),
      petId: clamp((data.pet ?? -1) | 0, -1, 31),
      vip: Boolean(data.vip),
    };
    Object.assign(me, look);
    this.toOthers('playerIdentityUpdate', { playerId: this.id, ...look });
    this.room.pushScores();   // the scoreboard colours names by hue
  }

  onSetName(data) {
    const { room, socket } = this;
    const me = this.player;
    if (!me || !data) return;
    let name = tidyText(data.name, NAME_MAX_LENGTH);
    if (!name || isReservedName(name)) {
      // Tell the client the name it really has, so it doesn't show "Server".
      socket.emit('nameAssigned', { name: me.name });
      return;
    }
    if (name !== me.name && !this.renameWindow.tryUse()) return;

    // Names are unique per room: chat highlighting and !kick depend on it.
    const inUse = candidate => Object.keys(room.players).some(id =>
      id !== this.id && room.players[id].name.toLowerCase() === candidate.toLowerCase());
    if (inUse(name)) {
      const stem = name.slice(0, 17).trimEnd();
      let n = 2;
      let candidate;
      do {
        candidate = `${stem} ${n}`;
        n += 1;
      } while (inUse(candidate) && n < 100);
      name = candidate;
      socket.emit('nameAssigned', { name });
    }
    if (name === me.name) return;

    const before = me.name;
    me.name = name;
    this.toOthers('playerNameChanged', { playerId: this.id, name });
    room.pushScores();
    if (socket.data.announced) room.announce(`${before} is now known as ${name}.`);
  }

  // ── Pickups ───────────────────────────────────────────────────────────────

  // The client has parsed the map: (maybe) learn its spawn list, then tell it
  // which pickups are currently up.
  onMapLoaded(data) {
    const room = this.room;
    if (data) room.learnPickups(data.weaponSpawns, finite);
    this.socket.emit('pickupState', room.pickupSnapshot());
  }

  // The picker already equipped the weapon locally. Others are told; if it
  // was gone already, the picker is told to put their previous weapon back.
  onPickup(data) {
    const me = this.player;
    if (!data || !me) return;
    const spawnIndex = data.spawnIndex;
    if (!Number.isInteger(spawnIndex)) return;
    const pickup = this.room.takePickup(spawnIndex);
    if (!pickup) {
      this.socket.emit('pickupRejected', { spawnIndex, weaponId: me.weaponId ?? 0 });
      return;
    }
    me.weaponId = pickup.weaponId;
    this.toOthers('pickupTaken', { spawnIndex, playerId: this.id, weaponId: pickup.weaponId });
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  onChat(data) {
    const me = this.player;
    if (!me || !data) return;
    const text = tidyText(data.text, CHAT_MAX_LENGTH);
    if (!text) return;
    if (text.startsWith('!') && runChatCommand(this, text)) return;
    if (!this.chatWindow.tryUse()) {
      this.socket.emit('chatMessage', { name: 'Server', text: 'You are sending messages too fast.' });
      return;
    }
    this.room.broadcast('chatMessage', { name: me.name, hue: me.indicatorHue ?? 0, text });
  }
}

module.exports = ClientSession;

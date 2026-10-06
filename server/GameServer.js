// Wires socket.io to the rooms: admission (bans, per-address cap, packet
// budget, room capacity) and one ClientSession per accepted socket.

const fs = require('fs');
const path = require('path');

const { AccessControl, BanList } = require('./access');
const { capConnectionsPerAddress, guardPacketFlood } = require('./throttle');
const { RoomRegistry, RejoinLedger, roomIdFrom } = require('./RoomRegistry');
const { DEBUG_MAP_FILE } = require('./Room');
const ClientSession = require('./ClientSession');

const DATA_DIR = path.join(__dirname, '..', 'docs', 'data');

// Session tokens are random per browser tab; anything else is ignored.
const SESSION_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

class GameServer {
  constructor(io, config) {
    this.io = io;
    this.config = config;

    // The client reads the very same weapon table.
    this.weapons = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'weapons.json'), 'utf8'));
    // Every map rotates in except the debug map, which only !debugmap enables.
    const mapFiles = fs.readdirSync(path.join(DATA_DIR, 'maps'))
      .filter(f => f.endsWith('.dat') && f !== DEBUG_MAP_FILE);

    this.access = new AccessControl(config);
    this.bans = new BanList(config.bansFile);
    this.registry = new RoomRegistry({ io, mapFiles, roundMs: config.roundMs, scoreboardMs: config.scoreboardMs });
    this.ledger = new RejoinLedger();

    capConnectionsPerAddress(io, socket => this.access.addressOf(socket), config.connectionsPerAddress);
    io.on('connection', socket => this.admit(socket));
  }

  isWeaponId(id) {
    return Number.isInteger(id) && id >= 0 && id < this.weapons.length;
  }

  log(...parts) {
    if (!this.config.quiet) console.log(...parts);
  }

  admit(socket) {
    guardPacketFlood(socket, this.config.packetBudgetPerSecond);
    this.log('a user connected: ', socket.id);

    if (this.bans.has(this.access.addressOf(socket))) {
      this.turnAway(socket, 'You are banned.');
      return;
    }

    const room = this.registry.open(roomIdFrom(socket.handshake.query?.room));
    this.evictGhosts(socket, room);

    if (room.size >= this.config.roomCapacity) {
      this.turnAway(socket, 'This room is full.');
      this.registry.closeIfEmpty(room);
      return;
    }

    new ClientSession(this, socket, room).start();
  }

  turnAway(socket, reason) {
    socket.emit('kicked', { reason });
    socket.disconnect(true);
  }

  // After a silent network drop (Wi-Fi to mobile data, say) the old socket can
  // hang around as a frozen ghost until the ping timeout, holding a room slot.
  // A new socket bringing the same session token into the same room takes over
  // at once; the swap is kept out of chat.
  evictGhosts(socket, room) {
    const token = socket.handshake.query?.session;
    if (typeof token !== 'string' || !SESSION_TOKEN.test(token)) return;
    socket.data.session = token;
    for (const [id, other] of this.io.sockets.sockets) {
      if (id === socket.id || other.data.session !== token || other.data.room !== room) continue;
      other.data.replaced = true;
      socket.data.announced = true;
      other.disconnect(true);
    }
  }

  // The player record behind a socket id, whichever room it is in.
  findPlayer(socketId) {
    return this.registry.findPlayer(socketId);
  }

  // Server going down: tell everyone first.
  sayGoodbye() {
    this.io.emit('chatMessage', { name: 'Server', text: 'Server is restarting…' });
  }

  stop() {
    this.ledger.cancelAll();
    this.registry.disposeAll();
  }
}

module.exports = GameServer;

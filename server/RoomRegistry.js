// All live rooms by code. The public lobby always exists; a private room is
// opened by the first player using its code and closed after the last leaves.

const { Room } = require('./Room');

const PUBLIC_ROOM_ID = 'public';
const ROOM_CODE = /^[a-z0-9][a-z0-9-]{0,23}$/;

// Room code from the handshake: lower-cased; anything malformed means the lobby.
function roomIdFrom(raw) {
  const code = String(raw ?? '').trim().toLowerCase();
  return ROOM_CODE.test(code) ? code : PUBLIC_ROOM_ID;
}

class RoomRegistry {
  constructor(roomOptions) {
    this.roomOptions = roomOptions;   // { io, mapFiles, roundMs, scoreboardMs }
    this.rooms = new Map();
    this.open(PUBLIC_ROOM_ID);
  }

  get lobby() { return this.rooms.get(PUBLIC_ROOM_ID); }

  open(id) {
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(id, this.roomOptions);
      this.rooms.set(id, room);
    }
    return room;
  }

  isCurrent(room) { return this.rooms.get(room.id) === room; }

  // Closes a private room that has emptied. A room that was already replaced
  // under the same code (closed and reopened meanwhile) is only shut down,
  // never allowed to remove its successor.
  closeIfEmpty(room) {
    if (!this.isCurrent(room)) {
      if (room.size === 0) room.dispose();
      return;
    }
    if (room.id === PUBLIC_ROOM_ID || room.size !== 0) return;
    room.dispose();
    this.rooms.delete(room.id);
  }

  privateRooms() {
    return [...this.rooms.values()].filter(r => r.id !== PUBLIC_ROOM_ID);
  }

  totalPlayers() {
    let total = 0;
    for (const room of this.rooms.values()) total += room.size;
    return total;
  }

  findPlayer(socketId) {
    for (const room of this.rooms.values()) {
      if (room.players[socketId]) return room.players[socketId];
    }
    return null;
  }

  disposeAll() {
    for (const room of this.rooms.values()) room.dispose();
  }
}

// Players who dropped recently, held for a possible reconnect with the same
// session token. Keyed by room code + token.
class RejoinLedger {
  constructor() {
    this.entries = new Map();
  }

  static key(roomId, session) { return `${roomId}|${session}`; }

  hold(key, record, windowMs, onExpire) {
    const timer = setTimeout(() => {
      this.entries.delete(key);
      onExpire();
    }, windowMs);
    if (timer.unref) timer.unref();
    this.entries.set(key, { ...record, timer });
  }

  // Removes and returns the held record (its expiry cancelled), if any.
  claim(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.entries.delete(key);
    return entry;
  }

  // Cancels a pending "left" for someone of this name in this room: a page
  // reload brings a new token, but it is still the same player coming back.
  forgetByName(roomId, name) {
    const prefix = roomId + '|';
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix) && entry.name === name) {
        this.claim(key);
        return true;
      }
    }
    return false;
  }

  cancelAll() {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
  }
}

module.exports = { RoomRegistry, RejoinLedger, roomIdFrom, PUBLIC_ROOM_ID };

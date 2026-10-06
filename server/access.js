// Who is connecting: client addresses, admin trust and the ban list.

const fs = require('fs');
const path = require('path');

const PRIVATE_RANGES = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];
const LOOPBACK = new Set(['::1', '127.0.0.1', 'localhost']);

const stripV4Mapping = addr => addr.replace(/^::ffff:/, '');

class AccessControl {
  constructor({ trustProxy, lanAdmin }) {
    this.trustProxy = trustProxy;
    this.lanAdmin = lanAdmin;
  }

  // With a trusted proxy the real client is the hop the proxy appended last;
  // anything to its left was written by the client and means nothing.
  addressOf(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (this.trustProxy && forwarded) {
      const hops = String(forwarded).split(',').map(h => h.trim()).filter(Boolean);
      if (hops.length > 0) return stripV4Mapping(hops[hops.length - 1]);
    }
    return stripV4Mapping((socket.handshake.address || '').trim());
  }

  // Admins: anyone who logged in with the password, or (when allowed) a direct
  // connection from loopback or a private network. Proxied or forwarded
  // connections never get LAN trust, because the address can't be relied on.
  isAdmin(socket) {
    if (socket.data.isAdmin) return true;
    if (!this.lanAdmin || this.trustProxy) return false;
    if (socket.handshake.headers['x-forwarded-for']) return false;
    const addr = this.addressOf(socket);
    return LOOPBACK.has(addr) || PRIVATE_RANGES.some(range => range.test(addr));
  }
}

// Banned addresses. With a file configured the list is loaded at start-up and
// rewritten after every ban; writes go one at a time through a temp file and a
// rename, so two quick bans can never leave a half-written or stale file.
class BanList {
  constructor(file) {
    this.file = file;
    this.addresses = new Set();
    this.saving = false;
    this.saveAgain = false;
    if (file) this.load();
  }

  load() {
    try {
      for (const addr of JSON.parse(fs.readFileSync(this.file, 'utf8'))) this.addresses.add(String(addr));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Could not read ${this.file}:`, err.message);
    }
  }

  has(addr) { return this.addresses.has(addr); }

  add(addr) {
    this.addresses.add(addr);
    this.save();
  }

  save() {
    if (!this.file) return;
    if (this.saving) { this.saveAgain = true; return; }
    this.saving = true;
    this.saveAgain = false;
    const target = path.resolve(this.file);
    const staging = target + '.tmp';
    const finish = (err) => {
      if (err) console.warn(`Could not write ${this.file}:`, err.message);
      this.saving = false;
      if (this.saveAgain) this.save();
    };
    fs.mkdir(path.dirname(target), { recursive: true }, () => {
      fs.writeFile(staging, JSON.stringify([...this.addresses], null, 2), (err) => {
        if (err) finish(err);
        else fs.rename(staging, target, finish);
      });
    });
  }
}

module.exports = { AccessControl, BanList };

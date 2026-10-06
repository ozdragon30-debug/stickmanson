// "!" commands typed in chat. `!help` is answered by the client itself and
// `!login` is open to everyone; the rest only work for admins (LAN players or
// those who logged in). For anyone else they are posted as ordinary chat.

const KICK_GRACE_MS = 500;   // lets the 'kicked' notice arrive before the cut

function whisper(session, text) {
  session.socket.emit('chatMessage', { name: 'Server', text });
}

const adminCommands = {
  '!next'(session) {
    session.room.finishRound();
  },

  '!kick'(session, args) { removePlayer(session, args.join(' '), false); },
  '!ban'(session, args) { removePlayer(session, args.join(' '), true); },

  '!weapon'(session, args) {
    const weaponId = parseInt(args[0], 10);
    if (!session.game.isWeaponId(weaponId)) return;
    session.player.weaponId = weaponId;
    session.socket.emit('forceWeapon', { weaponId });
  },

  '!debugmap'(session) {
    const room = session.room;
    room.debugMapEnabled = !room.debugMapEnabled;
    whisper(session, `Debug map ${room.debugMapEnabled ? 'ON (debug.dat)' : 'OFF (random maps)'} — starting new round...`);
    room.finishRound();
  },
};

// Target is matched by exact name or socket id, inside the admin's room only.
function removePlayer(session, target, ban) {
  const { room, game } = session;
  const victimId = Object.keys(room.players).find(id => room.players[id].name === target || id === target);
  if (victimId === undefined) {
    whisper(session, `No player named "${target}".`);
    return;
  }
  const victimSocket = game.io.sockets.sockets.get(victimId);
  if (ban && victimSocket) {
    const addr = game.access.addressOf(victimSocket);
    if (addr) game.bans.add(addr);
  }
  game.io.to(victimId).emit('kicked', { reason: ban ? 'Banned by admin.' : 'Kicked by admin.' });
  setTimeout(() => {
    const stillThere = game.io.sockets.sockets.get(victimId);
    if (stillThere) stillThere.disconnect(true);
  }, KICK_GRACE_MS);
  room.broadcast('chatMessage', { name: '[Admin]', text: `${room.players[victimId].name} was ${ban ? 'banned' : 'kicked'}.` });
}

// Returns true when the line was consumed as a command (and must not be
// posted to chat).
function runChatCommand(session, line) {
  const [head, ...args] = line.split(/\s+/);
  const command = head.toLowerCase();

  if (command === '!help') return true;

  if (command === '!login') {
    const { adminPassword } = session.game.config;
    if (adminPassword && args[0] === adminPassword) {
      session.socket.data.isAdmin = true;
      whisper(session, 'Admin access granted.');
    } else {
      whisper(session, 'Invalid admin password.');
    }
    return true;
  }

  if (!session.game.access.isAdmin(session.socket)) return false;
  // Unknown commands from admins are swallowed rather than posted.
  if (Object.hasOwn(adminCommands, command)) adminCommands[command](session, args);
  return true;
}

module.exports = { runChatCommand };

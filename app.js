// Stick Clash server entry point: one HTTP server delivering the web client
// (docs/) and carrying the socket.io multiplayer traffic.
//
//   node app.js            (settings come from the environment, see server/config.js)
//
// The game logic lives in server/: GameServer admits sockets, ClientSession
// handles each one, Room runs rounds and pickups, httpSite serves the pages.

const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');

const config = require('./server/config');
const GameServer = require('./server/GameServer');
const { mountHttpSite } = require('./server/httpSite');

const site = express();
const server = http.createServer(site);
const io = new SocketServer(server, {
  // Game messages are tiny; anything bigger is refused outright.
  maxHttpBufferSize: 16 * 1024,
  // Pages hosted elsewhere (the GitHub Pages build with ?server=…) may
  // connect; CORS_ORIGIN narrows that to a list of origins.
  cors: { origin: config.corsOrigins },
  pingInterval: 10000,
  pingTimeout: 8000,
});

const game = new GameServer(io, config);
mountHttpSite(site, { registry: game.registry, trustProxy: config.trustProxy });

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${config.port} is already in use. Stop the other server or run with PORT=<number> node app.js`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  game.log(`Stick Clash listening on http://${config.host || 'localhost'}:${server.address().port}`);
});

// Docker, systemd and Ctrl+C: warn the players, then close; give up waiting
// after three seconds.
function stopOnSignal(signal) {
  console.log(`${signal} received, shutting down…`);
  game.sayGoodbye();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

if (require.main === module) {
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopOnSignal(signal));
}

// Handles used by the integration and browser tests.
module.exports = {
  server,
  io,
  rooms: game.registry.rooms,
  weaponsData: game.weapons,
  player: socketId => game.findPlayer(socketId),
  close() {
    game.stop();
    io.close();
    return new Promise(resolve => server.close(() => resolve()));
  },
};

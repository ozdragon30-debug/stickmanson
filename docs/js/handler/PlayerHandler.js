socketManager.on("currentPlayers", (players) => {
  // Sent on every (re)connection: drop remote players that left while we were
  // disconnected, otherwise they linger as frozen ghosts.
  for (const id of Object.keys(playerManager.getPlayers())) {
    if (!botManager.isBot(id) && !(id in players)) playerManager.removePlayer(id);
  }
  for (const playerId in players) {
    if (playerId === socketManager.socket?.id) continue;
    const info = players[playerId];
    const player = new Player(info.position.x, info.position.y);
    if (info.name)                player.name               = info.name;
    if (info.weaponId        != null) player.equipWeapon(info.weaponId, true);
    if (info.indicatorHue        != null) player.indicatorHue        = info.indicatorHue;
    if (info.indicatorShapeIndex != null) player.indicatorShapeIndex = info.indicatorShapeIndex;
    player.afk = !!info.afk;
    playerManager.addPlayer(playerId, player);
  }
});

socketManager.on("newPlayer", (data) => {
  const player = new Player(-10, -10);
  if (data.name) player.name = data.name;
  playerManager.addPlayer(data.playerId, player);
  soundManager.play('join_lobby');
  // Waiting in another tab? Flag it in the tab title until the player returns.
  if (document.hidden) {
    document.title = '● ' + t('tab.joined') + ' — Stick Clash';
    const restore = () => { if (!document.hidden) { document.title = 'Stick Clash'; document.removeEventListener('visibilitychange', restore); } };
    document.addEventListener('visibilitychange', restore);
  }
});

socketManager.on("playerDisconnected", (playerId) => {
  playerManager.removePlayer(playerId);
  // The last other player left mid-round: bring the bots back right away
  // instead of leaving an empty arena until the next round.
  // Wait a moment: a player whose connection just blipped usually comes back.
  setTimeout(() => {
    const humans = Object.keys(playerManager.getPlayers()).filter(id => !botManager.isBot(id));
    if (!humans.length && !botManager.active && socketManager.isConnected && map.ready && playerManager.mainPlayer) {
      botManager.considerSpawning({});
    }
  }, 6000);
});

socketManager.on("playWalkingAnimation", (data) => {
  const { playerId, rotation } = data;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  player.playWalkingAnim(rotation);
});

socketManager.on("playerMoved", (data) => {
  const { playerId, playerPos } = data;
  
  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  if (!playerPos || !Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y)) return;
  player.setNetPosition(playerPos.x, playerPos.y, playerPos.rotation);
});

socketManager.on("playShoot", (data) => {
  const { playerId } = data;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;

  player.shoot();
});

// Last attacker's socket id — used to give kill credit when the main player dies.
let _lastAttackerId = null;

socketManager.on("playerGotHit", (data) => {
  const { playerId, damage, weaponId, attackerId } = data;
  const myId = socketManager.socket?.id;

  let player = playerManager.getPlayer(playerId);
  const isMe = !player && playerId === myId;
  if (isMe) {
    player = playerManager.mainPlayer;
    _lastAttackerId = attackerId;
  }
  if (!player || player.isRespawning) return;

  const attacker = playerManager.getPlayer(attackerId);
  player.showHitsplat(damage, weaponId, attacker ? { x: attacker.body.x, y: attacker.body.y } : null);

  // Only the victim's own client triggers death, to avoid every player calling it.
  if (isMe && player.health <= 0) {
    socketManager.emit('iDied', { killerId: _lastAttackerId, weaponId });
    player.death();
  }
});

socketManager.on("playerDied", (data) => {
  const { playerId, killerId, weaponId } = data;

  // Kill feed (killerId/weaponId are only sent by updated servers).
  const myId = socketManager.socket?.id;
  const scores = scoreboardManager.scores || {};
  const victim = scores[playerId], killer = killerId ? scores[killerId] : null;
  hudManager.onKill({
    killerName: killer?.name ?? (killerId ? '?' : 'World'), killerHue: killer?.indicatorHue,
    victimName: victim?.name, victimHue: victim?.indicatorHue,
    weaponId: weaponId ?? 0, killerIsMe: !!killerId && killerId === myId, victimIsMe: playerId === myId,
  });

  // Bots are handled locally; we already triggered our own death above.
  if (botManager.isBot(playerId)) return;
  if (playerId === socketManager.socket?.id) return;

  const player = playerManager.getPlayer(playerId);
  if (!player) return;
  player.death();
});

// After a reconnect the server sees a brand-new player: re-send who we are.
socketManager.on("connect", () => {
  const me = playerManager.mainPlayer;
  if (!me) return; // first connection: createMainPlayer() announces us
  me.name = settingsManager.name; // a previous room-unique suffix ("Name 2") may no longer apply
  // The server now believes we're holding fists (fresh player): match it so
  // everyone sees the same weapon.
  me.equipWeapon(0, true);
  socketManager.emit('setName', { name: settingsManager.name });
  socketManager.emit('playerIdentity', { hue: settingsManager.spinnerHue, shapeIndex: settingsManager.spinnerShapeIndex });
  socketManager.emit('playerMovement', me.getPosition());
});

socketManager.on("gameState", (data) => {
  scoreboardManager.updateScores(data.scores);
  scoreboardManager.roundEndsAt = data.roundEndsAt;
  if (data.phase === 'roundEnd') scoreboardManager.showRoundEnd(data.scores);
  else scoreboardManager.hideRoundEnd();
  const previousMap = currentMapFile;
  Constants._weaponsReady.then(() => loadMap(data.mapFile).then(() => {
    // Reconnected into a different map (the round changed meanwhile): our old
    // coordinates mean nothing here, so move to a spawn point.
    if (previousMap && previousMap !== data.mapFile) {
      if (playerManager.mainPlayer) playerManager.mainPlayer.forceRespawn(map.spawnPoints);
      if (botManager.active) botManager.respawnAll();
    }
    // Spawn bots when alone, despawn when others are present.
    botManager.considerSpawning(data.scores);
  }));
});

function _myRank(scores) {
  const myId = socketManager.socket?.id;
  if (!myId || !(myId in scores)) return null;
  const sorted = Object.entries(scores).sort(compareScores);
  return sorted.findIndex(([id]) => id === myId) + 1; // 1-based
}

let _prevMyKills = 0;
let _prevMyRank  = null;

socketManager.on("scoreUpdate", (data) => {
  // Alone on the server with bots: the local bot match owns the scores. The
  // server's copy has no bots and would reset our bot-match kills to 0.
  if (botManager.active) { botManager._updateScoreboard(); return; }

  const myId      = socketManager.socket?.id;
  const prevKills = scoreboardManager.scores[myId]?.kills ?? 0;
  const prevRank  = _prevMyRank;

  scoreboardManager.updateScores(data.scores);

  // Keep the local player entity's counters in sync with the server's authoritative values.
  if (myId && data.scores[myId] && playerManager.mainPlayer) {
    playerManager.mainPlayer.kills  = data.scores[myId].kills;
    playerManager.mainPlayer.deaths = data.scores[myId].deaths;
  }

  const newKills = data.scores[myId]?.kills ?? 0;
  const newRank  = _myRank(data.scores);
  _prevMyRank = newRank;

  if (newKills > prevKills) soundManager.play('kill');

  if (newRank !== null && prevRank !== null && newRank !== prevRank) {
    soundManager.play(newRank === 1 ? 'position_first' : 'position_change');
  }
});

socketManager.on("roundEnd", (data) => {
  let scores = data.scores;
  if (botManager.active) { botManager._updateScoreboard(); scores = scoreboardManager.scores; }
  scoreboardManager.showRoundEnd(scores);
  const rank = _myRank(scores);
  soundManager.play(rank === 1 ? 'win' : 'lose');
  statsManager.onRoundEnd(rank === 1);
  _prevMyRank = null; // reset for next round
});

socketManager.on("roundStart", (data) => {
  // A server round also resets a bot match played while waiting for players.
  if (botManager.active) {
    if (playerManager.mainPlayer) { playerManager.mainPlayer.kills = 0; playerManager.mainPlayer.deaths = 0; }
    for (const bot of Object.values(botManager.bots)) { bot.kills = 0; bot.deaths = 0; }
  }
  scoreboardManager.updateScores(data.scores);
  scoreboardManager.roundEndsAt = data.roundEndsAt;
  scoreboardManager.hideRoundEnd();
  loadMap(data.mapFile).then(() => {
    if (playerManager.mainPlayer) {
      playerManager.mainPlayer.forceRespawn(map.spawnPoints);
    }
    // Reset all remote players back to fist — server resets weaponId on round start.
    for (const id in playerManager.getPlayers()) {
      playerManager.getPlayers()[id].equipWeapon(0, true);
    }
    // Bots kept the previous map's coordinates (often inside walls / off-map).
    if (botManager.active) botManager.respawnAll();
    // Re-evaluate bots: despawn if others joined, keep/spawn if still alone.
    botManager.considerSpawning(data.scores);
  });
});

// The server made our name unique in this room ("Name 2"): show that locally.
socketManager.on("nameAssigned", (data) => {
  if (playerManager.mainPlayer && data && typeof data.name === 'string') playerManager.mainPlayer.name = data.name;
});

socketManager.on("playerStatus", (data) => {
  const player = playerManager.getPlayer(data.playerId);
  if (player) player.afk = !!data.afk;
});

// Tell others when we're away (menu open or tab in the background).
let _lastAfk = null;
// menuOpen is passed by the Menu itself (it may call this while `menu` is
// still being constructed, when even `typeof menu` would throw).
function reportAfk(menuOpen) {
  // Timer/event callbacks never run during `new Menu()`, so typeof is safe here
  // (and protects against firing before Menu.js has loaded).
  const afk = !!(menuOpen ?? (typeof menu !== 'undefined' && menu.isOpen)) || document.hidden;
  if (afk === _lastAfk) return;
  _lastAfk = afk;
  socketManager.emit('playerStatus', { afk });
}
document.addEventListener('visibilitychange', () => reportAfk());
socketManager.on('connect', () => { _lastAfk = null; setTimeout(() => reportAfk(), 500); });

socketManager.on("playerIdentityUpdate", (data) => {
  const player = playerManager.getPlayer(data.playerId);
  if (!player) return;
  player.indicatorHue        = data.indicatorHue;
  player.indicatorShapeIndex = data.indicatorShapeIndex;
});

socketManager.on("pickupState", (states) => {
  pickupManager.applyState(states);
});

socketManager.on("pickupTaken", (data) => {
  const { spawnIndex, playerId, weaponId } = data;
  // Our own pickup is already handled locally; only process events for remote players.
  if (playerId === socketManager.socket?.id) return;
  pickupManager.takePickupRemote(spawnIndex, playerId, weaponId);
});

socketManager.on("chatMessage", (data) => {
  chatManager.addMessage(data.name, data.text, data.hue ?? null);
});

socketManager.on("playerNameChanged", (data) => {
  const player = playerManager.getPlayer(data.playerId);
  if (player) player.name = data.name;
});

socketManager.on("kicked", (data) => {
  chatManager.addMessage('Server', data.reason || 'You have been removed from the server.', null);
  hudManager.flash(t('hud.disconnected'), i18n.chat(data.reason || 'You have been removed from the server.'), '#ff6b6b', 8000);
  socketManager.socket.io.opts.reconnection = false;
  socketManager.kicked = true;
  socketManager.kickReason = i18n.chat(data.reason || 'You have been removed from the server.');
  // Refused before the game started (room full, banned): explain it in the
  // menu and fall back to an offline bot match instead of hanging on "Loading".
  if (!loopStarted) botManager._startOffline();
  socketManager.socket.disconnect();
});

socketManager.on("forceWeapon", (data) => {
  if (playerManager.mainPlayer) playerManager.mainPlayer.equipWeapon(data.weaponId);
});



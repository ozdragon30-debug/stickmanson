// Client side of the multiplayer protocol: reacts to everything the game
// server broadcasts (roster, movement, combat, rounds, identity, chat…).
// Offline, socketManager.on() does nothing and none of this ever runs.

// ── Ranking helpers (also used by BotManager and the stats) ──────────────────

// True when `myId` is first and the win is clear: more kills than whoever is
// second, or at least one kill when nobody else is listed.
function _strictLead(scores, myId = socketManager.socket?.id) {
  const ranking = Object.entries(scores).sort(compareScores);
  if (ranking.length === 0 || ranking[0][0] !== myId) return false;
  const leaderKills = ranking[0][1].kills;
  return ranking.length === 1 ? leaderKills > 0 : leaderKills > ranking[1][1].kills;
}

// Our 1-based place in `scores`, or null when we aren't listed.
function _myRank(scores) {
  const ownId = socketManager.socket?.id;
  if (!ownId || !(ownId in scores)) return null;
  const ranking = Object.entries(scores).sort(compareScores);
  return ranking.findIndex(entry => entry[0] === ownId) + 1;
}

// ── Away status ──────────────────────────────────────────────────────────────

// Last away state sent to the server (null: nothing sent on this connection).
let _afkReported = null;

// Tell the server whether we're away: menu open or tab hidden. The Menu passes
// `menuOpen` itself because it may call this while `menu` is still being
// built (then even `typeof menu` would throw). Calls from timers and events
// never happen during that, so the typeof check below is safe for them and
// also covers Menu.js not being loaded yet.
function reportAfk(menuOpen) {
  const menuShown = menuOpen ?? (typeof menu !== 'undefined' && menu.isOpen);
  const away = !!menuShown || document.hidden;
  if (away === _afkReported) return;
  _afkReported = away;
  socketManager.emit('playerStatus', { afk: away });
}

document.addEventListener('visibilitychange', () => reportAfk());

// ── Server event handlers ────────────────────────────────────────────────────

(() => {
  const ownId = () => socketManager.socket?.id;
  const KICK_TEXT = 'You have been removed from the server.';
  // Our place after the last score update, to play a sound when it changes.
  let rankBefore = null;

  // Build a Player for someone already in the room from their server record.
  const playerFromInfo = (info) => {
    const remote = new Player(info.position.x, info.position.y);
    if (info.name) remote.name = info.name;
    if (info.weaponId != null) remote.equipWeapon(info.weaponId, true);
    if (info.indicatorHue != null) remote.indicatorHue = info.indicatorHue;
    if (info.indicatorShapeIndex != null) remote.indicatorShapeIndex = info.indicatorShapeIndex;
    if (info.petId != null) remote.petId = info.petId;
    remote.vip = !!info.vip;
    remote.afk = !!info.afk;
    return remote;
  };

  // Put the browser tab title on alert until the tab is looked at again.
  const flagTabTitle = () => {
    document.title = '● ' + t('tab.joined') + ' — Stick Clash';
    const onVisible = () => {
      if (document.hidden) return;
      document.title = 'Stick Clash';
      document.removeEventListener('visibilitychange', onVisible);
    };
    document.addEventListener('visibilitychange', onVisible);
  };

  // ── Room roster ──

  // Arrives on every (re)connection with the full room.
  socketManager.on('currentPlayers', (players) => {
    // Whoever left while we were disconnected would otherwise stay as a
    // frozen ghost.
    for (const id of Object.keys(playerManager.getPlayers())) {
      if (!botManager.isBot(id) && !(id in players)) playerManager.removePlayer(id);
    }
    for (const id in players) {
      if (id === ownId()) continue;
      playerManager.addPlayer(id, playerFromInfo(players[id]));
    }
  });

  socketManager.on('newPlayer', (data) => {
    const newcomer = new Player(-10, -10);
    if (data.name) newcomer.name = data.name;
    playerManager.addPlayer(data.playerId, newcomer);
    soundManager.play('join_lobby');
    if (document.hidden) flagTabTitle();
  });

  socketManager.on('playerDisconnected', (playerId) => {
    playerManager.removePlayer(playerId);
    // If that was the last other human, bring the bots back instead of an
    // empty arena until the next round. The short delay lets a player whose
    // connection only blipped come back first.
    setTimeout(() => {
      const humansLeft = Object.keys(playerManager.getPlayers()).some(id => !botManager.isBot(id));
      if (!humansLeft && !botManager.active && socketManager.isConnected && map.ready && playerManager.mainPlayer) {
        botManager.considerSpawning({});
      }
    }, 6000);
  });

  // ── Movement and shooting of others ──

  socketManager.on('playWalkingAnimation', (data) => {
    const remote = playerManager.getPlayer(data.playerId);
    if (remote) remote.playWalkingAnim(data.rotation);
  });

  socketManager.on('playerMoved', (data) => {
    const remote = playerManager.getPlayer(data.playerId);
    if (!remote) return;
    const pos = data.playerPos;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    remote.setNetPosition(pos.x, pos.y, pos.rotation);
  });

  socketManager.on('playShoot', (data) => {
    const remote = playerManager.getPlayer(data.playerId);
    if (remote) remote.shoot();
  });

  // ── Damage, death, respawn ──

  socketManager.on('playerGotHit', (data) => {
    const { playerId, damage, weaponId, attackerId } = data;
    let victim = playerManager.getPlayer(playerId);
    // Hits on us come with our own id, which isn't in the remote roster.
    const hitMe = !victim && playerId === ownId();
    if (hitMe) victim = playerManager.mainPlayer;
    if (!victim || victim.isRespawning) return;

    const attacker = playerManager.getPlayer(attackerId);
    // The attacker's spinner/pet perk scales the damage (bots have none).
    const perk = attacker && !botManager.isBot(attackerId)
      ? ShopManager.attackFactorFor(attacker.indicatorShapeIndex, attacker.petId ?? -1)
      : 1;
    const baseDamage = damage ?? Constants.WEAPON_ID_MAP[weaponId]?.damage ?? 5;
    victim.showHitsplat(baseDamage * perk, weaponId, attacker ? { x: attacker.body.x, y: attacker.body.y } : null);

    // Only the victim's own client reports the death, so it happens once.
    if (hitMe && victim.health <= 0) {
      socketManager.emit('iDied', { killerId: attackerId, weaponId });
      victim.death();
    }
  });

  socketManager.on('playerDied', (data) => {
    const { playerId, killerId, weaponId } = data;
    const me = ownId();

    // Kill feed. Older servers send neither killerId nor weaponId.
    const scores = scoreboardManager.scores || {};
    const victimRow = scores[playerId];
    const killerRow = killerId ? scores[killerId] : null;
    hudManager.onKill({
      killerName: killerRow?.name ?? (killerId ? '?' : 'World'), killerHue: killerRow?.indicatorHue,
      victimName: victimRow?.name, victimHue: victimRow?.indicatorHue,
      weaponId: weaponId ?? 0, killerIsMe: !!killerId && killerId === me, victimIsMe: playerId === me,
    });

    // Bots die locally, and our own death already ran on 'playerGotHit'.
    if (botManager.isBot(playerId) || playerId === ownId()) return;

    const victim = playerManager.getPlayer(playerId);
    if (!victim) return;
    victim.death();
    // Keep the body down until that player's own respawn message (their death
    // animation may be longer or shorter than ours), so no one shoots at a
    // ghost. Servers that never send it: get up after 6 s anyway.
    victim.awaitRespawn = true;
    clearTimeout(victim._respawnFallback);
    victim._respawnFallback = setTimeout(() => victim.remoteRespawn(null), 6000);
  });

  socketManager.on('playerRespawned', (data) => {
    const remote = playerManager.getPlayer(data.playerId);
    if (remote && !botManager.isBot(data.playerId)) remote.remoteRespawn(data.playerPos);
  });

  // Our pickup lost the race: go back to the weapon the server says we hold.
  socketManager.on('pickupRejected', (data) => {
    const me = playerManager.mainPlayer;
    if (!me || me.isRespawning) return;
    if (Number.isInteger(data?.weaponId)) me.equipWeapon(data.weaponId, true);
  });

  // ── Reconnection ──

  // The server treats a reconnect as a new player: introduce ourselves again.
  socketManager.on('connect', () => {
    const me = playerManager.mainPlayer;
    if (!me) return; // the very first connection is announced by createMainPlayer()
    // Drop any room-unique suffix ("Name 2") the previous session was given.
    me.name = settingsManager.name;
    // As a fresh player we hold fists on the server: show the same here.
    me.equipWeapon(0, true);
    socketManager.emit('setName', { name: settingsManager.name });
    socketManager.emit('playerIdentity', shopManager.identity());
    socketManager.emit('playerMovement', me.getPosition());
  });

  // A new connection has heard nothing about our away state yet.
  socketManager.on('connect', () => {
    _afkReported = null;
    setTimeout(() => reportAfk(), 500);
  });

  // ── Rounds and scores ──

  socketManager.on('gameState', (data) => {
    scoreboardManager.updateScores(data.scores);
    scoreboardManager.roundEndsAt = data.roundEndsAt;
    botManager.serverPhase = data.phase;
    if (data.phase === 'roundEnd') scoreboardManager.showRoundEnd(data.scores);
    else scoreboardManager.hideRoundEnd();
    const mapBefore = currentMapFile;
    Constants._weaponsReady.then(() => loadMap(data.mapFile).then(() => {
      // Rejoined on another map (the round moved on while we were away): our
      // old position is meaningless there, so respawn.
      if (mapBefore && mapBefore !== data.mapFile) {
        if (playerManager.mainPlayer) playerManager.mainPlayer.forceRespawn(map.spawnPoints);
        if (botManager.active) botManager.respawnAll();
      }
      botManager.considerSpawning(data.scores);
    }));
  });

  socketManager.on('scoreUpdate', (data) => {
    // In a bot match the local scores rule; the server's table has no bots
    // and would wipe our kills against them.
    if (botManager.active) {
      botManager._updateScoreboard();
      return;
    }

    const me = ownId();
    const killsBefore = scoreboardManager.scores[me]?.kills ?? 0;
    const previousRank = rankBefore;

    scoreboardManager.updateScores(data.scores);

    // The server's counters are authoritative for our own player too.
    const mine = me ? data.scores[me] : undefined;
    if (mine && playerManager.mainPlayer) {
      playerManager.mainPlayer.kills = mine.kills;
      playerManager.mainPlayer.deaths = mine.deaths;
    }

    const killsNow = data.scores[me]?.kills ?? 0;
    const rankNow = _myRank(data.scores);
    rankBefore = rankNow;

    if (killsNow > killsBefore) soundManager.play('kill');
    if (rankNow !== null && previousRank !== null && rankNow !== previousRank) {
      soundManager.play(rankNow === 1 ? 'position_first' : 'position_change');
    }
  });

  socketManager.on('roundEnd', (data) => {
    botManager.serverPhase = 'roundEnd';
    let finalScores = data.scores;
    if (botManager.active) {
      botManager._updateScoreboard();
      finalScores = scoreboardManager.scores;
    }
    scoreboardManager.showRoundEnd(finalScores);
    const place = _myRank(finalScores);
    soundManager.play(place === 1 ? 'win' : 'lose');
    statsManager.onRoundEnd(place === 1 && _strictLead(finalScores));
    rankBefore = null; // the next round starts the comparison afresh
  });

  socketManager.on('roundStart', (data) => {
    botManager.serverPhase = 'playing';
    // A bot match played while waiting restarts with the server's round.
    if (botManager.active) {
      const me = playerManager.mainPlayer;
      if (me) {
        me.kills = 0;
        me.deaths = 0;
      }
      for (const bot of Object.values(botManager.bots)) {
        bot.kills = 0;
        bot.deaths = 0;
      }
    }
    scoreboardManager.updateScores(data.scores);
    scoreboardManager.roundEndsAt = data.roundEndsAt;
    scoreboardManager.hideRoundEnd();
    loadMap(data.mapFile).then(() => {
      if (playerManager.mainPlayer) playerManager.mainPlayer.forceRespawn(map.spawnPoints);
      // The server puts everyone back on fists at a new round.
      for (const remote of Object.values(playerManager.getPlayers())) remote.equipWeapon(0, true);
      // Bots still stand where they were on the old map.
      if (botManager.active) botManager.respawnAll();
      // Others may have joined (bots leave) or not (bots stay / come back).
      botManager.considerSpawning(data.scores);
    });
  });

  // ── Names, identity, status ──

  // The server renamed us to keep names unique in the room ("Name 2").
  socketManager.on('nameAssigned', (data) => {
    if (!playerManager.mainPlayer || !data || typeof data.name !== 'string') return;
    playerManager.mainPlayer.name = data.name;
  });

  socketManager.on('playerStatus', (data) => {
    const remote = playerManager.getPlayer(data.playerId);
    if (remote) remote.afk = !!data.afk;
  });

  socketManager.on('playerIdentityUpdate', (data) => {
    const remote = playerManager.getPlayer(data.playerId);
    if (!remote) return;
    remote.indicatorHue = data.indicatorHue;
    remote.indicatorShapeIndex = data.indicatorShapeIndex;
    remote.petId = data.petId ?? -1;
    remote.vip = !!data.vip;
  });

  socketManager.on('playerNameChanged', (data) => {
    const remote = playerManager.getPlayer(data.playerId);
    if (remote) remote.name = data.name;
  });

  // ── Pickups ──

  socketManager.on('pickupState', (states) => {
    pickupManager.applyState(states);
  });

  socketManager.on('pickupTaken', (data) => {
    // Our own pickups were already applied locally.
    if (data.playerId === ownId()) return;
    pickupManager.takePickupRemote(data.spawnIndex, data.playerId, data.weaponId);
  });

  // ── Chat and moderation ──

  socketManager.on('chatMessage', (data) => {
    chatManager.addMessage(data.name, data.text, data.hue ?? null);
  });

  socketManager.on('kicked', (data) => {
    const reason = data.reason || KICK_TEXT;
    const shownReason = i18n.chat(reason);
    chatManager.addMessage('Server', reason, null);
    hudManager.flash(t('hud.disconnected'), shownReason, '#ff6b6b', 8000);
    socketManager.socket.io.opts.reconnection = false;
    socketManager.kicked = true;
    socketManager.kickReason = shownReason;
    // Turned away before the game even started (room full, banned): show why
    // in the menu and play offline against bots rather than stay on "Loading".
    if (!loopStarted) botManager._startOffline();
    socketManager.socket.disconnect();
  });

  socketManager.on('forceWeapon', (data) => {
    if (playerManager.mainPlayer) playerManager.mainPlayer.equipWeapon(data.weaponId);
  });
})();

// Computer-controlled opponents for when there is nobody else to play with.
//
// Two situations put bots on the field:
//   • Offline: no game server answered (static hosting, server down, refused).
//     A local match runs here instead, with its own map rotation and round
//     clock that copy the server's rules.
//   • Waiting: connected, but alone in the room. The server still owns the
//     round clock and the map; bots only fill the arena until a human joins.
//
// How a hit reaches a bot: the local player's shot code emits 'playerHit' as
// usual. While bots exist, socketManager.emit is wrapped so that hits whose
// target id belongs to a bot are settled here (onPlayerHitsBot path) and never
// reach the network. Bots hurting anyone go through _applyDamage, called by Bot.

// Where a freshly spawned entity goes when the map offers no spawn points.
const BOT_FALLBACK_SPAWN = { x: 400, y: 300 };

// Gaps between frames longer than this are treated as a pause (menu, hidden
// tab): they don't consume round time.
const BOT_PAUSE_GAP_MS = 250;

class BotManager {
  static BOT_COUNT = 2;

  static BOT_NAMES = ['Alpha', 'Beta', 'Delta', 'Omega', 'Gamma', 'Zeta', 'Theta'];

  // Offline rotation: maps that suit a small solo-versus-bots match.
  static OFFLINE_MAPS = [
    'asphaltstreets.dat',
    'officefloor.dat',
    'stormchannel.dat',
    'trailerpark.dat',
    'orbitstation.dat',
    'biolab.dat',
    'containerport.dat',
    'thepitarena.dat',
    'hedgemaze.dat',
    'shipyard.dat',
    'foundry.dat',
    'sandbase.dat',
    'stonekeep.dat',
    'rooftops.dat',
    'metroline.dat',
  ];

  // Same timings as the server: a round lasts five minutes, the results stay
  // up for ten seconds.
  static ROUND_MS     = 300000;
  static ROUND_END_MS = 10000;

  /** A random rotation map other than `exclude` (debug.dat is never picked). */
  static randomMap(exclude = null) {
    const choices = BotManager.OFFLINE_MAPS.filter(file => file !== 'debug.dat' && file !== exclude);
    return choices[Math.floor(Math.random() * choices.length)];
  }

  /**
   * How many bots a map gets: about one per 150 tiles, clamped to 3..6, and
   * always leaving at least one spawn point over for the human.
   */
  static getBotCount(map) {
    const bySize = Math.max(3, Math.min(6, Math.round((map.width * map.height) / 150)));
    const spawnCount = map.spawnPoints?.length || bySize + 1;
    return Math.max(1, Math.min(bySize, spawnCount - 1));
  }

  /** "feature/abandonedcity.dat" → "Abandonedcity" (menu label). */
  static mapLabel(file) {
    const stem = file.replace(/^.*\//, '').replace(/\.dat$/, '');
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  }

  static getInstance() {
    if (!BotManager.instance) BotManager.instance = new BotManager();
    return BotManager.instance;
  }

  constructor() {
    this.bots = {};          // bot id → Bot
    this.active = false;
    // Shown on the scoreboard: 'none', 'no-server' (never reached / lost the
    // server) or 'waiting' (connected, no other humans yet).
    this.status = 'none';
    this._originalEmit = null;
    this._offlineTimer = null;
  }

  // ── Start-up and server connection ─────────────────────────────────────────

  /** Wires the socket listeners and arms the offline fallback (from game.js). */
  init() {
    socketManager.on('connect', () => {
      // From now on rounds come from the server.
      this._offlineRounds = false;
      this._cancelOfflineTimer();
      if (this.active) this.status = 'waiting';
    });

    socketManager.on('disconnect', () => {
      if (!this.active) return;
      this.status = 'no-server';
      // Lost the server mid-match: keep playing with a local round clock.
      if (!this._offlineRounds) {
        scoreboardManager.hideRoundEnd();
        this._beginOfflineRound();
      }
    });

    // Another human arrived: the bots step aside.
    socketManager.on('newPlayer', () => {
      if (this.active) this.despawn();
    });

    // Without socket.io at all, go offline after 2 s. With a socket that is
    // still trying, allow 10 s (a refused connection fires connect_error and
    // goes offline straight away). A successful connection instead leads to
    // gameState → loadMap → considerSpawning.
    const goOffline = () => {
      this._cancelOfflineTimer();
      if (!loopStarted) this._startOffline();
    };
    this._offlineTimer = setTimeout(goOffline, socketManager.socket ? 10000 : 2000);
    socketManager.on('connect_error', () => {
      if (this._offlineTimer) goOffline();
    });
  }

  _cancelOfflineTimer() {
    if (this._offlineTimer) clearTimeout(this._offlineTimer);
    this._offlineTimer = null;
  }

  /**
   * After a server map load: bring bots in when we're the only human in
   * `scores`, send them away when someone else is there.
   */
  considerSpawning(scores) {
    const ownId = socketManager.socket?.id;
    const humanCount = Object.keys(scores).filter(id => id !== ownId && !this.isBot(id)).length;

    if (humanCount > 0) {
      if (this.active) this.despawn();
      return;
    }
    if (this.active) {
      // Still alone (e.g. reconnected): put the bots back into the scores.
      this._updateScoreboard();
      return;
    }

    this.status = socketManager.isConnected ? 'waiting' : 'no-server';
    const points = this._spawnPoints();
    this.spawn(points, BotManager.getBotCount(map));
    this._serverNotice(this.status === 'waiting'
      ? 'Waiting for other players, playing against bots.'
      : 'No connection to the server, playing against bots.');
  }

  /** The current map's spawn points, or a single default one. */
  _spawnPoints() {
    return (map.ready && map.spawnPoints.length) ? map.spawnPoints : [{ ...BOT_FALLBACK_SPAWN }];
  }

  _serverNotice(text) {
    chatManager.addMessage('Server', text, null);
  }

  // ── Bot roster ─────────────────────────────────────────────────────────────

  /** Create `botCount` bots, each on a randomly chosen spawn point. */
  spawn(spawnPoints, botCount = BotManager.BOT_COUNT) {
    if (this.active) return;
    this.active = true;

    // A new bot session starts the human from zero as well.
    const me = playerManager.mainPlayer;
    if (me) {
      me.kills = 0;
      me.deaths = 0;
    }

    this._patchSocketEmit();

    for (let index = 0; index < botCount; index++) {
      const where = spawnPoints.length
        ? spawnPoints[Math.floor(Math.random() * spawnPoints.length)]
        : { ...BOT_FALLBACK_SPAWN };
      const id = `bot_${index}`;
      this.bots[id] = new Bot(id, where.x, where.y, index);
    }

    this._updateScoreboard();
  }

  /** Put every bot on a spawn point of the (new) current map. */
  respawnAll() {
    for (const bot of Object.values(this.bots)) {
      bot.respawnPending = false;
      bot.player.forceRespawn(map.spawnPoints);
      bot._resetNavigation(bot.player.body);
    }
  }

  /** Remove every bot and give socketManager its own emit back. */
  despawn() {
    for (const bot of Object.values(this.bots)) bot.remove();
    this.bots = {};
    this.active = false;
    this.status = 'none';
    this._restoreSocketEmit();
  }

  isBot(id) {
    return id in this.bots;
  }

  /** { bot id → Player }, so bots can pick each other as targets. */
  getBotPlayers() {
    const players = {};
    for (const id of Object.keys(this.bots)) players[id] = this.bots[id].player;
    return players;
  }

  // ── Frame update (from game.js) ────────────────────────────────────────────

  update(dt) {
    if (!this.active) return;
    if (this._offlineRounds) {
      this._tickOfflineRound();
      // Bots stand still on the results screen and while the next map loads.
      if (this._roundPhase !== 'playing') return;
    } else if (this.serverPhase === 'roundEnd') {
      // Waiting mode: also freeze while the server shows its results.
      return;
    }
    for (const bot of Object.values(this.bots)) bot.think(dt);
  }

  // ── Local (offline) rounds ─────────────────────────────────────────────────

  _beginOfflineRound() {
    this._offlineRounds = true;
    this._roundPhase = 'playing';
    this._lastTick = performance.now();
    // Time actually played (pauses left out); decides whether the round pays.
    this._roundPlayedMs = 0;
    scoreboardManager.roundEndsAt = Date.now() + BotManager.ROUND_MS;
  }

  _tickOfflineRound() {
    this._accountFrameTime();
    const now = Date.now();
    if (this._roundPhase === 'playing') {
      if (now >= scoreboardManager.roundEndsAt) this._finishOfflineRound(now);
    } else if (this._roundPhase === 'roundEnd' && now >= this._nextRoundAt) {
      this.startOfflineRound(this.preferredMap || BotManager.randomMap(this._currentMap));
    }
  }

  // Adds the time since the previous frame to the played time, or, after a
  // pause, pushes the running deadline back by the length of the pause.
  _accountFrameTime() {
    const perfNow = performance.now();
    const elapsed = perfNow - (this._lastTick || perfNow);
    this._lastTick = perfNow;
    const playing = this._roundPhase === 'playing';
    if (elapsed > BOT_PAUSE_GAP_MS) {
      if (playing) scoreboardManager.roundEndsAt += elapsed;
      else this._nextRoundAt += elapsed;
    } else if (playing) {
      this._roundPlayedMs = (this._roundPlayedMs || 0) + elapsed;
    }
  }

  _finishOfflineRound(now) {
    this._roundPhase = 'roundEnd';
    this._updateScoreboard();
    const finalScores = scoreboardManager.scores;
    scoreboardManager.showRoundEnd(finalScores);
    const won = _strictLead(finalScores, socketManager.socket?.id ?? 'local_player');
    soundManager.play(won ? 'win' : 'lose');
    // A round ended early (e.g. "!next") earns nothing, so coins can't be farmed.
    statsManager.onRoundEnd(won, (this._roundPlayedMs || 0) >= 60000);
    this._serverNotice(`Round over! Next round starting in ${BotManager.ROUND_END_MS / 1000} seconds...`);
    this._nextRoundAt = now + BotManager.ROUND_END_MS;
  }

  /**
   * Switch to map `file` and start a new local round there: bots re-created
   * for the map size, everybody respawned, scores cleared (like a server
   * round change). Resolves true when the round started.
   */
  startOfflineRound(file) {
    const phaseBefore = this._roundPhase;
    this._loadGen = (this._loadGen || 0) + 1;
    const ticket = this._loadGen;
    this._roundPhase = 'loading';
    return loadMap(file).then((loaded) => {
      // Superseded by a later load, or the server took over in the meantime.
      if (ticket !== this._loadGen || socketManager.isConnected) return false;
      if (!loaded) {
        this._offlineMapFailed(file, phaseBefore);
        return false;
      }
      this._currentMap = file;
      scoreboardManager.hideRoundEnd();
      const keptStatus = this.status;
      this.despawn();
      this.status = keptStatus;
      const points = this._spawnPoints();
      const me = playerManager.mainPlayer;
      if (me) {
        me.kills = 0;
        me.deaths = 0;
        me.forceRespawn(points);
      }
      this.spawn(points, BotManager.getBotCount(map));
      this._beginOfflineRound();
      const { title, author } = splitMapName(map.name || file);
      this._serverNotice(`Round started on ${author ? `${title} (by ${author})` : title}!`);
      return true;
    });
  }

  // The map couldn't be loaded (e.g. missing from the offline cache): forget
  // it as the chosen map so the rotation moves on rather than retrying it.
  _offlineMapFailed(file, phaseBefore) {
    if (this.preferredMap === file) this.preferredMap = null;
    if (phaseBefore === 'playing') {
      this._roundPhase = 'playing';
    } else {
      this._roundPhase = 'roundEnd';
      this._nextRoundAt = Date.now() + 1000;
    }
  }

  /** First offline match after start-up (retries other maps a few times). */
  _startOffline(attempt = 0) {
    const file = BotManager.randomMap();
    this._currentMap = file;
    this.status = socketManager.isConnected ? 'waiting' : 'no-server';
    // Pickups need the weapon table, so wait for it before loading the map.
    Constants._weaponsReady.then(() => loadMap(file))
      .then((loaded) => {
        // A server showed up meanwhile and drives the game now.
        if (socketManager.isConnected) return;
        if (!loaded) {
          // Partially cached offline install: try another map.
          if (attempt < 8 && !loopStarted) this._startOffline(attempt + 1);
          return;
        }
        this.spawn(this._spawnPoints(), BotManager.getBotCount(map));
        this._beginOfflineRound();
        this._serverNotice('No server found — playing offline with bots.');
      })
      .catch(err => console.warn('[BotManager] Failed to load offline map:', err));
  }

  // ── Damage ─────────────────────────────────────────────────────────────────

  /** `shooterBot` hit `victim` (a bot or the human); settle it locally. */
  _applyDamage(shooterBot, victim) {
    if (victim.isRespawning) return;
    const shooter = shooterBot.player;
    const gun = shooter.currentWeapon;
    const damage = gun?.damage ?? 5;
    const weaponId = gun?.id ?? 0;

    victim.showHitsplat(damage, weaponId, { x: shooter.body.x, y: shooter.body.y });
    if (victim.health > 0) return;

    const victimIsMe = victim === playerManager.mainPlayer;
    hudManager.onKill({
      killerName: shooter.name, killerHue: shooter.indicatorHue,
      victimName: victim.name, victimHue: victim.indicatorHue,
      weaponId, killerIsMe: false, victimIsMe,
    });

    if (victimIsMe) {
      shooterBot.kills++;
      victim.deaths++;
      victim.death(); // the main player's death animation ends in its own respawn
    } else {
      const victimBot = Object.values(this.bots).find(bot => bot.player === victim);
      if (victimBot) {
        victimBot.deaths++;
        shooterBot.kills++;
        victimBot.player.death();
        victimBot.respawnPending = true;
      }
    }
    this._updateScoreboard();
  }

  /** The human's shot hit bot `botId` (diverted from a 'playerHit' emit). */
  _handleBotHit(botId, damage, weaponId) {
    if (this._offlineRounds && this._roundPhase !== 'playing') return;
    const bot = this.bots[botId];
    if (!bot || bot.player.isRespawning) return;

    const me = playerManager.mainPlayer;
    const amount = damage ?? me?.currentWeapon?.damage ?? 5;
    const gunId = weaponId ?? me?.currentWeapon?.id ?? 0;

    bot.player.showHitsplat(amount * shopManager.attackFactor(), gunId, me ? { x: me.body.x, y: me.body.y } : null);
    if (bot.player.health > 0) return;

    bot.deaths++;
    if (me) me.kills++;
    hudManager.onKill({
      killerName: me?.name, killerHue: me?.indicatorHue,
      victimName: bot.player.name, victimHue: bot.player.indicatorHue,
      weaponId: gunId, killerIsMe: true, victimIsMe: false,
    });
    soundManager.play('kill');
    bot.player.death();
    bot.respawnPending = true;
    this._updateScoreboard();
  }

  // ── socketManager.emit wrapper ─────────────────────────────────────────────

  // Hits on bots are resolved here; every other event goes out unchanged.
  _patchSocketEmit() {
    this._originalEmit = socketManager.emit.bind(socketManager);
    socketManager.emit = (event, data) => {
      if (event === 'playerHit' && this.isBot(data?.playerId)) {
        this._handleBotHit(data.playerId, data.damage, data.weaponId);
        return;
      }
      this._originalEmit(event, data);
    };
  }

  _restoreSocketEmit() {
    if (!this._originalEmit) return;
    socketManager.emit = this._originalEmit;
    this._originalEmit = null;
  }

  // ── Scoreboard ─────────────────────────────────────────────────────────────

  /** Publish the human's and the bots' kills/deaths to the scoreboard. */
  _updateScoreboard() {
    const table = {};
    const me = playerManager.mainPlayer;
    if (me) {
      // Keyed by socket id when there is one, else a fixed local key.
      table[socketManager.socket?.id ?? 'local_player'] = {
        name: me.name,
        kills: me.kills,
        deaths: me.deaths,
        indicatorHue: me.indicatorHue ?? 0,
      };
    }
    for (const [id, bot] of Object.entries(this.bots)) {
      table[id] = {
        name: bot.player.name,
        kills: bot.kills,
        deaths: bot.deaths,
        indicatorHue: bot.player.indicatorHue,
      };
    }
    scoreboardManager.updateScores(table);
  }
}

const botManager = BotManager.getInstance();

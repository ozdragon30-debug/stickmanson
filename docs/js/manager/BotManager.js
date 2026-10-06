// Manages the lifecycle of offline AI bots.
//
// Flow:
//   1. botManager.init() is called at the end of game.js.
//   2. A 2-second timer starts.  If the server delivers a 'gameState' event before
//      the timer fires, loopStarted will be true and we skip offline mode entirely.
//   3. If no server is reachable (GitHub Pages, local file, server down), the timer
//      fires, we load a random map from OFFLINE_MAPS, start the game loop, and
//      spawn BOT_COUNT bots.
//   4. If the socket later connects (server appeared), bots are despawned and the
//      server takes full control via its normal 'gameState' / 'roundStart' events.
//   5. If a real player joins while bots are active, bots are also despawned.
//
// Damage pipeline (offline):
//   • Player hits bot  → checkCollision emits 'playerHit' → patched socketManager.emit
//                        intercepts it → _handleBotHit().
//   • Bot hits target  → Bot._tryShoot() → botManager._applyDamage().

class BotManager {
  static BOT_COUNT = 2;

  static BOT_NAMES = ['Alpha', 'Beta', 'Delta', 'Omega', 'Gamma', 'Zeta', 'Theta'];

  // Maps known to play nicely for solo-vs-bots.
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

  // Offline rounds mirror the server's rules: 5-minute rounds, 10 s scoreboard.
  static ROUND_MS     = 5 * 60 * 1000;
  static ROUND_END_MS = 10 * 1000;

  // Random offline rotation (the debug test map is only reachable via "!map debug").
  static randomMap(exclude = null) {
    const pool = BotManager.OFFLINE_MAPS.filter(f => f !== 'debug.dat' && f !== exclude);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  static getBotCount(map) {
    const area = map.width * map.height;
    if (area <= 900) return 2;
    if (area <= 2500) return 4;
    return 7;
  }

  static getInstance() {
    if (!BotManager.instance) BotManager.instance = new BotManager();
    return BotManager.instance;
  }

  constructor() {
    this.bots   = {};      // botId → Bot
    this.active = false;
    // 'none' | 'no-server' | 'waiting'
    // 'no-server'  — socket.io never connected
    // 'waiting'    — socket connected but no other real players yet
    this.status = 'none';

    this._originalEmit  = null;
    this._offlineTimer  = null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Called once from game.js after all scripts are loaded. */
  init() {
    // Cancel the offline timer if the socket connects in time.
    socketManager.on('connect', () => {
      // The server drives rounds from now on.
      this._offlineRounds = false;
      if (this._offlineTimer) {
        clearTimeout(this._offlineTimer);
        this._offlineTimer = null;
      }
      // Update status label if bots are already running.
      if (this.active) this.status = 'waiting';
    });

    // Server disconnected while bots are running.
    socketManager.on('disconnect', () => {
      if (!this.active) return;
      this.status = 'no-server';
      // The server's round clock no longer applies: run local rounds until it returns.
      if (!this._offlineRounds) { scoreboardManager.hideRoundEnd(); this._beginOfflineRound(); }
    });

    // A real player joined — bots are no longer needed.
    socketManager.on('newPlayer', () => {
      if (this.active) this.despawn();
    });

    // No socket.io at all (static hosting): start bots after 2 s. With a server
    // that is still connecting (slow network) wait up to 10 s — a refused
    // connection reports connect_error at once and starts bots immediately.
    // If the socket DOES connect, gameState → loadMap → considerSpawning handles it.
    const startOffline = () => {
      if (this._offlineTimer) clearTimeout(this._offlineTimer);
      this._offlineTimer = null;
      if (!loopStarted) this._startOffline();
    };
    this._offlineTimer = setTimeout(startOffline, socketManager.socket ? 10000 : 2000);
    socketManager.on('connect_error', () => { if (this._offlineTimer) startOffline(); });
  }

  /**
   * Called after every server-driven map load.
   * Spawns bots when the player is alone; despawns them when others are present.
   * @param {object} scores  The scores object from gameState / roundStart.
   */
  considerSpawning(scores) {
    const myId   = socketManager.socket?.id;
    const others = Object.keys(scores).filter(id => id !== myId && !this.isBot(id));

    if (others.length > 0) {
      // Real players present — make sure bots are gone.
      if (this.active) this.despawn();
      return;
    }

    // Alone on the server — keep bots (re-merging them into the server's
    // scores, e.g. after a reconnect) or spawn them.
    if (this.active) { this._updateScoreboard(); return; }
    if (!this.active) {
      this.status = socketManager.isConnected ? 'waiting' : 'no-server';
      const pts = (typeof map !== 'undefined' && map.ready && map.spawnPoints.length)
        ? map.spawnPoints : [{ x: 400, y: 300 }];
      const botCount = BotManager.getBotCount(map);
      this.spawn(pts, botCount);
      chatManager.addMessage('Server',
        this.status === 'waiting'
          ? 'Waiting for other players, playing against bots.'
          : 'No connection to the server, playing against bots.',
        null);
    }
  }

  /** Spawn botCount bots at random spawn points. */
  spawn(spawnPoints, botCount = BotManager.BOT_COUNT) {
    if (this.active) return;
    this.active = true;

    // Reset the human player's local score for a fresh bot session.
    if (playerManager.mainPlayer) {
      playerManager.mainPlayer.kills  = 0;
      playerManager.mainPlayer.deaths = 0;
    }

    this._patchSocketEmit();

    for (let i = 0; i < botCount; i++) {
      const id = 'bot_' + i;
      const sp = spawnPoints.length
        ? spawnPoints[Math.floor(Math.random() * spawnPoints.length)]
        : { x: 400, y: 300 };
      this.bots[id] = new Bot(id, sp.x, sp.y, i);
    }

    this._updateScoreboard();
  }

  /** Move every bot to a spawn point of the current map (after a map change). */
  respawnAll() {
    for (const bot of Object.values(this.bots)) {
      bot.respawnPending = false;
      bot.player.forceRespawn(map.spawnPoints);
      bot._resetNavigation(bot.player.body);
    }
  }

  /** Remove all bots and restore normal socket behaviour. */
  despawn() {
    for (const bot of Object.values(this.bots)) bot.remove();
    this.bots   = {};
    this.active = false;
    this.status = 'none';
    this._restoreSocketEmit();
  }

  // ── Accessors (used by Bot instances) ────────────────────────────────────────

  isBot(id) { return id in this.bots; }

  /** Returns a plain { botId → Player } map so bots can target each other. */
  getBotPlayers() {
    const out = {};
    for (const [id, bot] of Object.entries(this.bots)) out[id] = bot.player;
    return out;
  }

  // ── Per-frame update (called from game.js update()) ──────────────────────────

  update(dt) {
    if (!this.active) return;
    if (this._offlineRounds) {
      this._tickOfflineRound();
      if (this._roundPhase === 'roundEnd') return; // everyone freezes on the scoreboard
    }
    for (const bot of Object.values(this.bots)) bot.think(dt);
  }

  // ── Offline rounds ───────────────────────────────────────────────────────────

  _beginOfflineRound() {
    this._offlineRounds = true;
    this._roundPhase = 'playing';
    this._lastTick = performance.now();
    scoreboardManager.roundEndsAt = Date.now() + BotManager.ROUND_MS;
  }

  _tickOfflineRound() {
    const nowPerf = performance.now();
    // Time spent paused (menus, hidden tab) doesn't count against the round.
    const gap = nowPerf - (this._lastTick || nowPerf);
    this._lastTick = nowPerf;
    if (gap > 250) {
      if (this._roundPhase === 'playing') scoreboardManager.roundEndsAt += gap;
      else this._nextRoundAt += gap;
    }

    const now = Date.now();
    if (this._roundPhase === 'playing' && now >= scoreboardManager.roundEndsAt) {
      this._roundPhase = 'roundEnd';
      this._updateScoreboard();
      const scores = scoreboardManager.scores;
      scoreboardManager.showRoundEnd(scores);
      const myId = socketManager.socket?.id ?? 'local_player';
      const ranked = Object.entries(scores).sort(compareScores);
      const won = !!ranked[0] && ranked[0][0] === myId;
      soundManager.play(won ? 'win' : 'lose');
      statsManager.onRoundEnd(won);
      chatManager.addMessage('Server', `Round over! Next round starting in ${BotManager.ROUND_END_MS / 1000} seconds...`, null);
      this._nextRoundAt = now + BotManager.ROUND_END_MS;
    } else if (this._roundPhase === 'roundEnd' && now >= this._nextRoundAt) {
      this.startOfflineRound(this.preferredMap || BotManager.randomMap(this._currentMap));
    }
  }

  /**
   * Load `file` and start a fresh offline round on it: new bots sized for the
   * map, everyone respawned, scores reset (same as a server round change).
   */
  startOfflineRound(file) {
    const previousPhase = this._roundPhase;
    const gen = this._loadGen = (this._loadGen || 0) + 1;
    this._roundPhase = 'loading';
    return loadMap(file).then((ok) => {
      // A newer load superseded this one, or a server connected meanwhile
      // (the server drives maps/rounds from then on).
      if (gen !== this._loadGen || socketManager.isConnected) return false;
      if (!ok) {
        // Unavailable map (e.g. not cached offline): drop the choice and fall
        // back to the random rotation instead of retrying it forever.
        if (this.preferredMap === file) this.preferredMap = null;
        if (previousPhase === 'playing') this._roundPhase = 'playing';
        else { this._roundPhase = 'roundEnd'; this._nextRoundAt = Date.now() + 1000; }
        return false;
      }
      this._currentMap = file;
      scoreboardManager.hideRoundEnd();
      const status = this.status;
      this.despawn();
      this.status = status;
      const pts = (map.ready && map.spawnPoints.length) ? map.spawnPoints : [{ x: 400, y: 300 }];
      if (playerManager.mainPlayer) {
        playerManager.mainPlayer.kills = 0;
        playerManager.mainPlayer.deaths = 0;
        playerManager.mainPlayer.forceRespawn(pts);
      }
      this.spawn(pts, BotManager.getBotCount(map));
      this._beginOfflineRound();
      const { title, author } = splitMapName(map.name || file);
      chatManager.addMessage('Server', `Round started on ${author ? `${title} (by ${author})` : title}!`, null);
      return true;
    });
  }

  // "feature/abandonedcity.dat" → "Abandoned City"-ish display label.
  static mapLabel(file) {
    const base = file.replace(/^.*\//, '').replace(/\.dat$/, '');
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  // ── Damage handling ───────────────────────────────────────────────────────────

  /**
   * Bot fired its weapon at `targetPlayer`.
   * Applies damage locally and triggers death if health reaches zero.
   */
  _applyDamage(attackerBot, targetPlayer) {
    if (targetPlayer.isRespawning) return;
    const weapon   = attackerBot.player.currentWeapon;
    const damage   = weapon?.damage   ?? 5;
    const weaponId = weapon?.id       ?? 0;

    targetPlayer.showHitsplat(damage, weaponId, { x: attackerBot.player.body.x, y: attackerBot.player.body.y });
    if (targetPlayer.health > 0) return;

    const victimIsMe = targetPlayer === playerManager.mainPlayer;
    hudManager.onKill({
      killerName: attackerBot.player.name, killerHue: attackerBot.player.indicatorHue,
      victimName: targetPlayer.name, victimHue: targetPlayer.indicatorHue,
      weaponId, killerIsMe: false, victimIsMe,
    });

    if (victimIsMe) {
      // Bot killed the human player.
      attackerBot.kills++;
      targetPlayer.deaths++;
      targetPlayer.death(); // Player.death() → anim → respawn() for isMainPlayer ✓
    } else {
      // Bot killed another bot.
      for (const [, b] of Object.entries(this.bots)) {
        if (b.player === targetPlayer) {
          b.deaths++;
          attackerBot.kills++;
          b.player.death();
          b.respawnPending = true;
          break;
        }
      }
    }
    this._updateScoreboard();
  }

  /**
   * The human player's checkCollision detected a hit on a bot.
   * (Intercepted from 'playerHit' socket emit via _patchSocketEmit.)
   */
  _handleBotHit(botId, damage, weaponId) {
    if (this._offlineRounds && this._roundPhase !== 'playing') return;
    const bot = this.bots[botId];
    if (!bot || bot.player.isRespawning) return;

    // Use damage/weaponId passed directly from the intercepted emit.
    const dmg = damage ?? playerManager.mainPlayer?.currentWeapon?.damage ?? 5;
    const wid = weaponId ?? playerManager.mainPlayer?.currentWeapon?.id ?? 0;

    bot.player.showHitsplat(dmg * shopManager.attackFactor(), wid);
    if (bot.player.health > 0) return;

    bot.deaths++;
    if (playerManager.mainPlayer) playerManager.mainPlayer.kills++;
    hudManager.onKill({
      killerName: playerManager.mainPlayer?.name, killerHue: playerManager.mainPlayer?.indicatorHue,
      victimName: bot.player.name, victimHue: bot.player.indicatorHue,
      weaponId: wid, killerIsMe: true, victimIsMe: false,
    });
    soundManager.play('kill');
    bot.player.death();
    bot.respawnPending = true;
    this._updateScoreboard();
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _startOffline(attempt = 0) {
    const file = BotManager.randomMap();
    this._currentMap = file;
    // Determine initial status: if socket.io isn't even available we're fully offline;
    // if it is but hasn't connected yet we're still waiting to see.
    this.status = socketManager.isConnected ? 'waiting' : 'no-server';
    // Weapon data must be ready before pickups are built from the map.
    Constants._weaponsReady.then(() => loadMap(file))
      .then((ok) => {
        // Offline with a partially cached game: try a few other maps.
        // A server connected meanwhile (its map load superseded ours): stand down.
        if (loopStarted && !this.active && socketManager.isConnected) return;
        if (socketManager.isConnected) return;
        if (!ok) { if (attempt < 8 && !loopStarted) this._startOffline(attempt + 1); return; }
        const pts = (map.ready && map.spawnPoints.length) ? map.spawnPoints : [{ x: 400, y: 300 }];
        const botCount = BotManager.getBotCount(map);
        this.spawn(pts, botCount);
        if (!socketManager.isConnected) this._beginOfflineRound();
        chatManager.addMessage('Server', 'No server found — playing offline with bots.', null);
      })
      .catch(err => console.warn('[BotManager] Failed to load offline map:', err));
  }

  /**
   * Monkey-patch socketManager.emit so 'playerHit' events aimed at bot IDs
   * are resolved locally instead of sent over the network.
   */
  _patchSocketEmit() {
    this._originalEmit = socketManager.emit.bind(socketManager);
    const self = this;
    socketManager.emit = function(event, data) {
      if (event === 'playerHit' && self.isBot(data?.playerId)) {
        self._handleBotHit(data.playerId, data.damage, data.weaponId);
        return;
      }
      self._originalEmit(event, data);
    };
  }

  _restoreSocketEmit() {
    if (this._originalEmit) {
      socketManager.emit = this._originalEmit;
      this._originalEmit = null;
    }
  }

  /** Push the current offline scores to the scoreboard for Tab-overlay display. */
  _updateScoreboard() {
    const scores = {};

    // Human player — use socket id when available, fall back to a fixed key.
    const myId = socketManager.socket?.id ?? 'local_player';
    const main = playerManager.mainPlayer;
    if (main) {
      scores[myId] = {
        name:         main.name,
        kills:        main.kills,
        deaths:       main.deaths,
        indicatorHue: main.indicatorHue ?? 0,
      };
    }

    // Bots.
    for (const [id, bot] of Object.entries(this.bots)) {
      scores[id] = {
        name:         bot.player.name,
        kills:        bot.kills,
        deaths:       bot.deaths,
        indicatorHue: bot.player.indicatorHue,
      };
    }

    scoreboardManager.updateScores(scores);
  }
}

const botManager = BotManager.getInstance();

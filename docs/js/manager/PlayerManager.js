// The local player plus every other player (remote humans and bots) by id.
class PlayerManager {
  static getInstance() {
    return PlayerManager.instance || (PlayerManager.instance = new PlayerManager());
  }

  constructor() {
    this.players = {};      // id → Player (insertion order = update/draw order)
    this.mainPlayer = null;
  }

  createMainPlayer(spawnPoints = []) {
    const pts = spawnPoints.length ? spawnPoints : [{ x: 400, y: 300 }];
    const { x, y } = pts[Math.floor(Math.random() * pts.length)];
    const me = this.mainPlayer = new Player(x, y);
    me.isMainPlayer = true;
    me.health = me.maxHealth();                  // shop health perks count from the first life
    me.healthbarHeart = new AtlasGameObject(heartbeatAtlas, 'heartbeat_healthy', 30, 25);
    me.name = settingsManager.name;
    me.indicatorHue = settingsManager.spinnerHue;
    me.indicatorShapeIndex = settingsManager.spinnerShapeIndex;
    socketManager.emit('setName', { name: settingsManager.name });
    socketManager.emit('playerIdentity', shopManager.identity());
    socketManager.emit('playerMovement', { x, y });
  }

  // Own keys only: an id like "constructor" must never resolve to an Object member.
  getPlayer(id) { return Object.hasOwn(this.players, id) ? this.players[id] : undefined; }
  getPlayers() { return this.players; }
  addPlayer(id, player) { this.players[id] = player; }
  removePlayer(id) { delete this.players[id]; }

  updatePlayers() {
    this.mainPlayer.update();
    camera.setPos(this.mainPlayer.body);
    for (const id in this.players) this.players[id].update();
  }

  // Others first, so the local player is always drawn on top.
  drawPlayers(ctx) {
    for (const id in this.players) this.players[id].draw(ctx);
    this.mainPlayer.draw(ctx);
  }
}

const playerManager = PlayerManager.getInstance();

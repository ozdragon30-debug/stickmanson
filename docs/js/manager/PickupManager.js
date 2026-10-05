class PickupManager {
  static getInstance() {
    if (!PickupManager.instance) {
      PickupManager.instance = new PickupManager();
    }
    return PickupManager.instance;
  }

  constructor() {
    this.pickups = [];
  }

  // Respawn timers are bound to the pickup object (not its array index), so a
  // timer started on the previous map can't make a pickup on the new map
  // reappear early. Re-hiding a pickup restarts its timer.
  _scheduleRespawn(pick, ms) {
    if (pick._respawnTimer) clearTimeout(pick._respawnTimer);
    pick._respawnTimer = setTimeout(() => {
      pick._respawnTimer = null;
      pick.isVisible = true;
    }, ms);
  }

  initFromMap(weaponSpawns) {
    for (const p of this.pickups) if (p._respawnTimer) clearTimeout(p._respawnTimer);
    this.pickups = weaponSpawns.map(
      ws => new WeaponPickup(ws.x, ws.y, ws.weaponId, ws.respawnTime)
    );
    // Visible immediately; server state (applyState) will correct any already-taken ones.
  }

  // Apply the pickup state array sent by the server (on join / reconnect).
  // Hides taken pickups and starts local respawn timers based on the server's respawnAt timestamp.
  applyState(states) {
    states.forEach((state, i) => {
      const pick = this.pickups[i];
      if (!pick) return;
      if (state.available) {
        if (pick._respawnTimer) { clearTimeout(pick._respawnTimer); pick._respawnTimer = null; }
        pick.isVisible = true;
      } else {
        pick.isVisible = false;
        const ms = state.respawnAt
          ? Math.max(0, state.respawnAt - Date.now())
          : (pick.respawnTime || 10000);
        this._scheduleRespawn(pick, ms);
      }
    });
  }

  // Unified pickup: hides the pickup, equips it on playerEntity, starts local respawn timer.
  // Pass emitToServer=true for the human player when connected.
  takePickup(index, playerEntity, emitToServer = false) {
    const pick = this.pickups[index];
    if (!pick || !pick.isVisible) return false;
    pick.isVisible = false;
    if (playerEntity) playerEntity.equipWeapon(pick.weaponId);
    this._scheduleRespawn(pick, pick.respawnTime || 10000);
    if (emitToServer) socketManager.emit('pickupWeapon', { spawnIndex: index });
    return true;
  }

  // Called when the server relays that a remote player picked something up.
  takePickupRemote(index, playerId, weaponId) {
    const pick = this.pickups[index];
    if (!pick) return;
    pick.isVisible = false;
    this._scheduleRespawn(pick, pick.respawnTime || 10000);
    const player = playerManager.getPlayer(playerId);
    if (player) player.equipWeapon(weaponId);
  }

  update() {
    this.pickups.forEach(p => p.update());

    if (!playerManager.mainPlayer) return;
    const px = playerManager.mainPlayer.body.x;
    const py = playerManager.mainPlayer.body.y;
    for (let i = 0; i < this.pickups.length; i++) {
      if (this.pickups[i].isPlayerOverlapping(px, py)) {
        this.takePickup(i, playerManager.mainPlayer, true);
      }
    }
  }

  draw(ctx) {
    this.pickups.forEach(p => p.draw(ctx));
  }
}

const pickupManager = PickupManager.getInstance();

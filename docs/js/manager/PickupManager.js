// All weapon pickups of the current map: who takes what, and when each one
// comes back. Respawn timers belong to the pickup object, so a timer from a
// previous map can never bring back a pickup on the next one.
class PickupManager {
  static getInstance() {
    return PickupManager.instance || (PickupManager.instance = new PickupManager());
  }

  constructor() {
    this.pickups = [];
  }

  _scheduleRespawn(pick, ms) {
    clearTimeout(pick._respawnTimer);
    pick._respawnTimer = setTimeout(() => { pick._respawnTimer = null; pick.isVisible = true; }, ms);
  }

  _hide(pick, ms = pick.respawnTime || 10000) {
    pick.isVisible = false;
    this._scheduleRespawn(pick, ms);
  }

  initFromMap(weaponSpawns) {
    for (const p of this.pickups) clearTimeout(p._respawnTimer);
    this.pickups = weaponSpawns.map(w => new WeaponPickup(w.x, w.y, w.weaponId, w.respawnTime));
  }

  // Server snapshot on join / reconnect: [{available, respawnAt}] per pickup.
  applyState(states) {
    states.forEach((s, i) => {
      const pick = this.pickups[i];
      if (!pick) return;
      if (s.available) {
        clearTimeout(pick._respawnTimer);
        pick._respawnTimer = null;
        pick.isVisible = true;
      } else {
        this._hide(pick, s.respawnAt ? Math.max(0, s.respawnAt - Date.now()) : undefined);
      }
    });
  }

  // `who` walked over pickup `index`: it disappears and they get the weapon.
  takePickup(index, who, tellServer = false) {
    const pick = this.pickups[index];
    if (!pick?.isVisible) return false;
    pick.isVisible = false;
    who?.equipWeapon(pick.weaponId);
    this._scheduleRespawn(pick, pick.respawnTime || 10000);
    if (tellServer) socketManager.emit('pickupWeapon', { spawnIndex: index });
    return true;
  }

  // Another player took it (relayed by the server).
  takePickupRemote(index, playerId, weaponId) {
    const pick = this.pickups[index];
    if (!pick) return;
    this._hide(pick);
    playerManager.getPlayer(playerId)?.equipWeapon(weaponId);
  }

  update() {
    for (const p of this.pickups) p.update();
    const me = playerManager.mainPlayer;
    if (!me || me.isRespawning) return;          // a corpse collects nothing
    const { x, y } = me.body;
    this.pickups.forEach((p, i) => {
      if (p.isPlayerOverlapping(x, y)) this.takePickup(i, me, true);
    });
  }

  draw(ctx) {
    for (const p of this.pickups) p.draw(ctx);
  }
}

const pickupManager = PickupManager.getInstance();

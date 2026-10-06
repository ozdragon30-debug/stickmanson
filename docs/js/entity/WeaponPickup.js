// A weapon lying on the floor: it bobs and turns slowly until someone walks
// over it, then stays hidden until its respawn timer runs out.
class WeaponPickup {
  constructor(x, y, weaponId, respawnTime = 10000) {
    this.weaponId = weaponId;
    this.respawnTime = respawnTime;
    this.phaseOffset = Math.random() * Math.PI * 2;   // pickups don't bob in sync
    const weapon = Constants.WEAPON_ID_MAP[weaponId];
    this.sprite = weapon?.hasPickup ? new AtlasGameObject(pickupAtlas, `${weapon.name}_pickup`, x, y) : null;
    if (this.sprite) this.sprite.isVisible = true;
  }

  get isVisible() { return !!this.sprite && this.sprite.isVisible; }
  set isVisible(v) { if (this.sprite) this.sprite.isVisible = v; }

  update() { this.sprite?.update(); }

  // Within `radius` px of (px, py) and currently lying there.
  isPlayerOverlapping(px, py, radius = 38) {
    if (!this.isVisible) return false;
    const dx = px - this.sprite.x, dy = py - this.sprite.y;
    return dx * dx + dy * dy < radius * radius;
  }

  draw(ctx) {
    if (!this.isVisible) return;
    const f = pickupAtlas.getFrameData(this.sprite.animName, 0);
    if (!f) return;
    const time = performance.now() / 1000 + this.phaseOffset;
    const lift = Math.sin(time * 1.5) * 5;          // ±5 px bob
    const turn = time * Math.PI / 3;                // a full turn every 6 s
    if (fx.enabled) this._drawGround(ctx, time, lift, f);
    ctx.save();
    ctx.translate(this.sprite.x, this.sprite.y + lift);
    ctx.rotate(turn);
    ctx.drawImage(pickupAtlas.image, f.x, f.y, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h);
    ctx.restore();
  }

  // A pulsing halo in the weapon's colour and a contact shadow that shrinks
  // while the weapon floats up.
  _drawGround(ctx, time, lift, f) {
    const { x, y } = this.sprite;
    const rgb = FX_PICKUP[Constants.WEAPON_ID_MAP[this.weaponId]?.name] || [200, 210, 230];
    const pulse = 0.5 + 0.5 * Math.sin(time * 3);
    fx.light(ctx, x, y, 40 + 8 * pulse, rgb, 0.22 + 0.14 * pulse);
    const up = (5 - lift) / 10;
    fx.shadow(ctx, x + 3, y + 8, Math.max(f.w, f.h) * (0.5 - 0.12 * up), 0.75 - 0.3 * up);
  }
}

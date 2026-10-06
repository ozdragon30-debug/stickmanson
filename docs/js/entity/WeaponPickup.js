// A single weapon pickup lying on the map floor.
class WeaponPickup {
  constructor(x, y, weaponId, respawnTime = 10000) {
    this.weaponId    = weaponId;
    this.respawnTime = respawnTime;
    this.phaseOffset = Math.random() * Math.PI * 2; // random start so pickups don't all sync

    const weapon = Constants.WEAPON_ID_MAP[weaponId];
    const animName = weapon?.hasPickup ? weapon.name + '_pickup' : null;
    this.sprite = animName ? new AtlasGameObject(pickupAtlas, animName, x, y) : null;
    if (this.sprite) this.sprite.isVisible = true;
  }

  get isVisible() { return this.sprite ? this.sprite.isVisible : false; }
  set isVisible(v) { if (this.sprite) this.sprite.isVisible = v; }

  update() {
    if (this.sprite) this.sprite.update();
  }

  draw(ctx) {
    if (!this.sprite || !this.sprite.isVisible) return;
    const f = pickupAtlas.getFrameData(this.sprite.animName, 0);
    if (!f) return;

    const time = performance.now() / 1000 + this.phaseOffset;
    const bob   = Math.sin(time * 1.5) * 5;  // ±5 px vertical bob
    const angle = time * (Math.PI * 2 / 6);  // one full rotation every 6 s

    const modern = fx.enabled;
    if (modern) this._drawGround(ctx, time, bob, f);

    ctx.save();
    ctx.translate(this.sprite.x, this.sprite.y + bob);
    ctx.rotate(angle);
    if (modern) fx.setShadow(ctx, 0.8);
    ctx.drawImage(pickupAtlas.image, f.x, f.y, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h);
    ctx.restore();
  }

  // Render-only: a pulsing coloured halo and a contact shadow that shrinks as
  // the weapon bobs up, so pickups read as floating above the floor.
  _drawGround(ctx, time, bob, f) {
    const x = this.sprite.x, y = this.sprite.y;
    const name = Constants.WEAPON_ID_MAP[this.weaponId]?.name;
    const rgb = FX_PICKUP[name] || [200, 210, 230];
    const pulse = 0.5 + 0.5 * Math.sin(time * 3);
    fx.light(ctx, x, y, 40 + 8 * pulse, rgb, 0.22 + 0.14 * pulse);
    const h = (5 - bob) / 10;  // 0 (lowest) … 1 (highest)
    const rx = Math.max(f.w, f.h) * (0.42 - 0.1 * h);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.28 - 0.12 * h})`;
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 8, rx, rx * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  isPlayerOverlapping(px, py, radius = 38) {
    if (!this.sprite || !this.sprite.isVisible) return false;
    const dx = px - this.sprite.x, dy = py - this.sprite.y;
    return dx * dx + dy * dy < radius * radius;
  }
}

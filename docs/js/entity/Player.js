class Player {
  constructor(x, y) {
    this.health = 100;
    this.kills  = 0;
    this.deaths = 0;
    this.canMove = true;
    this.canShoot = true;
    this.isRespawning = false;
    this.isMainPlayer = false;
    this.previousPosition = { x: -1, y: -1, rotation: -1 };
    this.name = '';

    // Indicator spinner — shape index + hue form the player's visual identity.
    // Both are synced to/from the server so all clients see the same spinner.
    this.indicatorShapeIndex = Math.floor(Math.random() * 64);
    this.indicatorHue = Math.floor(Math.random() * 360);
    // Shop extras shown to everyone: pet companion (-1 = none) and VIP badge.
    this.petId = -1;
    this.vip = false;

    // Current weapon definition (from Constants.WEAPON_ID_MAP).
    this.currentWeapon = Constants.WEAPON_ID_MAP[0]; // fist default

    // Body (upper half + weapon) — atlas-based, loops glock_idle by default.
    this.body = new AtlasGameObject(playerAtlas, 'fist_idle', x, y);
    this.body._defaultAnim = 'fist_idle';
    // Provide hitbox data compatible with checkCollision (glock_shoot frame geometry).
    this.body.spritesheetData = {
      spriteCenter: { x: 35, y: 485 },
      hitboxOffsets: {
        topLeft:     { x: 25, y: 0 },
        topRight:    { x: 50, y: 0 },
        bottomLeft:  { x: 25, y: 449 },
        bottomRight: { x: 50, y: 449 }
      }
    };

    // Legs — atlas-based, plays once per move call then hides.
    this.legs = new AtlasGameObject(playerAtlas, 'run', x, y, 1);
    this.legs.isVisible = false;

    // Hitsplat — atlas-based blood animation, picks variant from current weapon.
    this.hitsplat = new AtlasGameObject(bloodAtlas, 'blood_bullet_0', x, y, 1);
    this.hitsplat.isVisible = false;

    // Muzzle flash / shoot particle effect.
    this.muzzleFlash = new AtlasGameObject(particleAtlas, 'glock_particle', x, y, 1);
    this.muzzleFlash.isVisible = false;
    this.muzzleFlashPinned = false; // when true, particle stays at world position where it spawned

    // Death body — atlas-based, plays one random death anim then hides.
    this.deathBody = new AtlasGameObject(deathAtlas, 'death_0', x, y, 1);
    this.deathBody.isVisible = false;

    // Body event: fires when a shoot animation finishes — resets visual state.
    this.body.addEventListener("animationcomplete", () => {
      this.body.isShootingAnimation = false;
      this.body.resetAnimation();
    });

    // Death animation finished — respawn.
    this.deathBody.addEventListener("animationcomplete", () => {
      this.health = this.maxHealth();
      this.canShoot = true;
      this.canMove = true;

      // Move body to the new spawn position BEFORE clearing isRespawning,
      // so the body is never drawn at the death position.
      if (this.isMainPlayer) {
        this.healthbarHeart.setAnimation('heartbeat_healthy');
        this.respawn();
        if (typeof hudManager !== 'undefined') hudManager.onRespawn();
      }

      this.isRespawning = false;
      this.deathBody.isVisible = false;
      this.body.isVisible = true;

      this.deathBody.setAnimation('death_0');
    });

    this.legs.addEventListener("animationcomplete", () => {
      this.canMove = true;
      this.legs.isVisible = false;
      this.legs.resetAnimationRepeat(1);
    });

    this.muzzleFlash.addEventListener("animationcomplete", () => {
      this.muzzleFlash.isVisible = false;
    });

    this.hitsplat.addEventListener("animationcomplete", () => {
      this.hitsplat.isVisible = false;
    });

    this.body.addEventListener("shotsfired", this.checkCollision.bind(this));
  }

  checkCollision(data) {
    if (!this.isMainPlayer) return;

    const playerPos = data.playerPos;
    // body.rotation has +90° baked in for sprite orientation — remove it for physics.
    const rotation = this.body.rotation - (90 * Constants.TO_RADIANS);
    const origin = { x: playerPos.x, y: playerPos.y };
    const hitShape = this.currentWeapon.hitShape ?? { type: 'rect' };

    // Rectangle hitbox (default): pre-compute once, reused for all targets.
    let hitboxRegion = null;
    if (hitShape.type === 'rect') {
      const { hitboxOffsets } = this.body.spritesheetData;
      hitboxRegion = {
        topLeft:     { x: origin.x + hitboxOffsets.topLeft.x,     y: origin.y + hitboxOffsets.topLeft.y },
        topRight:    { x: origin.x + hitboxOffsets.topRight.x,    y: origin.y + hitboxOffsets.topRight.y },
        bottomLeft:  { x: origin.x + hitboxOffsets.bottomLeft.x,  y: origin.y + hitboxOffsets.bottomLeft.y },
        bottomRight: { x: origin.x + hitboxOffsets.bottomRight.x, y: origin.y + hitboxOffsets.bottomRight.y }
      };
      for (const corner in hitboxRegion) {
        const p = hitboxRegion[corner];
        const rotated = Physics.rotatePoint(origin.x, origin.y, p.x, p.y, rotation);
        hitboxRegion[corner].x = rotated.x;
        hitboxRegion[corner].y = rotated.y;
      }
    }

    let anyHit = false;
    const otherPlayers = playerManager.getPlayers();
    for (const playerId in otherPlayers) {
      const otherPlayer = otherPlayers[playerId];
      if (otherPlayer.isMainPlayer) continue;
      if (otherPlayer.isRespawning) continue;
      // Hit tests use the latest networked position (as the original did), not
      // the eased on-screen position used for drawing remote players.
      const targetPos = otherPlayer.getHitPosition();
      if (Physics.checkForObstacles(playerPos, targetPos)) continue;

      let hit = false;
      if (hitShape.type === 'ray') {
        hit = Physics.isRayHit(origin, targetPos, rotation, hitShape.maxRange);
      } else if (hitShape.type === 'cone') {
        hit = Physics.isConeHit(origin, targetPos, rotation, hitShape.maxRange, hitShape.spreadAngle);
      } else if (hitShape.type === 'circle') {
        hit = Physics.isCircleHit(origin, targetPos, hitShape.maxRange);
      } else {
        hit = Physics.isCircleCollidingRect(targetPos, hitboxRegion);
      }

      if (hit) {
        socketManager.emit("playerHit", { playerId, damage: this.currentWeapon.damage ?? 5, weaponId: this.currentWeapon.id ?? 0 });
        anyHit = true;
      }
    }
    if (anyHit && typeof hudManager !== 'undefined') hudManager.onHitConfirmed();
  }

  // Network position update for a remote player: rotation applies immediately,
  // position is eased over a few frames to hide network jitter. Large jumps
  // (respawns, teleports) snap instantly.
  setNetPosition(x, y, rotation) {
    if (rotation) this.body.setRotation(rotation);
    const dx = x - this.body.x, dy = y - this.body.y;
    if (!this._netTarget || dx * dx + dy * dy > 120 * 120 || this.isRespawning) {
      this.body.setPosition(x, y);
      this._netTarget = { x, y };
    } else {
      this._netTarget.x = x;
      this._netTarget.y = y;
    }
    this._netTime = performance.now();
  }

  _smoothNetPosition() {
    const target = this._netTarget;
    if (!target) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this._smoothAt || now)) / 1000);
    this._smoothAt = now;
    const k = 1 - Math.exp(-dt * 40); // ~25 ms time constant
    const dx = target.x - this.body.x, dy = target.y - this.body.y;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) { this.body.setPosition(target.x, target.y); return; }
    this.body.setPosition(this.body.x + dx * k, this.body.y + dy * k);
  }

  setPosition(x, y, rotation) {
    this.body.setPosition(x, y);
    if (rotation) {
      this.body.setRotation(rotation);
    }
  }

  getHitPosition() {
    const target = this._netTarget;
    return target ? { x: target.x, y: target.y, rotation: this.body.rotation } : this.getPosition();
  }

  getPosition() {
    return {
      x: this.body.x,
      y: this.body.y,
      rotation: this.body.rotation
    }
  }

  isPositionChanged(currentPosition) {
    return currentPosition.x !== this.previousPosition.x
      || currentPosition.y !== this.previousPosition.y
      || currentPosition.rotation !== this.previousPosition.rotation;
  }

  playWalkingAnim(legRotation = 0) {
    this._lastWalkAt = performance.now();
    this.legs.isVisible = true;
    this.canMove = false;
    this.legs.setPosition(this.body.x, this.body.y);
    this.legs.setRotation(legRotation * Constants.TO_RADIANS);
  }

  move(speedX, speedY = null, legRotation = 0) {
    const curX = this.body.x;
    const curY = this.body.y;
    const newX = speedX != null ? curX + speedX : curX;
    const newY = speedY != null ? curY + speedY : curY;

    const _blocked = (x, y) => {
      if (!obstacleGrid.length) return false;
      const tx = Math.floor(x / 50), ty = Math.floor(y / 50);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
      const tile = obstacleGrid[ty * map.width + tx];
      return tile && Physics.isTileWalkBlocked(tile, x % 50, y % 50);
    };

    // Try full diagonal move first.
    if (!_blocked(newX, newY)) {
      if (speedX != null) this.body.setVelocityX(speedX);
      if (speedY != null) this.body.setVelocityY(speedY);
    } else {
      // Slide: try each axis independently so the player glides along walls.
      const canX = speedX != null && !_blocked(newX, curY);
      const canY = speedY != null && !_blocked(curX, newY);
      if (canX) this.body.setVelocityX(speedX);
      if (canY) this.body.setVelocityY(speedY);
      if (!canX && !canY) return; // fully blocked — no anim either
    }

    this.playWalkingAnim(legRotation);

    // Throttled: the leg animation only needs a refresh every few frames, and
    // per-frame emits flooded the server on high-refresh (144/240 Hz) monitors.
    if (this.isMainPlayer) {
      const now = performance.now();
      if (legRotation !== this._lastWalkRot || now - (this._lastWalkEmit || 0) >= 50) {
        this._lastWalkEmit = now;
        this._lastWalkRot = legRotation;
        socketManager.emit("playedWalkingAnimation", { rotation: legRotation });
      }
    }
  }

  // World position for positional audio; null for the local player (always centred).
  _soundPos() {
    return this.isMainPlayer ? null : { x: this.body.x, y: this.body.y };
  }

  equipWeapon(weaponId, silent = false) {
    const weapon = Constants.WEAPON_ID_MAP[weaponId] ?? Constants.WEAPON_ID_MAP[2];
    this.currentWeapon = weapon;
    const idleAnim = weapon.name + '_idle';
    this.body._defaultAnim = idleAnim;
    this.body.isShootingAnimation = false;
    this.body.setAnimation(idleAnim);
    if (weapon.hasPickup && !silent) {
      soundManager.play(weapon.name + '_pickup', this._soundPos());
    }
  }

  shoot() {
    const weapon = this.currentWeapon;
    const shootSounds = weapon.shootSounds ?? [weapon.name + '_shoot'];
    soundManager.playRandom(shootSounds, this._soundPos());
    this.canShoot = false;
    // Keep the handle: a cooldown from a previous life/round must not cut a
    // later weapon's cooldown short (same cooldown lengths as before).
    clearTimeout(this._cooldownTimer);
    this._cooldownTimer = setTimeout(() => { this.canShoot = true; }, weapon.fireCooldown);
    const shootAnim = weapon.shootAnims[Math.floor(Math.random() * weapon.shootAnims.length)];
    this.body.isShootingAnimation = true;
    this.body.setAnimation(shootAnim, 1);
    if (weapon.shootParticle && particleAtlas.ready) {
      const particleAnim = particleAtlas.animationMap[weapon.shootParticle];
      const pOff = particleAnim?.offset || [0, 0];
      this.muzzleFlashPinned = particleAnim?.pinned || false;
      this.muzzleFlash.setAnimation(weapon.shootParticle, 1);
      if (this.muzzleFlashPinned) {
        // Bake offset into world position now so the particle stays put.
        const r = this.body.rotation;
        const wx = this.body.x + pOff[0] * Math.cos(r) - pOff[1] * Math.sin(r);
        const wy = this.body.y + pOff[0] * Math.sin(r) + pOff[1] * Math.cos(r);
        this.muzzleFlash.setPosition(wx, wy);
      } else {
        this.muzzleFlash.setPosition(this.body.x, this.body.y);
      }
      this.muzzleFlash.isVisible = true;
    }
    if (this.isMainPlayer) socketManager.emit('playedShoot');
  }

  death() {
    clearTimeout(this._cooldownTimer);
    this.health = 0;
    this.isRespawning = true;
    this.canShoot = false;
    this.canMove = false;

    soundManager.playRandom(Constants.DEATH_SOUNDS, this._soundPos());

    // Reset to fist.
    this.equipWeapon(0, true);

    // Pick a random death animation.
    const animName = 'death_' + Math.floor(Math.random() * 8);
    this.body.isShootingAnimation = false;
    this.body.setAnimation('fist_idle');
    this.body.isVisible = false;
    this.legs.isVisible = false;
    this.deathBody.setPosition(this.body.x, this.body.y);
    this.deathBody.setAnimation(animName, 1);
    this.deathBody.isVisible = true;
  }

  respawn() {
    const pts = (typeof map !== 'undefined' && map.ready && map.spawnPoints.length)
      ? map.spawnPoints
      : [{ x: 400, y: 300 }];
    const { x, y } = pts[Math.floor(Math.random() * pts.length)];

    this.body.setPosition(x, y);

    socketManager.emit("playerRespawn", { position: { x, y } });
  }

  // Called on round start — resets the player to a spawn point regardless of death state.
  forceRespawn(spawnPoints = []) {
    const pts = spawnPoints.length ? spawnPoints : [{ x: 400, y: 300 }];
    const { x, y } = pts[Math.floor(Math.random() * pts.length)];

    clearTimeout(this._cooldownTimer);
    this.health = this.maxHealth();
    this.isRespawning = false;
    this.canShoot = true;
    this.canMove = true;
    this.deathBody.isVisible = false;
    this.body.isVisible = true;
    this.body.isShootingAnimation = false;
    this.equipWeapon(0, true);
    this.body.setPosition(x, y);

    if (this.isMainPlayer) {
      this.healthbarHeart.setAnimation('heartbeat_healthy');
      if (typeof hudManager !== 'undefined') hudManager.onRespawn();
      socketManager.emit("playerRespawn", { position: { x, y } });
    }
  }

  // 100, plus the local player's health perk from the spinner shop.
  maxHealth() {
    return this.isMainPlayer && typeof shopManager !== 'undefined' ? shopManager.maxHealth() : 100;
  }

  showHitsplat(damage, attackerWeaponId, attackerPos = null) {
    const attackerWeapon = Constants.WEAPON_ID_MAP[attackerWeaponId];
    // Weapons without an impactSound fell back to 'impact', a file that doesn't
    // exist (silent + a 404 on every hit); keep them silent without the request.
    const impactKey = attackerWeapon?.impactSound;
    if (impactKey) soundManager.play(impactKey, this._soundPos());
    const anims = this.currentWeapon.bloodAnims;
    const anim = anims[Math.floor(Math.random() * anims.length)];
    this.hitsplat.setAnimation(anim, 1);
    this.hitsplat.setPosition(this.body.x, this.body.y);
    this.hitsplat.isVisible = true;
    this._hitFxAt = performance.now(); // render-only (hit rim flash)
    // Spinner perk (shop): armor reduces what the local player takes.
    const armor = this.isMainPlayer && typeof shopManager !== 'undefined' ? shopManager.armorFactor() : 1;
    this.health -= (damage ?? this.currentWeapon.damage) * Constants.DAMAGE_MULTIPLIER * armor;

    if (this.isMainPlayer) {
      if (typeof hudManager !== 'undefined') hudManager.onDamaged(attackerPos);
      const targetAnim = this.health >= 75 ? 'heartbeat_healthy'
                       : this.health >  20 ? 'heartbeat_impacted'
                                           : 'heartbeat_critical';
      if (this.healthbarHeart.animName !== targetAnim) {
        this.healthbarHeart.setAnimation(targetAnim);
      }
    }
  }

  update() {
    this.legs.update();
    this.body.update();
    this.hitsplat.update();
    this.muzzleFlash.update();
    if (this.muzzleFlash.isVisible && !this.muzzleFlashPinned) {
      this.muzzleFlash.setPosition(this.body.x, this.body.y);
    }
    if (this.isRespawning) {
      this.deathBody.update();
    }

    if (this.isMainPlayer) {
      this.healthbarHeart.update();
      this._regen();
    }

    // Legs stop as soon as the player stops (they used to keep running until the
    // 3-second run cycle finished). Remote players get extra slack for network jitter.
    if (this.legs.isVisible && this._lastWalkAt) {
      const idleMs = performance.now() - this._lastWalkAt;
      if (idleMs > (this.isMainPlayer ? 120 : 260)) {
        this.legs.isVisible = false;
        this.canMove = true;
        this.legs.resetAnimationRepeat(1);
      }
    }

    if (!this.isMainPlayer) this._smoothNetPosition();

    // Position updates are capped at ~60 Hz regardless of monitor refresh rate.
    // The latest position is always sent: an unsent change stays "changed" and
    // goes out on the next eligible frame.
    const currentPosition = this.getPosition();
    if (this.isMainPlayer && this.isPositionChanged(currentPosition)) {
      const now = performance.now();
      if (now - (this._lastNetSend || 0) >= 15) {
        this._lastNetSend = now;
        socketManager.emit("playerMovement", currentPosition);
        this.previousPosition = currentPosition;
      }
    }
  }

  // Pet perk: slow health regeneration once out of combat for 4 s.
  _regen() {
    const now = performance.now(), dt = Math.min(0.25, (now - (this._regenAt || now)) / 1000);
    this._regenAt = now;
    const rate = typeof shopManager !== 'undefined' ? shopManager.regenPerSec() : 0;
    if (!rate || this.isRespawning || this.health <= 0) return;
    if (typeof isOfflinePaused === 'function' && isOfflinePaused()) return;   // no healing behind a menu
    if (now - (this._hitFxAt || -1e9) < 4000) return;
    this.health = Math.min(this.maxHealth(), this.health + rate * dt);
    const anim = this.health >= 75 ? 'heartbeat_healthy' : this.health > 20 ? 'heartbeat_impacted' : 'heartbeat_critical';
    if (this.healthbarHeart.animName !== anim) this.healthbarHeart.setAnimation(anim);
  }

  // Pet companion: trots after its owner, a little behind and to the side.
  _drawPet(ctx) {
    const id = this.isMainPlayer && typeof shopManager !== 'undefined' ? shopManager.pet : this.petId;
    if (id == null || id < 0 || this.isRespawning || typeof Pets === 'undefined') { this._pet = null; return; }
    const now = performance.now(), face = this.body.rotation - Math.PI / 2;
    const tx = this.body.x - Math.cos(face) * 26 - Math.sin(face) * 16;
    const ty = this.body.y - Math.sin(face) * 26 + Math.cos(face) * 16;
    let p = this._pet;
    if (!p || Math.hypot(p.x - tx, p.y - ty) > 300) p = this._pet = { x: tx, y: ty, a: face, t: now };
    const dt = Math.min(0.1, (now - p.t) / 1000); p.t = now;
    const k = 1 - Math.exp(-dt * 7), dx = (tx - p.x) * k, dy = (ty - p.y) * k;
    p.x += dx; p.y += dy;
    const moving = Math.hypot(dx, dy) > 0.25 * (dt * 60);
    const want = moving ? Math.atan2(dy, dx) : face;
    let da = want - p.a; da = Math.atan2(Math.sin(da), Math.cos(da));
    p.a += da * Math.min(1, dt * 10);
    const time = now / 1000, fly = Pets.FLYING.has(id);
    if (fx.enabled) fx.shadow(ctx, p.x + 3, p.y + (fly ? 12 : 4), fly ? 9 : 11, fly ? 0.45 : 0.7);
    ctx.save();
    ctx.translate(p.x, p.y - (fly ? 6 + Math.sin(time * 3) * 2 : 0));
    ctx.rotate(p.a + Math.PI / 2);
    ctx.scale(1.3, 1.3);
    Pets.draw(ctx, id, time, moving);
    ctx.restore();
  }

  _drawIndicator(ctx) {
    // Hidden while dead.
    if (this.isRespawning) return;
    if (!indicatorAtlas.ready) return;

    const names = indicatorAtlas.animationNames;
    if (!names.length) return;
    const animName = names[this.indicatorShapeIndex % names.length];
    const anim = indicatorAtlas.getAnimation(animName);
    if (!anim || !anim.frames.length) return;

    // Rotary spinners (1 frame) spin via ctx.rotate().
    // Animated spinners (>1 frame) step through frames; no rotation needed.
    const now = Date.now();
    const isAnimated = anim.frames.length > 1;
    const frameIndex = isAnimated
      ? Math.floor((now / 1000) * anim.fps) % anim.frames.length
      : 0;

    const f = indicatorAtlas.getFrameData(animName, frameIndex);
    if (!f) return;

    const scale = 0.66;   // snug around the player
    const dw = f.w * scale;
    const dh = f.h * scale;

    const tinted = tintCache.get(indicatorAtlas, f, this.indicatorHue);
    if (!tinted) return;
    ctx.save();
    ctx.translate(this.body.x, this.body.y);
    if (!isAnimated) {
      ctx.rotate((now % 3000) / 3000 * Math.PI * 2);
    }
    ctx.drawImage(tinted.canvas, tinted.x, tinted.y, f.w, f.h, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  // The name tag is rendered to a small canvas once (text drawing every frame
  // was one of the costlier calls on phones) and redrawn only when the label,
  // HUD scale or resolution changes.
  _nameTag() {
    const u = display.uiScale || 1;
    const label = this.afk ? `💤 ${this.name}` : this.name;
    const res = Math.max(1, display.scale * worldScale());
    const vip = this.isMainPlayer && typeof shopManager !== 'undefined' ? shopManager.vip : this.vip;
    const key = label + '|' + u + '|' + res + '|' + vip;
    if (this._tag && this._tag.key === key) return this._tag;
    const font = `bold ${Math.round(11 * u)}px monospace`;
    const pad = 3, th = Math.round(13 * u);
    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    const w = Math.ceil(m.measureText(label).width) + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * res);
    canvas.height = Math.ceil(th * res);
    const c = canvas.getContext('2d');
    c.scale(res, res);
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, 0, w, th);
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillStyle = this.afk ? '#9fb3c8' : vip ? '#ffd166' : '#ffffff';
    c.fillText(label, w / 2, th);
    this._tag = { key, canvas, w, h: th };
    return this._tag;
  }

  // Additive light pool in front of a firing gun (render-only).
  _drawMuzzleLight(ctx) {
    if (this.isRespawning) return;
    const weapon = this.currentWeapon;
    const rgb = weapon && FX_MUZZLE[weapon.name];
    if (!rgb || !String(this.body.animName).includes('shoot')) return;
    // Weapons with a flash sprite light up with it; the others flicker while firing.
    const k = weapon.shootParticle
      ? (this.muzzleFlash.isVisible ? 1 : 0)
      : 0.65 + 0.35 * Math.random();
    if (!k) return;
    const r = this.body.rotation;
    const x = this.body.x + Math.sin(r) * 34;
    const y = this.body.y - Math.cos(r) * 34;
    fx.light(ctx, x, y, 110, rgb, 0.32 * k);
  }

  draw(ctx) {
    // Indicator spinner drawn first (below everything).
    this._drawIndicator(ctx);
    this._drawPet(ctx);
    const modern = fx.enabled;
    if (modern && !this.isRespawning) {
      // Soft ground light in the player's colour, so everyone reads at a glance.
      if (this._fxHue !== this.indicatorHue) {
        this._fxHue = this.indicatorHue;
        this._fxRgb = fx.hueRgb(((this.indicatorHue ?? 0) + 36) % 360);
      }
      fx.light(ctx, this.body.x, this.body.y, 46, this._fxRgb, 0.13);
    }
    if (modern) this._drawMuzzleLight(ctx);
    if (modern) {
      const x = this.body.x + 4, y = this.body.y + 6;
      fx.shadow(ctx, x, y, this.isRespawning ? 30 : 24, 0.9);
      // Energy weapons light up the floor around their holder.
      const glow = !this.isRespawning && FX_GLOW[this.currentWeapon?.name];
      if (glow) fx.light(ctx, this.body.x, this.body.y, 60, glow, 0.28);
    }
    // Legs are drawn first (behind body).
    if (!this.canMove) {
      this.legs.draw(ctx);
    }
    if (this.isRespawning) {
      this.deathBody.draw(ctx);
    } else {
      // Body rotates around the head pivot so the character aims correctly.
      this.body.drawWithHeadPivot(ctx);
      // Red flash for a moment after taking a hit.
      const since = performance.now() - (this._hitFxAt || -1e9);
      if (modern && since < 160) fx.light(ctx, this.body.x, this.body.y, 42, FX_HIT, 0.7 * (1 - since / 160));
    }
    this.hitsplat.drawCentered(ctx);
    const pOff = (!this.muzzleFlashPinned && this.currentWeapon.shootParticle && particleAtlas.animationMap[this.currentWeapon.shootParticle]?.offset) || [0, 0];
    this.muzzleFlash.drawCenteredRotated(ctx, this.muzzleFlashPinned ? 0 : this.body.rotation, pOff[0], pOff[1]);
    if (modern && this.muzzleFlash.isVisible) {
      // Bloom: a second, additive copy of the flash.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      this.muzzleFlash.drawCenteredRotated(ctx, this.muzzleFlashPinned ? 0 : this.body.rotation, pOff[0], pOff[1]);
      ctx.restore();
    }
    // Name tag above the player (hidden while dead).
    if (!this.isRespawning && this.name) {
      const tag = this._nameTag();
      if (tag) ctx.drawImage(tag.canvas, this.body.x - tag.w / 2, this.body.y - 48 - tag.h, tag.w, tag.h);
    }
  }
}

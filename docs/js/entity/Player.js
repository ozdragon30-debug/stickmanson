// A fighter in the arena: the local player or a networked/bot opponent.
//
// Sprite layers (all atlas driven):
//   body       – torso + held weapon, loops the weapon's idle animation
//   legs       – running cycle, shown only while walking
//   deathBody  – one-shot death animation shown while respawning
//   hitsplat   – one-shot blood burst when damaged
//   muzzleFlash– one-shot particle when firing
//
// Only the local player ("main" player) performs hit tests, regenerates,
// drives the heart icon and talks to the server; remote players are moved by
// network updates which are eased to hide jitter.

class Player {
  // Hit area in front of the shooter for the default rectangular weapon
  // shape, relative to the shooter position before rotation.
  static GEOMETRY = {
    spriteCenter: { x: 35, y: 485 },
    hitboxOffsets: {
      topLeft:     { x: 25, y: 0 },
      topRight:    { x: 50, y: 0 },
      bottomLeft:  { x: 25, y: 449 },
      bottomRight: { x: 50, y: 449 }
    }
  };
  static BASE_HEALTH = 100;
  static FALLBACK_SPAWN = { x: 400, y: 300 };
  static TILE = 50;

  // Heart icon state for a given health value.
  static heartAnimFor(health) {
    if (health >= 75) return 'heartbeat_healthy';
    if (health > 20) return 'heartbeat_impacted';
    return 'heartbeat_critical';
  }

  // The shop/HUD singletons are absent on some test pages.
  static hasShop() { return typeof shopManager !== 'undefined'; }
  static hasHud() { return typeof hudManager !== 'undefined'; }

  constructor(x, y) {
    this.health = Player.BASE_HEALTH;
    this.kills = 0;
    this.deaths = 0;
    this.canMove = true;
    this.canShoot = true;
    this.isRespawning = false;
    this.isMainPlayer = false;
    this.previousPosition = { x: -1, y: -1, rotation: -1 };
    this.name = '';

    // Spinner identity (shape then hue), shared with other clients via the server.
    this.indicatorShapeIndex = Math.floor(Math.random() * 64);
    this.indicatorHue = Math.floor(Math.random() * 360);
    // Cosmetics visible to everybody: companion pet (-1 means none), VIP tag.
    this.petId = -1;
    this.vip = false;

    this.currentWeapon = Constants.WEAPON_ID_MAP[0];

    this.body = new AtlasGameObject(playerAtlas, 'fist_idle', x, y);
    this.body._defaultAnim = 'fist_idle';
    this.body.spritesheetData = {
      spriteCenter: { ...Player.GEOMETRY.spriteCenter },
      hitboxOffsets: {
        topLeft:     { ...Player.GEOMETRY.hitboxOffsets.topLeft },
        topRight:    { ...Player.GEOMETRY.hitboxOffsets.topRight },
        bottomLeft:  { ...Player.GEOMETRY.hitboxOffsets.bottomLeft },
        bottomRight: { ...Player.GEOMETRY.hitboxOffsets.bottomRight }
      }
    };

    this.legs = this._oneShotSprite(playerAtlas, 'run', x, y);
    this.hitsplat = this._oneShotSprite(bloodAtlas, 'blood_bullet_0', x, y);
    this.muzzleFlash = this._oneShotSprite(particleAtlas, 'glock_particle', x, y);
    this.muzzleFlashPinned = false; // pinned flashes stay where they were spawned
    this.deathBody = this._oneShotSprite(deathAtlas, 'death_0', x, y);

    this._wireAnimationEvents();
  }

  _oneShotSprite(atlas, anim, x, y) {
    const sprite = new AtlasGameObject(atlas, anim, x, y, 1);
    sprite.isVisible = false;
    return sprite;
  }

  _wireAnimationEvents() {
    // A finished shot returns the torso to its idle loop.
    this.body.addEventListener('animationcomplete', () => {
      this.body.isShootingAnimation = false;
      this.body.resetAnimation();
    });

    // Death animation over: come back to life, unless this is a remote fighter
    // whose own client decides when it respawns (see remoteRespawn).
    this.deathBody.addEventListener('animationcomplete', () => {
      if (this.awaitRespawn) return;
      this.health = this.maxHealth();
      this.canShoot = true;
      this.canMove = true;
      if (this.isMainPlayer) {
        // Relocate first so the body never flashes at the corpse position.
        this.healthbarHeart.setAnimation('heartbeat_healthy');
        this.respawn();
        if (Player.hasHud()) hudManager.onRespawn();
      }
      this._showAlive();
    });

    this.legs.addEventListener('animationcomplete', () => this._stopLegs());
    this.muzzleFlash.addEventListener('animationcomplete', () => { this.muzzleFlash.isVisible = false; });
    this.hitsplat.addEventListener('animationcomplete', () => { this.hitsplat.isVisible = false; });

    this.body.addEventListener('shotsfired', this.checkCollision.bind(this));
  }

  // Swap the corpse back for the living body.
  _showAlive() {
    this.isRespawning = false;
    this.deathBody.isVisible = false;
    this.body.isVisible = true;
    this.deathBody.setAnimation('death_0');
  }

  _stopLegs() {
    this.canMove = true;
    this.legs.isVisible = false;
    this.legs.resetAnimationRepeat(1);
  }

  // ---------------------------------------------------------------- combat

  // Corners of the rectangular weapon hit area, rotated to the aim direction.
  _rectHitArea(origin, aim) {
    const offsets = this.body.spritesheetData.hitboxOffsets;
    const area = {};
    for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
      const px = origin.x + offsets[corner].x;
      const py = origin.y + offsets[corner].y;
      const turned = Physics.rotatePoint(origin.x, origin.y, px, py, aim);
      area[corner] = { x: turned.x, y: turned.y };
    }
    return area;
  }

  // Fired by the body sprite on the shooting frame: resolve which opponents
  // the current weapon reached and report them to the server.
  checkCollision(data) {
    if (!this.isMainPlayer) return;

    const shooterPos = data.playerPos;
    // The sprite rotation carries a quarter turn for artwork orientation.
    const aim = this.body.rotation - (90 * Constants.TO_RADIANS);
    const origin = { x: shooterPos.x, y: shooterPos.y };
    const shape = this.currentWeapon.hitShape ?? { type: 'rect' };
    const rectArea = shape.type === 'rect' ? this._rectHitArea(origin, aim) : null;

    const reaches = (targetPos) => {
      switch (shape.type) {
        case 'ray':    return Physics.isRayHit(origin, targetPos, aim, shape.maxRange);
        case 'cone':   return Physics.isConeHit(origin, targetPos, aim, shape.maxRange, shape.spreadAngle);
        case 'circle': return Physics.isCircleHit(origin, targetPos, shape.maxRange);
        default:       return Physics.isCircleCollidingRect(targetPos, rectArea);
      }
    };

    let landed = false;
    const everyone = playerManager.getPlayers();
    for (const playerId in everyone) {
      const target = everyone[playerId];
      if (target.isMainPlayer || target.isRespawning) continue;
      // Test against the last networked position rather than the eased one.
      const targetPos = target.getHitPosition();
      if (Physics.checkForObstacles(shooterPos, targetPos)) continue;
      if (!reaches(targetPos)) continue;
      socketManager.emit('playerHit', {
        playerId,
        damage: this.currentWeapon.damage ?? 5,
        weaponId: this.currentWeapon.id ?? 0
      });
      landed = true;
    }
    if (landed && Player.hasHud()) hudManager.onHitConfirmed();
  }

  // ------------------------------------------------------------- position

  // Remote update: rotation is applied at once, position glides toward the
  // target; far jumps (spawns, teleports) and corpses snap.
  setNetPosition(x, y, rotation) {
    if (rotation) this.body.setRotation(rotation);
    const offX = x - this.body.x;
    const offY = y - this.body.y;
    const farJump = offX * offX + offY * offY > 120 * 120;
    if (!this._netTarget || farJump || this.isRespawning) {
      this.body.setPosition(x, y);
      this._netTarget = { x, y };
    } else {
      this._netTarget.x = x;
      this._netTarget.y = y;
    }
    this._netReceivedAt = performance.now();
  }

  _easeTowardNetTarget() {
    const goal = this._netTarget;
    if (!goal) return;
    const now = performance.now();
    const elapsed = Math.min(0.1, (now - (this._easedAt || now)) / 1000);
    this._easedAt = now;
    const blend = 1 - Math.exp(-elapsed * 40);
    const gapX = goal.x - this.body.x;
    const gapY = goal.y - this.body.y;
    if (Math.abs(gapX) < 0.05 && Math.abs(gapY) < 0.05) {
      this.body.setPosition(goal.x, goal.y);
      return;
    }
    this.body.setPosition(this.body.x + gapX * blend, this.body.y + gapY * blend);
  }

  setPosition(x, y, rotation) {
    this.body.setPosition(x, y);
    if (rotation) this.body.setRotation(rotation);
  }

  getHitPosition() {
    const goal = this._netTarget;
    if (!goal) return this.getPosition();
    return { x: goal.x, y: goal.y, rotation: this.body.rotation };
  }

  getPosition() {
    return { x: this.body.x, y: this.body.y, rotation: this.body.rotation };
  }

  isPositionChanged(pos) {
    const last = this.previousPosition;
    return pos.x !== last.x || pos.y !== last.y || pos.rotation !== last.rotation;
  }

  // ------------------------------------------------------------- movement

  playWalkingAnim(legRotation = 0) {
    this._walkedAt = performance.now();
    this.legs.isVisible = true;
    this.canMove = false;
    this.legs.setPosition(this.body.x, this.body.y);
    this.legs.setRotation(legRotation * Constants.TO_RADIANS);
  }

  // Whether a world point is unwalkable (outside the map or inside solid tile art).
  _isSolidAt(px, py) {
    if (!obstacleGrid.length) return false;
    const col = Math.floor(px / Player.TILE);
    const row = Math.floor(py / Player.TILE);
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) return true;
    const tile = obstacleGrid[row * map.width + col];
    return tile && Physics.isTileWalkBlocked(tile, px % Player.TILE, py % Player.TILE);
  }

  move(speedX, speedY = null, legRotation = 0) {
    const fromX = this.body.x;
    const fromY = this.body.y;
    const hasX = speedX != null;
    const hasY = speedY != null;
    const toX = hasX ? fromX + speedX : fromX;
    const toY = hasY ? fromY + speedY : fromY;

    if (!this._isSolidAt(toX, toY)) {
      if (hasX) this.body.setVelocityX(speedX);
      if (hasY) this.body.setVelocityY(speedY);
    } else {
      // Blocked diagonally: keep whichever axis is still free (wall sliding).
      const slideX = hasX && !this._isSolidAt(toX, fromY);
      const slideY = hasY && !this._isSolidAt(fromX, toY);
      if (slideX) this.body.setVelocityX(speedX);
      if (slideY) this.body.setVelocityY(speedY);
      if (!slideX && !slideY) return;
    }

    this.playWalkingAnim(legRotation);
    if (this.isMainPlayer) this._announceWalk(legRotation);
  }

  // Leg animation broadcast, rate limited to one per 50 ms unless the
  // direction changed (high refresh monitors would otherwise flood the server).
  _announceWalk(legRotation) {
    const now = performance.now();
    if (legRotation === this._walkSentRot && now - (this._walkSentAt || 0) < 50) return;
    this._walkSentAt = now;
    this._walkSentRot = legRotation;
    socketManager.emit('playedWalkingAnimation', { rotation: legRotation });
  }

  // Where sounds from this fighter originate; the local player is always centred (null).
  _soundPos() {
    if (this.isMainPlayer) return null;
    return { x: this.body.x, y: this.body.y };
  }

  // -------------------------------------------------------------- weapons

  equipWeapon(weaponId, silent = false) {
    const weapon = Constants.WEAPON_ID_MAP[weaponId] ?? Constants.WEAPON_ID_MAP[2];
    this.currentWeapon = weapon;
    const idle = `${weapon.name}_idle`;
    this.body._defaultAnim = idle;
    this.body.isShootingAnimation = false;
    this.body.setAnimation(idle);
    if (weapon.hasPickup && !silent) soundManager.play(`${weapon.name}_pickup`, this._soundPos());
  }

  shoot() {
    const weapon = this.currentWeapon;
    soundManager.playRandom(weapon.shootSounds ?? [`${weapon.name}_shoot`], this._soundPos());

    // Only one cooldown timer is ever live, so a stale one from an earlier
    // weapon or life cannot re-enable shooting early.
    this.canShoot = false;
    clearTimeout(this._cooldownTimer);
    this._cooldownTimer = setTimeout(() => { this.canShoot = true; }, weapon.fireCooldown);

    const anims = weapon.shootAnims;
    this.body.isShootingAnimation = true;
    this.body.setAnimation(anims[Math.floor(Math.random() * anims.length)], 1);

    if (weapon.shootParticle && particleAtlas.ready) this._spawnMuzzleFlash(weapon.shootParticle);
    if (this.isMainPlayer) socketManager.emit('playedShoot');
  }

  _spawnMuzzleFlash(particle) {
    const info = particleAtlas.animationMap[particle];
    const offset = info?.offset || [0, 0];
    this.muzzleFlashPinned = info?.pinned || false;
    this.muzzleFlash.setAnimation(particle, 1);
    if (this.muzzleFlashPinned) {
      // Resolve the offset into world space now; the flash then stays put.
      const rot = this.body.rotation;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      this.muzzleFlash.setPosition(
        this.body.x + offset[0] * cos - offset[1] * sin,
        this.body.y + offset[0] * sin + offset[1] * cos
      );
    } else {
      this.muzzleFlash.setPosition(this.body.x, this.body.y);
    }
    this.muzzleFlash.isVisible = true;
  }

  // ------------------------------------------------------ life and death

  death() {
    clearTimeout(this._cooldownTimer);
    this.health = 0;
    this.isRespawning = true;
    this.canShoot = false;
    this.canMove = false;

    soundManager.playRandom(Constants.DEATH_SOUNDS, this._soundPos());
    this.equipWeapon(0, true);

    const deathAnim = `death_${Math.floor(Math.random() * 8)}`;
    this.body.isShootingAnimation = false;
    this.body.setAnimation('fist_idle');
    this.body.isVisible = false;
    this.legs.isVisible = false;
    this.deathBody.setPosition(this.body.x, this.body.y);
    this.deathBody.setAnimation(deathAnim, 1);
    this.deathBody.isVisible = true;
  }

  // The remote fighter's own client respawned it (or our fallback timer gave up waiting).
  remoteRespawn(pos) {
    clearTimeout(this._respawnFallback);
    if (!this.awaitRespawn) return;
    this.awaitRespawn = false;
    if (pos) {
      this.body.setPosition(pos.x, pos.y);
      this._netTarget = { x: pos.x, y: pos.y };
    }
    this.health = Player.BASE_HEALTH;
    this.canShoot = true;
    this.canMove = true;
    this._showAlive();
  }

  _pickSpawn(points) {
    return points[Math.floor(Math.random() * points.length)];
  }

  respawn() {
    const mapReady = typeof map !== 'undefined' && map.ready && map.spawnPoints.length;
    const { x, y } = this._pickSpawn(mapReady ? map.spawnPoints : [Player.FALLBACK_SPAWN]);
    this.body.setPosition(x, y);
    socketManager.emit('playerRespawn', { position: { x, y } });
  }

  // Round start: put the fighter on a spawn point whatever state it is in.
  forceRespawn(spawnPoints = []) {
    this.awaitRespawn = false;
    clearTimeout(this._respawnFallback);
    const { x, y } = this._pickSpawn(spawnPoints.length ? spawnPoints : [Player.FALLBACK_SPAWN]);

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

    if (!this.isMainPlayer) return;
    this.healthbarHeart.setAnimation('heartbeat_healthy');
    if (Player.hasHud()) hudManager.onRespawn();
    socketManager.emit('playerRespawn', { position: { x, y } });
  }

  // Base health, raised for the local player by the shop's health perk.
  maxHealth() {
    return this.isMainPlayer && Player.hasShop() ? shopManager.maxHealth() : Player.BASE_HEALTH;
  }

  _refreshHeart() {
    const wanted = Player.heartAnimFor(this.health);
    if (this.healthbarHeart.animName !== wanted) this.healthbarHeart.setAnimation(wanted);
  }

  showHitsplat(damage, attackerWeaponId, attackerPos = null) {
    const attackerWeapon = Constants.WEAPON_ID_MAP[attackerWeaponId];
    // Only weapons that define an impact sound make one.
    const impact = attackerWeapon?.impactSound;
    if (impact) soundManager.play(impact, this._soundPos());

    const blood = this.currentWeapon.bloodAnims;
    this.hitsplat.setAnimation(blood[Math.floor(Math.random() * blood.length)], 1);
    this.hitsplat.setPosition(this.body.x, this.body.y);
    this.hitsplat.isVisible = true;
    this._hitFxAt = performance.now();

    // Melee weapons also leave a slash/impact effect pointing away from the attacker.
    const meleeName = attackerWeapon?.name;
    if (StickFigure.HIT_TIME[meleeName]) {
      const angle = attackerPos
        ? Math.atan2(this.body.y - attackerPos.y, this.body.x - attackerPos.x)
        : Math.random() * Math.PI * 2;
      this._meleeFx = { weapon: meleeName, startedAt: performance.now(), angle, seed: Math.floor(Math.random() * 1000) };
    }

    // Shop armor perk softens hits on the local player.
    const armor = this.isMainPlayer && Player.hasShop() ? shopManager.armorFactor() : 1;
    this.health -= (damage ?? this.currentWeapon.damage) * Constants.DAMAGE_MULTIPLIER * armor;

    if (this.isMainPlayer) {
      if (Player.hasHud()) hudManager.onDamaged(attackerPos);
      this._refreshHeart();
    }
  }

  // ---------------------------------------------------------------- tick

  update() {
    this.legs.update();
    this.body.update();
    this.hitsplat.update();
    this.muzzleFlash.update();
    if (this.muzzleFlash.isVisible && !this.muzzleFlashPinned) {
      this.muzzleFlash.setPosition(this.body.x, this.body.y);
    }
    if (this.isRespawning) this.deathBody.update();

    if (this.isMainPlayer) {
      this.healthbarHeart.update();
      this._regenerate();
    }

    // Hide the legs shortly after walking stops; remote fighters get more
    // slack because their walk events arrive over the network.
    if (this.legs.isVisible && this._walkedAt) {
      const grace = this.isMainPlayer ? 120 : 260;
      if (performance.now() - this._walkedAt > grace) this._stopLegs();
    }

    if (!this.isMainPlayer) this._easeTowardNetTarget();

    // Send our position at most every 15 ms; an unsent change is retried on
    // the next frame because previousPosition only advances when sent.
    const pos = this.getPosition();
    if (this.isMainPlayer && this.isPositionChanged(pos)) {
      const now = performance.now();
      if (now - (this._posSentAt || 0) >= 15) {
        this._posSentAt = now;
        socketManager.emit('playerMovement', pos);
        this.previousPosition = pos;
      }
    }
  }

  // Shop pet perk: heal slowly after 4 s without being hit.
  _regenerate() {
    const now = performance.now();
    const elapsed = Math.min(0.25, (now - (this._regenTickAt || now)) / 1000);
    this._regenTickAt = now;
    const perSecond = Player.hasShop() ? shopManager.regenPerSec() : 0;
    if (!perSecond || this.isRespawning || this.health <= 0) return;
    if (typeof isOfflinePaused === 'function' && isOfflinePaused()) return;
    if (now - (this._hitFxAt || -1e9) < 4000) return;
    this.health = Math.min(this.maxHealth(), this.health + perSecond * elapsed);
    this._refreshHeart();
  }

  // ---------------------------------------------------------------- draw

  // Companion pet following beside and slightly behind its owner.
  _drawPet(ctx) {
    const petId = this.isMainPlayer && Player.hasShop() ? shopManager.pet : this.petId;
    if (petId == null || petId < 0 || this.isRespawning || typeof Pets === 'undefined') {
      this._companion = null;
      return;
    }
    const now = performance.now();
    const facing = this.body.rotation - Math.PI / 2;
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);
    const goalX = this.body.x - cos * 26 - sin * 16;
    const goalY = this.body.y - sin * 26 + cos * 16;

    let pet = this._companion;
    if (!pet || Math.hypot(pet.x - goalX, pet.y - goalY) > 300) {
      pet = this._companion = { x: goalX, y: goalY, angle: facing, at: now };
    }
    const elapsed = Math.min(0.1, (now - pet.at) / 1000);
    pet.at = now;
    const follow = 1 - Math.exp(-elapsed * 7);
    const stepX = (goalX - pet.x) * follow;
    const stepY = (goalY - pet.y) * follow;
    pet.x += stepX;
    pet.y += stepY;
    const walking = Math.hypot(stepX, stepY) > 0.25 * (elapsed * 60);
    const heading = walking ? Math.atan2(stepY, stepX) : facing;
    let turn = heading - pet.angle;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    pet.angle += turn * Math.min(1, elapsed * 10);

    const seconds = now / 1000;
    const flying = Pets.FLYING.has(petId);
    if (fx.enabled) fx.shadow(ctx, pet.x + 3, pet.y + (flying ? 12 : 4), flying ? 9 : 11, flying ? 0.45 : 0.7);
    ctx.save();
    ctx.translate(pet.x, pet.y - (flying ? 6 + Math.sin(seconds * 3) * 2 : 0));
    ctx.rotate(pet.angle + Math.PI / 2);
    ctx.scale(1.3, 1.3);
    Pets.draw(ctx, petId, seconds, walking);
    ctx.restore();
  }

  // Tinted spinner under the fighter; single-frame shapes rotate, multi-frame ones animate.
  _drawIndicator(ctx) {
    if (this.isRespawning || !indicatorAtlas.ready) return;
    const shapes = indicatorAtlas.animationNames;
    if (!shapes.length) return;
    const shape = shapes[this.indicatorShapeIndex % shapes.length];
    const anim = indicatorAtlas.getAnimation(shape);
    if (!anim || !anim.frames.length) return;

    const now = Date.now();
    const frameCount = anim.frames.length;
    const spins = frameCount === 1;
    const frame = indicatorAtlas.getFrameData(shape, spins ? 0 : Math.floor((now / 1000) * anim.fps) % frameCount);
    if (!frame) return;
    const tinted = tintCache.get(indicatorAtlas, frame, this.indicatorHue);
    if (!tinted) return;

    // Drawn snug around the player, like the classic game's spinners.
    const w = frame.w * 0.66;
    const h = frame.h * 0.66;
    ctx.save();
    ctx.translate(this.body.x, this.body.y);
    if (spins) ctx.rotate((now % 3000) / 3000 * Math.PI * 2);
    ctx.drawImage(tinted.canvas, tinted.x, tinted.y, frame.w, frame.h, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // Name label pre-rendered to an offscreen canvas, rebuilt only when its
  // text, colour, HUD scale or pixel ratio changes.
  _nameTag() {
    const ui = display.uiScale || 1;
    const text = this.afk ? `💤 ${this.name}` : this.name;
    const pixelRatio = Math.max(1, display.scale * worldScale());
    const vip = this.isMainPlayer && Player.hasShop() ? shopManager.vip : this.vip;
    const cacheKey = `${text}|${ui}|${pixelRatio}|${vip}`;
    if (this._label && this._label.key === cacheKey) return this._label;

    const font = `bold ${Math.round(11 * ui)}px monospace`;
    const height = Math.round(13 * ui);
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = font;
    const width = Math.ceil(measure.measureText(text).width) + 6;

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * pixelRatio);
    canvas.height = Math.ceil(height * pixelRatio);
    const g = canvas.getContext('2d');
    g.scale(pixelRatio, pixelRatio);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, width, height);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillStyle = this.afk ? '#9fb3c8' : vip ? '#ffd166' : '#ffffff';
    g.fillText(text, width / 2, height);
    this._label = { key: cacheKey, canvas, w: width, h: height };
    return this._label;
  }

  // Additive glow ahead of the barrel while firing.
  _drawMuzzleLight(ctx) {
    if (this.isRespawning) return;
    const weapon = this.currentWeapon;
    const color = weapon && FX_MUZZLE[weapon.name];
    if (!color || !String(this.body.animName).includes('shoot')) return;
    // With a flash sprite the light follows it; without one it flickers.
    let strength;
    if (weapon.shootParticle) strength = this.muzzleFlash.isVisible ? 1 : 0;
    else strength = 0.65 + 0.35 * Math.random();
    if (!strength) return;
    const rot = this.body.rotation;
    fx.light(ctx, this.body.x + Math.sin(rot) * 34, this.body.y - Math.cos(rot) * 34, 110, color, 0.32 * strength);
  }

  _drawMeleeFx(ctx) {
    const melee = this._meleeFx;
    if (!melee) return;
    const progress = (performance.now() - melee.startedAt) / 1000 / StickFigure.HIT_TIME[melee.weapon];
    if (progress >= 1) {
      this._meleeFx = null;
      return;
    }
    ctx.save();
    ctx.translate(this.body.x, this.body.y);
    StickFigure.hit(ctx, melee.weapon, progress, melee.angle, melee.seed);
    ctx.restore();
  }

  _drawMuzzleFlash(ctx, fancy) {
    const pinned = this.muzzleFlashPinned;
    const particle = this.currentWeapon.shootParticle;
    const offset = (!pinned && particle && particleAtlas.animationMap[particle]?.offset) || [0, 0];
    const rot = pinned ? 0 : this.body.rotation;
    this.muzzleFlash.drawCenteredRotated(ctx, rot, offset[0], offset[1]);
    if (!fancy || !this.muzzleFlash.isVisible) return;
    // Bloom pass: the same flash again, additively blended.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    this.muzzleFlash.drawCenteredRotated(ctx, rot, offset[0], offset[1]);
    ctx.restore();
  }

  draw(ctx) {
    this._drawIndicator(ctx);
    this._drawPet(ctx);

    const fancy = fx.enabled;
    const alive = !this.isRespawning;
    if (fancy && alive) {
      // Ground light in the fighter's colour for quick recognition.
      if (this._glowHue !== this.indicatorHue) {
        this._glowHue = this.indicatorHue;
        this._glowRgb = fx.hueRgb(((this.indicatorHue ?? 0) + 36) % 360);
      }
      fx.light(ctx, this.body.x, this.body.y, 46, this._glowRgb, 0.13);
    }
    if (fancy) {
      this._drawMuzzleLight(ctx);
      fx.shadow(ctx, this.body.x + 4, this.body.y + 6, alive ? 24 : 30, 0.9);
      const weaponGlow = alive && FX_GLOW[this.currentWeapon?.name];
      if (weaponGlow) fx.light(ctx, this.body.x, this.body.y, 60, weaponGlow, 0.28);
    }

    if (!this.canMove) this.legs.draw(ctx);
    if (alive) {
      this.body.drawWithHeadPivot(ctx);
      // Brief red flash after being hit.
      const sinceHit = performance.now() - (this._hitFxAt || -1e9);
      if (fancy && sinceHit < 160) fx.light(ctx, this.body.x, this.body.y, 42, FX_HIT, 0.7 * (1 - sinceHit / 160));
    } else {
      this.deathBody.draw(ctx);
    }

    this.hitsplat.drawCentered(ctx);
    this._drawMeleeFx(ctx);
    this._drawMuzzleFlash(ctx, fancy);

    if (alive && this.name) {
      const tag = this._nameTag();
      if (tag) ctx.drawImage(tag.canvas, this.body.x - tag.w / 2, this.body.y - 48 - tag.h, tag.w, tag.h);
    }
  }
}

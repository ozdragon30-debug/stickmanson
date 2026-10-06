// Computer-controlled opponent for offline play.
//
// A Bot owns one Player entity and steers it every frame from think(). The
// BotManager creates and removes bots, routes their damage and keeps the
// scoreboard; this file only decides where a bot walks, where it looks and
// when it pulls the trigger.
//
// One frame of decision making:
//   1. Handle a pending respawn, then grab any pickup lying underfoot.
//   2. Roll the personality noise: a fresh turn rate, a slowly swinging aim
//      error and the odd short pause.
//   3. Look for the closest enemy in plain sight. The bot only engages after
//      it has watched that enemy for its own reaction delay, and a bot holding
//      nothing but fists leaves enemies alone unless they are close or have
//      just hurt it.
//   4. Engaged: close-combat weapons rush in along an A* route. Guns rush in
//      only while the enemy is out of reach; in reach they regain sight if it
//      is blocked, step back from enemies that come too near, and otherwise
//      stand their ground and shoot.
//   5. Nothing to fight: wander between spawn points and lying weapons (a bot
//      without a weapon heads for the nearest reachable one first).
//   6. Whenever the bot has hardly moved for a while, shove it somewhere random.

class Bot {
  // weapons.json ids handled with the close-combat behaviour
  // (the tesla helmet counts too: its aura only reaches ~75 px).
  static MELEE_IDS = new Set([0, 1, 6, 8, 9, 11, 12]);

  // Per-style tuning. `aimSwing` bounds the aim error (rad), the turn rate is
  // turnBase + random * turnSpread (rad/s), a shot needs the aim error below
  // aimSwing * steadyFactor and the facing within `facingSlack` rad of the enemy.
  static STYLE = {
    melee:  { aimSwing: 0.45, turnBase: 2.8, turnSpread: 1.2, steadyFactor: 1,   facingSlack: 0.5 },
    ranged: { aimSwing: 0.18, turnBase: 1.4, turnSpread: 0.8, steadyFactor: 0.7, facingSlack: 0.25 },
  };

  static CHASE_REPLAN_SECONDS = 0.5;   // how often a chase / retreat route is recomputed
  static WAYPOINT_REACHED_PX = 30;
  static WANDER_GOAL_REACHED_PX = 60;
  static PROVOKE_RANGE_PX = 120;       // fists-only bots defend themselves inside this range
  static PROVOKE_MEMORY_MS = 3000;     // ...or for this long after being hit
  static STUCK_WINDOW_S = 0.3;
  static FALLBACK_SPAWN = { x: 400, y: 300 };
  static DEFAULT_HIT_SHAPE = { type: 'cone', maxRange: 50, spreadAngle: 80 };

  /**
   * @param {string} id         Key under which the player is registered (e.g. 'bot_0').
   * @param {number} x          Spawn x in world pixels.
   * @param {number} y          Spawn y in world pixels.
   * @param {number} nameIndex  Index into BotManager.BOT_NAMES.
   */
  constructor(id, x, y, nameIndex = 0) {
    this.id = id;

    const body = new Player(x, y);
    this.player = body;
    const names = BotManager.BOT_NAMES;
    body.name = '[BOT] ' + names[nameIndex % names.length];

    // Cosmetics: spinner colour / shape and, for some bots, a pet.
    body.indicatorHue = Math.floor(Math.random() * 360);
    body.indicatorShapeIndex = Math.floor(Math.random() * 64);
    body.petId = Math.random() < 0.3 ? Math.floor(Math.random() * Pets.count) : -1;

    // Scoreboard counters, updated by BotManager.
    this.kills = 0;
    this.deaths = 0;

    // Raised by BotManager when the player dies; think() teleports the bot to
    // a spawn point once the death animation is over.
    this.respawnPending = false;

    // ── personality (the random draws below must keep this order) ──────────
    this._reaction = { delay: 0.35 + Math.random() * 0.55, watched: 0, ready: false };
    this._aim = { offset: 0, rate: (Math.random() - 0.5) * 1.8, limit: 0 };
    this._pause = { clock: 0, every: 2.5 + Math.random() * 3.5, left: 0 };
    this._unstick = {
      clock: 0,                       // time spent stuck since the last new heading
      heading: Bot._randomHeading(),  // direction of the escape shove
      last: { x, y },                 // position seen on the previous frame
      travelled: 0,                   // distance covered in the current window
      window: 0,                      // length of the current window (s)
      stuck: false,
    };
    this._facing = Bot._randomHeading();   // where the bot currently looks (rad)
    this._turnRate = 0;                    // rad/s, re-rolled every frame

    // ── navigation ─────────────────────────────────────────────────────────
    const wanderEvery = 8 + Math.random() * 12;
    this._wander = {
      points: [], next: 0,   // route being walked
      goal: null,            // spawn point / weapon it leads to
      every: wanderEvery,    // seconds between new goals
      clock: Math.random() * wanderEvery,
    };
    this._chase = { points: [], next: 0, clock: 0 };

    playerManager.addPlayer(id, body);
  }

  get isMelee() {
    return Bot.MELEE_IDS.has(this.player.currentWeapon?.id ?? 0);
  }

  // ── per-frame entry point ──────────────────────────────────────────────────

  think(dt) {
    const me = this.player;

    if (this.respawnPending && !me.isRespawning) {
      this.respawnPending = false;
      this._respawnAtSpawnPoint();
      return;
    }
    if (me.isRespawning) return;

    this._collectPickupsUnderfoot();

    const melee = this.isMelee;
    const style = melee ? Bot.STYLE.melee : Bot.STYLE.ranged;
    this._aim.limit = style.aimSwing;
    this._turnRate = style.turnBase + Math.random() * style.turnSpread;
    this._swingAim(dt);
    const pausing = this._tickPause(dt);

    const here = me.getPosition();
    const weapon = me.currentWeapon;
    const fistsOnly = (weapon?.id ?? 0) === 0;

    const spotted = this._closestVisibleEnemy(here);
    const reacted = this._noticeEnemy(spotted !== null, dt);
    const provoked = spotted !== null && this._isProvokedBy(spotted, here);
    const foe = spotted && reacted && (!fistsOnly || provoked) ? spotted : null;

    if (foe) this._fight(foe, here, weapon, melee, style, pausing, dt);
    else this._idle(here, fistsOnly, pausing, dt);

    this._shakeLooseIfStuck(dt, here);
  }

  /** Remove this bot's player from the player registry. */
  remove() {
    playerManager.removePlayer(this.id);
  }

  /** Throw away every route planned from an old position (respawn, map switch). */
  _resetNavigation(pos) {
    const w = this._wander;
    w.points = [];
    w.next = 0;
    w.goal = null;
    this._dropChase();
    w.clock = w.every;   // pick a fresh goal on the next frame
    this._unstick.clock = 0;
    this._unstick.last = { x: pos.x, y: pos.y };
  }

  // ── personality ────────────────────────────────────────────────────────────

  /** Swing the aim error back and forth between -limit and +limit. */
  _swingAim(dt) {
    const aim = this._aim;
    aim.offset += aim.rate * dt;
    if (Math.abs(aim.offset) > aim.limit) {
      aim.rate = -aim.rate;
      aim.offset = Math.sign(aim.offset) * aim.limit;
    }
  }

  /** Advance the pause schedule; true while the bot is standing still. */
  _tickPause(dt) {
    const pz = this._pause;
    if (pz.left > 0) pz.left -= dt;
    pz.clock += dt;
    if (pz.clock >= pz.every) {
      pz.clock = 0;
      pz.every = 2.5 + Math.random() * 3.5;
      pz.left = 0.12 + Math.random() * 0.25;
    }
    return pz.left > 0;
  }

  /** Track how long an enemy has been in view; true once the reaction delay has passed. */
  _noticeEnemy(inView, dt) {
    const rx = this._reaction;
    if (inView) {
      rx.watched += dt;
      if (rx.watched >= rx.delay) rx.ready = true;
    } else {
      rx.watched = 0;
      rx.ready = false;
    }
    return rx.ready;
  }

  /** A fists-only bot hits back when it was hurt recently or the enemy is very close. */
  _isProvokedBy(enemy, here) {
    const hurtAt = this.player._hitFxAt || -1e9;
    return performance.now() - hurtAt < Bot.PROVOKE_MEMORY_MS ||
      Bot._distance(here, enemy.getPosition()) < Bot.PROVOKE_RANGE_PX;
  }

  // ── combat ─────────────────────────────────────────────────────────────────

  _fight(foe, here, weapon, melee, style, pausing, dt) {
    const there = foe.getPosition();
    const dx = there.x - here.x;
    const dy = there.y - here.y;
    const gap = Math.sqrt(dx * dx + dy * dy);
    const reach = weapon?.hitShape?.maxRange ?? 50;

    const bearing = Math.atan2(dy, dx);
    this._rotateToward(bearing + this._aim.offset, dt);
    this._applyFacing();

    if (!pausing) this._manoeuvre(here, there, dx, dy, gap, reach, melee, dt);

    // Only shoot when in reach, the aim error is small and the bot already
    // faces the enemy (a bot still turning around must not fire yet).
    const steady = Math.abs(this._aim.offset) < this._aim.limit * style.steadyFactor;
    const lookingAtFoe = Math.abs(Bot._wrapAngle(this._facing, bearing)) < style.facingSlack;
    if (gap <= reach && this.player.canShoot && steady && lookingAtFoe) this._fireAt(foe);

    // Actively fighting never counts as being stuck.
    this._unstick.clock = 0;
  }

  /** Choose where to move while engaged. */
  _manoeuvre(here, there, dx, dy, gap, reach, melee, dt) {
    // Close-combat bots, and guns that cannot reach yet, run at the enemy.
    if (melee || gap > reach * 0.85) {
      this._steerChase(there, here, dt);
      return;
    }

    // In reach with a gun: first make sure the enemy can actually be seen.
    if (Physics.checkForObstacles(here, there)) {
      this._steerChase(there, here, dt);
      return;
    }

    // Enemy uncomfortably close: back off to roughly half the weapon's reach.
    if (gap < reach * 0.35) {
      const backOff = reach * 0.5 + (Math.random() - 0.5) * 40;
      const refuge = {
        x: here.x - (dx / gap) * backOff,
        y: here.y - (dy / gap) * backOff,
      };
      this._steerChase(refuge, here, dt);
      return;
    }

    // Good distance: hold position.
    this._dropChase();
  }

  /** Walk the chase route toward `dest`, re-planning it every CHASE_REPLAN_SECONDS. */
  _steerChase(dest, here, dt) {
    const route = this._chase;
    route.clock += dt;
    if (route.clock >= Bot.CHASE_REPLAN_SECONDS) {
      route.clock = 0;
      // Without a usable route, simply head straight for the destination.
      const planned = this._canPlan() ? this._plan(here, dest) : null;
      Bot._setRoute(route, planned || [dest]);
    }
    this._followRoute(route, dt);
  }

  _dropChase() {
    const route = this._chase;
    route.points = [];
    route.next = 0;
    route.clock = 0;
  }

  /** Fire the weapon; damage only counts if the real hit shape, from where the bot faces, reaches the enemy. */
  _fireAt(foe) {
    const me = this.player;
    me.shoot();
    const shape = me.currentWeapon?.hitShape ?? Bot.DEFAULT_HIT_SHAPE;
    const from = me.getPosition();
    const to = foe.getPosition();
    const facing = this._facing;

    let landed;
    switch (shape.type) {
      case 'ray':    landed = Physics.isRayHit(from, to, facing, shape.maxRange); break;
      case 'circle': landed = Physics.isCircleHit(from, to, shape.maxRange); break;
      default:       landed = Physics.isConeHit(from, to, facing, shape.maxRange, shape.spreadAngle ?? 80);
    }
    if (landed && !Physics.checkForObstacles(from, to)) botManager._applyDamage(this, foe);
  }

  /** Closest living enemy (human first, then other bots) with a clear line of sight, or null. */
  _closestVisibleEnemy(here) {
    let best = null;
    let bestGap = Infinity;
    const consider = (who) => {
      const at = who.getPosition();
      const gap = Bot._distance(here, at);
      if (gap < bestGap && !Physics.checkForObstacles(here, at)) {
        bestGap = gap;
        best = who;
      }
    };

    const human = playerManager.mainPlayer;
    if (human && !human.isRespawning) consider(human);

    for (const [key, other] of Object.entries(botManager.getBotPlayers())) {
      if (key !== this.id && !other.isRespawning) consider(other);
    }
    return best;
  }

  // ── wandering ──────────────────────────────────────────────────────────────

  _idle(here, fistsOnly, pausing, dt) {
    this._dropChase();
    this._updateWanderGoal(here, fistsOnly, dt);

    const goal = this._wander.goal;
    if (!goal || pausing) return;
    this._followRoute(this._wander, dt);
    this._rotateToward(Math.atan2(goal.y - here.y, goal.x - here.x), dt);
    this._applyFacing();
  }

  _updateWanderGoal(here, fistsOnly, dt) {
    const w = this._wander;
    w.clock += dt;
    if (w.clock >= w.every) {
      w.clock = 0;
      w.every = 8 + Math.random() * 12;
      this._chooseWanderGoal(here, fistsOnly);
    }
    // Close enough: ask for a new goal on the next frame.
    if (w.goal && Bot._distance(here, w.goal) < Bot.WANDER_GOAL_REACHED_PX) w.clock = w.every - 0.1;
  }

  _chooseWanderGoal(here, fistsOnly) {
    const spawns = map && map.spawnPoints ? [...map.spawnPoints] : [];

    // Weapons that are lying on the map right now, at their sprite position.
    const weapons = [];
    if (map && map.weaponSpawns) {
      for (let i = 0; i < map.weaponSpawns.length; i++) {
        const pickup = pickupManager?.pickups[i];
        if (pickup && pickup.isVisible && pickup.sprite) weapons.push({ x: pickup.sprite.x, y: pickup.sprite.y });
      }
    }

    if (fistsOnly && weapons.length > 0) {
      // Go for the nearest weapon that can actually be reached.
      const byNearness = [...weapons].sort((a, b) => Bot._distance(here, a) - Bot._distance(here, b));
      if (!this._canPlan()) {
        this._wander.goal = byNearness[0];
        return;
      }
      for (const spot of byNearness) {
        const route = this._plan(here, spot);
        if (route) {
          this._wander.goal = spot;
          Bot._setRoute(this._wander, route);
          return;
        }
      }
      if (spawns.length > 0) this._headFor(Bot._pickOne(spawns), here);
      return;
    }

    const options = fistsOnly ? spawns : spawns.concat(weapons);
    if (options.length > 0) this._headFor(Bot._pickOne(options), here);
  }

  /** Make `goal` the wander goal and plan a route to it. */
  _headFor(goal, here) {
    const w = this._wander;
    w.goal = goal;
    if (!this._canPlan()) {
      Bot._setRoute(w, [goal]);
      return;
    }
    const route = this._plan(here, goal);
    if (route) Bot._setRoute(w, route);
    else w.clock = w.every - 0.1;   // unreachable: try another goal next frame
  }

  // ── movement ───────────────────────────────────────────────────────────────

  _canPlan() {
    return typeof Pathfinder !== 'undefined' && map && obstacleGrid && obstacleGrid.length > 0;
  }

  /** A* route from `here` to `dest`, or null when there is none. */
  _plan(here, dest) {
    const route = Pathfinder.findPath(here, dest, map, obstacleGrid);
    return route && route.length > 0 ? route : null;
  }

  /** Walk toward the route's current waypoint, moving on to the next one when close. */
  _followRoute(route, dt) {
    if (route.next >= route.points.length) return;
    const here = this.player.getPosition();
    if (Bot._distance(here, route.points[route.next]) < Bot.WAYPOINT_REACHED_PX) {
      route.next++;
      if (route.next >= route.points.length) return;
    }
    const waypoint = route.points[route.next];
    this._walkTo(waypoint.x, waypoint.y, dt);
  }

  /** Step toward a world point at the current weapon's walking speed. */
  _walkTo(x, y, dt) {
    const here = this.player.getPosition();
    const dx = x - here.x;
    const dy = y - here.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return;

    const speed = Constants.SPEED * (this.player.currentWeapon?.walkSpeed ?? 1.0);
    const legDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    this.player.move((dx / len) * speed * dt, (dy / len) * speed * dt, legDeg);
  }

  /** Turn the view toward `goalAngle`, no faster than the current turn rate. */
  _rotateToward(goalAngle, dt) {
    const delta = Bot._wrapAngle(this._facing, goalAngle);
    const step = this._turnRate * dt;
    this._facing = Math.abs(delta) <= step ? goalAngle : this._facing + Math.sign(delta) * step;
    this._facing = ((this._facing + Math.PI) % (2 * Math.PI)) - Math.PI;
  }

  /** The body sprite is drawn pointing up, hence the quarter-turn offset. */
  _applyFacing() {
    this.player.body.setRotation(this._facing + (90 * Constants.TO_RADIANS));
  }

  /**
   * Stuck detection over short windows (so the result does not depend on the
   * frame rate). While stuck, push the bot along a random heading that is
   * re-rolled after every second of being stuck.
   */
  _shakeLooseIfStuck(dt, here) {
    const u = this._unstick;
    u.travelled += Bot._distance(here, u.last);
    u.last = { x: here.x, y: here.y };
    u.window += dt;
    if (u.window >= Bot.STUCK_WINDOW_S) {
      const expected = Constants.SPEED * (this.player.currentWeapon?.walkSpeed ?? 1) * u.window;
      u.stuck = u.travelled < expected * 0.15;
      u.travelled = 0;
      u.window = 0;
    }

    if (!u.stuck) {
      u.clock = 0;
      return;
    }
    u.clock += dt;
    if (u.clock > 1.0) {
      u.heading = Bot._randomHeading();
      u.clock = 0;
    }
    const speed = Constants.SPEED * 0.5;
    const dir = u.heading;
    this.player.move(Math.cos(dir) * speed * dt, Math.sin(dir) * speed * dt, dir * (180 / Math.PI));
  }

  // ── pickups and respawn ────────────────────────────────────────────────────

  _collectPickupsUnderfoot() {
    const at = this.player.getPosition();
    const list = pickupManager.pickups;
    for (let i = 0; i < list.length; i++) {
      if (list[i].isPlayerOverlapping(at.x, at.y)) pickupManager.takePickup(i, this.player, false);
    }
  }

  /** Death animation finished (it already restored health etc.); move to a random spawn point. */
  _respawnAtSpawnPoint() {
    const choices = (typeof map !== 'undefined' && map.ready && map.spawnPoints.length)
      ? map.spawnPoints
      : [Bot.FALLBACK_SPAWN];
    const spot = Bot._pickOne(choices);
    this.player.body.setPosition(spot.x, spot.y);
    this.player.legs.setPosition(spot.x, spot.y);
    this._resetNavigation(spot);
  }

  // ── small pure helpers ─────────────────────────────────────────────────────

  static _setRoute(route, points) {
    route.points = points;
    route.next = 0;
  }

  static _pickOne(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  static _randomHeading() {
    return Math.random() * Math.PI * 2;
  }

  static _distance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Signed shortest turn from angle `from` to angle `to`, within [-PI, PI]. */
  static _wrapAngle(from, to) {
    const full = 2 * Math.PI;
    const d = ((to - from + Math.PI) % full) - Math.PI;
    return d < -Math.PI ? d + full : d;
  }
}

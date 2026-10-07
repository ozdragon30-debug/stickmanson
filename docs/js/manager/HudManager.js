// HudManager – screen-space feedback layer drawn on top of the world.
// Purely presentational: health bar, weapon slot, kill feed, hit markers,
// damage direction, death banner, FPS / ping and connection status.

class HudManager {
  constructor() {
    this.killFeed     = [];   // { killer, killerHue, victim, victimHue, weaponId, t, mine }
    this.hitMarkerAt  = 0;
    this.damageAt     = 0;
    this.damageDirs   = [];   // { angle, t }
    this.centerMsg    = null; // { text, sub, color, t, dur }
    this.deathInfo    = null; // { killer, t }
    this.displayHp    = 100;  // smoothed white "trail" behind the health bar
    this.fps          = 0;
    this._frames      = 0;
    this._fpsT        = performance.now();
    this.streak       = 0;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  onKill({ killerName, killerHue, victimName, victimHue, weaponId, killerIsMe, victimIsMe }) {
    if (typeof statsManager !== 'undefined') {
      if (killerIsMe && !victimIsMe) statsManager.onKill(weaponId);
      if (killerIsMe && !victimIsMe && typeof shopManager !== 'undefined') this.onCoins(ShopManager.REWARD.kill);
      if (victimIsMe) statsManager.onDeath();
    }
    if (settingsManager.get('killFeed')) {
      this.killFeed.push({
        killer: killerIsMe ? t('hud.you') : (killerName || '?'), killerHue,
        victim: victimIsMe ? t('hud.you') : (victimName || '?'), victimHue,
        weaponId, t: performance.now(), mine: killerIsMe || victimIsMe,
      });
      if (this.killFeed.length > 5) this.killFeed.shift();
    }
    if (killerIsMe && !victimIsMe) {
      this.streak++;
      const sub = this.streak >= 2 ? t('hud.streak.' + Math.min(this.streak, 5)) : null;
      this.flash(t('hud.eliminated', { name: victimName || '' }).trim(), sub, '#ffd166', 1600);
    }
    if (victimIsMe) {
      this.streak = 0;
      this.deathInfo = { killer: killerIsMe ? null : killerName, t: performance.now() };
    }
  }

  // Coins from the spinner shop economy: a small counter under the health bar
  // and a "+n" pop when some are earned.
  onCoins(n, alreadyEarned = false) {
    if (!alreadyEarned) n = shopManager.earn(n);
    if (!n) return;
    this.coinPop = { n, t: performance.now() };
  }

  _drawCoins(ctx, x, y) {
    if (typeof shopManager === 'undefined') return;
    ctx.save();
    ctx.beginPath(); ctx.arc(x + 6, y - 4, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f5c542'; ctx.fill();
    ctx.strokeStyle = '#9a6b12'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(shopManager.coins, x + 17, y + 1);
    ctx.fillStyle = '#ffe08a'; ctx.fillText(shopManager.coins, x + 16, y);
    const pop = this.coinPop, age = pop ? (performance.now() - pop.t) / 1400 : 1;
    if (age < 1) {
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = '#ffd166';
      ctx.fillText('+' + pop.n, x + 24 + ctx.measureText(String(shopManager.coins)).width, y - 10 * age);
    }
    ctx.restore();
  }

  onHitConfirmed() {
    if (settingsManager.get('hitMarkers')) this.hitMarkerAt = performance.now();
  }

  // attackerPos: world position of the attacker (optional) for the direction arc.
  onDamaged(attackerPos) {
    if (!settingsManager.get('damageFlash')) return;
    const now = performance.now();
    this.damageAt = now;
    const me = playerManager.mainPlayer;
    if (attackerPos && me) {
      const dx = attackerPos.x - me.body.x, dy = attackerPos.y - me.body.y;
      if (dx * dx + dy * dy > 30 * 30) {
        this.damageDirs.push({ angle: Math.atan2(dy, dx), t: now });
        if (this.damageDirs.length > 4) this.damageDirs.shift();
      }
    }
    if (typeof gamepadInput !== 'undefined') gamepadInput.rumble(0.45, 0.25, 110);
    if (inputMode.mode === 'touch' && navigator.vibrate) navigator.vibrate(25);
  }

  onRespawn() { this.deathInfo = null; }

  // "Facility (by Someone)" → big map title with the author underneath.
  showMapTitle(name) {
    if (!name) return;
    const { title, author } = splitMapName(name);
    this.flash(title, author ? t('hud.mapBy', { name: author }) : null, '#cfe3f7', 2600);
    if (this.centerMsg) this.centerMsg.subColor = '#8fa6bf';
  }

  flash(text, sub = null, color = '#fff', dur = 1500) {
    this.centerMsg = { text, sub, color, t: performance.now(), dur };
  }

  // ── Draw ──────────────────────────────────────────────────────────────────
  tickFps(now) {
    this._frames++;
    if (now - this._fpsT >= 500) {
      this.fps = Math.round(this._frames * 1000 / (now - this._fpsT));
      this._frames = 0;
      this._fpsT = now;
    }
  }

  draw(ctx) {
    const now = performance.now();
    const me = playerManager.mainPlayer;
    ctx.save();
    resetScreenTransform(ctx);

    this._drawDamage(ctx, now);
    if (me) {
      hudTransform(ctx, 0, 0);
      this._drawHealth(ctx, me);
      hudTransform(ctx, VIEW_W, 0);
      this._drawWeapon(ctx, me);
    }
    hudTransform(ctx, VIEW_W, 0);
    this._drawKillFeed(ctx, now);
    resetScreenTransform(ctx);
    this._drawCenter(ctx, now);
    if (me && me.isRespawning) this._drawDeath(ctx, now);
    this._drawHitMarker(ctx, now);
    hudTransform(ctx, VIEW_W, VIEW_H);
    this._drawStats(ctx);
    resetScreenTransform(ctx);
    this._drawConnection(ctx);
    if (typeof touchInput !== 'undefined') touchInput.draw(ctx);

    ctx.restore();
  }

  // Stick Clash health panel: heart badge + segmented capsule bar whose
  // colour follows the health left. Display only.
  _pill(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  _drawHealth(ctx, me) {
    const x = 50, y = 16, w = 104, h = 18, r = h / 2;
    const hp = Math.max(0, Math.min(100, me.health / me.maxHealth() * 100));
    // Trail eases down toward the real value after taking damage.
    this.displayHp = hp > this.displayHp ? hp : this.displayHp + (hp - this.displayHp) * 0.08;
    const now = performance.now();
    const low = hp <= 25;

    // Panel behind badge and bar.
    ctx.fillStyle = 'rgba(8,12,18,0.62)';
    this._pill(ctx, 10, 6, x + w - 2, 38, 19);
    ctx.fill();
    ctx.strokeStyle = low ? `rgba(255,90,90,${0.45 + 0.35 * Math.sin(now / 120)})` : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Heart badge.
    ctx.beginPath(); ctx.arc(30, 25, 15, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(27, 21, 2, 30, 25, 15);
    bg.addColorStop(0, '#3a4452'); bg.addColorStop(1, '#151a22');
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2; ctx.stroke();

    // Bar track, damage trail, health fill.
    ctx.save();
    this._pill(ctx, x, y, w, h, r);
    ctx.fillStyle = '#0b0f14'; ctx.fill();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,240,220,0.6)';
    ctx.fillRect(x, y, this.displayHp / 100 * w, h);
    const [c0, c1] = hp > 60 ? ['#7dea6a', '#2f9a3a'] : hp > 25 ? ['#ffd45a', '#d07a12'] : ['#ff6b5e', '#a8121a'];
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, c0); grad.addColorStop(1, c1);
    ctx.globalAlpha = low ? 0.7 + 0.3 * Math.sin(now / 120) : 1;
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, hp / 100 * w, h);
    ctx.globalAlpha = 1;
    // Gloss and 10 segments.
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, y + 2, w, h * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 1; k < 10; k++) ctx.fillRect(Math.round(x + k * w / 10), y, 1, h);
    ctx.restore();
    this._pill(ctx, x - 0.5, y - 0.5, w + 1, h + 1, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hpText = Math.max(0, Math.ceil(me.health));
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(hpText, x + w / 2 + 1, y + h / 2 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(hpText, x + w / 2, y + h / 2);
    ctx.textBaseline = 'alphabetic';
    this._drawCoins(ctx, x - 34, y + h + 26);

    me.healthbarHeart.drawCentered(ctx);
  }

  _drawWeapon(ctx, me) {
    const weapon = me.currentWeapon;
    if (!weapon || !weapon.hasPickup || !pickupAtlas.ready) return;
    const f = pickupAtlas.getFrameData(weapon.name + '_pickup', 0);
    if (!f) return;
    const x = VIEW_W - f.w - 10, y = 10;
    ctx.drawImage(pickupAtlas.image, f.x, f.y, f.w, f.h, x, y, f.w, f.h);
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const label = weapon.name.replace('_', ' ').toUpperCase();
    const tw = ctx.measureText(label).width;
    ctx.fillRect(VIEW_W - 12 - tw - 4, y + f.h + 2, tw + 8, 14);
    ctx.fillStyle = '#cfe3f7';
    ctx.fillText(label, VIEW_W - 12, y + f.h + 13);
  }

  _hueColor(h, l = 65, a = 1) {
    return h == null ? `rgba(255,255,255,${a})` : `hsla(${(h + 36) % 360},80%,${l}%,${a})`;
  }

  // Bounding box of the opaque pixels of a pickup frame (cached), so weapon
  // icons in the kill feed aren't tiny inside their padded sprite frames.
  _trimmed(f) {
    this._trimCache = this._trimCache || new Map();
    const key = `${f.x},${f.y}`;
    if (this._trimCache.has(key)) return this._trimCache.get(key);
    let r = { x: f.x, y: f.y, w: f.w, h: f.h };
    try {
      const c = document.createElement('canvas');
      c.width = f.w; c.height = f.h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(pickupAtlas.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      const d = cx.getImageData(0, 0, f.w, f.h).data;
      let x0 = f.w, y0 = f.h, x1 = -1, y1 = -1;
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        if (d[(y * f.w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 >= x0) r = { x: f.x + x0, y: f.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    } catch (e) { /* tainted canvas: use the full frame */ }
    if (pickupAtlas.image.complete) this._trimCache.set(key, r);
    return r;
  }

  _drawKillFeed(ctx, now) {
    if (!this.killFeed.length) return;
    this.killFeed = this.killFeed.filter(k => now - k.t < 6000);
    let y = 96;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const k of this.killFeed) {
      const age = (now - k.t) / 1000;
      const a = Math.min(1, Math.max(0, 6 - age)) * Math.min(1, age * 6 + 0.2);
      const weapon = Constants.WEAPON_ID_MAP[k.weaponId];
      const fr = weapon && weapon.hasPickup && pickupAtlas.ready ? pickupAtlas.getFrameData(weapon.name + '_pickup', 0) : null;
      const f = fr ? this._trimmed(fr) : null;
      const iconH = 22, iconW = f ? Math.min(56, f.w * iconH / f.h) : ctx.measureText('✊').width;
      const kw = ctx.measureText(k.killer).width, vw = ctx.measureText(k.victim).width;
      const total = kw + vw + iconW + 24;
      let x = VIEW_W - 10 - total;
      ctx.globalAlpha = a;
      ctx.fillStyle = k.mine ? 'rgba(80,30,30,0.75)' : 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 6, y - 14, total + 12, 28);
      ctx.textAlign = 'left';
      ctx.fillStyle = this._hueColor(k.killerHue);
      ctx.fillText(k.killer, x, y + 1);
      x += kw + 8;
      if (f) {
        // Light backing instead of a canvas blur (blur is slow on phones).
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x - 3, y - iconH / 2 - 2, iconW + 6, iconH + 4);
        ctx.drawImage(pickupAtlas.image, f.x, f.y, f.w, f.h, x, y - iconH / 2, iconW, iconH);
      }
      else { ctx.fillStyle = '#fff'; ctx.fillText('✊', x, y + 1); }
      x += iconW + 8;
      ctx.fillStyle = this._hueColor(k.victimHue);
      ctx.fillText(k.victim, x, y + 1);
      y += 32;
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  _drawCenter(ctx, now) {
    const m = this.centerMsg;
    if (!m) return;
    const age = now - m.t;
    if (age > m.dur) { this.centerMsg = null; return; }
    const a = Math.min(1, (m.dur - age) / 300);
    // Pop-in scale, skipped for users who asked the OS to reduce motion.
    const s = HudManager.reducedMotion ? 1 : 1 + Math.max(0, 0.25 - age / 600);
    ctx.save();
    ctx.globalAlpha = a;
    // Below the (possibly enlarged) kill feed; text grows with uiScale on phones.
    const u = display.uiScale || 1;
    const feedBottom = this.killFeed.length ? (96 + (this.killFeed.length - 1) * 32 + 14) * u : 0;
    const cy = u > 1 ? Math.max(150, feedBottom + 45 * u) : 150;
    hudTransform(ctx, VIEW_W / 2, cy);
    ctx.translate(VIEW_W / 2, cy);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.font = '900 22px system-ui, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(m.text, 0, 0);
    ctx.fillStyle = m.color;
    ctx.fillText(m.text, 0, 0);
    if (m.sub) {
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.strokeText(m.sub, 0, 24);
      ctx.fillStyle = m.subColor || '#ff8f5a';
      ctx.fillText(m.sub, 0, 24);
    }
    ctx.restore();
  }

  _drawDeath(ctx, now) {
    const since = this.deathInfo ? (now - this.deathInfo.t) / 1000 : 1;
    const a = Math.min(1, since * 3);
    ctx.save();
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = '#300';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    hudTransform(ctx, VIEW_W / 2, VIEW_H / 2 - 60);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = '900 30px system-ui, sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(t('hud.died'), VIEW_W / 2, VIEW_H / 2 - 70);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText(t('hud.died'), VIEW_W / 2, VIEW_H / 2 - 70);
    const killer = this.deathInfo && this.deathInfo.killer;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.lineWidth = 3;
    const sub = killer ? t('hud.killedBy', { name: killer }) : t('hud.respawning');
    ctx.strokeText(sub, VIEW_W / 2, VIEW_H / 2 - 44);
    ctx.fillStyle = '#eee';
    ctx.fillText(sub, VIEW_W / 2, VIEW_H / 2 - 44);
    ctx.restore();
  }

  _drawDamage(ctx, now) {
    const age = (now - this.damageAt) / 1000;
    if (age < 0.45) {
      const a = (1 - age / 0.45) * 0.45;
      const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.7);
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, `rgba(200,0,0,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // Direction arcs around the player.
    this.damageDirs = this.damageDirs.filter(d => now - d.t < 900);
    for (const d of this.damageDirs) {
      const a = 1 - (now - d.t) / 900;
      ctx.strokeStyle = `rgba(255,60,60,${a * 0.85})`;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(VIEW_W / 2, VIEW_H / 2, 70, d.angle - 0.32, d.angle + 0.32);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  _drawHitMarker(ctx, now) {
    const age = now - this.hitMarkerAt;
    if (age > 160) return;
    const a = 1 - age / 160;
    const cx = mouseScreenX, cy = mouseScreenY;
    if (cx < 0 || cy < 0) return;
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 2;
    const s = 5, g = 10;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.moveTo(cx + dx * s, cy + dy * s);
      ctx.lineTo(cx + dx * g, cy + dy * g);
    }
    ctx.stroke();
  }

  _drawStats(ctx) {
    const parts = [];
    if (settingsManager.get('showFps')) parts.push(`${this.fps} FPS`);
    if (settingsManager.get('showPing') && socketManager.isConnected && socketManager.ping != null) parts.push(`${socketManager.ping} ms`);
    if (!parts.length) return;
    const text = parts.join('  ·  ');
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(VIEW_W - tw - 16, VIEW_H - 22, tw + 10, 16);
    const p = socketManager.ping;
    ctx.fillStyle = p == null || p < 80 ? '#9fe0a8' : p < 160 ? '#ffd166' : '#ff6b6b';
    ctx.fillText(text, VIEW_W - 11, VIEW_H - 10);
  }

  _drawConnection(ctx) {
    if (!socketManager.wasConnected || socketManager.isConnected || socketManager.kicked) return;
    // Below the (possibly enlarged) timer / rank / bot-status stack.
    hudTransform(ctx, VIEW_W / 2, 0);
    const msg = t('hud.reconnecting');
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(msg).width;
    ctx.fillStyle = 'rgba(120,20,20,0.85)';
    ctx.fillRect(VIEW_W / 2 - tw / 2 - 12, 72, tw + 24, 24);
    ctx.fillStyle = '#fff';
    ctx.fillText(msg, VIEW_W / 2, 89);
  }
}

HudManager.reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

const hudManager = new HudManager();

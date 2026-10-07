// AtlasGameObject – renders sprites from an AtlasSpritesheet with animation and event support.
class AtlasGameObject {
  constructor(atlas, animName, x, y, repeatTimes = -1) {
    this.atlas = atlas;
    this.animName = animName;
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.isVisible = true;
    this.frameIndex = -1;   // starts at -1, advances to 0 on first update tick
    this.repeatTimes = repeatTimes;
    this.lastUpdated = 0;   // 0 forces an immediate first advance
    this.isShootingAnimation = false;
    this.listeners = {};

    // Exposed so callers that read spritesheetData (e.g. checkCollision) still work.
    // Override per-instance when needed.
    this.spritesheetData = null;
  }

  // ── Position / rotation ───────────────────────────────────────────────────
  setPosition(x, y) { this.x = x; this.y = y; }
  setVelocityX(speed) { this.x += speed; }
  setVelocityY(speed) { this.y += speed; }
  setRotation(radians) { this.rotation = radians; }

  // ── Animation control (mirrors GameObject API) ────────────────────────────
  // Play an animation for numTimes cycles (-1 = loop forever).
  setAnimation(name, numTimes = -1) {
    this.animName = name;
    this.frameIndex = -1;
    this.repeatTimes = numTimes;
    this.lastUpdated = 0; // force immediate first advance
  }

  // resetAnimationRepeat mirrors old GameObject.resetAnimationRepeat().
  resetAnimationRepeat(numTimes) {
    this.frameIndex = -1;
    this.repeatTimes = numTimes;
    this.lastUpdated = 0;
  }

  // resetAnimation mirrors old GameObject.resetAnimation() – resets to idle loop.
  resetAnimation() {
    this.setAnimation(this._defaultAnim || this.animName);
  }

  // ── Update ────────────────────────────────────────────────────────────────
  update() {
    if (!this.isVisible) return;
    if (this.repeatTimes !== -1 && this.repeatTimes <= 0) return;

    const anim = this.atlas.getAnimation(this.animName);
    if (!anim) {
      // Atlas failed to load: finish one-shot animations immediately so state
      // machines waiting on them (e.g. death → respawn) can't get stuck.
      if (this.atlas.failed && this.repeatTimes > 0) {
        this.repeatTimes = 0;
        this.dispatchEvent('animationcomplete', { name: this.animName });
      }
      return;
    }

    const timePerFrame = 1000 / (anim.fps || 12);
    // Monotonic clock: a wall-clock step backwards (NTP/DST) used to freeze animations.
    if (performance.now() - this.lastUpdated < timePerFrame) return;

    // Fire shotsfired when frameIndex is 0 (first displayed frame) for shooting anims.
    // Matches original GameObject behaviour (check before increment).
    if (this.frameIndex === 0 && this.isShootingAnimation) {
      this.dispatchEvent('shotsfired', { playerPos: { x: this.x, y: this.y } });
    }

    this.frameIndex++;
    if (this.frameIndex >= anim.frames.length) {
      this.frameIndex = 0;
      if (this.repeatTimes > 0) this.repeatTimes--;
      if (this.repeatTimes === 0) {
        this.dispatchEvent('animationcomplete', { name: this.animName });
      }
    }

    this.lastUpdated = performance.now();
  }

  // ── Draw helpers ──────────────────────────────────────────────────────────

  // Which in-between drawing (see Inbetween.js) to show right now, if any.
  // Read-only: frame index and timing are never touched, so animation events
  // fire exactly as before.
  _inbetween() {
    const ib = this.atlas.inbetween;
    if (!ib || !ib.enabled) return null;
    if (this.frameIndex < 0 || (this.repeatTimes !== -1 && this.repeatTimes <= 0)) return null;
    const anim = this.atlas.getAnimation(this.animName);
    if (!anim || anim.frames.length < 2) return null;
    // Last drawing of a one-shot animation: there is nothing to move towards.
    if (this.frameIndex === anim.frames.length - 1 && this.repeatTimes === 1) return null;
    const elapsed = performance.now() - this.lastUpdated;
    const k = Math.min(ib.steps - 1, Math.floor(elapsed * (anim.fps || 12) / 1000 * ib.steps));
    if (k <= 0) return null;
    return ib.lookup(anim.frames[this.frameIndex], k);
  }

  // Code-drawn sheets (Emblems: blood, heart): progress 0 → 1 through the
  // animation, smooth between frames. Read-only.
  _progress() {
    const anim = this.atlas.getAnimation(this.animName);
    const n = anim?.frames.length;
    if (!n) return 0;
    if (this.repeatTimes !== -1 && this.repeatTimes <= 0) return 1;
    if (this.frameIndex < 0) return 0;
    const between = Math.min(1, Math.max(0, (performance.now() - this.lastUpdated) * (anim.fps || 12) / 1000));
    if (this.repeatTimes === 1) {
      const last = this.frameIndex === n - 1;
      return Math.min(1, (this.frameIndex + (last ? 0 : between)) / Math.max(1, n - 1));
    }
    return Math.min(1, (this.frameIndex + between) / n);
  }

  _render(ctx, rotation, ox = 0, oy = 0) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(rotation);
    if (ox || oy) ctx.translate(ox, oy);
    this.atlas.renderer.draw(ctx, this.animName, this._progress());
    ctx.restore();
  }

  // Draw anchoring the sprite's origin point at (this.x, this.y).
  draw(ctx) {
    if (!this.isVisible) return;
    if (this.atlas.renderer) return this._render(ctx, this.rotation);
    const sub = this._inbetween();
    let img = this.atlas.image, f;
    if (sub && sub.img) {
      img = sub.img;
      f = sub.f;
    } else {
      f = this.atlas.getFrameData(this.animName, Math.max(0, this.frameIndex) + (sub && sub.next ? 1 : 0));
    }
    if (!f) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.drawImage(img, f.x, f.y, f.w, f.h,
      -f.origin.ox, -f.origin.oy, f.w, f.h);
    ctx.restore();
  }

  // Alias kept for call-site compatibility — now identical to draw().
  drawWithHeadPivot(ctx) { this.draw(ctx); }

  // Draw the frame centered on (this.x, this.y) — used for effects like blood.
  drawCentered(ctx) {
    if (!this.isVisible) return;
    if (this.atlas.renderer) return this._render(ctx, 0);
    const f = this.atlas.getFrameData(this.animName, Math.max(0, this.frameIndex));
    if (!f) return;
    // Centred on the original (untrimmed) frame size.
    ctx.drawImage(this.atlas.image, f.x, f.y, f.w, f.h,
      Math.round(this.x - f.sw / 2) + f.tx,
      Math.round(this.y - f.sh / 2) + f.ty,
      f.w, f.h);
  }

  // Draw the frame centered on (this.x, this.y) with a rotation — used for muzzle flashes.
  // offsetX/offsetY are in local (pre-rotation) space: +X = right, -Y = forward when rotation=0.
  drawCenteredRotated(ctx, rotation, offsetX = 0, offsetY = 0) {
    if (!this.isVisible) return;
    if (this.atlas.renderer) return this._render(ctx, rotation, offsetX, offsetY);
    const f = this.atlas.getFrameData(this.animName, Math.max(0, this.frameIndex));
    if (!f) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(rotation);
    ctx.drawImage(this.atlas.image, f.x, f.y, f.w, f.h, -f.sw / 2 + f.tx + offsetX, -f.sh / 2 + f.ty + offsetY, f.w, f.h);
    ctx.restore();
  }

  // ── Event system (matches GameObject) ────────────────────────────────────
  addEventListener(eventName, callback) {
    if (!this.listeners[eventName]) this.listeners[eventName] = [];
    this.listeners[eventName].push(callback);
  }

  dispatchEvent(eventName, data) {
    (this.listeners[eventName] || []).forEach(cb => cb(data));
  }
}

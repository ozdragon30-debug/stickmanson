// An animated sprite: plays a named animation of an AtlasSpritesheet
// (either frames cut from an image or a code renderer), steps it at the
// animation's fps and raises events for gameplay:
//   'shotsfired'        once per shooting animation, on its first frame
//   'animationcomplete' when a limited number of plays has run out
const clampUnit = v => (v < 0 ? 0 : v > 1 ? 1 : v);

class AtlasGameObject {
  constructor(atlas, animName, x, y, repeatTimes = -1) {
    this.atlas = atlas;
    this.animName = animName;
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.isVisible = true;
    this.frameIndex = -1;          // -1 → becomes 0 on the first tick
    this.repeatTimes = repeatTimes; // plays left; -1 = loop forever
    this.lastUpdated = 0;          // 0 → the first tick happens at once
    this.isShootingAnimation = false;
    this.listeners = {};
    this.spritesheetData = null;   // per-instance data some callers attach
  }

  // ── Placement ─────────────────────────────────────────────────────────────
  setPosition(x, y) { this.x = x; this.y = y; }
  setVelocityX(dx) { this.x += dx; }
  setVelocityY(dy) { this.y += dy; }
  setRotation(radians) { this.rotation = radians; }

  // ── Playback ──────────────────────────────────────────────────────────────
  setAnimation(name, plays = -1) {
    this.animName = name;
    this.resetAnimationRepeat(plays);
  }

  resetAnimationRepeat(plays) {
    this.frameIndex = -1;
    this.repeatTimes = plays;
    this.lastUpdated = 0;
  }

  // Back to the default (idle) loop.
  resetAnimation() {
    this.setAnimation(this._defaultAnim || this.animName);
  }

  get _finished() { return this.repeatTimes !== -1 && this.repeatTimes <= 0; }

  update() {
    if (!this.isVisible || this._finished) return;
    const anim = this.atlas.getAnimation(this.animName);
    if (!anim) {
      // Atlas failed to load: end limited animations right away, so whatever
      // waits for them (death → respawn) can't hang.
      if (this.atlas.failed && this.repeatTimes > 0) {
        this.repeatTimes = 0;
        this.dispatchEvent('animationcomplete', { name: this.animName });
      }
      return;
    }
    const frameMs = 1000 / (anim.fps || 12);
    if (performance.now() - this.lastUpdated < frameMs) return;

    // The shot happens when the first frame of a shooting animation is left.
    if (this.isShootingAnimation && this.frameIndex === 0) {
      this.dispatchEvent('shotsfired', { playerPos: { x: this.x, y: this.y } });
    }
    if (++this.frameIndex >= anim.frames.length) {
      this.frameIndex = 0;
      if (this.repeatTimes > 0) this.repeatTimes--;
      if (this.repeatTimes === 0) this.dispatchEvent('animationcomplete', { name: this.animName });
    }
    this.lastUpdated = performance.now();
  }

  // How far through the animation we are, 0 → 1, smooth between frames (for
  // code-drawn atlases). Read-only: never touches the frame clock.
  _progress() {
    const anim = this.atlas.getAnimation(this.animName);
    const n = anim?.frames.length;
    if (!n) return 0;
    if (this._finished) return 1;
    if (this.frameIndex < 0) return 0;
    const between = clampUnit((performance.now() - this.lastUpdated) * (anim.fps || 12) / 1000);
    // A one-shot animation ends at p = 1 on its last frame; loops wrap.
    if (this.repeatTimes === 1) {
      const last = this.frameIndex === n - 1;
      return Math.min(1, (this.frameIndex + (last ? 0 : between)) / Math.max(1, n - 1));
    }
    return Math.min(1, (this.frameIndex + between) / n);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  _frame() {
    return this.atlas.getFrameData(this.animName, Math.max(0, this.frameIndex));
  }

  _render(ctx, rotation, ox = 0, oy = 0) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(rotation);
    if (ox || oy) ctx.translate(ox, oy);
    this.atlas.renderer.draw(ctx, this.animName, this._progress());
    ctx.restore();
  }

  // Anchored at the frame's origin point (the head for characters).
  draw(ctx) {
    if (!this.isVisible) return;
    if (this.atlas.renderer) return this._render(ctx, this.rotation);
    const f = this._frame();
    if (!f) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.drawImage(this.atlas.image, f.x, f.y, f.w, f.h, -f.origin.ox, -f.origin.oy, f.w, f.h);
    ctx.restore();
  }

  drawWithHeadPivot(ctx) { this.draw(ctx); }

  // Centred on (x, y), unrotated (hit splats).
  drawCentered(ctx) {
    if (!this.isVisible) return;
    if (this.atlas.renderer) return this._render(ctx, 0);
    const f = this._frame();
    if (!f) return;
    ctx.drawImage(this.atlas.image, f.x, f.y, f.w, f.h,
      Math.round(this.x - f.sw / 2) + f.tx, Math.round(this.y - f.sh / 2) + f.ty, f.w, f.h);
  }

  // Centred and rotated (shot effects); the offset is in the rotated frame.
  drawCenteredRotated(ctx, rotation, ox = 0, oy = 0) {
    if (!this.isVisible) return;
    if (this.atlas.renderer) return this._render(ctx, rotation, ox, oy);
    const f = this._frame();
    if (!f) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(rotation);
    ctx.drawImage(this.atlas.image, f.x, f.y, f.w, f.h, -f.sw / 2 + f.tx + ox, -f.sh / 2 + f.ty + oy, f.w, f.h);
    ctx.restore();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  addEventListener(name, fn) {
    (this.listeners[name] || (this.listeners[name] = [])).push(fn);
  }

  dispatchEvent(name, data) {
    for (const fn of (this.listeners[name] || []).slice()) fn(data);
  }
}

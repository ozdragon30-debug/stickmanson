const canvas = document.getElementById("canvas");
// Opaque canvas: the page compositor can skip blending it (the game always
// paints every pixel).
const ctx = canvas.getContext("2d", { alpha: false });

// World zoom: the original 960×720 canvas rendered the 800×600 Flash stage at 1.2×.
const scaleFactor = Math.min(VIEW_W / 800, VIEW_H / 600);
// Logical px per world unit, including the wide-screen zoom (display.zoom).
function worldScale() { return scaleFactor * display.zoom; }
let debugTiles = false;  // toggle with !debug command

const map = new MapLoader();
let obstacleGrid = [];


const TILE = 50; // world units per map tile

// Tile codes are parsed once per map instead of for every tile, every frame.
const EMPTY_TILE = { code: '000000', tileType: '000', rot: 0, flip: 0, cVal: 0 };
function parsedTiles() {
  if (map._parsedFor !== map.tiles) {
    map._parsed = map.tiles.map(raw => {
      const code = (raw || '000000').toUpperCase();
      return {
        code,
        tileType: code.slice(0, 3),
        rot:  parseInt(code[3] || '0', 10) % 4,  // 0-3 → 0/90/180/270°
        flip: parseInt(code[4] || '0', 10) % 4,  // 0=none,1=H,2=V,3=H+V
        cVal: parseInt(code[5] || '0', 10),
      };
    });
    map._parsedFor = map.tiles;
  }
  return map._parsed;
}

function isAnimatedTile(tileType) {
  const a = mapAtlas.tileAnimations[tileType];
  return !!(a && a.frames.length > 1);
}

// Draws one tile in world coordinates. `seam` overdraws by ~1 device pixel so
// anti-aliased edges at non-integer scales leave no hairline gaps.
function drawTile(c, cell, x, y, nowMs, seam) {
  const f = mapAtlas.getAnimatedMapTileFrame(cell.tileType, nowMs);
  if (!f) return;
  const half = TILE / 2;
  c.save();
  c.translate(x * TILE + half, y * TILE + half);
  c.rotate(cell.rot * Math.PI / 2);
  if (cell.flip !== 0) {
    c.scale((cell.flip === 1 || cell.flip === 3) ? -1 : 1, (cell.flip === 2 || cell.flip === 3) ? -1 : 1);
  }
  c.drawImage(mapAtlas.image, f.x, f.y, f.w, f.h, -half - seam / 2, -half - seam / 2, TILE + seam, TILE + seam);
  c.restore();
}

// The static part of the map is rendered once into 8×8-tile chunks; a frame
// then draws a handful of chunk images plus the animated tiles, instead of
// ~250 individually transformed tiles (the single biggest per-frame cost).
const mapCache = {
  CHUNK: 8,
  _chunks: new Map(), // "cx,cy" → { canvas, animated: [[x, y], …] }
  _for: null,
  _res: 0,
  _smooth: null,

  draw(c, x0, x1, y0, y1, nowMs) {
    const res = Math.min(2.5, display.scale * worldScale()); // chunk pixels per world unit
    const smooth = !settingsManager.get('pixelArt');
    if (this._for !== map.tiles || this._res !== res || this._smooth !== smooth || this._bg !== map.bgImage) {
      this._bg = map.bgImage;
      this._chunks.clear();
      this._for = map.tiles; this._res = res; this._smooth = smooth;
    }
    const C = this.CHUNK, size = C * TILE;
    const seam = 1 / (display.scale * worldScale());
    const cx0 = Math.floor(x0 / C), cx1 = Math.floor((x1 - 1) / C);
    const cy0 = Math.floor(y0 / C), cy1 = Math.floor((y1 - 1) / C);
    const visible = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cx + ',' + cy;
        let chunk = this._chunks.get(key);
        if (chunk) this._chunks.delete(key);    // re-insert: most recently used last
        else chunk = this._build(cx, cy, res, smooth);
        this._chunks.set(key, chunk);
        c.drawImage(chunk.canvas, cx * size, cy * size, size + seam, size + seam);
        visible.push(chunk);
      }
    }
    // Animated tiles (water, lights…) on top, every frame.
    const parsed = parsedTiles();
    for (const chunk of visible) {
      for (const [x, y] of chunk.animated) {
        if (x >= x0 && x < x1 && y >= y0 && y < y1) drawTile(c, parsed[y * map.width + x], x, y, nowMs, seam);
      }
    }
    // Keep at most ~80 MB of chunk images (but always every visible chunk).
    const perChunk = Math.pow(Math.ceil(size * res), 2) * 4;
    const max = Math.max(visible.length + 4, Math.floor(80e6 / perChunk));
    while (this._chunks.size > max) this._chunks.delete(this._chunks.keys().next().value);
  },

  _build(cx, cy, res, smooth) {
    const C = this.CHUNK, size = C * TILE;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.ceil(size * res);
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = smooth;
    c.imageSmoothingQuality = 'high';
    c.setTransform(res, 0, 0, res, -cx * size * res, -cy * size * res);
    const parsed = parsedTiles();
    if (map.bgImage) return this._buildFromBackground(c, cx, cy, canvas, parsed);
    const animated = [], outside = [];
    for (let y = cy * C; y < (cy + 1) * C; y++) {
      for (let x = cx * C; x < (cx + 1) * C; x++) {
        const inside = x >= 0 && y >= 0 && x < map.width && y < map.height;
        if (!inside) {
          // Beyond the map edge: continue the nearest edge tile, darkened, so
          // wide screens never show an empty void (decor only: nothing can
          // go there — the map's own walls still bound it).
          const ex = Math.min(map.width - 1, Math.max(0, x)), ey = Math.min(map.height - 1, Math.max(0, y));
          drawTile(c, parsed[ey * map.width + ex] || EMPTY_TILE, x, y, 0, 1 / res);
          outside.push([x, y]);
          continue;
        }
        const cell = parsed[y * map.width + x] || EMPTY_TILE;
        if (isAnimatedTile(cell.tileType)) animated.push([x, y]);
        else drawTile(c, cell, x, y, 0, 1 / res);
      }
    }
    c.fillStyle = 'rgba(4,8,14,0.62)';
    for (const [x, y] of outside) c.fillRect(x * TILE - 0.5, y * TILE - 0.5, TILE + 1, TILE + 1);
    return { canvas, animated };
  },

  // Painted maps: the chunk is a piece of the background picture (which also
  // covers a few tiles of surroundings); animated tiles still go on top.
  _buildFromBackground(c, cx, cy, canvas, parsed) {
    const C = this.CHUNK, size = C * TILE;
    const img = map.bgImage, k = map.bgPx / TILE, pad = map.bgPad * map.bgPx;
    // Source rectangle, clipped to the picture.
    let sx = cx * size * k + pad, sy = cy * size * k + pad, sw = size * k, sh = size * k;
    let dx = cx * size, dy = cy * size, dw = size, dh = size;
    if (sx < 0) { dx -= sx / k; dw += sx / k; sw += sx; sx = 0; }
    if (sy < 0) { dy -= sy / k; dh += sy / k; sh += sy; sy = 0; }
    if (sx + sw > img.width) { const cut = sx + sw - img.width; sw -= cut; dw -= cut / k; }
    if (sy + sh > img.height) { const cut = sy + sh - img.height; sh -= cut; dh -= cut / k; }
    if (sw > 0 && sh > 0) c.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    const animated = [];
    for (let y = Math.max(0, cy * C); y < Math.min(map.height, (cy + 1) * C); y++) {
      for (let x = Math.max(0, cx * C); x < Math.min(map.width, (cx + 1) * C); x++) {
        const cell = parsed[y * map.width + x];
        if (cell && isAnimatedTile(cell.tileType)) animated.push([x, y]);
      }
    }
    return { canvas, animated };
  },
};

// Draws the map tiles visible in the logical view rectangle (the 4:3 area by
// default; wider/taller when the screen is filled).
const OUTSIDE_TILES = 24; // how far past the map edge the decorative fill goes
function drawMap(nowMs, viewX0 = 0, viewX1 = VIEW_W, viewY0 = 0, viewY1 = VIEW_H) {
  if (!mapAtlas.ready || !map.ready) return;
  const mapWidth = map.width;
  const mapHeight = map.height;
  const tileView = TILE * worldScale(); // logical px per tile

  // Debug view stays within the map; the normal view also fills around it.
  const pad = debugTiles ? 0 : OUTSIDE_TILES;
  const startX = Math.max(-pad, Math.floor((camera.x + viewX0) / tileView));
  const startY = Math.max(-pad, Math.floor((camera.y + viewY0) / tileView));
  const endX = Math.min(mapWidth + pad, Math.floor((camera.x + viewX1) / tileView) + 1);
  const endY = Math.min(mapHeight + pad, Math.floor((camera.y + viewY1) / tileView) + 1);
  if (endX <= startX || endY <= startY) return;

  if (!debugTiles) {
    mapCache.draw(ctx, startX, endX, startY, endY, nowMs);
    return;
  }

  // Debug view (!debug): per-tile drawing with collision overlays and labels.
  const tileSize = TILE;
  const seam = 1 / (display.scale * worldScale());
  const parsed = parsedTiles();
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const cell = parsed[y * mapWidth + x] || EMPTY_TILE;
      const { code, rot, flip, cVal } = cell;
      drawTile(ctx, cell, x, y, nowMs, seam);
      const half = tileSize / 2;
      const cx = x * tileSize + half;
      const cy = y * tileSize + half;
      {
        // Collision overlay — draw the ColX sprite at 50% opacity with the same
        // rotation/flip as the tile so the blocked zone transforms correctly.
        const colFrame = mapAtlas.getMapTileFrame(`Col${cVal}`);
        if (colFrame && colFrame.w > 1) {
          // Col sprites are authored at 52 px; scale their dimensions proportionally
          // so partial shapes (e.g. Col6 = 52×26 = top half) stay true to their area.
          const COL_BASE = 52;
          const dstW = (colFrame.w / COL_BASE) * tileSize;
          const dstH = (colFrame.h / COL_BASE) * tileSize;
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.translate(cx, cy);
          ctx.rotate(rot * Math.PI / 2);
          if (flip !== 0) {
            ctx.scale(
              (flip === 1 || flip === 3) ? -1 : 1,
              (flip === 2 || flip === 3) ? -1 : 1
            );
          }
          ctx.drawImage(mapAtlas.image, colFrame.x, colFrame.y, colFrame.w, colFrame.h, -half, -half, dstW, dstH);
          ctx.restore();
        }
        // Tile border
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x * tileSize + 0.25, y * tileSize + 0.25, tileSize - 0.5, tileSize - 0.5);
        // Tile code label
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x * tileSize + 1, y * tileSize + 1, 34, 20);
        ctx.fillStyle = '#fff';
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(code, x * tileSize + 3, y * tileSize + 8);
        ctx.fillStyle = '#adf';
        ctx.fillText(`${x},${y}`, x * tileSize + 3, y * tileSize + 17);
      }
    }
  }
}

// Bot matches pause while a menu is open (they run locally, also when
// connected to an empty server); real online matches can't pause.
function isOfflinePaused() {
  return botManager.active && isUiBlocking();
}

function update(dt) {
  playerManager.updatePlayers();
  pickupManager.update();
  if (!isOfflinePaused()) botManager.update(dt);
}

function drawCursor() {
  if (!cursorAtlas.ready) return;
  if (inputMode.mode === 'touch' || isUiBlocking()) return;
  if (inputMode.mode === 'mouse' && !mouseInView) return;
  const names = cursorAtlas.animationNames;
  if (!names.length) return;
  const animName = names[settingsManager.cursorIndex % names.length];
  const f = cursorAtlas.getFrameData(animName, 0);
  if (!f) return;
  ctx.save();
  resetScreenTransform(ctx);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cursorAtlas.image, f.x, f.y, f.w, f.h,
    Math.round(mouseScreenX - f.w / 2),
    Math.round(mouseScreenY - f.h / 2),
    f.w, f.h);
  ctx.restore();
}

function draw(nowMs) {
  const ex = display.extraX, ey = display.extraY, ws = worldScale();
  resetScreenTransform(ctx);
  ctx.fillStyle = "#000";
  ctx.fillRect(-ex, -ey, VIEW_W + 2 * ex, VIEW_H + 2 * ey);
  ctx.translate(-camera.x, -camera.y);
  ctx.scale(ws, ws);

  ctx.imageSmoothingEnabled = !settingsManager.get('pixelArt');

  drawMap(nowMs, -ex, VIEW_W + ex, -ey, VIEW_H + ey);
  ctx.save();
  if (display.mode === 'classic' && ex > 0) {
    // Classic mode: margins show the map only, dimmed; everything else is
    // clipped to the original 4:3 view.
    resetScreenTransform(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-ex, 0, ex, VIEW_H);
    ctx.fillRect(VIEW_W, 0, ex, VIEW_H);
    ctx.fillStyle = 'rgba(143,166,191,0.25)';
    ctx.fillRect(-1, 0, 1, VIEW_H);
    ctx.fillRect(VIEW_W, 0, 1, VIEW_H);
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    ctx.translate(-camera.x, -camera.y);
    ctx.scale(ws, ws);
  }
  pickupManager.draw(ctx);
  playerManager.drawPlayers(ctx);
  if (debugTiles) drawDebugHitshape(ctx);
  ctx.restore();
  hudManager.draw(ctx);
  scoreboardManager.draw(ctx, canvas);
  // Chat history would draw over the scoreboard; keep it while typing.
  if (!scoreboardManager.isVisible || chatManager.isOpen) chatManager.draw(ctx, canvas);
  drawCursor();
}

// Draws the main player's weapon hitshape in world space.
function drawDebugHitshape(ctx) {
  const player = playerManager.mainPlayer;
  if (!player || player.isRespawning) return;

  const origin   = player.getPosition();          // {x, y, rotation}
  const rotation = origin.rotation - (90 * Constants.TO_RADIANS); // strip sprite +90° offset
  const weapon   = player.currentWeapon;
  const hitShape = weapon.hitShape ?? { type: 'rect' };
  const radius   = Constants.STICK_FIGURE_HEAD_RADIUS;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,0,0.85)';
  ctx.fillStyle   = 'rgba(255,255,0,0.15)';
  ctx.lineWidth   = 1.5;

  if (hitShape.type === 'ray') {
    const ex = origin.x + Math.cos(rotation) * hitShape.maxRange;
    const ey = origin.y + Math.sin(rotation) * hitShape.maxRange;
    // Ray line
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Width corridor (±radius)
    const nx = -Math.sin(rotation) * radius;
    const ny =  Math.cos(rotation) * radius;
    ctx.beginPath();
    ctx.moveTo(origin.x + nx, origin.y + ny);
    ctx.lineTo(ex + nx, ey + ny);
    ctx.moveTo(origin.x - nx, origin.y - ny);
    ctx.lineTo(ex - nx, ey - ny);
    ctx.stroke();

  } else if (hitShape.type === 'cone') {
    const halfAngle = (hitShape.spreadAngle * Math.PI / 180) / 2;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.arc(origin.x, origin.y, hitShape.maxRange, rotation - halfAngle, rotation + halfAngle);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

  } else if (hitShape.type === 'circle') {
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, hitShape.maxRange, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

  } else {
    // rect — reconstruct the rotated hitbox from offsets
    const { hitboxOffsets } = player.body.spritesheetData;
    const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map(k => {
      const off = hitboxOffsets[k];
      return Physics.rotatePoint(origin.x, origin.y, origin.x + off.x, origin.y + off.y, rotation);
    });
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

let lastTime = 0;
let _loopErrors = 0;
// Frame-rate cap (Settings → Video). All movement and timers use real elapsed
// time, so a cap never changes game speed.
//   auto (default): the monitor's refresh rate (60/120/144 Hz…); if the device
//     keeps missing frames, lower the render resolution step by step, then
//     settle on a steady 60 fps — a stable 60 looks smoother than 80–120 jitter.
//   unlimited: always the refresh rate.   240/144/120/60/30: fixed caps.
let _frameInterval = 0;  // ms between rendered frames; 0 = every display refresh
let _nextFrameAt = 0;
let _fpsMode = 'auto';
function setFpsLimit(v) {
  _fpsMode = (v === 'off' || v === undefined) ? 'auto' : v;  // 'off' = old default
  const n = parseInt(_fpsMode, 10);
  _frameInterval = n > 0 ? 1000 / n : 0;
  _nextFrameAt = 0;
  pacer.reset();
}

const pacer = {
  _gaps: [],
  _start: 0,
  refresh: 1000 / 60,   // estimated display refresh interval (ms)
  _refreshSeen: Infinity,
  autoCapped: false,

  reset() { this._gaps.length = 0; this._start = 0; this.autoCapped = false; this._stepped = false; },

  // Called with the time between two rendered frames.
  sample(nowMs, gap) {
    if (_fpsMode !== 'auto' || document.hidden || gap <= 0 || gap > 250) return;
    if (!this._start) this._start = nowMs;
    this._gaps.push(gap);
    if (nowMs - this._start < 2000 || this._gaps.length < 30) return;
    const g = this._gaps.sort((a, b) => a - b);
    // Fastest frames show the display's refresh interval.
    this._refreshSeen = Math.min(this._refreshSeen, g[Math.floor(g.length * 0.1)]);
    this.refresh = this._refreshSeen;
    const median = g[Math.floor(g.length / 2)];
    this._gaps.length = 0;
    this._start = 0;
    const target = Math.max(this.refresh, _frameInterval);
    if (median <= target * 1.25) return;
    // Missing frames. On a fast (120 Hz+) screen: one resolution step, then a
    // steady 60 fps (sharper than dropping resolution further); after that,
    // or on a 60 Hz screen, fewer pixels step by step.
    if (this.refresh < 13 && !this.autoCapped) {
      if (!this._stepped && display.stepDown()) { this._stepped = true; return; }
      this.autoCapped = true;
      _frameInterval = 1000 / 60;
      console.info('[pacer] device can\'t hold ' + Math.round(1000 / this.refresh) + ' fps — steady 60 fps');
      return;
    }
    display.stepDown();
  },
};

function loop(nowMs) {
  // Schedule the next frame first: an exception in one frame used to stop the
  // rAF chain and freeze the game permanently.
  requestAnimationFrame(loop);
  if (_frameInterval) {
    // 1 ms of slack so a 120 cap on a 120 Hz screen never drops refreshes.
    if (nowMs < _nextFrameAt - 1) return;
    _nextFrameAt = Math.max(_nextFrameAt + _frameInterval, nowMs - _frameInterval);
  }
  try {
    frame(nowMs);
  } catch (err) {
    // A throw between save()/restore() leaves canvas state unbalanced: reset it.
    if (ctx.reset) ctx.reset();
    if (_loopErrors++ < 3) {
      console.error('[game] frame error (game keeps running):', err);
      if (typeof chatManager !== 'undefined') chatManager.addMessage('Server', 'Something went wrong — the game recovered. Reload if it misbehaves.', null);
    }
  }
}

function frame(nowMs) {
  if (!lastTime) lastTime = nowMs;
  pacer.sample(nowMs, nowMs - lastTime);
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);  // seconds; capped to avoid spiral after tab switch
  lastTime = nowMs;

  // Input is applied before update/draw so the frame on screen reflects it
  // (previously movement was applied after drawing: one frame of extra lag).
  gamepadInput.poll();
  touchInput.update();
  if (!isOfflinePaused()) {
    keyEvents(dt);
    mouseEvents();
  }
  update(dt);
  draw(nowMs);
  hudManager.tickFps(nowMs);
  if (!menu.isOpen && !document.hidden) statsManager.tick(dt);
}

document.addEventListener("keydown", keyDownHandler);
document.addEventListener("keyup", keyUpHandler);
// 'blur' only fires on window (not document); previously keys stayed stuck after Alt+Tab.
window.addEventListener("blur", onBlurHandler);
document.addEventListener("visibilitychange", () => { if (document.hidden) onBlurHandler(); });
window.addEventListener("pointermove", mouseMoveHandler);
canvas.addEventListener("pointerdown", onMouseDown);
window.addEventListener("pointerup", onMouseUp);
canvas.addEventListener("dragstart", e => e.preventDefault());
canvas.addEventListener("contextmenu", e => e.preventDefault());

// Global shortcuts that work outside the chat box.
document.addEventListener("keydown", e => {
  if (chatManager.isOpen || e.repeat) return;
  if (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  if (e.code === 'KeyM' && !Object.values(settingsManager.settings.keybinds).includes('KeyM')) {
    settingsManager.set('muted', !settingsManager.get('muted'));
    hudManager.flash(settingsManager.get('muted') ? t('hud.soundOff') : t('hud.soundOn'), null, '#cfe3f7', 900);
  }
});

// Apply presentation settings now and whenever they change.
settingsManager.onChange((key, value) => {
  if (key === 'volume') soundManager.setVolume(value);
  else if (key === 'muted') soundManager.setMuted(value);
  else if (key === 'spatialAudio') soundManager.setSpatial(value);
  else if (key === 'renderQuality') display.setQuality(value);
  else if (key === 'viewMode') display.setViewMode(value);
  else if (key === 'fpsLimit') setFpsLimit(value);
  else if (key === 'pixelArt') document.body.classList.toggle('pixel-art', !!value);
  else if (key === 'touchControls') updateTouchControls();
  else if (key === 'language') {
    i18n.setLanguage(value);
    if (menu._ready) menu.playBtn.textContent = t('menu.play');
    menu._renderRecentRooms();
    menu.labelMaps();
    if (settingsManager.isOpen()) settingsManager._refresh();
  }
});

function updateTouchControls() {
  const pref = settingsManager.get('touchControls');
  touchInput.setEnabled(pref === 'on' || (pref === 'auto' && inputMode.mode === 'touch'));
}
inputMode.onChange(updateTouchControls);

// Warm up the Web Audio cache with every sound the game can play.
Constants._weaponsReady.then(() => {
  const names = new Set(['kill', 'win', 'lose', 'join_lobby', 'position_first', 'position_change', 'btn_chat', ...Constants.DEATH_SOUNDS]);
  for (const w of Object.values(Constants.WEAPON_ID_MAP)) {
    (w.shootSounds || [w.name + '_shoot']).forEach(n => names.add(n));
    if (w.impactSound) names.add(w.impactSound);
    if (w.hasPickup) names.add(w.name + '_pickup');
  }
  const preload = () => soundManager.preload([...names]);
  // Decoding needs an AudioContext, which needs a user gesture.
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, preload, { once: true, capture: true });
});


setFpsLimit(settingsManager.get('fpsLimit'));
display.setViewMode(settingsManager.get('viewMode'));

let loopStarted = false;

// Kick off the offline-mode timer.  Must be after all managers are defined.
botManager.init();
// All scripts have run: now it is safe to receive server events.
if (socketManager.socket) socketManager.socket.connect();

// Resolves true once the map is live, false if it failed to load (callers may
// retry with another map; e.g. offline with only some maps cached).
let currentMapFile = null;
let _mapLoadGen = 0;
function loadMap(filename) {
  // Parse into a fresh loader and only apply it if no newer loadMap() started
  // meanwhile: otherwise whichever fetch finished last would win, leaving the
  // world on a different map than the round/server.
  const gen = ++_mapLoadGen;
  const next = new MapLoader();
  return next.load('data/maps/' + filename).then(() => {
    if (gen !== _mapLoadGen) return false;
    Object.assign(map, next);
    if (currentMapFile !== filename && !menu.isOpen) hudManager.showMapTitle(map.name);
    currentMapFile = filename;
    obstacleGrid = map.collisionMap;
    pickupManager.initFromMap(map.weaponSpawns);
    // Tell the server about this map's pickup layout so it can sync state.
    socketManager.emit('mapLoaded', {
      weaponSpawns: map.weaponSpawns.map(ws => ({ weaponId: ws.weaponId, respawnTime: ws.respawnTime })),
    });
    if (!loopStarted) {
      playerManager.createMainPlayer(map.spawnPoints);
      loopStarted = true;
      // Must go through rAF: calling loop() directly passed an undefined timestamp,
      // making the first frame's dt NaN (and the player's position NaN if a key was held).
      requestAnimationFrame(loop);
      menu.setReady();
    }
    return true;
  }).catch(err => { console.error('Failed to load map:', err); return false; });
}

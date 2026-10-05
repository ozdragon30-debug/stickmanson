const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// World zoom: the original 960×720 canvas rendered the 800×600 Flash stage at 1.2×.
const scaleFactor = Math.min(VIEW_W / 800, VIEW_H / 600);
let debugTiles = false;  // toggle with !debug command

const map = new MapLoader();
let obstacleGrid = [];


function drawMap(nowMs) {
  if (!mapAtlas.ready || !map.ready) return;

  const tileSize = 50;
  const mapWidth = map.width;
  const mapHeight = map.height;

  const startX = Math.max(0, Math.floor(camera.x / (tileSize * scaleFactor)));
  const startY = Math.max(0, Math.floor(camera.y / (tileSize * scaleFactor)));

  const endX = Math.min(mapWidth, startX + Math.ceil(VIEW_W / (tileSize * scaleFactor)) + 1);
  const endY = Math.min(mapHeight, startY + Math.ceil(VIEW_H / (tileSize * scaleFactor)) + 1);

  // At non-integer render scales, anti-aliased tile edges leave hairline seams
  // between neighbouring tiles. Overdraw each tile by ~1 device pixel to hide them.
  const seam = 1 / (display.scale * scaleFactor);

  // Tile codes are parsed once per map instead of for every tile, every frame.
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
  const EMPTY = { code: '000000', tileType: '000', rot: 0, flip: 0, cVal: 0 };

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const { code, tileType, rot, flip, cVal } = map._parsed[y * mapWidth + x] || EMPTY;

      const f = mapAtlas.getAnimatedMapTileFrame(tileType, nowMs);
      if (!f) continue;

      const half = tileSize / 2;
      const cx = x * tileSize + half;  // tile centre in world coords
      const cy = y * tileSize + half;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot * Math.PI / 2);
      if (flip !== 0) {
        ctx.scale(
          (flip === 1 || flip === 3) ? -1 : 1,
          (flip === 2 || flip === 3) ? -1 : 1
        );
      }
      ctx.drawImage(mapAtlas.image, f.x, f.y, f.w, f.h, -half - seam / 2, -half - seam / 2, tileSize + seam, tileSize + seam);
      ctx.restore();

      if (debugTiles) {
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

// Offline bot matches pause while a menu is open (online matches can't pause).
function isOfflinePaused() {
  return botManager.active && !socketManager.isConnected && isUiBlocking();
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
  const names = Object.keys(cursorAtlas.animationMap);
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
  resetScreenTransform(ctx);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.translate(-camera.x, -camera.y);
  ctx.scale(scaleFactor, scaleFactor);

  ctx.imageSmoothingEnabled = !settingsManager.get('pixelArt');

  drawMap(nowMs);
  pickupManager.draw(ctx);
  playerManager.drawPlayers(ctx);
  if (debugTiles) drawDebugHitshape(ctx);
  hudManager.draw(ctx);
  scoreboardManager.draw(ctx, canvas);
  chatManager.draw(ctx, canvas);
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
function loop(nowMs) {
  if (!lastTime) lastTime = nowMs;
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
  requestAnimationFrame(loop);
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
  else if (key === 'pixelArt') document.body.classList.toggle('pixel-art', !!value);
  else if (key === 'touchControls') updateTouchControls();
  else if (key === 'language') {
    i18n.setLanguage(value);
    if (menu._ready) menu.playBtn.textContent = t('menu.play');
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


let loopStarted = false;

// Kick off the offline-mode timer.  Must be after all managers are defined.
botManager.init();

// Resolves true once the map is live, false if it failed to load (callers may
// retry with another map; e.g. offline with only some maps cached).
let currentMapFile = null;
function loadMap(filename) {
  return map.load('data/maps/' + filename).then(() => {
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

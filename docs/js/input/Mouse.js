// Mouse aiming / shooting. Coordinates are converted from CSS pixels to the
// fixed 960×720 logical view, so aim is identical at any window size or DPI.

// Screen-space mouse position in logical view pixels (used for cursor rendering).
let mouseScreenX = -100;
let mouseScreenY = -100;
let mouseInView  = false;

function aimAtViewPoint(vx, vy) {
  if (!playerManager.mainPlayer || playerManager.mainPlayer.isRespawning) return;
  // The main player is always drawn at the centre of the view.
  const spriteRotation = Math.atan2(vy - VIEW_H / 2, vx - VIEW_W / 2) + (90 * Constants.TO_RADIANS);
  playerManager.mainPlayer.body.setRotation(spriteRotation);
}

// Pointer Events are used (not mouse events) so the compatibility mouse events
// browsers synthesise after a touch don't flip the game into mouse mode.
function mouseMoveHandler(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  syncMouseButtons(event);
  const p = display.toView(event.clientX, event.clientY);
  mouseScreenX = p.x;
  mouseScreenY = p.y;
  mouseInView  = p.x >= -display.extraX && p.y >= 0 && p.x <= VIEW_W + display.extraX && p.y <= VIEW_H;
  if (typeof inputMode !== 'undefined') inputMode.set('mouse');
  if (isUiBlocking()) return;
  aimAtViewPoint(p.x, p.y);
}

let mouseLMBDown = false;

function onMouseDown(event) {
  if (event.pointerType && event.pointerType !== 'mouse') {
    // A touch landed on the canvas (touch layer not active yet): hand it over.
    if (typeof touchInput !== 'undefined') {
      inputMode.set('touch');
      if (typeof updateTouchControls === 'function') updateTouchControls();
      if (touchInput.enabled) touchInput._down(event);
    }
    return;
  }
  if (event.button !== Constants.LEFT_MOUSE_BUTTON) return;
  if (isUiBlocking()) return;
  mouseLMBDown = true;
}

// Pointer events only report the first press / last release of a button chord,
// so the left-button state is re-derived from the buttons bitmask.
function syncMouseButtons(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  if (mouseLMBDown && !(event.buttons & 1)) mouseLMBDown = false;
}

// Listened for on window: releasing the button outside the canvas used to leave
// the weapon firing forever.
function onMouseUp(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  if (event.button === Constants.LEFT_MOUSE_BUTTON || !(event.buttons & 1)) mouseLMBDown = false;
}

function mouseEvents() {
  if (!playerManager.mainPlayer) return;
  if (!mouseLMBDown) return;
  if (isUiBlocking()) { mouseLMBDown = false; return; }
  if (!playerManager.mainPlayer.canShoot || playerManager.mainPlayer.isRespawning) return;
  playerManager.mainPlayer.shoot();
}

// True while a menu/overlay owns input (settings panel, start menu, …).
function isUiBlocking() {
  if (typeof settingsManager !== 'undefined' && settingsManager.isOpen()) return true;
  if (typeof menu !== 'undefined' && menu.isOpen) return true;
  return false;
}

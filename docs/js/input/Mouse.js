// Mouse aiming and firing. Pointer positions are converted to the logical
// view (960×720 plus any wide-screen margin), so aim is the same at every
// window size and pixel density. Pointer Events are used so the fake mouse
// events browsers send after a touch never switch the game to mouse mode.

let mouseScreenX = -100;     // cursor in logical view pixels (for drawing it)
let mouseScreenY = -100;
let mouseInView = false;
let mouseLMBDown = false;

const isMousePointer = e => !e.pointerType || e.pointerType === 'mouse';

// True while a menu or panel owns the input.
function isUiBlocking() {
  return (typeof settingsManager !== 'undefined' && settingsManager.isOpen()) ||
         (typeof menu !== 'undefined' && !!menu.isOpen);
}

// The local player is always drawn at the view centre: face the given point.
function aimAtViewPoint(vx, vy) {
  const me = playerManager.mainPlayer;
  if (!me || me.isRespawning) return;
  const facing = Math.atan2(vy - VIEW_H / 2, vx - VIEW_W / 2);
  me.body.setRotation(facing + 90 * Constants.TO_RADIANS);   // sprites face up
}

function mouseMoveHandler(e) {
  if (!isMousePointer(e)) return;
  syncMouseButtons(e);
  const p = display.toView(e.clientX, e.clientY);
  mouseScreenX = p.x;
  mouseScreenY = p.y;
  const mx = display.extraX, my = display.extraY;
  mouseInView = p.x >= -mx && p.y >= -my && p.x <= VIEW_W + mx && p.y <= VIEW_H + my;
  if (typeof inputMode !== 'undefined') inputMode.set('mouse');
  if (!isUiBlocking()) aimAtViewPoint(p.x, p.y);
}

function onMouseDown(e) {
  if (!isMousePointer(e)) {
    // A finger on the canvas before the touch layer took over: hand it on.
    if (typeof touchInput !== 'undefined') {
      inputMode.set('touch');
      if (typeof updateTouchControls === 'function') updateTouchControls();
      if (touchInput.enabled) touchInput._down(e);
    }
    return;
  }
  if (e.button === Constants.LEFT_MOUSE_BUTTON && !isUiBlocking()) mouseLMBDown = true;
}

// Pointer events only report the first press / last release of a chord, so
// the left button's state is re-read from the `buttons` bitmask.
function syncMouseButtons(e) {
  if (isMousePointer(e) && mouseLMBDown && !(e.buttons & 1)) mouseLMBDown = false;
}

// Listened for on window, so releasing outside the canvas also stops firing.
function onMouseUp(e) {
  if (!isMousePointer(e)) return;
  if (e.button === Constants.LEFT_MOUSE_BUTTON || !(e.buttons & 1)) mouseLMBDown = false;
}

// Called every frame: keep firing while the button is held.
function mouseEvents() {
  const me = playerManager.mainPlayer;
  if (!me || !mouseLMBDown) return;
  if (isUiBlocking()) { mouseLMBDown = false; return; }
  if (me.canShoot && !me.isRespawning) me.shoot();
}

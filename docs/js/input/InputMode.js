// Tracks which input device was used last ('mouse' | 'keyboard' | 'gamepad' | 'touch'),
// so the UI can adapt (e.g. hide the mouse cursor sprite and show touch sticks).
const inputMode = {
  mode: (window.matchMedia && matchMedia('(pointer: coarse)').matches) ? 'touch' : 'mouse',
  listeners: [],
  set(m) {
    if (m === this.mode) return;
    // Keyboard alone doesn't hide a mouse cursor (people use both together).
    if (m === 'keyboard') return;
    this.mode = m;
    for (const fn of this.listeners) fn(m);
  },
  onChange(fn) { this.listeners.push(fn); },
};

// Converts an analog direction into the original game's 8-way digital input,
// so analog devices move at exactly the same speeds/directions as a keyboard.
function directionToKeys(x, y, deadzone) {
  const out = { up: false, down: false, left: false, right: false };
  if (Math.hypot(x, y) < deadzone) return out;
  const oct = ((Math.round(Math.atan2(y, x) / (Math.PI / 4)) % 8) + 8) % 8; // 0 = right, 2 = down
  out.right = oct === 7 || oct === 0 || oct === 1;
  out.down  = oct === 1 || oct === 2 || oct === 3;
  out.left  = oct === 3 || oct === 4 || oct === 5;
  out.up    = oct === 5 || oct === 6 || oct === 7;
  return out;
}

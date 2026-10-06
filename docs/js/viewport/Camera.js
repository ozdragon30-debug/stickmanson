// Keeps the local player centred. The offset is snapped to whole *device*
// pixels so scrolling stays even on high-density and high-refresh screens.
// Drawing only: aiming is measured from the view centre.
class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
  }

  setPos(target) {
    const px = (typeof display !== 'undefined' && display.scale) || 1;
    const k = worldScale();
    const snap = v => Math.round(v * px) / px;
    this.x = snap(target.x * k - VIEW_W / 2);
    this.y = snap(target.y * k - VIEW_H / 2);
  }
}

const camera = new Camera();

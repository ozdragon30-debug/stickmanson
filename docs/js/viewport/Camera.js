class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
  }
  
  // Snapped to *device* pixels, not logical ones: on a 2× screen the old
  // whole-logical-pixel snap moved the world in uneven 2-pixel steps (1 then 2
  // px per frame at 120 Hz), which reads as judder. Camera only affects drawing
  // (aim is measured from the view centre), so gameplay is unchanged.
  setPos(player) {
    const s = (typeof display !== 'undefined' && display.scale) || 1;
    const ws = worldScale();
    this.x = Math.round(((player.x * ws) - VIEW_W / 2) * s) / s;
    this.y = Math.round(((player.y * ws) - VIEW_H / 2) * s) / s;
  }
}

const camera = new Camera();

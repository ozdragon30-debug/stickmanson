class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
  }
  
  setPos(player) {
    this.x = Math.floor((player.x * scaleFactor) - VIEW_W / 2);
    this.y = Math.floor((player.y * scaleFactor) - VIEW_H / 2);
  }
}

const camera = new Camera();

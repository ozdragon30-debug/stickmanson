class Player {
  constructor() {
    this.position = null;
    this.kills = 0;
    this.deaths = 0;
    this.name = '';
    this.weaponId = 0; // fist default
    this.indicatorHue = 0;
    this.indicatorShapeIndex = 0;
    this.afk = false; // in the menu or tab in background (display only)
  }
}

module.exports = Player;


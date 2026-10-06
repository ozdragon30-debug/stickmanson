// What the server remembers about one connected player. Instances are sent to
// newcomers as-is inside `currentPlayers`, so every field here is public.
// `petId` and `vip` only appear once the client has sent `playerIdentity`.

class Player {
  constructor(name = '', position = null) {
    this.name = name;
    this.position = position;  // last reported {x, y[, rotation]}
    this.kills = 0;
    this.deaths = 0;
    this.weaponId = 0;         // what the server believes they hold; 0 = fists
    this.indicatorHue = 0;
    this.indicatorShapeIndex = 0;
    this.afk = false;          // menu open or tab hidden; shown to others only
  }

  // Back to bare fists with a clean score line (new round).
  resetForRound() {
    this.kills = 0;
    this.deaths = 0;
    this.weaponId = 0;
  }

  scoreLine() {
    return {
      name: this.name,
      kills: this.kills,
      deaths: this.deaths,
      indicatorHue: this.indicatorHue ?? 0,
    };
  }
}

module.exports = Player;

// Shared gameplay constants and the weapon table.
class Constants {
  // Damage taken is multiplied by this (1.15 = everyone dies 15% easier).
  static DAMAGE_MULTIPLIER = 1.15;
  static SPEED = 210;                    // walking speed, px/s (scaled per weapon)
  static STICK_FIGURE_HEAD_RADIUS = 17;  // hit radius of a player
  static TO_RADIANS = Math.PI / 180;
  static LEFT_MOUSE_BUTTON = 0;
  static DEATH_SOUNDS = Object.freeze(Array.from({ length: 7 }, (_, i) => `death_${i}`));
  // id → weapon definition (data/weapons.json), filled at startup.
  static WEAPON_ID_MAP = {};
}

// Everything that needs weapon data waits for this promise.
Constants._weaponsReady = fetch('./data/weapons.json')
  .then(r => r.json())
  .then(list => {
    Constants.WEAPON_ID_MAP = Object.freeze(Object.fromEntries(list.map(w => [w.id, Object.freeze(w)])));
  });

// ShopManager – coins and spinner perks.
//
// Coins are earned by playing (kills, rounds) and spent on spinners (the
// shape that orbits your player). The first STARTERS spinners are free; the
// others cost coins and each gives one small perk while equipped:
//   hp     +max health
//   atk    +damage dealt
//   armor  −damage taken
// Kept in localStorage ('sar_shop').

class ShopManager {
  static STARTERS = 4;
  static COUNT = 64;
  static TIERS = [
    null,
    { price: 60,  hp: 4,  atk: 0.03, armor: 0.03 },
    { price: 150, hp: 7,  atk: 0.05, armor: 0.05 },
    { price: 300, hp: 10, atk: 0.08, armor: 0.08 },
  ];
  static STATS = ['hp', 'atk', 'armor'];
  static REWARD = { kill: 10, round: 5, win: 25 };

  constructor() {
    this.data = { coins: 0, owned: [] };
    try { Object.assign(this.data, JSON.parse(localStorage.getItem('sar_shop') || '{}') || {}); } catch (e) {}
    if (!Array.isArray(this.data.owned)) this.data.owned = [];
    this.listeners = [];
    // Spinners used to be free to pick: one that isn't owned falls back to a starter.
    const i = settingsManager.spinnerShapeIndex;
    if (!this.owns(i)) settingsManager.set('spinnerShapeIndex', i % ShopManager.STARTERS);
  }

  _save() {
    try { localStorage.setItem('sar_shop', JSON.stringify(this.data)); } catch (e) {}
    for (const f of this.listeners) f();
  }
  onChange(f) { this.listeners.push(f); }

  get coins() { return this.data.coins; }
  earn(n) { if (n > 0) { this.data.coins += n; this._save(); } }

  // Perk of spinner i: { tier, stat, value, price } (tier 0 = free, no perk).
  static perk(i) {
    i = ((i % ShopManager.COUNT) + ShopManager.COUNT) % ShopManager.COUNT;
    if (i < ShopManager.STARTERS) return { tier: 0, stat: null, value: 0, price: 0 };
    const tier = i < 28 ? 1 : i < 48 ? 2 : 3;
    const stat = ShopManager.STATS[i % 3];
    const T = ShopManager.TIERS[tier];
    return { tier, stat, value: T[stat], price: T.price };
  }

  owns(i) { return ShopManager.perk(i).tier === 0 || this.data.owned.includes(i % ShopManager.COUNT); }

  buy(i) {
    const p = ShopManager.perk(i);
    if (this.owns(i) || this.data.coins < p.price) return false;
    this.data.coins -= p.price;
    this.data.owned.push(i % ShopManager.COUNT);
    this._save();
    return true;
  }

  // Perk of a spinner as worn by a player. Remote humans can only equip
  // spinners they own, so theirs counts as owned; bots get no perks.
  static valueFor(index, stat) {
    const p = ShopManager.perk(index ?? 0);
    return p.stat === stat ? p.value : 0;
  }
  _mine(stat) {
    const i = settingsManager.spinnerShapeIndex;
    return this.owns(i) ? ShopManager.valueFor(i, stat) : 0;
  }
  maxHealth()   { return 100 + this._mine('hp'); }
  attackFactor() { return 1 + this._mine('atk'); }
  armorFactor()  { return 1 - this._mine('armor'); }
  static attackFactorFor(index) { return 1 + ShopManager.valueFor(index, 'atk'); }

  // Short label, e.g. "Can +7" / "Saldırı +5%".
  static perkLabel(i) {
    const p = ShopManager.perk(i);
    if (!p.stat) return t('shop.free');
    if (p.stat === 'hp') return `${t('shop.hp')} +${p.value}`;
    return `${p.stat === 'atk' ? t('shop.atk') : t('shop.armor')} +${Math.round(p.value * 100)}%`;
  }
}

const shopManager = new ShopManager();

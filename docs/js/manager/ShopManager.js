// ShopManager – coins and spinner perks.
//
// Coins are earned by playing (kills, rounds) and spent on spinners (the
// shape that orbits your player). The first STARTERS spinners are free; the
// others cost coins and each gives one small perk while equipped:
//   hp     +max health
//   atk    +damage dealt
//   armor  −damage taken
// Pets (render/Pets.js) follow their owner and give one small perk too
// (health, attack, armor, more coins, or health regeneration).
// VIP: +20% coins and a gold name. It can't be bought yet (payment comes
// with the store release); the flag and perks are ready.
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
  static PETS = [
    { name: 'pet.cat',    price: 250, stat: 'coins', value: 0.10 },
    { name: 'pet.dog',    price: 300, stat: 'regen', value: 1 / 3 },
    { name: 'pet.crow',   price: 350, stat: 'atk',   value: 0.02 },
    { name: 'pet.slime',  price: 300, stat: 'hp',    value: 5 },
    { name: 'pet.drone',  price: 400, stat: 'armor', value: 0.03 },
    { name: 'pet.ghost',  price: 450, stat: 'coins', value: 0.15 },
    { name: 'pet.fox',    price: 500, stat: 'regen', value: 1 / 2 },
    { name: 'pet.dragon', price: 800, stat: 'atk',   value: 0.04 },
  ];
  static VIP_COINS = 0.2;

  constructor() {
    this.data = { coins: 0, owned: [], pets: [], pet: -1, vip: false };
    try { Object.assign(this.data, JSON.parse(localStorage.getItem('sar_shop') || '{}') || {}); } catch (e) {}
    if (!Array.isArray(this.data.owned)) this.data.owned = [];
    if (!Array.isArray(this.data.pets)) this.data.pets = [];
    if (!this.data.pets.includes(this.data.pet)) this.data.pet = -1;
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
  // Coins after pet / VIP bonuses; returns what was actually added.
  earn(n) {
    if (!(n > 0)) return 0;
    const k = Math.round(n * this.coinFactor());
    this.data.coins += k; this._save();
    return k;
  }
  coinFactor() { return 1 + this._petValue('coins') + (this.vip ? ShopManager.VIP_COINS : 0); }
  get vip() { return !!this.data.vip; }

  // ── Pets ──
  get pet() { return this.data.pet; }
  ownsPet(id) { return this.data.pets.includes(id); }
  buyPet(id) {
    const p = ShopManager.PETS[id];
    if (!p || this.ownsPet(id) || this.data.coins < p.price) return false;
    this.data.coins -= p.price; this.data.pets.push(id); this.data.pet = id; this._save();
    return true;
  }
  equipPet(id) {
    if (id !== -1 && !this.ownsPet(id)) return;
    this.data.pet = id; this._save();
  }
  static petValue(id, stat) { const p = ShopManager.PETS[id]; return p && p.stat === stat ? p.value : 0; }
  _petValue(stat) { return ShopManager.petValue(this.data.pet, stat); }
  regenPerSec() { return this._petValue('regen'); }
  static petLabel(id) {
    const p = ShopManager.PETS[id];
    if (!p) return '';
    const L = { hp: t('shop.hp'), atk: t('shop.atk'), armor: t('shop.armor'), coins: t('shop.coinsBonus'), regen: t('shop.regen') };
    const v = p.stat === 'hp' ? `+${p.value}` : p.stat === 'regen' ? `+${Math.round(p.value * 10) / 10}/s` : `+${Math.round(p.value * 100)}%`;
    return `${L[p.stat]} ${v}`;
  }

  // What other players need to see: spinner, hue, pet and VIP.
  identity() {
    return { hue: settingsManager.spinnerHue, shapeIndex: settingsManager.spinnerShapeIndex, pet: this.data.pet, vip: this.vip };
  }

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
  maxHealth()   { return 100 + this._mine('hp') + this._petValue('hp'); }
  attackFactor() { return 1 + this._mine('atk') + this._petValue('atk'); }
  armorFactor()  { return 1 - this._mine('armor') - this._petValue('armor'); }
  static attackFactorFor(index, pet = -1) { return 1 + ShopManager.valueFor(index, 'atk') + ShopManager.petValue(pet, 'atk'); }

  // Short label, e.g. "Can +7" / "Saldırı +5%".
  static perkLabel(i) {
    const p = ShopManager.perk(i);
    if (!p.stat) return t('shop.free');
    if (p.stat === 'hp') return `${t('shop.hp')} +${p.value}`;
    return `${p.stat === 'atk' ? t('shop.atk') : t('shop.armor')} +${Math.round(p.value * 100)}%`;
  }
}

const shopManager = new ShopManager();

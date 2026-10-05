// StatsManager – lifetime player statistics kept in localStorage and shown in
// the main menu. Purely informational.

class StatsManager {
  constructor() {
    this.stats = { kills: 0, deaths: 0, rounds: 0, wins: 0, bestStreak: 0, playSeconds: 0, weaponKills: {} };
    try { Object.assign(this.stats, JSON.parse(localStorage.getItem('sar_stats') || '{}') || {}); } catch (e) {}
    this.streak = 0;
    this._dirty = false;
    setInterval(() => this._flush(), 5000);
    window.addEventListener('pagehide', () => this._flush());
  }

  _flush() {
    if (!this._dirty) return;
    this._dirty = false;
    try { localStorage.setItem('sar_stats', JSON.stringify(this.stats)); } catch (e) {}
  }

  onKill(weaponId) {
    this.stats.kills++;
    this.stats.weaponKills[weaponId] = (this.stats.weaponKills[weaponId] || 0) + 1;
    this.streak++;
    if (this.streak > this.stats.bestStreak) this.stats.bestStreak = this.streak;
    this._dirty = true;
  }

  onDeath() {
    this.stats.deaths++;
    this.streak = 0;
    this._dirty = true;
  }

  onRoundEnd(won) {
    this.stats.rounds++;
    if (won) this.stats.wins++;
    this._dirty = true;
  }

  tick(dt) {
    this.stats.playSeconds += dt;
    this._dirty = true;
  }

  favouriteWeapon() {
    let best = null, n = 0;
    for (const [id, c] of Object.entries(this.stats.weaponKills)) if (c > n) { n = c; best = +id; }
    const w = best != null ? Constants.WEAPON_ID_MAP[best] : null;
    return w ? w.name.replace('_', ' ') : '—';
  }

  rows() {
    const s = this.stats;
    const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
    const h = Math.floor(s.playSeconds / 3600), m = Math.floor(s.playSeconds / 60) % 60;
    return [
      [t('stats.kills'), s.kills], [t('stats.deaths'), s.deaths], [t('stats.kd'), kd],
      [t('stats.wins'), `${s.wins} / ${s.rounds}`], [t('stats.streak'), s.bestStreak],
      [t('stats.weapon'), this.favouriteWeapon()], [t('stats.time'), h ? t('stats.hm', { h, m }) : t('stats.m', { m })],
    ];
  }

  reset() {
    this.stats = { kills: 0, deaths: 0, rounds: 0, wins: 0, bestStreak: 0, playSeconds: 0, weaponKills: {} };
    this._dirty = true;
    this._flush();
  }
}

const statsManager = new StatsManager();

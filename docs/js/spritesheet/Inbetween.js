// 60 fps display of the hand-drawn 12 fps player animations.
//
// tools/gen-inbetweens.py computes 4 drawings between every pair of original
// frames (optical-flow interpolation). AtlasGameObject shows them while it waits
// for its next original frame. Animation timing, frame indices and every event
// (shots, animation ends) still run on the original 12 fps frames, so this is
// drawing-only: gameplay is identical with it on or off (Settings → Video).
//
// Sheets are split per weapon and fetched the first time a drawing from them is
// needed; until then the original drawing is shown.
class InbetweenFrames {
  constructor(base) {
    this.base = base;
    this.steps = 1;
    this.ready = false;
    this._where = Object.create(null); // "frame~k" → { group, f }
    this._next = Object.create(null);  // "frame~k" → 1: show the next original drawing
    this._sheets = Object.create(null);
    fetch(base + '.json')
      .then(r => r.json())
      .then(d => {
        this.steps = d.steps;
        Object.assign(this._next, d.next);
        for (const group in d.groups) {
          for (const key in d.groups[group]) this._where[key] = { group, f: d.groups[group][key] };
        }
        this.ready = true;
        this._sheet('legs'); // walking legs are on screen all the time
        this._sheet('fist'); // everyone spawns with fists
      })
      .catch(err => console.info('[Inbetween] not available, animations stay at 12 fps:', err));
  }

  get enabled() {
    return this.ready && (typeof settingsManager === 'undefined' || settingsManager.get('smoothAnim') !== false);
  }

  _sheet(group) {
    let s = this._sheets[group];
    if (!s) {
      s = this._sheets[group] = { img: new Image(), loaded: false };
      s.img.decoding = 'async';
      s.img.src = `${this.base}_${group}.webp`;
      // Only used once fully decoded: drawing a still-encoded sheet decoded it
      // on the main thread mid-game (a visible freeze the first time a weapon
      // was used).
      const ready = () => { s.loaded = true; };
      if (s.img.decode) s.img.decode().then(ready, () => { s.img.onload = ready; });
      else s.img.onload = ready;
    }
    return s;
  }

  // Drawing for step k (1…steps-1) after original frame `key`:
  // { img, f } for an in-between, { next: true } to show the next original,
  // or null to keep showing `key`.
  lookup(key, k) {
    const id = key + '~' + k;
    if (this._next[id]) return { next: true };
    const w = this._where[id];
    if (!w) return null;
    const sheet = this._sheet(w.group);
    return sheet.loaded ? { img: sheet.img, f: w.f } : null;
  }
}

const inbetweens = new InbetweenFrames('sprites/player/inbetween');

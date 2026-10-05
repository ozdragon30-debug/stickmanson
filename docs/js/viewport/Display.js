// Display – decouples the game's fixed logical viewport from the physical canvas.
//
// Gameplay always sees a 960×720 logical view (exactly what the original fixed
// canvas showed), so field of view and aiming are unchanged. The backing store is
// sized to the on-screen CSS size × devicePixelRatio, so the game stays crisp on
// HiDPI / 4K displays and scales to fill any window while keeping a 4:3 aspect.

const VIEW_W = 960;
const VIEW_H = 720;

class Display {
  constructor(canvas) {
    this.canvas = canvas;
    this.scale = 1;          // backing-store pixels per logical pixel
    this.quality = 'auto';   // 'auto' | 'high' | 'low'
    this.listeners = [];

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      new ResizeObserver(onResize).observe(canvas.parentElement);
    }
    this._watchDpr();
    this.resize();
  }

  // devicePixelRatio changes when a window moves between monitors or the user zooms.
  _watchDpr() {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handler = () => { this.resize(); this._watchDpr(); };
    if (mq.addEventListener) mq.addEventListener('change', handler, { once: true });
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  _pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (this.quality === 'low') return 1;
    if (this.quality === 'high') return Math.min(dpr, 3);
    return Math.min(dpr, 2); // auto: sharp, but cap the fill-rate cost on 3× phones
  }

  resize() {
    const host = this.canvas.parentElement || document.body;
    // clientWidth/Height include padding (safe-area insets on notched phones).
    const cs = getComputedStyle(host);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const availW = (host.clientWidth  || window.innerWidth)  - padX;
    const availH = (host.clientHeight || window.innerHeight) - padY;
    // Fit 4:3 inside the available area.
    let cssW = Math.min(availW, availH * VIEW_W / VIEW_H);
    let cssH = cssW * VIEW_H / VIEW_W;
    cssW = Math.max(240, Math.floor(cssW));
    cssH = Math.max(180, Math.floor(cssH));

    const ratio = this._pixelRatio();
    const bw = Math.round(cssW * ratio);
    const bh = Math.round(cssH * ratio);

    this.canvas.style.width  = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width  = bw;
      this.canvas.height = bh;
    }
    this.scale = bw / VIEW_W;
    for (const fn of this.listeners) fn();
  }

  onResize(fn) { this.listeners.push(fn); }

  // Convert a pointer event's client coordinates into logical view coordinates.
  toView(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * VIEW_W / r.width,
      y: (clientY - r.top)  * VIEW_H / r.height,
    };
  }
}

const display = new Display(document.getElementById('canvas'));

// Replacement for ctx.setTransform(1,0,0,1,0,0): screen-space drawing in logical px.
function resetScreenTransform(ctx) {
  ctx.setTransform(display.scale, 0, 0, display.scale, 0, 0);
}

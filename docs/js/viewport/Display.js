// Display – decouples the game's fixed logical viewport from the physical canvas.
//
// Gameplay always sees a 960×720 logical view (exactly what the original fixed
// canvas showed), so field of view and aiming are unchanged. The backing store is
// sized to the on-screen CSS size × devicePixelRatio, so the game stays crisp on
// HiDPI / 4K displays and scales to fill any window while keeping a 4:3 aspect.
//
// Screens that aren't 4:3 (Settings → Video → Screen):
//   'wide' (default): the canvas fills the screen; the view extends by extraX /
//     extraY logical px on each side and the world is zoomed in (zoom) so the
//     visible map AREA stays the same as the original 4:3 view — a wider but
//     shorter view on phones, with everything bigger.
//   'classic': 4:3 play area; the extra width shows only the dimmed map.
//   'off': 4:3 with black bars.

const VIEW_W = 960;
const VIEW_H = 720;

class Display {
  constructor(canvas) {
    this.canvas = canvas;
    this.scale = 1;          // backing-store pixels per logical pixel
    this.mode = 'off';       // 'wide' | 'classic' | 'off' (set from settings by game.js)
    this.extraX = 0;         // logical px added on the left and right
    this.extraY = 0;         // logical px added above and below ('wide', tall screens)
    this.zoom = 1;           // world magnification ('wide')
    this.quality = 'auto';   // 'auto' | 'high' | 'low'
    this.dynamicCap = Infinity; // lowered by adaptive resolution on slow devices
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

  setViewMode(mode) {
    this.mode = mode === true ? 'wide' : mode === false ? 'off' : (mode || 'wide');
    this.resize();
  }

  // Logical size of the whole canvas.
  get viewW() { return VIEW_W + 2 * this.extraX; }
  get viewH() { return VIEW_H + 2 * this.extraY; }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  _pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (this.quality === 'low') return 1;
    if (this.quality === 'high') return Math.min(dpr, 3);
    // auto: sharp, but cap the fill-rate cost on 3× phones (and lower further if slow)
    return Math.max(1, Math.min(dpr, 2, this.dynamicCap));
  }

  resize() {
    const host = this.canvas.parentElement || document.body;
    // clientWidth/Height include padding (safe-area insets on notched phones).
    const cs = getComputedStyle(host);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const availW = (host.clientWidth  || window.innerWidth)  - padX;
    const availH = (host.clientHeight || window.innerHeight) - padY;
    const aspect = availW / availH, base = VIEW_W / VIEW_H;
    const wideFill = this.mode !== 'off' && aspect > base + 0.02;
    const tallFill = this.mode === 'wide' && aspect < base - 0.02;
    let cssW, cssH;
    if (wideFill) {
      // Full height; width up to 21:9 (beyond that, black bars again).
      cssH = Math.max(180, Math.floor(availH));
      cssW = Math.floor(Math.min(availW, cssH * 21 / 9));
    } else if (tallFill) {
      // Full width; height up to square (e.g. an unfolded foldable).
      cssW = Math.max(240, Math.floor(availW));
      cssH = Math.floor(Math.min(availH, cssW));
    } else {
      // Fit 4:3 inside the available area.
      cssW = Math.min(availW, availH * base);
      cssH = cssW / base;
      cssW = Math.max(240, Math.floor(cssW));
      cssH = Math.max(180, Math.floor(cssH));
    }

    const ratio = this._pixelRatio();
    const bw = Math.round(cssW * ratio);
    const bh = Math.round(cssH * ratio);

    this.canvas.style.width  = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.classList.toggle('fill', wideFill || tallFill);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width  = bw;
      this.canvas.height = bh;
    }
    this.scale = wideFill ? bh / VIEW_H : bw / VIEW_W;
    this.extraX = wideFill ? Math.max(0, (bw / this.scale - VIEW_W) / 2) : 0;
    this.extraY = tallFill ? Math.max(0, (bh / this.scale - VIEW_H) / 2) : 0;
    // Same visible world area as the original 4:3 view.
    this.zoom = this.mode === 'wide' ? Math.sqrt((this.viewW * this.viewH) / (VIEW_W * VIEW_H)) : 1;
    // On small screens (phones) HUD text would shrink to ~6 px. uiScale grows
    // screen-space HUD groups around their anchors; the world view is untouched.
    const cssRatio = cssH / this.viewH;
    this.uiScale = cssRatio < 0.8 ? Math.min(1.7, 0.8 / cssRatio) : 1;
    for (const fn of this.listeners) fn();
  }

  onResize(fn) { this.listeners.push(fn); }

  // Adaptive resolution ('auto' quality only), driven by the frame pacer in
  // game.js: one step down (2× → 1.5× → 1×). Returns false at the bottom.
  // It only ever steps down, so it can't oscillate.
  stepDown() {
    if (this.quality !== 'auto') return false;
    const current = this._pixelRatio();
    if (current <= 1) return false;
    this.dynamicCap = Math.max(1, Math.round((current - 0.5) * 2) / 2);
    console.info(`[Display] missed frames — render scale ${current}× → ${this.dynamicCap}×`);
    this.resize();
    return true;
  }

  // Convert a pointer event's client coordinates into logical view coordinates.
  toView(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * this.viewW / r.width - this.extraX,
      y: (clientY - r.top)  * this.viewH / r.height - this.extraY,
    };
  }
}

const display = new Display(document.getElementById('canvas'));

// Replacement for ctx.setTransform(1,0,0,1,0,0): screen-space drawing in logical px.
// Logical (0, 0) is the top-left of the central 4:3 area; extended margins are
// negative / beyond VIEW_W×VIEW_H.
function resetScreenTransform(ctx) {
  ctx.setTransform(display.scale, 0, 0, display.scale, display.scale * display.extraX, display.scale * display.extraY);
}

// Screen-space transform scaled by display.uiScale around an anchor point, so a
// HUD group keeps its corner/edge position while its contents grow.
// On a filled screen, groups anchored to an edge move out to the real screen
// edges.
function hudTransform(ctx, anchorX, anchorY) {
  const u = display.uiScale || 1;
  const s = display.scale;
  const ex = display.extraX || 0, ey = display.extraY || 0;
  const dx = ex + (anchorX < VIEW_W * 0.35 ? -ex : anchorX > VIEW_W * 0.65 ? ex : 0);
  const dy = ey + (anchorY < VIEW_H * 0.35 ? -ey : anchorY > VIEW_H * 0.65 ? ey : 0);
  ctx.setTransform(s * u, 0, 0, s * u, s * (dx + anchorX * (1 - u)), s * (dy + anchorY * (1 - u)));
}

"""Paints a whole map as one detailed, weathered top-down picture (original art,
made in code). Textures are continuous across tiles (no visible repetition),
edges between natural ground types are irregular, walls have a visible front
face and cast soft shadows, and the floor collects grime, cracks, stains,
puddles, leaves and litter.

paint_map(cells, theme, seed) -> RGB uint8 image of (h + 2P) × (w + 2P) tiles
at PX pixels per tile. P tiles of darkened surroundings are painted around the
map so wide screens never show a void at the edge.
"""
import math
import numpy as np
import cv2

PX = 80     # pixels per tile (tile = 50 world px → 1.6 px per world unit)
P = 5       # tiles of surroundings painted around the map


# ── noise ──────────────────────────────────────────────────────────────────
class Noise:
    def __init__(self, seed):
        self.r = np.random.RandomState(seed & 0x7fffffff)

    def value(self, h, w, scale):
        """Smooth value noise in [-1, 1]; `scale` = feature size in px."""
        gh, gw = max(2, int(h / scale) + 3), max(2, int(w / scale) + 3)
        g = self.r.rand(gh, gw).astype(np.float32)
        big = cv2.resize(g, (int(gw * scale), int(gh * scale)), interpolation=cv2.INTER_CUBIC)
        oy, ox = self.r.randint(0, int(scale)), self.r.randint(0, int(scale))
        return (big[oy:oy + h, ox:ox + w] * 2 - 1).clip(-1.2, 1.2)

    def fbm(self, h, w, scale, octaves=4, gain=0.5):
        out, amp, tot, s = np.zeros((h, w), np.float32), 1.0, 0.0, scale
        for _ in range(octaves):
            if s < 1.5: break
            out += self.value(h, w, s) * amp
            tot += amp; amp *= gain; s /= 2
        return out / tot

    def stretched(self, h, w, sx, sy):
        """Anisotropic noise (grain, grass blades)."""
        g = self.r.rand(int(h / sy) + 3, int(w / sx) + 3).astype(np.float32)
        big = cv2.resize(g, (int(g.shape[1] * sx), int(g.shape[0] * sy)), interpolation=cv2.INTER_LINEAR)
        return big[:h, :w] * 2 - 1


def rgb(*c):
    return np.array(c, np.float32)


def blend(dst, src, alpha):
    """dst, src: HxWx3 float; alpha HxW (0..1)."""
    a = alpha[..., None]
    dst *= (1 - a)
    dst += src * a


def tint(img, color, alpha):
    blend(img, np.broadcast_to(rgb(*color), img.shape), alpha)


# ── materials (continuous textures over a region) ──────────────────────────
def mat_asphalt(n, h, w, X, Y):
    v = 62 + n.fbm(h, w, 5, 2) * 9 + n.fbm(h, w, 90, 3) * 9
    img = np.stack([v, v + 2, v + 6], -1)
    speck = n.value(h, w, 1.6) > 0.82
    img[speck] += 30
    return img


def mat_concrete(n, h, w, X, Y):
    v = 148 + n.fbm(h, w, 6, 3) * 10 + n.fbm(h, w, 120, 3) * 12
    img = np.stack([v, v, v - 4], -1)
    slab = PX * 2
    seam = ((X % slab) < 2) | ((Y % slab) < 2)
    img[seam] *= 0.72
    tone = (np.floor(X / slab) * 7 + np.floor(Y / slab) * 13) % 5 - 2
    img += tone[..., None] * 3
    return img


def mat_sidewalk(n, h, w, X, Y):
    s = PX // 2
    v = 172 + n.fbm(h, w, 6, 2) * 8
    tone = ((np.floor(X / s) * 17 + np.floor(Y / s) * 29) % 7 - 3) * 3
    img = np.stack([v + tone, v + tone - 3, v + tone - 10], -1)
    lx, ly = X % s, Y % s
    img[(lx < 3) | (ly < 3)] = rgb(108, 104, 96)
    img[((lx >= 3) & (lx < 6)) | ((ly >= 3) & (ly < 6))] += 18     # bevel light
    img[(lx > s - 4) | (ly > s - 4)] -= 18
    return img


def mat_sand(n, h, w, X, Y):
    v = n.fbm(h, w, 160, 4)
    img = np.stack([206 + v * 16, 176 + v * 15, 122 + v * 12], -1)
    warp = n.fbm(h, w, 120, 2) * 40
    rip = np.sin((Y + warp) / 7.0 + X / 40.0)
    img -= (np.clip(rip, 0.6, 1) - 0.6)[..., None] * 40
    img += n.fbm(h, w, 2, 1)[..., None] * 8
    return img


def mat_grass(n, h, w, X, Y):
    big = n.fbm(h, w, 140, 4)
    blades = n.stretched(h, w, 1.6, 6)
    img = np.stack([62 + big * 18, 112 + big * 26, 44 + big * 12], -1)
    img += blades[..., None] * rgb(10, 22, 8)
    clump = n.fbm(h, w, 22, 2) > 0.35
    img[clump] *= 0.82
    return img


def mat_dirt(n, h, w, X, Y):
    v = n.fbm(h, w, 70, 4)
    img = np.stack([118 + v * 22, 88 + v * 18, 60 + v * 12], -1)
    img += n.fbm(h, w, 3, 2)[..., None] * 12
    return img


def mat_gravel(n, h, w, X, Y):
    v = n.fbm(h, w, 60, 3)
    img = np.stack([120 + v * 10] * 3, -1)
    peb = n.value(h, w, 3.0)
    img += (peb * 34)[..., None]
    img[peb > 0.55] += 22
    return img


def mat_metal(n, h, w, X, Y):
    v = 110 + n.fbm(h, w, 40, 3) * 8
    img = np.stack([v, v + 5, v + 12], -1)
    # Diamond tread.
    a = ((X + Y) % 22 < 4) & ((X % 22) < 13)
    b = ((X - Y) % 22 < 4) & ((X % 22) >= 11)
    img[a | b] += 24
    plate = PX
    seam = ((X % plate) < 3) | ((Y % plate) < 3)
    img[seam] = rgb(58, 62, 70)
    rust = np.clip(n.fbm(h, w, 70, 4) - 0.25, 0, 1) * 1.6
    tint(img, (122, 70, 38), rust * 0.55)
    return img


def mat_carpet(color):
    def f(n, h, w, X, Y):
        v = n.fbm(h, w, 2, 1) * 10 + n.fbm(h, w, 160, 3) * 10
        img = np.broadcast_to(rgb(*color), (h, w, 3)) + v[..., None]
        pat = ((X % 40) < 3) | ((Y % 40) < 3)
        img = img.copy(); img[pat] *= 0.84
        wear = np.clip(n.fbm(h, w, 90, 3), 0, 1)
        img += wear[..., None] * 22                             # walked-on paths
        return img
    return f


def mat_labtile(n, h, w, X, Y):
    s = PX // 2
    v = 222 + n.fbm(h, w, 60, 2) * 5
    tone = ((np.floor(X / s) * 31 + np.floor(Y / s) * 17) % 5 - 2) * 2
    img = np.stack([v + tone - 4, v + tone, v + tone + 4], -1)
    g = ((X % s) < 2) | ((Y % s) < 2)
    img[g] = rgb(150, 156, 164)
    return img


def mat_wood(n, h, w, X, Y):
    ph = PX // 5
    row = np.floor(Y / ph)
    offs = (row * 137) % 400
    plank = np.floor((X + offs) / (PX * 2.3))
    tone = ((row * 19 + plank * 31) % 9 - 4) * 4
    grain = n.stretched(h, w, 40, 1.4) * 10
    img = np.stack([146 + tone + grain, 100 + tone + grain * 0.8, 58 + tone / 2 + grain * 0.5], -1)
    gap = ((Y % ph) < 2) | (((X + offs) % (PX * 2.3)) < 2)
    img[gap] = rgb(62, 40, 22)
    return img


def mat_stone(n, h, w, X, Y):
    # Irregular flagstones: jittered-grid Voronoi.
    cell = PX * 0.7
    gx, gy = np.floor(X / cell), np.floor(Y / cell)
    best = np.full(X.shape, 1e9, np.float32); second = best.copy(); idv = np.zeros(X.shape, np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx, cy = gx + dx, gy + dy
            jx = ((cx * 127.1 + cy * 311.7) % 1.0 * 0 + np.sin(cx * 12.9898 + cy * 78.233) * 43758.5453 % 1.0)
            jy = (np.sin(cx * 39.346 + cy * 11.135) * 24634.6345 % 1.0)
            px, py = (cx + jx) * cell, (cy + jy) * cell
            d = np.hypot(X - px, Y - py)
            closer = d < best
            second = np.where(closer, best, np.minimum(second, d))
            idv = np.where(closer, (cx * 7 + cy * 13) % 11, idv)
            best = np.where(closer, d, best)
    edge = (second - best) < 3
    v = 126 + n.fbm(h, w, 8, 2) * 8 + (idv - 5) * 3
    img = np.stack([v, v - 4, v - 12], -1)
    img[edge] = rgb(70, 66, 60)
    return img


def mat_grate(n, h, w, X, Y):
    img = np.zeros((h, w, 3), np.float32) + 16
    bars = ((X % 16) < 4) | ((Y % 16) < 3)
    img[bars] = rgb(92, 96, 104)
    img[bars & ((X % 16) < 1)] += 30
    return img


def mat_track(n, h, w, X, Y):
    img = mat_gravel(n, h, w, X, Y) * 0.85
    sleep = (Y % 32) < 12
    lx = X % PX
    img[sleep & (lx > 8) & (lx < PX - 8)] = rgb(86, 62, 40)
    for r in (PX * 0.28, PX * 0.72):
        rail = np.abs(lx - r) < 3
        img[rail] = rgb(150, 152, 158)
        img[np.abs(lx - r + 1) < 1] = rgb(214, 216, 222)
    return img


def mat_road_line(direction):
    def f(n, h, w, X, Y):
        img = mat_asphalt(n, h, w, X, Y)
        c = X % PX if direction == 'v' else Y % PX
        along = Y if direction == 'v' else X
        line = (np.abs(c - PX / 2) < 3) & ((along % PX) < PX * 0.6)
        img[line] = rgb(222, 186, 60)
        return img
    return f


def mat_crossing(direction):
    def f(n, h, w, X, Y):
        img = mat_asphalt(n, h, w, X, Y)
        c = X if direction == 'v' else Y
        stripe = (c % (PX / 2)) < PX * 0.27
        img[stripe] = rgb(214, 214, 206) + n.fbm(h, w, 4, 2)[stripe][..., None] * 12
        return img
    return f


MATERIALS = {
    'asphalt': mat_asphalt, 'concrete': mat_concrete, 'sidewalk': mat_sidewalk, 'sand': mat_sand,
    'grass': mat_grass, 'dirt': mat_dirt, 'gravel': mat_gravel, 'metal': mat_metal,
    'carpet_red': mat_carpet((136, 40, 42)), 'carpet_blue': mat_carpet((46, 64, 118)),
    'labtile': mat_labtile, 'wood': mat_wood, 'stone': mat_stone, 'grate': mat_grate, 'track': mat_track,
    'asphalt_v': mat_road_line('v'), 'asphalt_h': mat_road_line('h'),
    'cross_v': mat_crossing('v'), 'cross_h': mat_crossing('h'),
}
NATURAL = {'grass', 'dirt', 'sand', 'gravel'}
OUTDOOR = {'asphalt', 'concrete', 'sidewalk', 'sand', 'grass', 'dirt', 'gravel', 'asphalt_v', 'asphalt_h', 'cross_v', 'cross_h', 'track', 'stone'}


# ── walls ──────────────────────────────────────────────────────────────────
WALL_TOP = {
    'brick': ('building', (150, 72, 54)), 'concrete': ('slab', (166, 166, 160)), 'metal': ('panel', (96, 104, 114)),
    'hedge': ('leaf', (48, 96, 40)), 'stone': ('block', (124, 118, 108)), 'roof': ('roof', (118, 116, 112)),
    'rock': ('rock', (110, 98, 86)), 'cubicle': ('fabric', (124, 128, 136)),
    'container_red': ('corrugated', (156, 52, 40)), 'container_blue': ('corrugated', (44, 84, 136)),
    'trailer': ('siding', (212, 208, 196)),
}


def wall_texture(kind, base, n, h, w, X, Y):
    b = rgb(*base)
    v = n.fbm(h, w, 6, 2)[..., None] * 8 + n.fbm(h, w, 80, 3)[..., None] * 10
    img = np.broadcast_to(b, (h, w, 3)) + v
    img = img.copy()
    if kind == 'building':
        # Flat tar roof seen from above (the bricks show on the front face).
        tar = n.fbm(h, w, 20, 3)
        img = np.stack([70 + tar * 10, 68 + tar * 10, 66 + tar * 10], -1)
        img += n.value(h, w, 2.0)[..., None] * 10
        return img
    if kind == 'brick':
        bh, bw = 12, 26
        row = np.floor(Y / bh)
        off = (row % 2) * bw / 2
        mortar = ((Y % bh) < 2) | (((X + off) % bw) < 2)
        tone = ((row * 7 + np.floor((X + off) / bw) * 13) % 6 - 3) * 6
        img += tone[..., None] * rgb(1, 0.5, 0.4)
        img[mortar] = rgb(110, 100, 92)
    elif kind == 'slab':
        img[(Y % 40) < 2] *= 0.8
    elif kind == 'panel':
        pn = PX / 2
        img[((X % pn) < 3) | ((Y % pn) < 3)] = rgb(60, 66, 74)
        rv = ((X % pn - 9) ** 2 + (Y % pn - 9) ** 2) < 9
        img[rv] = rgb(160, 168, 178)
    elif kind == 'leaf':
        lum = n.fbm(h, w, 9, 3)
        img = np.stack([40 + lum * 22, 94 + lum * 40, 34 + lum * 16], -1)
        hi = n.value(h, w, 4) > 0.5
        img[hi] += rgb(18, 34, 10)
    elif kind == 'block':
        row = np.floor(Y / 26); off = (row % 2) * 22
        joint = ((Y % 26) < 2) | (((X + off) % 44) < 2)
        tone = ((row * 5 + np.floor((X + off) / 44) * 11) % 7 - 3) * 4
        img += tone[..., None]
        img[joint] = rgb(74, 70, 64)
    elif kind == 'roof':
        img += n.value(h, w, 2.5)[..., None] * 20
    elif kind == 'rock':
        img += n.fbm(h, w, 30, 4)[..., None] * 26
    elif kind == 'fabric':
        img += n.fbm(h, w, 1.6, 1)[..., None] * 6
    elif kind == 'corrugated':
        img *= (0.86 + 0.14 * np.sin(X / 3.0))[..., None]
        rust = np.clip(n.fbm(h, w, 40, 3) - 0.3, 0, 1) * 1.5
        tint(img, (110, 64, 36), rust * 0.6)
    elif kind == 'siding':
        img[(Y % 14) < 2] *= 0.86
    return img


# ── props ──────────────────────────────────────────────────────────────────
def draw_prop(canvas, shadow, kind, x0, y0, wt, ht, rnd):
    """Draws a prop occupying wt×ht tiles at pixel (x0, y0); also marks its shadow."""
    W, H = wt * PX, ht * PX
    lay = np.zeros((H, W, 4), np.uint8)
    m = 8
    aa = cv2.LINE_AA

    def rect(a, b, col, th=-1):
        cv2.rectangle(lay, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), col + (255,), th, aa)

    def circ(c, r, col, th=-1):
        cv2.circle(lay, (int(c[0]), int(c[1])), int(r), col + (255,), th, aa)

    if kind == 'crate':
        rect((m, m), (W - m, H - m), (52, 96, 150))
        rect((m + 4, m + 4), (W - m - 4, H - m - 4), (66, 120, 178))
        for i in range(3):
            y = m + 6 + i * (H - 2 * m - 12) // 3
            cv2.line(lay, (m + 4, y), (W - m - 4, y), (40, 76, 120, 255), 2, aa)
        cv2.line(lay, (m + 6, m + 6), (W - m - 6, H - m - 6), (44, 82, 128, 255), 5, aa)
        rect((m, m), (W - m, H - m), (24, 40, 64), 3)
    elif kind.startswith('barrel'):
        col = {'barrel_red': (40, 48, 168), 'barrel_blue': (150, 88, 40), 'barrel_yellow': (36, 168, 210)}[kind]
        for i in range(wt):
            for j in range(ht):
                c = (i * PX + PX // 2, j * PX + PX // 2)
                circ(c, PX * 0.36, col)
                circ(c, PX * 0.36, (20, 20, 20), 2)
                circ(c, PX * 0.22, tuple(int(v * 0.75) for v in col), 3)
                circ((c[0] - 7, c[1] - 6), 6, (30, 30, 30))
                cv2.ellipse(lay, c, (int(PX * 0.3), int(PX * 0.3)), 0, 200, 270, (255, 255, 255, 110), 3, aa)
    elif kind in ('car_red', 'car_blue', 'car_white'):
        col = {'car_red': (40, 40, 176), 'car_blue': (168, 82, 40), 'car_white': (220, 222, 226)}[kind]
        vert = ht >= wt
        L, Wd = (H if vert else W) - 14, (W if vert else H) - 26
        car = np.zeros((L, Wd, 4), np.uint8)
        def cr(a, b, c, th=-1):
            cv2.rectangle(car, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), c + (255,), th, aa)
        cr((2, 6), (Wd - 3, L - 6), col)
        cr((2, 6), (Wd - 3, L - 6), (20, 20, 24), 3)
        cr((4, 9), (Wd - 5, int(L * .2)), tuple(min(255, int(v * 1.12)) for v in col))   # bonnet highlight
        cr((7, int(L * .2)), (Wd - 8, int(L * .36)), (70, 54, 40))           # windscreen
        cr((7, int(L * .36)), (Wd - 8, int(L * .7)), tuple(int(v * 0.82) for v in col))
        cr((8, int(L * .7)), (Wd - 9, int(L * .8)), (70, 54, 40))
        cr((5, 7), (16, 14), (190, 240, 250)); cr((Wd - 17, 7), (Wd - 6, 14), (190, 240, 250))
        cr((5, L - 13), (14, L - 8), (40, 40, 200)); cr((Wd - 15, L - 13), (Wd - 6, L - 8), (40, 40, 200))
        if not vert: car = cv2.rotate(car, cv2.ROTATE_90_CLOCKWISE)
        oy, ox = (H - car.shape[0]) // 2, (W - car.shape[1]) // 2
        lay[oy:oy + car.shape[0], ox:ox + car.shape[1]] = car
    elif kind == 'desk':
        rect((m, m + 6), (W - m, H - m - 6), (60, 92, 128))
        rect((m, m + 6), (W - m, H - m - 6), (30, 46, 66), 3)
        for i in range(wt):
            x = i * PX + PX // 2
            rect((x - 18, m + 12), (x + 18, m + 34), (40, 36, 32)); rect((x - 15, m + 15), (x + 15, m + 31), (200, 150, 70))
            rect((x - 20, m + 44), (x + 20, m + 52), (210, 210, 210))
            circ((x + 26, m + 48), 4, (200, 200, 200))
    elif kind in ('plant', 'tree'):
        for i in range(wt):
            for j in range(ht):
                cx, cy = i * PX + PX // 2, j * PX + PX // 2
                if kind == 'plant':
                    circ((cx, cy), PX * 0.3, (60, 96, 150)); circ((cx, cy), PX * 0.3, (30, 50, 80), 2)
                for k in range(16 if kind == 'tree' else 9):
                    a = rnd.random() * 6.283; rr = rnd.random() * PX * (0.28 if kind == 'tree' else 0.18)
                    s = PX * (0.2 if kind == 'tree' else 0.12) + rnd.random() * PX * 0.1
                    g = rnd.randint(70, 140)
                    circ((cx + rr * math.cos(a), cy + rr * math.sin(a)), s, (g // 4, g, g // 3))
                circ((cx - PX * 0.08, cy - PX * 0.1), PX * 0.12, (90, 190, 120))
    elif kind == 'pillar':
        for i in range(wt):
            for j in range(ht):
                x, y = i * PX + 14, j * PX + 14
                rect((x, y), (x + PX - 28, y + PX - 28), (176, 180, 182))
                rect((x + 8, y + 8), (x + PX - 36, y + PX - 36), (150, 154, 156))
                rect((x, y), (x + PX - 28, y + PX - 28), (50, 50, 50), 3)
    elif kind == 'sandbags':
        for row in range(ht * 3):
            y = 4 + row * PX // 3
            for col in range(wt * 3 + 1):
                x = col * PX // 3 + (12 if row % 2 else 0) - 6
                if x < 0 or x + 30 > W: continue
                cv2.ellipse(lay, (x + 15, y + 12), (15, 11), 0, 0, 360, (104, 150, 172, 255), -1, aa)
                cv2.ellipse(lay, (x + 15, y + 12), (15, 11), 0, 0, 360, (52, 80, 96, 255), 2, aa)
    elif kind == 'tank':
        c, r = (W // 2, H // 2), min(W, H) // 2 - 10
        circ(c, r, (86, 78, 70)); circ(c, r, (26, 22, 20), 4)
        circ(c, r - 12, (140, 220, 60)); circ((c[0] - r // 3, c[1] - r // 3), r // 3, (210, 255, 180))
    elif kind == 'machine':
        rect((m, m), (W - m, H - m), (108, 98, 92))
        for i in range(wt):
            for j in range(ht):
                c = (i * PX + PX // 2, j * PX + PX // 2)
                circ(c, 22, (72, 64, 60)); circ(c, 22, (166, 156, 150), 3)
                for k in range(6):
                    a = k / 6 * 6.283
                    cv2.line(lay, c, (int(c[0] + 20 * math.cos(a)), int(c[1] + 20 * math.sin(a))), (166, 156, 150, 255), 3, aa)
        rect((m + 6, m + 6), (m + 30, m + 14), (40, 180, 230))
        rect((m, m), (W - m, H - m), (30, 28, 26), 3)
    elif kind == 'vending':
        rect((m, m + 6), (W - m, H - m - 6), (44, 40, 196)); rect((m + 8, m + 14), (W - m - 24, H - m - 14), (240, 210, 150))
        rect((m, m + 6), (W - m, H - m - 6), (20, 12, 60), 3)
    elif kind == 'bench':
        for k in range(3):
            y = m + 14 + k * 18
            rect((m, y), (W - m, y + 12), (60, 104, 150)); rect((m, y), (W - m, y + 12), (24, 46, 70), 2)
    elif kind == 'dumpster':
        rect((m, m + 6), (W - m, H - m - 6), (60, 110, 52)); rect((m, m + 6), (W - m, H - m - 6), (22, 40, 20), 3)
        for x in range(m + 14, W - m, 20):
            cv2.line(lay, (x, m + 6), (x, H - m - 6), (46, 86, 40, 255), 3, aa)
    # BGR(A) from cv2 → RGB
    rgba = lay[..., [2, 1, 0, 3]].astype(np.float32)
    a = rgba[..., 3:] / 255
    region = canvas[y0:y0 + H, x0:x0 + W]
    region[:] = region * (1 - a) + rgba[..., :3] * a
    shadow[y0:y0 + H, x0:x0 + W] = np.maximum(shadow[y0:y0 + H, x0:x0 + W], a[..., 0])


# ── the map ────────────────────────────────────────────────────────────────
def paint_map(cells, theme, seed=1):
    """cells[y][x] = dict(kind='floor'|'wall'|'void'|'water'|'prop', mat=…, prop=(kind, wt, ht, i, j), floor=…)."""
    import random
    rnd = random.Random(seed)
    n = Noise(seed)
    h0, w0 = len(cells), len(cells[0])
    # Surroundings: copy the nearest edge cell.
    grid = [[cells[min(h0 - 1, max(0, y - P))][min(w0 - 1, max(0, x - P))] for x in range(w0 + 2 * P)] for y in range(h0 + 2 * P)]
    h, w = len(grid), len(grid[0])
    H, W = h * PX, w * PX
    Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
    canvas = np.zeros((H, W, 3), np.float32)

    # Floor material per pixel; natural ground gets wavy borders.
    def floor_of(c):
        return c['mat'] if c['kind'] == 'floor' else c.get('floor')
    names = sorted({floor_of(c) for row in grid for c in row if floor_of(c)})
    idx = {m: i for i, m in enumerate(names)}
    cellmat = np.array([[idx.get(floor_of(c), -1) for c in row] for row in grid], np.int32)
    natural = np.array([[floor_of(c) in NATURAL for c in row] for row in grid])
    warp = n.fbm(H, W, 60, 3) * PX * 0.45
    warp2 = n.fbm(H, W, 60, 3) * PX * 0.45
    cx = np.clip(((X + warp) / PX).astype(np.int32), 0, w - 1)
    cy = np.clip(((Y + warp2) / PX).astype(np.int32), 0, h - 1)
    sx = np.clip((X / PX).astype(np.int32), 0, w - 1)
    sy = np.clip((Y / PX).astype(np.int32), 0, h - 1)
    use_warp = natural[sy, sx] & natural[cy, cx]
    pm = np.where(use_warp, cellmat[cy, cx], cellmat[sy, sx])
    for m, i in idx.items():
        mask = pm == i
        if not mask.any(): continue
        ys, xs = np.where(mask)
        y0_, y1_, x0_, x1_ = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        tex = MATERIALS[m](n, y1_ - y0_, x1_ - x0_, X[y0_:y1_, x0_:x1_], Y[y0_:y1_, x0_:x1_])
        sub = canvas[y0_:y1_, x0_:x1_]
        mk = mask[y0_:y1_, x0_:x1_]
        sub[mk] = tex[mk]

    # Curbs where two different paved floors meet (e.g. pavement / road).
    curb = np.zeros((H, W), np.float32)
    for y in range(h):
        for x in range(w):
            a = floor_of(grid[y][x])
            if not a or a in NATURAL or grid[y][x]['kind'] != 'floor': continue
            for dx, dy in ((1, 0), (0, 1)):
                if x + dx >= w or y + dy >= h: continue
                b = floor_of(grid[y + dy][x + dx])
                if not b or b == a or b in NATURAL or grid[y + dy][x + dx]['kind'] != 'floor': continue
                if {a, b} <= {'asphalt', 'asphalt_v', 'asphalt_h', 'cross_v', 'cross_h'}: continue
                if dx: curb[y * PX:(y + 1) * PX, (x + 1) * PX - 3:(x + 1) * PX + 3] = 1
                else: curb[(y + 1) * PX - 3:(y + 1) * PX + 3, x * PX:(x + 1) * PX] = 1
    if curb.any():
        canvas *= (1 - np.clip(cv2.GaussianBlur(curb, (0, 0), 4) * 0.5, 0, 0.4))[..., None]
        blend(canvas, np.broadcast_to(rgb(196, 194, 186), canvas.shape), curb * 0.95)

    # Grime: dirt accumulates in large patches and along walls.
    solid = np.zeros((H, W), np.float32)
    wallmask = np.zeros((H, W), np.float32)
    for y in range(h):
        for x in range(w):
            k = grid[y][x]['kind']
            if k == 'wall':
                wallmask[y * PX:(y + 1) * PX, x * PX:(x + 1) * PX] = 1
    g1 = np.clip(n.fbm(H, W, 140, 5) * 1.1 + 0.05, 0, 1)
    g2 = np.clip(n.fbm(H, W, 30, 3) * 1.4 - 0.2, 0, 1)
    grime = g1 * 0.38 + g2 * 0.16
    near = cv2.GaussianBlur(wallmask, (0, 0), PX * 0.3)
    grime += near * 0.35
    dirt_col = rgb(*theme.get('dirt', (70, 58, 44)))
    blend(canvas, np.broadcast_to(dirt_col, canvas.shape), np.clip(grime, 0, 0.62))

    # Decals on the floor.
    decal_layer(canvas, n, rnd, grid, theme, H, W)

    # Water and void.
    for y in range(h):
        for x in range(w):
            c = grid[y][x]
            sl = (slice(y * PX, (y + 1) * PX), slice(x * PX, (x + 1) * PX))
            if c['kind'] == 'water':
                v = n.fbm(PX, PX, 30, 2)
                canvas[sl] = np.stack([22 + v * 8, 64 + v * 14, 78 + v * 16], -1)
            elif c['kind'] == 'void':
                canvas[sl] = void_texture(theme.get('void', 'dark'), n, rnd, PX)

    # Water edges: wet darker rim.
    watermask = np.zeros((H, W), np.float32)
    voidmask = np.zeros((H, W), np.float32)
    for y in range(h):
        for x in range(w):
            k = grid[y][x]['kind']
            sl = (slice(y * PX, (y + 1) * PX), slice(x * PX, (x + 1) * PX))
            if k == 'water': watermask[sl] = 1
            if k == 'void': voidmask[sl] = 1
    rim = np.clip(cv2.GaussianBlur(watermask, (0, 0), 6) - watermask, 0, 1)
    canvas *= (1 - rim * 0.8)[..., None]
    # Drop-off into the void: dark gradient on the floor edge.
    drop = np.clip(cv2.GaussianBlur(voidmask, (0, 0), 10) * 1.6, 0, 1) * (1 - voidmask)
    canvas *= (1 - drop * 0.7)[..., None]

    # Walls: top face, visible front face (south side), bevels.
    front = int(PX * 0.28)
    shadow = np.zeros((H, W), np.float32)
    for y in range(h):
        for x in range(w):
            c = grid[y][x]
            if c['kind'] != 'wall': continue
            kind, base = WALL_TOP[c['mat']]
            x0, y0 = x * PX, y * PX
            sl = (slice(y0, y0 + PX), slice(x0, x0 + PX))
            top = wall_texture(kind, base, n, PX, PX, X[sl], Y[sl])
            front_kind = 'brick' if kind == 'building' else kind
            same = lambda dx, dy: 0 <= x + dx < w and 0 <= y + dy < h and grid[y + dy][x + dx]['kind'] == 'wall' and grid[y + dy][x + dx]['mat'] == c['mat']
            canvas[sl] = top
            shadow[sl] = 1
            reg = canvas[sl]
            if kind in ('building', 'roof'):
                par = rgb(150, 72, 54) if kind == 'building' else rgb(176, 172, 164)
                pw = 7
                if not same(0, -1): reg[:pw] = par
                if not same(-1, 0): reg[:, :pw] = par
                if not same(1, 0): reg[:, -pw:] = par * 0.8
                if not same(0, 1): reg[-pw - front:] = par * 0.8
                if same(0, -1) and same(0, 1) and same(-1, 0) and same(1, 0) and rnd.random() < 0.35:
                    rooftop_unit(reg, rnd)
            # Light from the top-left.
            if not same(0, -1): reg[:6] = reg[:6] * 0.6 + 255 * 0.4 * np.linspace(1, 0.3, 6)[:, None, None]
            if not same(-1, 0): reg[:, :5] = reg[:, :5] * 0.7 + 255 * 0.3 * np.linspace(1, 0.3, 5)[None, :, None]
            if not same(1, 0): reg[:, -5:] *= np.linspace(0.85, 0.55, 5)[None, :, None]
            if not same(0, 1):
                # Front face: darker, vertical shading, a grimy base line.
                fr = wall_texture(front_kind, tuple(int(v * (0.85 if kind == 'building' else 0.62)) for v in base), n, front, PX, X[y0 + PX - front:y0 + PX, x0:x0 + PX], Y[y0 + PX - front:y0 + PX, x0:x0 + PX])
                fr *= np.linspace(1.0, 0.65, front)[:, None, None]
                reg[PX - front:] = fr
                reg[PX - front:PX - front + 2] = reg[PX - front:PX - front + 2] * 0.3 + 255 * 0.25
                reg[-3:] *= 0.45
                if c['mat'] in ('brick', 'concrete', 'container_red', 'container_blue', 'trailer') and rnd.random() < theme.get('graffiti', 0.0):
                    graffiti(reg[PX - front:], rnd)
            if c['mat'] == 'hedge':  # soften hedge outlines
                pass

    # Props.
    done = set()
    for y in range(h):
        for x in range(w):
            c = grid[y][x]
            if c['kind'] != 'prop': continue
            kind, wt, ht, i, j = c['prop']
            ox, oy = x - i, y - j
            if (ox, oy, kind) in done: continue
            done.add((ox, oy, kind))
            if 0 <= ox and 0 <= oy and ox + wt <= w and oy + ht <= h:
                draw_prop(canvas, shadow, kind, ox * PX, oy * PX, wt, ht, rnd)

    # Soft shadows down-right of walls and props, onto everything below them.
    sh = cv2.GaussianBlur(shadow, (0, 0), 7)
    M = np.float32([[1, 0, 10], [0, 1, 14]])
    sh = cv2.warpAffine(sh, M, (W, H))
    canvas *= (1 - np.clip(sh - shadow, 0, 1) * 0.5)[..., None]
    ao = cv2.GaussianBlur(shadow, (0, 0), 16)
    canvas *= (1 - np.clip(ao - shadow, 0, 1) * 0.35)[..., None]

    # Lighting: broad soft light variation + optional lamp pools.
    light = 1 + n.fbm(H, W, 400, 2) * 0.08
    for _ in range(theme.get('lamps', 0)):
        lx, ly = rnd.uniform(0, W), rnd.uniform(0, H)
        light += 0.18 * np.exp(-((X - lx) ** 2 + (Y - ly) ** 2) / (2 * (PX * 2.2) ** 2))
    canvas *= light[..., None]

    # Colour grade.
    g = np.array(theme.get('grade', (1, 1, 1)), np.float32)
    canvas *= g
    canvas = (canvas - 128) * theme.get('contrast', 1.06) + 128

    # Surroundings outside the map: darkened.
    out = np.ones((H, W), np.float32)
    out[:P * PX] = out[-P * PX:] = 0.42
    out[:, :P * PX] = out[:, -P * PX:] = 0.42
    out = cv2.GaussianBlur(out, (0, 0), PX * 0.3)
    canvas *= out[..., None]
    return np.clip(canvas, 0, 255).astype(np.uint8)


def rooftop_unit(reg, rnd):
    """AC unit / vent / skylight on a flat roof."""
    k = rnd.random()
    s = reg.shape[0]
    x0, y0 = rnd.randrange(8, s // 3), rnd.randrange(8, s // 3)
    if k < 0.45:
        reg[y0:y0 + 34, x0:x0 + 34] = rgb(170, 172, 176)
        cv2.circle(reg, (x0 + 17, y0 + 17), 12, (110, 112, 116), -1, cv2.LINE_AA)
        for a in range(0, 360, 45):
            cv2.line(reg, (x0 + 17, y0 + 17), (int(x0 + 17 + 11 * math.cos(math.radians(a))), int(y0 + 17 + 11 * math.sin(math.radians(a)))), (70, 72, 76), 2, cv2.LINE_AA)
        reg[y0 + 34:y0 + 40, x0 + 4:x0 + 38] *= 0.6
    elif k < 0.75:
        cv2.circle(reg, (x0 + 12, y0 + 12), 10, (150, 152, 156), -1, cv2.LINE_AA)
        cv2.circle(reg, (x0 + 12, y0 + 12), 5, (40, 40, 44), -1, cv2.LINE_AA)
    else:
        reg[y0:y0 + 30, x0:x0 + 44] = rgb(120, 160, 190)
        reg[y0:y0 + 30, x0 + 21:x0 + 23] = rgb(80, 84, 90)
        reg[y0 + 14:y0 + 16, x0:x0 + 44] = rgb(80, 84, 90)


def void_texture(kind, n, rnd, size):
    img = np.zeros((size, size, 3), np.float32) + 6
    if kind == 'space':
        for _ in range(4):
            x, y = rnd.randrange(size), rnd.randrange(size)
            b = rnd.randint(120, 255)
            img[y, x] = b
    elif kind == 'street':           # far below a rooftop
        v = n.fbm(size, size, 20, 2)
        img = np.stack([24 + v * 6, 26 + v * 6, 30 + v * 6], -1)
    return img


def graffiti(region, rnd):
    h, w = region.shape[:2]
    col = rgb(*rnd.choice([(230, 60, 160), (60, 200, 240), (250, 210, 40), (120, 240, 90), (240, 110, 40)]))
    layer = np.zeros((h, w), np.uint8)
    x = rnd.randrange(4, max(5, w - 30))
    pts = [(x + k * 6, rnd.randrange(3, max(4, h - 3))) for k in range(rnd.randint(3, 6))]
    cv2.polylines(layer, [np.array(pts, np.int32)], False, 255, rnd.randint(2, 4), cv2.LINE_AA)
    a = layer.astype(np.float32)[..., None] / 255 * 0.85
    region[:] = region * (1 - a) + col * a


def decal_layer(canvas, n, rnd, grid, theme, H, W):
    h, w = len(grid), len(grid[0])
    floor_cells = [(x, y) for y in range(h) for x in range(w) if grid[y][x]['kind'] == 'floor']
    if not floor_cells: return
    area = len(floor_cells)
    lay = np.zeros((H, W), np.float32)          # dark stains / cracks
    wet = np.zeros((H, W), np.float32)          # puddles
    specks = []
    for _ in range(int(area * 0.08)):            # cracks
        x, y = rnd.choice(floor_cells)
        if grid[y][x].get('floor') in ('grass', 'carpet_red', 'carpet_blue', 'wood'): continue
        px, py = x * PX + rnd.random() * PX, y * PX + rnd.random() * PX
        pts = [(px, py)]
        a = rnd.random() * 6.28
        for _ in range(rnd.randint(4, 9)):
            a += rnd.uniform(-0.7, 0.7)
            px += math.cos(a) * rnd.uniform(6, 16); py += math.sin(a) * rnd.uniform(6, 16)
            pts.append((px, py))
        cv2.polylines(lay, [np.array(pts, np.int32)], False, 0.55, 1, cv2.LINE_AA)
    for _ in range(int(area * 0.10)):            # stains
        x, y = rnd.choice(floor_cells)
        cxp, cyp = int(x * PX + rnd.random() * PX), int(y * PX + rnd.random() * PX)
        cv2.ellipse(lay, (cxp, cyp), (rnd.randint(6, 26), rnd.randint(4, 18)), rnd.randint(0, 180), 0, 360, rnd.uniform(0.15, 0.35), -1, cv2.LINE_AA)
    if theme.get('puddles'):
        for _ in range(int(area * 0.03)):
            x, y = rnd.choice(floor_cells)
            if grid[y][x].get('floor') not in OUTDOOR: continue
            cxp, cyp = int(x * PX + rnd.random() * PX), int(y * PX + rnd.random() * PX)
            for k in range(3):
                cv2.ellipse(wet, (cxp + rnd.randint(-10, 10), cyp + rnd.randint(-6, 6)), (rnd.randint(10, 28), rnd.randint(6, 14)), 0, 0, 360, 1.0, -1, cv2.LINE_AA)
    road = [(x, y) for x, y in floor_cells if grid[y][x].get('mat', '').startswith(('asphalt', 'cross'))]
    for _ in range(int(len(road) * 0.12)):                          # oil stains
        x, y = rnd.choice(road)
        cxp, cyp = int(x * PX + rnd.random() * PX), int(y * PX + rnd.random() * PX)
        for k in range(rnd.randint(2, 5)):
            cv2.ellipse(lay, (cxp + rnd.randint(-14, 14), cyp + rnd.randint(-10, 10)), (rnd.randint(8, 22), rnd.randint(6, 14)), rnd.randint(0, 180), 0, 360, 0.42, -1, cv2.LINE_AA)
    for _ in range(int(len(road) * 0.03)):                          # tyre marks
        x, y = rnd.choice(road)
        px_, py_ = x * PX + rnd.random() * PX, y * PX + rnd.random() * PX
        a = rnd.random() * 6.28; bend = rnd.uniform(-0.02, 0.02)
        for off in (-9, 9):
            pts = []
            for k in range(22):
                aa_ = a + bend * k
                pts.append((px_ + math.cos(aa_) * k * 9 - math.sin(a) * off, py_ + math.sin(aa_) * k * 9 + math.cos(a) * off))
            cv2.polylines(lay, [np.array(pts, np.int32)], False, 0.32, 5, cv2.LINE_AA)
    lay = cv2.GaussianBlur(lay, (0, 0), 1.2)
    canvas *= (1 - np.clip(lay, 0, 0.6))[..., None]
    if wet.any():
        wet = cv2.GaussianBlur(wet, (0, 0), 2.5)
        blend(canvas, canvas * 0.55 + rgb(40, 60, 80) * 0.45, np.clip(wet, 0, 1) * 0.8)
        edge = np.clip(wet - cv2.GaussianBlur(wet, (0, 0), 3), 0, 1)
        canvas += (edge * 60)[..., None]
    for _ in range(len(road) // 45 if road else 0):                 # manhole covers
        x, y = rnd.choice(road)
        c_ = (int(x * PX + PX / 2), int(y * PX + PX / 2))
        cv2.circle(canvas, c_, 17, (58, 58, 60), -1, cv2.LINE_AA)
        cv2.circle(canvas, c_, 17, (40, 40, 42), 2, cv2.LINE_AA)
        for k in range(-12, 13, 6):
            cv2.line(canvas, (c_[0] - 12, c_[1] + k), (c_[0] + 12, c_[1] + k), (78, 78, 80), 2, cv2.LINE_AA)
    walk = [(x, y) for x, y in floor_cells if grid[y][x].get('mat') in ('sidewalk', 'labtile', 'concrete')]
    for _ in range(int(len(walk) * 0.06)):                          # broken / stained slabs
        x, y = rnd.choice(walk)
        q = PX // 2
        sx_, sy_ = x * PX + rnd.choice((0, q)), y * PX + rnd.choice((0, q))
        canvas[sy_ + 3:sy_ + q - 3, sx_ + 3:sx_ + q - 3] *= rnd.uniform(0.72, 0.88)
    # Leaves / litter specks.
    cols = theme.get('specks', [(150, 90, 40), (190, 140, 50), (90, 110, 40), (225, 225, 215)])
    for _ in range(int(area * 0.9)):
        x, y = rnd.choice(floor_cells)
        if grid[y][x].get('floor') in ('carpet_red', 'carpet_blue', 'labtile'): continue
        cxp, cyp = int(x * PX + rnd.random() * PX), int(y * PX + rnd.random() * PX)
        col = rnd.choice(cols)
        r_ = rnd.randint(1, 3)
        cv2.circle(canvas, (cxp, cyp), r_, tuple(float(c) for c in col), -1, cv2.LINE_AA)

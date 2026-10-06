"""Procedural tile painters for the map tileset (original artwork, made in code).

Every painter returns a PIL RGBA image of TILE×TILE pixels (or a multiple of it
for multi-tile props). Light comes from the top-left; shadows fall down-right.
Images are painted at SS× size and downsampled for smooth edges.
"""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TILE = 100          # output pixels per tile (drawn at 50 world px → crisp on 2× screens)
SS = 2              # supersampling factor
S = TILE * SS       # working size


# ── helpers ────────────────────────────────────────────────────────────────
def rng(*key):
    return random.Random(hash(key) & 0xffffffff)


def noise(size, cells, seed, octaves=3):
    """Seamless value noise in [-1, 1] (size×size), `cells` = coarsest grid."""
    r = np.random.RandomState(seed & 0x7fffffff)
    out = np.zeros((size, size))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = cells * (2 ** o)
        grid = r.rand(n, n)
        big = np.tile(grid, (3, 3))
        img = Image.fromarray((big * 255).astype(np.uint8)).resize((size * 3, size * 3), Image.BICUBIC)
        a = np.asarray(img, dtype=np.float64)[size:size * 2, size:size * 2] / 255.0
        out += (a * 2 - 1) * amp
        total += amp
        amp *= 0.5
    return out / total


def base(color, n=None, k=1.0, size=S):
    """Solid colour modulated by noise array n (same size) with strength k (0-255 units)."""
    arr = np.zeros((size, size, 4))
    arr[..., :3] = color
    arr[..., 3] = 255
    if n is not None:
        arr[..., :3] += n[..., None] * k
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


def finish(img, size=TILE):
    return img.resize((size, size) if isinstance(size, int) else size, Image.LANCZOS)


def shade(img, box, color, alpha):
    ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(ov).rectangle(box, fill=color + (alpha,))
    return Image.alpha_composite(img, ov)


def grad_edge(img, side, width, alpha, color=(0, 0, 0)):
    """Darken/lighten along one edge with a linear fade (AO, bevels)."""
    w, h = img.size
    a = np.zeros((h, w))
    ramp = np.linspace(alpha, 0, width)
    if side == 'n': a[:width, :] = ramp[:, None]
    if side == 's': a[h - width:, :] = ramp[::-1][:, None]
    if side == 'w': a[:, :width] = ramp[None, :]
    if side == 'e': a[:, w - width:] = ramp[::-1][None, :]
    ov = np.zeros((h, w, 4)); ov[..., :3] = color; ov[..., 3] = a
    return Image.alpha_composite(img, Image.fromarray(ov.astype(np.uint8), 'RGBA'))


def drop_shadow(layer, dx=10, dy=12, blur=8, alpha=120):
    """Shadow of an RGBA layer's alpha, offset down-right."""
    a = layer.getchannel('A').filter(ImageFilter.GaussianBlur(blur))
    a = a.point(lambda v: v * alpha // 255)
    sh = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    sh.putalpha(a)
    out = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (dx, dy))
    return out


# ── floors ────────────────────────────────────────────────────────────────
def floor_concrete(v):
    n = noise(S, 4, 11 + v, 4)
    img = base((150, 151, 148), n, 18)
    d = ImageDraw.Draw(img)
    r = rng('conc', v)
    for _ in range(140):                                   # aggregate speckles
        x, y = r.randrange(S), r.randrange(S); c = r.randrange(105, 185)
        d.ellipse((x, y, x + 2, y + 2), fill=(c, c, c - 3, 255))
    d.line((0, 0, S, 0), fill=(118, 118, 116, 255), width=3)      # slab seams
    d.line((0, 0, 0, S), fill=(118, 118, 116, 255), width=3)
    if v == 2:                                                      # crack
        x, y = r.randrange(40, 160), 0
        while y < S:
            nx, ny = x + r.randrange(-18, 19), y + r.randrange(10, 30)
            d.line((x, y, nx, ny), fill=(95, 95, 93, 255), width=2); x, y = nx, ny
    return finish(img)


def floor_asphalt(v, mark=None):
    n = noise(S, 8, 21 + v, 3)
    img = base((62, 64, 68), n, 14)
    d = ImageDraw.Draw(img)
    r = rng('asph', v)
    for _ in range(420):
        x, y = r.randrange(S), r.randrange(S); c = r.randrange(40, 100)
        d.point((x, y), fill=(c, c, c + 2, 255))
    if mark == 'v':      # dashed centre line, vertical
        d.rectangle((S // 2 - 5, 20, S // 2 + 5, S - 20), fill=(232, 196, 64, 255))
    if mark == 'h':
        d.rectangle((20, S // 2 - 5, S - 20, S // 2 + 5), fill=(232, 196, 64, 255))
    if mark == 'cross':  # zebra crossing (stripes run vertically)
        for x in range(10, S, 50):
            d.rectangle((x, 0, x + 26, S), fill=(222, 222, 216, 255))
    if mark == 'crossh':
        for y in range(10, S, 50):
            d.rectangle((0, y, S, y + 26), fill=(222, 222, 216, 255))
    return finish(img)


def floor_sidewalk(v):
    img = base((176, 172, 162), noise(S, 6, 31 + v, 3), 12)
    d = ImageDraw.Draw(img)
    for i in range(2):
        for j in range(2):
            x0, y0 = i * S // 2, j * S // 2
            d.rectangle((x0, y0, x0 + S // 2, y0 + S // 2), outline=(130, 127, 120, 255), width=3)
            d.line((x0 + 3, y0 + 3, x0 + S // 2 - 3, y0 + 3), fill=(200, 197, 188, 255), width=3)
            d.line((x0 + 3, y0 + 3, x0 + 3, y0 + S // 2 - 3), fill=(200, 197, 188, 255), width=3)
    return finish(img)


def floor_sand(v):
    n = noise(S, 3, 41 + v, 4)
    img = base((206, 176, 122), n, 18)
    d = ImageDraw.Draw(img)
    r = rng('sand', v)
    for k in range(5):                                     # wind ripples
        y = r.randrange(S)
        pts = [(x, y + 6 * math.sin(x / 23 + k)) for x in range(0, S + 10, 10)]
        d.line(pts, fill=(186, 154, 102, 140), width=3)
    for _ in range(60):
        x, y = r.randrange(S), r.randrange(S)
        d.point((x, y), fill=(150, 120, 80, 255))
    return finish(img)


def floor_grass(v):
    n = noise(S, 4, 51 + v, 4)
    img = base((74, 126, 52), n, 26)
    d = ImageDraw.Draw(img)
    r = rng('grass', v)
    for _ in range(420):
        x, y = r.randrange(S), r.randrange(S)
        g = r.randrange(95, 170)
        d.line((x, y, x + r.randrange(-4, 5), y - r.randrange(5, 12)), fill=(g // 2, g, g // 3, 255), width=2)
    if v == 2:
        for _ in range(6):
            x, y = r.randrange(20, S - 20), r.randrange(20, S - 20)
            d.ellipse((x, y, x + 9, y + 9), fill=(236, 220, 90, 255))
    return finish(img)


def floor_dirt(v):
    img = base((122, 92, 62), noise(S, 5, 61 + v, 4), 22)
    d = ImageDraw.Draw(img)
    r = rng('dirt', v)
    for _ in range(40):
        x, y = r.randrange(S), r.randrange(S); s = r.randrange(3, 8)
        c = r.randrange(120, 160)
        d.ellipse((x, y, x + s, y + s), fill=(c, c - 12, c - 28, 255), outline=(70, 52, 36, 255))
    return finish(img)


def floor_metal(v):
    img = base((112, 118, 126), noise(S, 4, 71 + v, 3), 10)
    d = ImageDraw.Draw(img)
    for y in range(8, S, 24):                              # diamond tread
        for x in range(8 + (y // 24 % 2) * 12, S, 24):
            d.line((x - 5, y + 3, x + 5, y - 3), fill=(150, 156, 164, 255), width=4)
            d.line((x - 5, y + 4, x + 5, y - 2), fill=(80, 85, 92, 255), width=2)
    d.rectangle((0, 0, S - 1, S - 1), outline=(70, 74, 80, 255), width=4)
    for x, y in ((14, 14), (S - 14, 14), (14, S - 14), (S - 14, S - 14)):
        d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(160, 166, 174, 255), outline=(60, 64, 70, 255), width=2)
    return finish(img)


def floor_carpet(v, color):
    img = base(color, noise(S, 16, 81 + v, 2), 14)
    d = ImageDraw.Draw(img)
    dark = tuple(max(0, c - 28) for c in color)
    for k in range(0, S, 50):                              # subtle pattern
        d.line((k, 0, k, S), fill=dark + (255,), width=2)
        d.line((0, k, S, k), fill=dark + (255,), width=2)
    for x in range(25, S, 50):
        for y in range(25, S, 50):
            d.regular_polygon((x, y, 9), 4, rotation=45, fill=tuple(min(255, c + 22) for c in color) + (255,))
    return finish(img)


def floor_labtile(v):
    img = base((222, 228, 232), noise(S, 4, 91 + v, 2), 6)
    d = ImageDraw.Draw(img)
    for k in range(0, S + 1, 50):
        d.line((k, 0, k, S), fill=(160, 170, 178, 255), width=3)
        d.line((0, k, S, k), fill=(160, 170, 178, 255), width=3)
    return finish(img)


def floor_wood(v):
    img = base((150, 104, 62), noise(S, 3, 101 + v, 3), 12)
    d = ImageDraw.Draw(img)
    r = rng('wood', v)
    ph = S // 5
    for i in range(5):
        y = i * ph
        tone = r.randrange(-18, 18)
        d.rectangle((0, y, S, y + ph), fill=(150 + tone, 104 + tone, 62 + tone // 2, 255))
        for _ in range(4):
            gy = y + r.randrange(4, ph - 4)
            d.line((0, gy, S, gy + r.randrange(-3, 4)), fill=(118 + tone, 80 + tone, 46, 160), width=1)
        d.line((0, y, S, y), fill=(84, 56, 32, 255), width=3)
        jx = r.randrange(20, S - 20)
        d.line((jx, y, jx, y + ph), fill=(84, 56, 32, 255), width=3)
    return finish(img)


def floor_gravel(v):
    img = base((120, 120, 116), noise(S, 8, 111 + v, 3), 14)
    d = ImageDraw.Draw(img)
    r = rng('grav', v)
    for _ in range(260):
        x, y = r.randrange(S), r.randrange(S); s = r.randrange(3, 7); c = r.randrange(85, 175)
        d.ellipse((x, y, x + s, y + s), fill=(c, c, c - 4, 255))
    return finish(img)


def floor_stone(v):
    img = base((128, 122, 112), noise(S, 5, 121 + v, 3), 14)
    d = ImageDraw.Draw(img)
    r = rng('stone', v)
    rows = [0, 70, 130, S]
    for i in range(3):
        x = -r.randrange(0, 60)
        while x < S:
            w = r.randrange(60, 110)
            tone = r.randrange(-16, 16)
            d.rectangle((x + 3, rows[i] + 3, x + w - 3, rows[i + 1] - 3), fill=(134 + tone, 127 + tone, 116 + tone, 255))
            x += w
    return finish(img)


def floor_track(v):
    g = floor_gravel(v).resize((S, S))
    d = ImageDraw.Draw(g)
    for y in range(10, S, 40):                              # sleepers
        d.rectangle((30, y, S - 30, y + 18), fill=(90, 66, 44, 255), outline=(50, 36, 24, 255), width=2)
    for x in (60, S - 60):                                  # rails
        d.rectangle((x - 6, 0, x + 6, S), fill=(150, 152, 156, 255))
        d.line((x - 2, 0, x - 2, S), fill=(210, 212, 216, 255), width=3)
    return finish(g)


def floor_grate(v):
    img = base((20, 22, 26))
    d = ImageDraw.Draw(img)
    for k in range(0, S + 1, 20):
        d.line((k, 0, k, S), fill=(96, 100, 108, 255), width=6)
        d.line((0, k, S, k), fill=(78, 82, 90, 255), width=4)
    return finish(img)


def water_frames(count=8):
    frames = []
    for f in range(count):
        t = f / count * 2 * math.pi
        y, x = np.mgrid[0:S, 0:S] / S * 2 * math.pi
        w = (np.sin(x * 2 + t) + np.sin(y * 3 - t) + np.sin((x + y) * 2 + t * 2)) / 3
        arr = np.zeros((S, S, 4))
        arr[..., 0] = 34 + 14 * w
        arr[..., 1] = 98 + 24 * w
        arr[..., 2] = 120 + 26 * w
        arr[..., 3] = 255
        spark = np.clip((w - 0.62) * 600, 0, 140)
        arr[..., :3] += spark[..., None]
        frames.append(finish(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')))
    return frames


FLOORS = {
    'concrete': floor_concrete, 'asphalt': floor_asphalt, 'sidewalk': floor_sidewalk,
    'sand': floor_sand, 'grass': floor_grass, 'dirt': floor_dirt, 'metal': floor_metal,
    'carpet_red': lambda v: floor_carpet(v, (150, 44, 46)), 'carpet_blue': lambda v: floor_carpet(v, (52, 72, 132)),
    'labtile': floor_labtile, 'wood': floor_wood, 'gravel': floor_gravel, 'stone': floor_stone,
    'track': floor_track, 'grate': floor_grate,
    'asphalt_v': lambda v: floor_asphalt(v, 'v'), 'asphalt_h': lambda v: floor_asphalt(v, 'h'),
    'cross_v': lambda v: floor_asphalt(v, 'cross'), 'cross_h': lambda v: floor_asphalt(v, 'crossh'),
}


def floor_with_ao(name, variant, ao):
    """Floor tile with ambient occlusion from solid neighbours (ao: set of 'n','w','nw')."""
    img = FLOORS[name](variant).resize((S, S), Image.BICUBIC)
    if 'n' in ao: img = grad_edge(img, 'n', 34, 120)
    if 'w' in ao: img = grad_edge(img, 'w', 34, 120)
    if 'nw' in ao and 'n' not in ao and 'w' not in ao:
        ov = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(ov).ellipse((-34, -34, 34, 34), fill=(0, 0, 0, 110))
        img = Image.alpha_composite(img, ov.filter(ImageFilter.GaussianBlur(10)))
    return finish(img)


# ── walls (auto-tiled: mask bit set = neighbour is the same wall) ───────────
N, E, So, W = 1, 2, 4, 8


def wall_texture(mat, seed):
    r = rng('wall', mat, seed)
    if mat == 'brick':
        img = base((150, 70, 54), noise(S, 6, 201 + seed, 3), 14)
        d = ImageDraw.Draw(img)
        bh = 25
        for i, y in enumerate(range(0, S, bh)):
            off = 0 if i % 2 == 0 else 25
            for x in range(-50 + off, S, 50):
                tone = r.randrange(-18, 18)
                d.rectangle((x + 2, y + 2, x + 48, y + bh - 2), fill=(158 + tone, 74 + tone // 2, 56, 255))
        return img
    if mat == 'concrete':
        img = base((168, 168, 162), noise(S, 5, 211 + seed, 3), 12)
        d = ImageDraw.Draw(img)
        d.line((0, S // 2, S, S // 2), fill=(138, 138, 132, 255), width=3)
        return img
    if mat == 'metal':
        img = base((96, 104, 114), noise(S, 4, 221 + seed, 3), 10)
        d = ImageDraw.Draw(img)
        for k in (0, S // 2):
            d.rectangle((k + 4, 4, k + S // 2 - 4, S - 4), outline=(70, 76, 86, 255), width=3)
            for y in (16, S - 16):
                d.ellipse((k + 10, y - 4, k + 18, y + 4), fill=(150, 158, 168, 255))
        return img
    if mat == 'hedge':
        img = base((44, 92, 38), noise(S, 5, 231 + seed, 4), 26)
        d = ImageDraw.Draw(img)
        for _ in range(90):
            x, y = r.randrange(S), r.randrange(S); s = r.randrange(10, 22); g = r.randrange(80, 150)
            d.ellipse((x - s, y - s, x + s, y + s), fill=(g // 3, g, g // 4, 210))
        return img
    if mat == 'stone':
        img = base((122, 118, 110), noise(S, 5, 241 + seed, 3), 12)
        d = ImageDraw.Draw(img)
        for i, y in enumerate(range(0, S, 50)):
            off = 0 if i % 2 == 0 else 40
            for x in range(-80 + off, S, 80):
                tone = r.randrange(-14, 14)
                d.rounded_rectangle((x + 3, y + 3, x + 77, y + 47), 6, fill=(132 + tone, 127 + tone, 118 + tone, 255))
        return img
    if mat == 'roof':
        return floor_gravel(seed).resize((S, S)).copy()
    if mat == 'rock':
        img = base((108, 96, 84), noise(S, 3, 251 + seed, 5), 34)
        return img
    if mat == 'cubicle':
        return base((128, 132, 140), noise(S, 16, 261 + seed, 2), 8)
    if mat == 'container_red' or mat == 'container_blue':
        col = (160, 52, 40) if mat == 'container_red' else (44, 86, 140)
        img = base(col, noise(S, 4, 271 + seed, 2), 8)
        d = ImageDraw.Draw(img)
        for x in range(0, S, 16):
            d.line((x, 0, x, S), fill=tuple(c - 30 for c in col) + (255,), width=5)
        return img
    if mat == 'trailer':
        img = base((214, 210, 198), noise(S, 4, 281 + seed, 2), 8)
        d = ImageDraw.Draw(img)
        for y in range(0, S, 20):
            d.line((0, y, S, y), fill=(186, 182, 170, 255), width=3)
        return img
    raise KeyError(mat)


def wall_tile(mat, mask, seed=0):
    img = wall_texture(mat, seed).resize((S, S))
    bevel = 16 if mat not in ('hedge', 'rock') else 10
    exposed = {d: not (mask & bit) for d, bit in (('n', N), ('e', E), ('s', So), ('w', W))}
    if mat == 'roof':          # flat roof: raised parapet along exposed edges
        d = ImageDraw.Draw(img)
        for side, ex in exposed.items():
            if not ex: continue
            box = {'n': (0, 0, S, 22), 's': (0, S - 22, S, S), 'w': (0, 0, 22, S), 'e': (S - 22, 0, S, S)}[side]
            d.rectangle(box, fill=(176, 172, 164, 255))
    # Light from the top-left: exposed top/left edges catch light, bottom/right fall in shade.
    if exposed['n']: img = grad_edge(img, 'n', bevel, 90, (255, 255, 255))
    if exposed['w']: img = grad_edge(img, 'w', bevel, 70, (255, 255, 255))
    if exposed['s']: img = grad_edge(img, 's', bevel + 6, 150)
    if exposed['e']: img = grad_edge(img, 'e', bevel + 6, 130)
    d = ImageDraw.Draw(img)
    for side, ex in exposed.items():      # crisp dark outline on exposed edges
        if not ex: continue
        box = {'n': (0, 0, S, 3), 's': (0, S - 4, S, S), 'w': (0, 0, 3, S), 'e': (S - 4, 0, S, S)}[side]
        d.rectangle(box, fill=(18, 18, 20, 255))
    return finish(img)


# ── props (on a floor background, may span several tiles) ──────────────────
def prop_layer(kind, wt, ht, seed):
    """Transparent RGBA layer (wt×ht tiles at S scale) with the prop drawn on it."""
    W_, H_ = wt * S, ht * S
    lay = Image.new('RGBA', (W_, H_), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    r = rng('prop', kind, seed)
    m = 16
    if kind == 'crate':
        d.rectangle((m, m, W_ - m, H_ - m), fill=(166, 116, 62, 255), outline=(70, 46, 22, 255), width=6)
        d.rectangle((m + 14, m + 14, W_ - m - 14, H_ - m - 14), outline=(120, 80, 40, 255), width=5)
        d.line((m + 14, m + 14, W_ - m - 14, H_ - m - 14), fill=(120, 80, 40, 255), width=8)
        d.line((m + 8, m + 8, W_ - m - 8, m + 8), fill=(205, 160, 104, 255), width=4)
    elif kind in ('barrel_red', 'barrel_blue', 'barrel_yellow'):
        col = {'barrel_red': (176, 46, 38), 'barrel_blue': (40, 92, 160), 'barrel_yellow': (214, 172, 34)}[kind]
        for cx in range(wt):
            for cy in range(ht):
                x0, y0 = cx * S + 30, cy * S + 30
                d.ellipse((x0, y0, x0 + S - 60, y0 + S - 60), fill=col + (255,), outline=(20, 20, 20, 255), width=5)
                d.ellipse((x0 + 22, y0 + 22, x0 + S - 82, y0 + S - 82), outline=tuple(c - 40 for c in col) + (255,), width=5)
                d.ellipse((x0 + 30, y0 + 26, x0 + 54, y0 + 50), fill=(30, 30, 30, 255))
                d.arc((x0 + 6, y0 + 6, x0 + S - 66, y0 + S - 66), 200, 280, fill=(255, 255, 255, 120), width=6)
    elif kind in ('car_red', 'car_blue', 'car_white'):
        col = {'car_red': (186, 40, 38), 'car_blue': (40, 80, 170), 'car_white': (220, 222, 226)}[kind]
        vertical = ht >= wt
        L = (H_ if vertical else W_) - 30
        Wd = (W_ if vertical else H_) - 50
        car = Image.new('RGBA', (Wd, L), (0, 0, 0, 0))
        cd = ImageDraw.Draw(car)
        cd.rounded_rectangle((0, 0, Wd - 1, L - 1), 34, fill=col + (255,), outline=(20, 20, 24, 255), width=6)
        cd.rounded_rectangle((18, L * 0.22, Wd - 18, L * 0.38), 14, fill=(60, 90, 110, 255))   # windscreen
        cd.rounded_rectangle((18, L * 0.38, Wd - 18, L * 0.72), 10, fill=tuple(max(0, c - 25) for c in col) + (255,))  # roof
        cd.rounded_rectangle((22, L * 0.72, Wd - 22, L * 0.82), 10, fill=(60, 90, 110, 255))   # rear window
        for x in (8, Wd - 30):
            cd.rectangle((x, 14, x + 22, 34), fill=(250, 240, 180, 255))                       # headlights
        if not vertical:
            car = car.rotate(90, expand=True)
        lay.alpha_composite(car, ((W_ - car.width) // 2, (H_ - car.height) // 2))
    elif kind == 'desk':
        d.rectangle((m, m + 10, W_ - m, H_ - m - 10), fill=(126, 92, 60, 255), outline=(60, 40, 24, 255), width=5)
        for i in range(wt):
            x = i * S + S // 2
            d.rectangle((x - 30, m + 26, x + 30, m + 70), fill=(36, 40, 46, 255), outline=(10, 10, 12, 255), width=3)  # monitor
            d.rectangle((x - 26, m + 30, x + 26, m + 62), fill=(70, 150, 200, 255))
            d.rectangle((x - 34, m + 90, x + 34, m + 106), fill=(210, 210, 210, 255))      # keyboard
    elif kind == 'plant':
        for i in range(wt):
            for j in range(ht):
                cx, cy = i * S + S // 2, j * S + S // 2
                d.ellipse((cx - 40, cy - 40, cx + 40, cy + 40), fill=(150, 96, 60, 255), outline=(70, 40, 20, 255), width=5)
                for k in range(9):
                    a = k / 9 * 2 * math.pi
                    d.ellipse((cx + 34 * math.cos(a) - 24, cy + 34 * math.sin(a) - 24, cx + 34 * math.cos(a) + 24, cy + 34 * math.sin(a) + 24),
                              fill=(50 + r.randrange(30), 120 + r.randrange(50), 40, 255))
                d.ellipse((cx - 22, cy - 22, cx + 22, cy + 22), fill=(80, 160, 60, 255))
    elif kind == 'tree':
        for i in range(wt):
            for j in range(ht):
                cx, cy = i * S + S // 2, j * S + S // 2
                for k in range(14):
                    a = r.random() * 2 * math.pi; rr = r.randrange(10, 60); s = r.randrange(30, 55)
                    g = r.randrange(70, 130)
                    d.ellipse((cx + rr * math.cos(a) - s, cy + rr * math.sin(a) - s, cx + rr * math.cos(a) + s, cy + rr * math.sin(a) + s),
                              fill=(g // 3, g, g // 4, 255))
                d.ellipse((cx - 50, cy - 60, cx + 10, cy - 10), fill=(150, 200, 110, 70))
    elif kind == 'pillar':
        for i in range(wt):
            for j in range(ht):
                x0, y0 = i * S + 24, j * S + 24
                d.rectangle((x0, y0, x0 + S - 48, y0 + S - 48), fill=(186, 186, 180, 255), outline=(60, 60, 60, 255), width=6)
                d.rectangle((x0 + 18, y0 + 18, x0 + S - 66, y0 + S - 66), outline=(150, 150, 144, 255), width=4)
    elif kind == 'sandbags':
        for row in range(ht * 3):
            y = row * S // 3 + 10
            for col in range(wt * 3):
                x = col * S // 3 + (20 if row % 2 else 4)
                if x + 56 > W_: continue
                d.rounded_rectangle((x, y, x + 56, y + 46), 20, fill=(176, 158, 112, 255), outline=(96, 82, 52, 255), width=4)
    elif kind == 'tank':          # lab tank: glowing liquid cylinder
        cx, cy, rad = W_ // 2, H_ // 2, min(W_, H_) // 2 - 18
        d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=(70, 78, 86, 255), outline=(20, 22, 26, 255), width=8)
        d.ellipse((cx - rad + 22, cy - rad + 22, cx + rad - 22, cy + rad - 22), fill=(60, 220, 140, 255))
        d.ellipse((cx - rad + 40, cy - rad + 36, cx - 10, cy - 10), fill=(180, 255, 210, 160))
    elif kind == 'machine':
        d.rectangle((m, m, W_ - m, H_ - m), fill=(92, 98, 108, 255), outline=(30, 32, 36, 255), width=6)
        for i in range(wt):
            for j in range(ht):
                x, y = i * S + S // 2, j * S + S // 2
                d.ellipse((x - 34, y - 34, x + 34, y + 34), fill=(60, 64, 72, 255), outline=(150, 156, 166, 255), width=5)
                for k in range(6):
                    a = k / 6 * math.pi * 2
                    d.line((x, y, x + 30 * math.cos(a), y + 30 * math.sin(a)), fill=(150, 156, 166, 255), width=4)
        d.rectangle((m + 10, m + 10, m + 50, m + 26), fill=(230, 180, 40, 255))
    elif kind == 'vending':
        d.rectangle((m, m + 10, W_ - m, H_ - m - 10), fill=(196, 40, 44, 255), outline=(30, 10, 10, 255), width=6)
        d.rectangle((m + 16, m + 26, W_ - m - 50, H_ - m - 26), fill=(150, 210, 240, 255))
        for y in range(m + 40, H_ - m - 30, 24):
            d.line((m + 20, y, W_ - m - 54, y), fill=(255, 255, 255, 200), width=3)
    elif kind == 'bench':
        for k in range(3):
            y = m + 30 + k * 40
            d.rectangle((m, y, W_ - m, y + 26), fill=(150, 104, 60, 255), outline=(70, 46, 24, 255), width=4)
    elif kind == 'dumpster':
        d.rectangle((m, m + 12, W_ - m, H_ - m - 12), fill=(52, 110, 60, 255), outline=(20, 40, 22, 255), width=7)
        for x in range(m + 30, W_ - m, 60):
            d.line((x, m + 12, x, H_ - m - 12), fill=(40, 86, 48, 255), width=6)
    else:
        raise KeyError(kind)
    return lay


def prop_tiles(kind, floor, wt, ht, seed):
    """Returns {(i, j): tile image} for a wt×ht prop placed on `floor`."""
    lay = prop_layer(kind, wt, ht, seed)
    big = Image.new('RGBA', (wt * S, ht * S))
    for i in range(wt):
        for j in range(ht):
            big.paste(FLOORS[floor](hash((i, j, seed)) % 3).resize((S, S)), (i * S, j * S))
    big.alpha_composite(drop_shadow(lay))
    big.alpha_composite(lay)
    return {(i, j): finish(big.crop((i * S, j * S, (i + 1) * S, (j + 1) * S))) for i in range(wt) for j in range(ht)}

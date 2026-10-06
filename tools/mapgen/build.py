#!/usr/bin/env python3
"""Builds the game's maps and map tileset from tools/mapgen/maps.py.

Writes docs/data/maps/*.dat, docs/sprites/maps/atlas.{png,webp,json}.
Usage: python3 tools/mapgen/build.py   (needs: pip install pillow numpy)
"""
import json, os, sys
from collections import deque
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import tiles as T
import paint as PT
import numpy as np
from maps import MAPS, DEBUG_MAP

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs')
FLOOR_KEYS, WALL_KEYS = '.,;:', '#%&'
PROP_SINGLE = {'c': ('crate', 3), 'o': ('pillar', 3), 'b': ('barrel_red', 3), 'B': ('barrel_blue', 3),
               'y': ('barrel_yellow', 3), 't': ('tree', 3), 'p': ('plant', 3), 'v': ('vending', 3), 'u': ('dumpster', 3),
               'a': ('table', 3)}
PROP_MULTI = {'d': ('desk', 4), 's': ('sandbags', 4), 'n': ('bench', 4), 'K': ('car_red', 3), 'L': ('car_blue', 3),
              'M': ('car_white', 3), 'T': ('tank', 3), 'm': ('machine', 3)}
WEAPONS = {**{str(i): i for i in range(1, 10)}, '!': 10, '@': 11, '$': 12}
RESPAWN = {10: 30, 11: 30, 12: 30, 5: 25}


def expand(spec):
    rows = spec['rows']
    w = max(len(r) for r in rows)
    def pad(r):
        # Short rows continue with their last floor/wall char (never a spawn,
        # weapon or prop, which would be duplicated).
        fill = next((ch for ch in reversed(r) if ch in FLOOR_KEYS + WALL_KEYS + 'xw'), '.')
        return r + fill * (w - len(r))
    rows = [pad(r) for r in rows]
    m = spec.get('mirror')
    if m in ('h', 'hv'):
        rows = [r + r[-2::-1] for r in rows]
    if m == 'hv':
        rows = rows + rows[-2::-1]
    return rows


def nearest_floor(rows, x, y):
    h, w = len(rows), len(rows[0])
    seen, q = {(x, y)}, deque([(x, y)])
    while q:
        cx, cy = q.popleft()
        ch = rows[cy][cx]
        if ch in FLOOR_KEYS:
            return ch
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen:
                seen.add((nx, ny)); q.append((nx, ny))
    return '.'


def build_map(spec, registry):
    rows = expand(spec)
    h, w = len(rows), len(rows[0])
    floors = {'.': spec['floors']['A'], ',': spec['floors'].get('B'), ';': spec['floors'].get('C'), ':': spec['floors'].get('D')}
    walls = {'#': spec['walls']['A'], '%': spec['walls'].get('B'), '&': spec['walls'].get('C')}
    cells = [[None] * w for _ in range(h)]
    info = [[None] * w for _ in range(h)]      # for the painter
    spawns, weapons = [], []
    solid = lambda ch: ch in WALL_KEYS

    done = set()
    for y in range(h):
        for x in range(w):
            ch = rows[y][x]
            vrt = (x * 7 + y * 13 + (x * y) % 5) % 3
            if ch in FLOOR_KEYS or ch == 'S' or ch in WEAPONS:
                fch = ch if ch in FLOOR_KEYS else nearest_floor(rows, x, y)
                mat = floors[fch]
                if mat is None: raise SystemExit(f"{spec['file']}: floor '{fch}' not defined")
                ao = set()
                if y > 0 and solid(rows[y - 1][x]): ao.add('n')
                if x > 0 and solid(rows[y][x - 1]): ao.add('w')
                if x > 0 and y > 0 and solid(rows[y - 1][x - 1]): ao.add('nw')
                cells[y][x] = (('floor', mat, vrt, tuple(sorted(ao))), 0)
                info[y][x] = dict(kind='floor', mat=mat)
                if ch == 'S': spawns.append((x, y))
                if ch in WEAPONS: weapons.append((x, y, WEAPONS[ch]))
            elif ch in WALL_KEYS:
                mat = walls[ch]
                mask = 0
                if y > 0 and rows[y - 1][x] == ch: mask |= T.N
                if x < w - 1 and rows[y][x + 1] == ch: mask |= T.E
                if y < h - 1 and rows[y + 1][x] == ch: mask |= T.So
                if x > 0 and rows[y][x - 1] == ch: mask |= T.W
                cells[y][x] = (('wall', mat, mask), 3)
                info[y][x] = dict(kind='wall', mat=mat)
            elif ch == 'x':
                cells[y][x] = (None, 4)
                info[y][x] = dict(kind='void')
            elif ch == 'w':
                cells[y][x] = (('water',), 4)
                info[y][x] = dict(kind='water')
            elif ch in PROP_SINGLE:
                kind, col = PROP_SINGLE[ch]
                fl = floors[nearest_floor(rows, x, y)]
                cells[y][x] = (('prop', kind, fl, 1, 1, 0, 0, (x + y) % 2), col)
                info[y][x] = dict(kind='prop', floor=fl, prop=(kind, 1, 1, 0, 0))
            elif ch in PROP_MULTI and (x, y) not in done:
                kind, col = PROP_MULTI[ch]
                x1 = x
                while x1 + 1 < w and rows[y][x1 + 1] == ch: x1 += 1
                y1 = y
                while y1 + 1 < h and all(rows[y1 + 1][i] == ch for i in range(x, x1 + 1)): y1 += 1
                fl = floors[nearest_floor(rows, x, y)]
                pw, ph = x1 - x + 1, y1 - y + 1
                for j in range(ph):
                    for i in range(pw):
                        done.add((x + i, y + j))
                        cells[y + j][x + i] = (('prop', kind, fl, pw, ph, i, j, 0), col)
                        info[y + j][x + i] = dict(kind='prop', floor=fl, prop=(kind, pw, ph, i, j))
            elif (x, y) in done:
                pass
            else:
                raise SystemExit(f"{spec['file']}: unknown char {ch!r} at {x},{y}")

    check_reachable(spec, cells, spawns, weapons)
    codes = []
    for y in range(h):
        for x in range(w):
            desc, col = cells[y][x]
            # The picture comes from the painted background; only water is an
            # animated tile drawn on top of it.
            key = 'W00' if desc == ('water',) else '000'
            codes.append(f'{key}00{col}')
    spec['_info'] = info
    return rows, codes, spawns, weapons


def check_reachable(spec, cells, spawns, weapons):
    h, w = len(cells), len(cells[0])
    if len(spawns) < 2: raise SystemExit(f"{spec['file']}: needs at least 2 spawns")
    walk = lambda x, y: 0 <= x < w and 0 <= y < h and cells[y][x][1] < 3
    start = spawns[0]
    seen, q = {start}, deque([start])
    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if walk(nx, ny) and (nx, ny) not in seen:
                seen.add((nx, ny)); q.append((nx, ny))
    bad = [(x, y) for x, y in spawns + [(a, b) for a, b, _ in weapons] if (x, y) not in seen]
    if bad:
        rows = expand(spec)
        for y in range(h):
            print(''.join('?' if (x, y) in bad else ('_' if cells[y][x][1] < 3 and (x, y) not in seen else rows[y][x]) for x in range(w)))
        raise SystemExit(f"{spec['file']}: {bad} not reachable from the first spawn (_ = unreachable floor)")
    # The playable area must be closed (walking off the map edge is impossible).
    for x, y in seen:
        if x in (0, w - 1) or y in (0, h - 1):
            raise SystemExit(f"{spec['file']}: walkable cell on the map border at {x},{y}")


class Registry:
    def __init__(self):
        self.codes = {}
        self.n = 0

    def code(self, desc):
        if desc not in self.codes:
            digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            n = self.n + 36 * 36 * 10       # start at 'A00'
            self.codes[desc] = digits[n // 1296] + digits[n // 36 % 36] + digits[n % 36]
            self.n += 1
        return self.codes[desc]


def paint(desc, cache):
    kind = desc[0]
    if kind == 'floor':
        _, mat, v, ao = desc
        return [T.floor_with_ao(mat, v, set(ao))]
    if kind == 'wall':
        return [T.wall_tile(desc[1], desc[2])]
    if kind == 'water':
        return T.water_frames()
    if kind == 'prop':
        _, k, fl, pw, ph, i, j, seed = desc
        key = (k, fl, pw, ph, seed)
        if key not in cache: cache[key] = T.prop_tiles(k, fl, pw, ph, seed)
        return [cache[key][(i, j)]]


def write_atlas():
    """Tile atlas: only the animated water (semi-transparent over the painting)."""
    frames_img = T.water_frames()
    tile, pad = T.TILE, 2
    cell = tile + pad * 2
    sheet = Image.new('RGBA', (cell * len(frames_img), cell), (0, 0, 0, 0))
    frames, keys = {}, []
    for i, im in enumerate(frames_img):
        im = im.copy(); im.putalpha(150)
        big = im.resize((cell, cell), Image.NEAREST)
        sheet.paste(big, (i * cell, 0)); sheet.paste(im, (i * cell + pad, pad))
        key = f'W00_f{i:03d}.png'
        frames[key] = {'frame': {'x': i * cell + pad, 'y': pad, 'w': tile, 'h': tile}}
        keys.append(key)
    frames['W00.png'] = frames[keys[0]]
    out = os.path.join(ROOT, 'sprites', 'maps')
    for f in os.listdir(out): os.remove(os.path.join(out, f))
    sheet.save(os.path.join(out, 'atlas.png'), optimize=True)
    sheet.save(os.path.join(out, 'atlas.webp'), quality=90, method=6)
    json.dump({'frames': frames, 'tileAnimations': {'W00': {'fps': 8, 'frames': keys}}},
              open(os.path.join(out, 'atlas.json'), 'w'), separators=(',', ':'))


THEMES = {
    'asphaltstreets.dat': dict(puddles=True, graffiti=0.35, outside='asphalt', outdecor=['tree', 'car_red', 'car_white', 'dumpster', 'bush'], outdensity=0.25),
    'officefloor.dat': dict(lamps=10, dirt=(60, 52, 48), grade=(1.02, 1.0, 0.98)),
    'stormchannel.dat': dict(puddles=True, graffiti=0.3, grade=(0.95, 1.0, 1.02), outside='concrete', outdecor=['bush', 'crate', 'barrel_blue', 'tree'], outdensity=0.2),
    'trailerpark.dat': dict(dirt=(110, 84, 54), grade=(1.05, 1.0, 0.92), outside='dirt', outdecor=['tree', 'tree', 'bush', 'rock']),
    'orbitstation.dat': dict(void='space', lamps=8, grade=(0.95, 0.98, 1.06)),
    'biolab.dat': dict(lamps=10, dirt=(70, 76, 70), grade=(0.97, 1.02, 1.03)),
    'containerport.dat': dict(puddles=True, graffiti=0.2, outside='asphalt', outdecor=['crate', 'barrel_blue', 'barrel_red'], outdensity=0.18),
    'thepitarena.dat': dict(dirt=(90, 70, 50), grade=(1.04, 1.0, 0.93), outside='sand', outdecor=['rock', 'rock', 'bush'], outdensity=0.3),
    'hedgemaze.dat': dict(dirt=(60, 70, 40), outside='grass', outdecor=['tree', 'tree', 'bush', 'rock'], outdensity=0.55),
    'shipyard.dat': dict(puddles=True, grade=(0.97, 1.0, 1.03)),
    'foundry.dat': dict(lamps=8, dirt=(60, 50, 40), grade=(1.05, 0.98, 0.92)),
    'sandbase.dat': dict(dirt=(130, 100, 64), grade=(1.06, 1.0, 0.9), outside='sand', outdecor=['rock', 'bush', 'barrel_yellow'], outdensity=0.25),
    'stonekeep.dat': dict(dirt=(70, 66, 50), grade=(1.0, 1.0, 0.96), outside='grass', outdecor=['tree', 'tree', 'bush', 'rock'], outdensity=0.5),
    'rooftops.dat': dict(void='street', puddles=True, graffiti=0.2),
    'metroline.dat': dict(lamps=12, dirt=(54, 52, 50), graffiti=0.25),
    'debug.dat': dict(),
}


def write_background(spec, seed):
    img = PT.paint_map(spec['_info'], THEMES.get(spec['file'], {}), seed=seed)
    name = spec['file'].replace('.dat', '.webp')
    Image.fromarray(img).save(os.path.join(ROOT, 'data', 'maps', name), quality=85, method=6)
    return name


def write_dat(spec, rows, codes, spawns, weapons, bg):
    h, w = len(rows), len(rows[0])
    sp = ' '.join(f'{x * 50} {y * 50}' for x, y in spawns)
    ws = ' '.join(f'{x * 50} {y * 50} {wid} {RESPAWN.get(wid, 20)}' for x, y, wid in weapons)
    text = (f"inf={w} {h} {spec['name']}&tiles=\n{' '.join(codes)} \n&sp= {sp} \n&ws= {ws} \n"
            f"&rt= 300 \n&ts=0 \n&bg={bg} \n&bgpad={PT.P} \n&bgpx={PT.PX} \n")
    open(os.path.join(ROOT, 'data', 'maps', spec['file']), 'w').write(text)


def main():
    only = sys.argv[1:]
    registry = Registry()
    built = []
    for spec in MAPS + [DEBUG_MAP]:
        if only and spec['file'] not in only: continue
        rows, codes, spawns, weapons = build_map(spec, registry)
        built.append((spec, rows, codes, spawns, weapons))
        print(f"{spec['file']:22s} {len(rows[0])}x{len(rows)}  spawns {len(spawns)}  weapons {len(weapons)}")
    mapdir = os.path.join(ROOT, 'data', 'maps')
    if not only:
        for f in os.listdir(mapdir):
            if f.endswith(('.dat', '.webp')): os.remove(os.path.join(mapdir, f))
    for i, b in enumerate(built):
        bg = write_background(b[0], seed=1000 + i * 17)
        write_dat(*b, bg)
        print('painted', bg)
    write_atlas()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Trims transparent borders off every frame of the big sprite atlases and
repacks them into a compact sheet (each at most 4096 px on a side).

The original sheets were mostly empty space (player: 4085x6715, 74% unused
after trimming each frame), which costs phones ~110 MB of GPU memory for that
sheet alone and exceeds the 4096 px texture limit of many mobile GPUs: the
browser then re-uploads pieces of it while drawing (visible stutter).

Each trimmed frame keeps its original size and position in the JSON
(sw, sh = source size; tx, ty = where the trimmed pixels sat inside it), so
AtlasSpritesheet.getFrameData() places it exactly where it was before.

Usage: python3 tools/trim-atlases.py [atlas-dir ...]   (default: the big ones)
Requires: pip install pillow
"""
import json, os, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'sprites')
DEFAULT = ['blood/spritesheet']
PAD = 2
MAX = 4096


def rect(raw):
    return raw.get('frame', raw)


def pack(sizes, width):
    """Shelf packing, tallest first. Returns ({key: (x, y)}, height)."""
    order = sorted(sizes, key=lambda k: (-sizes[k][1], -sizes[k][0]))
    x = y = shelf = 0
    pos = {}
    for k in order:
        w, h = sizes[k]
        if x + w > width:
            x, y, shelf = 0, y + shelf + PAD, 0
        pos[k] = (x, y)
        x += w + PAD
        shelf = max(shelf, h)
    return pos, y + shelf


def trim(base):
    jpath = os.path.join(ROOT, base + '.json')
    ppath = os.path.join(ROOT, base + '.png')
    data = json.load(open(jpath, encoding='utf-8-sig'))
    if data.get('meta', {}).get('trimmed'):
        print(f'{base}: already trimmed')
        return
    img = Image.open(ppath).convert('RGBA')
    frames = data['frames']

    # Identical source rectangles (shared frames) are trimmed and stored once.
    crops, sizes, info = {}, {}, {}
    for key, raw in frames.items():
        f = rect(raw)
        src = (f['x'], f['y'], f['w'], f['h'])
        if src not in crops:
            c = img.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
            bb = c.getchannel('A').getbbox() or (0, 0, 1, 1)
            # Keep a 1 px transparent border (when the frame had one) so
            # filtered drawing fades the edges exactly as before.
            bb = (max(0, bb[0] - 1), max(0, bb[1] - 1), min(f['w'], bb[2] + 1), min(f['h'], bb[3] + 1))
            crops[src] = (c.crop(bb), bb)
            sizes[src] = (bb[2] - bb[0], bb[3] - bb[1])
        info[key] = src

    # Narrowest power-of-two-ish width that keeps the sheet roughly square.
    area = sum(w * h for w, h in sizes.values())
    width = MAX
    for w in (1024, 2048, 3072, 4096):
        pos, h = pack(sizes, w)
        if h <= w * 1.25 or w == MAX:
            width = w
            break
    pos, height = pack(sizes, width)
    if height > MAX:
        sys.exit(f'{base}: packed sheet {width}x{height} exceeds {MAX}px')

    sheet = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for src, (x, y) in pos.items():
        sheet.paste(crops[src][0], (x, y))

    out = {}
    for key, raw in frames.items():
        src = info[key]
        (x, y), bb = pos[src], crops[src][1]
        w, h = sizes[src]
        entry = {k: v for k, v in raw.items() if k not in ('frame', 'x', 'y', 'w', 'h')}
        entry.update({'x': x, 'y': y, 'w': w, 'h': h,
                      'tx': bb[0], 'ty': bb[1], 'sw': src[2], 'sh': src[3]})
        out[key] = entry
    data['frames'] = out
    data.setdefault('meta', {})['trimmed'] = True

    old = img.size
    sheet.save(ppath, optimize=True)
    sheet.save(os.path.join(ROOT, base + '.webp'), lossless=True, quality=100, method=6)
    json.dump(data, open(jpath, 'w'), separators=(',', ':'))
    print(f'{base}: {old[0]}x{old[1]} -> {width}x{height} '
          f'({old[0] * old[1] / 1e6:.1f} -> {width * height / 1e6:.1f} Mpx, {area / (width * height) * 100:.0f}% used)')


if __name__ == '__main__':
    for b in sys.argv[1:] or DEFAULT:
        trim(b)

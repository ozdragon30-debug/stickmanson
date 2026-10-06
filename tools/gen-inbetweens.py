#!/usr/bin/env python3
"""Generate in-between animation frames (optical-flow interpolation).

The game's sprite animations are hand-drawn at 12 fps. This tool computes
STEPS-1 intermediate drawings between every pair of consecutive frames so the
client can *display* them at 60 fps (STEPS=5). Animation timing and every
gameplay event still run on the original 12 fps frames: the in-betweens are
drawing-only.

Usage: python3 tools/gen-inbetweens.py [--only anim1,anim2] [--preview out.png]
Requires: pip install opencv-python-headless numpy
"""
import argparse, json, os, sys
import numpy as np
import cv2

ROOT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'sprites', 'player')
STEPS = 5  # 12 fps × 5 = 60 fps


def load_atlas():
    meta = json.load(open(os.path.join(ROOT, 'spritesheet.json')))
    img = cv2.imread(os.path.join(ROOT, 'spritesheet.png'), cv2.IMREAD_UNCHANGED)
    if img.shape[2] == 3:
        img = np.dstack([img, np.full(img.shape[:2], 255, np.uint8)])
    return meta, img


def frame_rect(meta, key):
    raw = meta['frames'][key]
    return raw.get('frame', raw)


def origin_of(meta, anim, f):
    so = meta.get('set_origins', {}).get(anim)
    if so and so.get('ox') is not None:
        return so['ox'], so['oy']
    return round(f['w'] / 2), round(f['h'] * 0.95)


def to_premul(rgba):
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    return np.concatenate([rgb * a, a], axis=2)


def from_premul(p):
    a = np.clip(p[..., 3:4], 0, 1)
    rgb = np.where(a > 1e-4, p[..., :3] / np.maximum(a, 1e-4), 0)
    out = np.concatenate([np.clip(rgb, 0, 1), a], axis=2)
    return (out * 255 + 0.5).astype(np.uint8)


def flow_input(p):
    # Drawn pixels (alpha) carry most of the structure; add luminance detail.
    a = p[..., 3]
    lum = p[..., :3].mean(axis=2)
    g = a * 0.7 + lum * 0.3
    return (np.clip(g, 0, 1) * 255).astype(np.uint8)


_dis = None
def flow(a, b):
    global _dis
    if _dis is None:
        _dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        _dis.setFinestScale(0)
    # Thin lines move far between drawings: blur gives the coarse levels
    # something to lock onto, then the sharp images refine it.
    return _dis.calc(cv2.GaussianBlur(a, (0, 0), 1.2), cv2.GaussianBlur(b, (0, 0), 1.2), None)


def warp(img, fl):
    h, w = fl.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(img, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=0)


# When the two warped drawings disagree this much (mean alpha difference over
# the drawn area) the motion was too large to track: hold the nearest original
# drawing instead of blending two ghosts. Worst case = the original 12 fps look.
MAX_MISMATCH = 0.10
SAME_EPS = 0.16
HOLD_THIS, HOLD_NEXT = 'this', 'next'


def interpolate(pa, pb, ts):
    """pa, pb: premultiplied float images on the same canvas. Returns list per t."""
    ga, gb = flow_input(pa), flow_input(pb)
    f01, f10 = flow(ga, gb), flow(gb, ga)
    out = []
    for t in ts:
        # Linear-motion approximation of the flow from time t to each end.
        ft0 = -(1 - t) * t * f01 + t * t * f10
        ft1 = (1 - t) * (1 - t) * f01 - t * (1 - t) * f10
        wa, wb = warp(pa, ft0), warp(pb, ft1)
        drawn = np.maximum(wa[..., 3], wb[..., 3]) > 0.2
        mismatch = np.abs(wa[..., 3] - wb[..., 3])[drawn].mean() if drawn.any() else 0
        if mismatch > MAX_MISMATCH:
            out.append(HOLD_NEXT if t >= 0.5 else HOLD_THIS)
            interpolate.held += 1
        else:
            img = (1 - t) * wa + t * wb
            # Barely different from the nearest original drawing: not worth
            # storing, the client shows that original instead.
            near = pb if t >= 0.5 else pa
            if np.abs(img - near).max() < SAME_EPS:
                out.append(HOLD_NEXT if t >= 0.5 else HOLD_THIS)
                interpolate.same += 1
            else:
                out.append(img)
        interpolate.total += 1
    return out
interpolate.held = interpolate.total = interpolate.same = 0


def place(atlas, f, ox, oy, cw, ch, cx, cy):
    """Copy frame f (origin ox,oy) onto a cw×ch canvas whose origin is cx,cy."""
    c = np.zeros((ch, cw, 4), np.uint8)
    x0, y0 = cx - ox, cy - oy
    c[y0:y0 + f['h'], x0:x0 + f['w']] = atlas[f['y']:f['y'] + f['h'], f['x']:f['x'] + f['w']]
    return c


def crop(img):
    a = img[..., 3]
    ys, xs = np.nonzero(a > 2)
    if not len(xs):
        return img[:1, :1], 0, 0
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return img[y0:y1, x0:x1], x0, y0


def build(meta, atlas, only=None):
    """Returns ({key: (rgba, ox, oy)}, {key: 1 for 'show the next original'})."""
    result, holds = {}, {}
    for anim in meta['animations']:
        name, keys = anim['name'], anim['frames']
        if only and name not in only:
            continue
        rects = [frame_rect(meta, k) for k in keys]
        origins = [origin_of(meta, name, f) for f in rects]
        for i, key in enumerate(keys):
            # Pair each frame with the next; the last pairs with the first
            # (the client skips it when a one-shot animation ends there).
            j = (i + 1) % len(keys)
            if j == i:
                continue
            fa, fb = rects[i], rects[j]
            (oax, oay), (obx, oby) = origins[i], origins[j]
            pad = 6
            left = max(oax, obx) + pad
            top = max(oay, oby) + pad
            right = max(fa['w'] - oax, fb['w'] - obx) + pad
            bottom = max(fa['h'] - oay, fb['h'] - oby) + pad
            cw, ch = left + right, top + bottom
            pa = to_premul(place(atlas, fa, oax, oay, cw, ch, left, top))
            pb = to_premul(place(atlas, fb, obx, oby, cw, ch, left, top))
            ts = [k / STEPS for k in range(1, STEPS)]
            for k, p in enumerate(interpolate(pa, pb, ts), start=1):
                if isinstance(p, str):
                    if p == HOLD_NEXT:
                        holds[f'{key}~{k}'] = 1
                    continue
                img, x0, y0 = crop(from_premul(p))
                result[f'{key}~{k}'] = (img, left - x0, top - y0)
    return result, holds


def pack(frames, max_w=4096):
    """Shelf-pack frames into one atlas. Returns (image, json-frames)."""
    items = sorted(frames.items(), key=lambda kv: -kv[1][0].shape[0])
    x = y = shelf = 0
    pos = {}
    for key, (img, ox, oy) in items:
        h, w = img.shape[:2]
        if x + w > max_w:
            x, y, shelf = 0, y + shelf + 2, 0
        pos[key] = (x, y, w, h, ox, oy)
        x += w + 2
        shelf = max(shelf, h)
    sheet = np.zeros((y + shelf, max_w, 4), np.uint8)
    out = {}
    for key, (x, y, w, h, ox, oy) in pos.items():
        sheet[y:y + h, x:x + w] = frames[key][0]
        out[key] = {'x': int(x), 'y': int(y), 'w': int(w), 'h': int(h), 'ox': int(ox), 'oy': int(oy)}
    return sheet, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--preview')
    ap.add_argument('--out', default=os.path.join(ROOT, 'inbetween'))
    args = ap.parse_args()
    meta, atlas = load_atlas()
    only = set(args.only.split(',')) if args.only else None
    frames, holds = build(meta, atlas, only)
    if args.preview:
        preview(meta, atlas, frames, sorted(only or []), args.preview)
        print(f'held (untrackable motion): {interpolate.held}/{interpolate.total}')
        return
    # One sheet per group (legs, then each weapon) so the client only loads
    # the drawings it is about to show.
    groups = {}
    for key, v in frames.items():
        groups.setdefault(group_of(key), {})[key] = v
    index = {'steps': STEPS, 'groups': {}, 'next': holds}
    total = 0
    for g, fr in sorted(groups.items()):
        sheet, fjson = pack(fr, max_w=2048)
        rgba = cv2.cvtColor(sheet, cv2.COLOR_BGRA2RGBA)
        from PIL import Image
        path = f'{args.out}_{g}.webp'
        Image.fromarray(rgba).save(path, quality=88, alpha_quality=90, method=6)
        index['groups'][g] = fjson
        total += os.path.getsize(path)
    json.dump(index, open(args.out + '.json', 'w'), separators=(',', ':'))
    print(f'held (untrackable motion): {interpolate.held}, near-identical: {interpolate.same}, total: {interpolate.total}')
    print(f'{len(frames)} in-between frames in {len(groups)} sheets, {total / 1e6:.1f} MB')


def group_of(key):
    name = key.split('~')[0].rsplit('_', 1)[0]  # e.g. "ak47_shoot"
    if name in ('walk', 'run'):
        return 'legs'
    for w in ('laser_sword', 'tesla_helmet'):
        if name.startswith(w):
            return w
    return name.split('_')[0]


def preview(meta, atlas, frames, anims, path):
    """Contact sheet: each row = original frame followed by its in-betweens."""
    rows = []
    for name in anims:
        anim = next(a for a in meta['animations'] if a['name'] == name)
        for key in anim['frames'][:6]:
            f = frame_rect(meta, key)
            ox, oy = origin_of(meta, name, f)
            cells = [(atlas[f['y']:f['y'] + f['h'], f['x']:f['x'] + f['w']], ox, oy)]
            cells += [frames[f'{key}~{k}'] for k in range(1, STEPS)]
            rows.append(cells)
    cell = 150
    sheet = np.full((cell * len(rows), cell * STEPS, 4), 255, np.uint8)
    for r, cells in enumerate(rows):
        for c, (img, ox, oy) in enumerate(cells):
            x0, y0 = c * cell + cell // 2 - ox, r * cell + cell // 2 - oy
            h, w = img.shape[:2]
            ys, xs = slice(max(0, y0), min(sheet.shape[0], y0 + h)), slice(max(0, x0), min(sheet.shape[1], x0 + w))
            sub = img[ys.start - y0:ys.stop - y0, xs.start - x0:xs.stop - x0].astype(np.float32)
            a = sub[..., 3:4] / 255
            dst = sheet[ys, xs].astype(np.float32)
            dst[..., :3] = dst[..., :3] * (1 - a) + sub[..., :3] * a
            sheet[ys, xs] = dst.astype(np.uint8)
        sheet[r * cell, :, :3] = 200
    for c in range(STEPS):
        sheet[:, c * cell, :3] = 200 if c else 0
    cv2.imwrite(path, sheet)
    print('preview →', path)


if __name__ == '__main__':
    main()

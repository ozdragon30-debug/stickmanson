// Geometry used by gameplay: tile collision, line of sight and the hit tests
// for each weapon shape. All positions are world pixels; tiles are 50 px.

const TILE_PX = 50;

class Physics {
  // ── Small vector helpers ──────────────────────────────────────────────────
  static distance(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Perpendicular distance from point p to the infinite line through a and b.
  static distanceToLine(p, a, b) {
    const cross = (b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x;
    return Math.abs(cross) / Physics.distance(a, b);
  }

  // Point (ox, oy) turned by `rotation` radians around (cx, cy).
  static rotatePoint(cx, cy, ox, oy, rotation) {
    const dx = ox - cx, dy = oy - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    const a = Math.atan2(dy, dx) + rotation;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  // A circle touches a (rotated) rectangle when it is within `radius` of any
  // of the lines through its four sides.
  static isCircleCollidingRect(circle, rect, radius = Constants.STICK_FIGURE_HEAD_RADIUS) {
    const { topLeft: a, topRight: b, bottomLeft: c, bottomRight: d } = rect;
    return Physics.distanceToLine(circle, a, b) <= radius ||
           Physics.distanceToLine(circle, b, c) <= radius ||
           Physics.distanceToLine(circle, c, d) <= radius ||
           Physics.distanceToLine(circle, d, a) <= radius;
  }

  // ── Tile collision ────────────────────────────────────────────────────────
  // Collision code c: ≤2 open, 3 and 4 fully solid, 5–9 partly solid. The
  // partial shapes are defined for an unrotated, unflipped tile; the point is
  // mapped back into that frame (undo rotation r × 90°, then the flip f).
  static isTileWalkBlocked(tile, localX, localY) {
    const { c, r, f = 0 } = tile;
    if (c <= 2) return false;
    if (c === 3 || c === 4) return true;
    const S = TILE_PX;
    let x = localX, y = localY;
    switch (r) {
      case 1: [x, y] = [y, S - x]; break;
      case 2: [x, y] = [S - x, S - y]; break;
      case 3: [x, y] = [S - y, x]; break;
    }
    if (f & 1) x = S - x;
    if (f & 2) y = S - y;
    const half = S / 2;
    switch (c) {
      case 5: return y < S * 0.75;
      case 6: return y < half;
      case 7: return y < S * 0.25;
      case 8: return x < half && y < half;
      case 9: return y < half || x < half;
      default: return false;
    }
  }

  // ── Weapon hit shapes ─────────────────────────────────────────────────────
  // Ray: the target's centre lies ahead (0 … maxRange along the aim) and no
  // further than `radius` from the aim line.
  static isRayHit(origin, targetPos, rotation, maxRange, radius = Constants.STICK_FIGURE_HEAD_RADIUS) {
    const dx = targetPos.x - origin.x, dy = targetPos.y - origin.y;
    const ux = Math.cos(rotation), uy = Math.sin(rotation);
    const along = dx * ux + dy * uy;
    const side = Math.abs(dx * uy - dy * ux);
    return along >= 0 && along <= maxRange && side <= radius;
  }

  // Circle: anything within maxRange, whatever the aim.
  static isCircleHit(origin, targetPos, maxRange) {
    return Physics.distance(targetPos, origin) <= maxRange;
  }

  // Cone: within maxRange and within spreadAngle/2 degrees of the aim.
  static isConeHit(origin, targetPos, rotation, maxRange, spreadAngle) {
    const dx = targetPos.x - origin.x, dy = targetPos.y - origin.y;
    if (Math.sqrt(dx * dx + dy * dy) > maxRange) return false;
    let off = Math.atan2(dy, dx) - rotation;
    off = Math.atan2(Math.sin(off), Math.cos(off));         // wrap to [-π, π]
    return Math.abs(off) <= (spreadAngle * Math.PI / 180) / 2;
  }

  // ── Line of sight ─────────────────────────────────────────────────────────
  // True when a bullet-blocking tile (c = 3) lies between the two points. The
  // segment is sampled every 10 px from `from` up to and including `to`.
  static checkForObstacles(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const steps = Math.sqrt(dx * dx + dy * dy) / 10;
    const sx = dx / steps, sy = dy / steps;
    const cols = (typeof map !== 'undefined' && map.ready) ? map.width : 35;
    const haveGrid = obstacleGrid.length > 0;
    let x = from.x, y = from.y;
    for (let i = 0; i <= steps; i++) {
      const tile = obstacleGrid[Math.floor(x / TILE_PX) + Math.floor(y / TILE_PX) * cols];
      if (haveGrid && tile && tile.c === 3) return true;
      x += sx; y += sy;
    }
    return false;
  }
}

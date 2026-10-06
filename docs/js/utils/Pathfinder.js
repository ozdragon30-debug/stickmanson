// Grid route planner for the bot AI.
//
// Levels are laid out on a lattice of 50 px square tiles. A route is searched on
// that lattice with A* (eight-way moves, Manhattan estimate) and handed back as a
// list of tile-centre waypoints in world pixels, start tile first.
//
// How a tile is treated depends on the collision code `c` in the obstacle grid:
//   no entry, or c <= 2   open      - step cost 1
//   c is 3 or 4           solid     - never entered
//   c from 5 to 9         partial   - entered only when the middle of the tile is
//                                     free, and then priced so high (25) that the
//                                     search avoids it whenever it can
//   anything else         open      - step cost 1
// A diagonal step costs 1.4 times the tile price and is only allowed when both
// tiles it cuts past are enterable.

class Pathfinder {
  static TILE_PX = 50;
  static SEARCH_CAP = 2000;        // stop once this many tiles carry a cost
  static PARTIAL_TILE_COST = 25;
  static DIAGONAL_FACTOR = 1.4;

  // Moves are tried in this exact order (axis-aligned ones first); the order
  // decides which of two equally cheap routes wins.
  static AXIS_MOVES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  static CORNER_MOVES = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  /**
   * Plan a walkable route between two world points.
   * @param {{x:number,y:number}} start
   * @param {{x:number,y:number}} goal
   * @param {Object} map            Level description (needs width / height in tiles).
   * @param {Array}  obstacleGrid   Row-major collision cells of the level.
   * @returns {Array<{x:number,y:number}>|null} Waypoints, or null when no route exists.
   */
  static findPath(start, goal, map, obstacleGrid) {
    if (!map || !obstacleGrid || obstacleGrid.length === 0) return null;

    const from = Pathfinder._cellAt(start);
    const dest = Pathfinder._cellAt(goal);
    if (!Pathfinder._inside(from.col, from.row, map)) return null;
    if (!Pathfinder._inside(dest.col, dest.row, map)) return null;

    // Already standing in the goal tile: walk straight to the point itself.
    if (from.col === dest.col && from.row === dest.row) return [goal];

    // Cells are identified by their row-major index.
    const cols = map.width;
    const originId = from.row * cols + from.col;
    const targetId = dest.row * cols + dest.col;

    const frontier = new Set([originId]);   // insertion order matters for ties
    const cameVia = new Map();
    const spent = new Map([[originId, 0]]);
    const ranking = new Map([[originId, Pathfinder._estimate(from.col, from.row, dest)]]);

    while (frontier.size > 0) {
      const node = Pathfinder._bestCandidate(frontier, ranking);
      if (node === targetId) return Pathfinder._traceBack(cameVia, node, cols);

      frontier.delete(node);
      const col = node % cols;
      const row = (node - col) / cols;
      const soFar = spent.get(node) || 0;

      for (const step of Pathfinder._exits(col, row, map, obstacleGrid)) {
        const id = step.row * cols + step.col;
        const total = soFar + step.cost;
        if (spent.has(id) && total >= spent.get(id)) continue;
        cameVia.set(id, node);
        spent.set(id, total);
        ranking.set(id, total + Pathfinder._estimate(step.col, step.row, dest));
        frontier.add(id);
      }

      if (spent.size > Pathfinder.SEARCH_CAP) return null;
    }
    return null;
  }

  /**
   * Thin out a waypoint list: from each kept point jump to the furthest later
   * point that is in clear sight of it.
   */
  static simplifyPath(path, obstacleGrid, map) {
    if (path.length <= 2) return path;

    const kept = [path[0]];
    let anchor = 0;
    const last = path.length - 1;
    while (anchor < last) {
      let jump = anchor + 1;
      for (let probe = last; probe > anchor + 1; probe--) {
        if (!Physics.checkForObstacles(path[anchor], path[probe])) { jump = probe; break; }
      }
      kept.push(path[jump]);
      anchor = jump;
    }
    return kept;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  static _cellAt(point) {
    return {
      col: Math.floor(point.x / Pathfinder.TILE_PX),
      row: Math.floor(point.y / Pathfinder.TILE_PX),
    };
  }

  static _inside(col, row, map) {
    return col >= 0 && col < map.width && row >= 0 && row < map.height;
  }

  static _estimate(col, row, dest) {
    return Math.abs(col - dest.col) + Math.abs(row - dest.row);
  }

  /** Frontier entry with the strictly lowest ranking; earliest entry wins ties. */
  static _bestCandidate(frontier, ranking) {
    let pick = null;
    let pickScore = Infinity;
    for (const id of frontier) {
      const score = ranking.get(id) || Infinity;
      if (score < pickScore) {
        pickScore = score;
        pick = id;
      }
    }
    return pick;
  }

  /** Price of stepping onto a cell, or null when it cannot be entered. */
  static _entryCost(col, row, map, obstacleGrid) {
    if (!Pathfinder._inside(col, row, map)) return null;

    const cell = obstacleGrid[row * map.width + col];
    if (!cell) return 1;

    const code = cell.c;
    if (code <= 2) return 1;
    if (code >= 3 && code <= 4) return null;
    if (code >= 5 && code <= 9) {
      const half = Pathfinder.TILE_PX / 2;
      const middleBlocked = typeof Physics !== 'undefined' && Physics.isTileWalkBlocked(cell, half, half);
      return middleBlocked ? null : Pathfinder.PARTIAL_TILE_COST;
    }
    return 1;
  }

  /** Every cell reachable in one move from (col, row), with its move cost. */
  static _exits(col, row, map, obstacleGrid) {
    const out = [];

    for (const [dc, dr] of Pathfinder.AXIS_MOVES) {
      const cost = Pathfinder._entryCost(col + dc, row + dr, map, obstacleGrid);
      if (cost !== null) out.push({ col: col + dc, row: row + dr, cost });
    }

    for (const [dc, dr] of Pathfinder.CORNER_MOVES) {
      // No squeezing between two blocked tiles: both sides must be open.
      const sideA = Pathfinder._entryCost(col, row + dr, map, obstacleGrid);
      const sideB = Pathfinder._entryCost(col + dc, row, map, obstacleGrid);
      if (sideA === null || sideB === null) continue;
      const cost = Pathfinder._entryCost(col + dc, row + dr, map, obstacleGrid);
      if (cost !== null) out.push({ col: col + dc, row: row + dr, cost: cost * Pathfinder.DIAGONAL_FACTOR });
    }

    return out;
  }

  /** Follow the parent links back to the origin and emit tile centres in walking order. */
  static _traceBack(cameVia, endId, cols) {
    const ids = [endId];
    let id = endId;
    while (cameVia.has(id)) {
      id = cameVia.get(id);
      ids.push(id);
    }
    ids.reverse();

    const half = Pathfinder.TILE_PX / 2;
    return ids.map(cellId => {
      const col = cellId % cols;
      const row = (cellId - col) / cols;
      return { x: col * Pathfinder.TILE_PX + half, y: row * Pathfinder.TILE_PX + half };
    });
  }
}

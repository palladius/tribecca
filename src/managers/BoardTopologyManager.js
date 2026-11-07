/**
 * @fileoverview BoardTopologyManager — Exact 96-square Hexagonal Three-Player Chess Topology
 * matching Riccardo's physical pyrography wooden board (`assets/scacchiera_fisica_riccardo.png`)
 * and the official rules from video `NMLVaFImzVs` (Triple S Games) & Riccardo's Google Doc.
 *
 * Headless manager (Niccolò Rule #6: zero DOM or Three.js imports).
 */

export const PLAYER_COLORS = ['white', 'red', 'green'];

export const SECTOR_META = {
  white: {
    index: 0,
    color: 'white',
    labelIt: 'Bianco',
    labelEn: 'White',
    cameraAngleDeg: 0,
    files: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    ranks: [1, 2, 3, 4],
    rosetteSquares: ['D4', 'E4'],
  },
  red: {
    index: 1,
    color: 'red',
    labelIt: 'Rosso',
    labelEn: 'Red',
    cameraAngleDeg: 120,
    files: ['L', 'K', 'J', 'I', 'D', 'C', 'B', 'A'],
    ranks: [8, 7, 6, 5],
    rosetteSquares: ['I5', 'D5'],
  },
  green: {
    index: 2,
    color: 'green',
    labelIt: 'Verde',
    labelEn: 'Green',
    cameraAngleDeg: 240,
    files: ['H', 'G', 'F', 'E', 'I', 'J', 'K', 'L'],
    ranks: [12, 11, 10, 9],
    rosetteSquares: ['E9', 'I9'],
  },
};

export const ROSETTE_SQUARES = new Set(['D4', 'D5', 'I5', 'I9', 'E9', 'E4']);

/**
 * Opposite Rosette square of the DIFFERENT color across the central 6-way point.
 * Forbidden for diagonal Bishop/Queen moves [01:15] and King steps [01:22].
 */
export const FORBIDDEN_ROSETTE_OPPOSITE = {
  D4: 'I9',
  I9: 'D4',
  E4: 'I5',
  I5: 'E4',
  D5: 'E9',
  E9: 'D5',
};

export class BoardTopologyManager {
  /**
   * @param {number} [boardRadius=6.0] Outer radius of the regular hexagon in world units
   */
  constructor(boardRadius = 6.0) {
    this.boardRadius = boardRadius;
    /** @type {Map<string, SquareNode>} */
    this.squares = new Map();
    /** @type {Map<string, string>} key `${s}:${c}:${r}` -> squareId (e.g. 'D4') */
    this.coordToId = new Map();

    this._buildTopology();
  }

  init(ctx) {
    this.ctx = ctx;
  }

  update() {}
  lateUpdate() {}
  dispose() {}

  _key(s, c, r) {
    return `${s}:${c}:${r}`;
  }

  /**
   * Builds the 96 quadrilateral squares, their exact 2D/3D vertices, centers, colors,
   * and the orthogonal & diagonal directed ray graphs.
   */
  _buildTopology() {
    const R = this.boardRadius;
    // Regular hexagon with flat bottom edge (White A1..H1 at South, z = +R * cos(30°))
    // Coordinate convention: +x = East (right), +z = South (bottom, toward White player).
    // Moving clockwise: Bottom-Left (V0=A1) -> Far-Left (V1=A8) -> Top-Left (V2=L8)
    // -> Top-Right (V3=L12) -> Far-Right (V4=H12) -> Bottom-Right (V5=H1).
    // Wait: let's list the 6 outer vertices so that Sector s (s=0,1,2) has:
    //   Outer-Left corner (col=0, row=0) = hexCornerLeft(s)
    //   Outer-Right corner (col=8, row=0) = hexCornerRight(s)
    //   Left rank-edge corner (col=0, row=8) = hexCornerLeft(s+1)
    // For s=0 (White at South):
    //   col=0, row=0 (A1) is at angle +120° from +x? Wait:
    //   Bottom edge has z = +R * sqrt(3)/2, x from -R/2 (A1) to +R/2 (H1).
    //   In polar angle phi from +x (where +z is +90° South):
    //     H1 = (+R/2, +R*sqrt(3)/2) -> phi = 60° (π/3)
    //     A1 = (-R/2, +R*sqrt(3)/2) -> phi = 120° (2π/3)
    //     A8 = (-R, 0)              -> phi = 180° (π)
    //     L8 = (-R/2, -R*sqrt(3)/2) -> phi = 240° (4π/3)
    //     L12= (+R/2, -R*sqrt(3)/2) -> phi = 300° (5π/3)
    //     H12= (+R, 0)              -> phi = 0° (0)
    // Notice that rotating clockwise by 120° (+2π/3 in phi):
    //   Sector 0 (White): A1 (120°) -> H1 (60°), back-rank midpoint at 90° (0, +R*sqrt(3)/2)
    //   Sector 1 (Red):   L8 (240°) -> A8 (180°), back-rank midpoint at 210°
    //   Sector 2 (Green): H12 (0°/360°) -> L12 (300°), back-rank midpoint at 330°
    // And notice the hinge line from 90° (between D1/E1) through (0,0) to 270° (between L5/L9)!
    const vtx = (deg) => {
      const rad = (deg * Math.PI) / 180;
      return { x: R * Math.cos(rad), z: R * Math.sin(rad) };
    };
    const mid = (p1, p2) => ({ x: 0.5 * (p1.x + p2.x), z: 0.5 * (p1.z + p2.z) });
    const bilerp = (p00, p10, p11, p01, u, v) => ({
      x:
        (1 - u) * (1 - v) * p00.x +
        u * (1 - v) * p10.x +
        u * v * p11.x +
        (1 - u) * v * p01.x,
      z:
        (1 - u) * (1 - v) * p00.z +
        u * (1 - v) * p10.z +
        u * v * p11.z +
        (1 - u) * v * p01.z,
    });

    const center = { x: 0, z: 0 };
    const colorOrder = PLAYER_COLORS;

    for (let s = 0; s < 3; s++) {
      const color = colorOrder[s];
      const meta = SECTOR_META[color];
      const baseDeg = 120 + s * 120; // Outer-Left corner of sector s (A1=120°, L8=240°, H12=360°)
      const P_outerLeft = vtx(baseDeg);
      const P_outerRight = vtx(baseDeg - 60);
      const P_prevCorner = vtx(baseDeg + 60);
      const P_nextCorner = vtx(baseDeg - 120);

      const M_back = mid(P_outerLeft, P_outerRight);
      const M_leftEdge = mid(P_outerLeft, P_prevCorner);
      const M_rightEdge = mid(P_outerRight, P_nextCorner);

      // Compute grid vertices (9 x 5) for sector s
      const gridPts = Array.from({ length: 9 }, () => Array(5));
      for (let c = 0; c <= 8; c++) {
        for (let r = 0; r <= 4; r++) {
          const v = r / 4;
          if (c <= 4) {
            const u = c / 4;
            gridPts[c][r] = bilerp(P_outerLeft, M_back, center, M_leftEdge, u, v);
          } else {
            const u = (c - 4) / 4;
            gridPts[c][r] = bilerp(M_back, P_outerRight, M_rightEdge, center, u, v);
          }
        }
      }

      for (let c = 0; c < 8; c++) {
        for (let r = 0; r < 4; r++) {
          const file = meta.files[c];
          const rank = meta.ranks[r];
          const id = `${file}${rank}`;
          const isLight = (c + r) % 2 === 1;
          const corners = [
            gridPts[c][r], // SW (outer-left of cell)
            gridPts[c + 1][r], // SE (outer-right of cell)
            gridPts[c + 1][r + 1], // NE (inner-right of cell)
            gridPts[c][r + 1], // NW (inner-left of cell)
          ];
          const centerPt = {
            x: 0.25 * (corners[0].x + corners[1].x + corners[2].x + corners[3].x),
            z: 0.25 * (corners[0].z + corners[1].z + corners[2].z + corners[3].z),
          };
          const node = {
            id,
            file,
            rank,
            sector: s,
            sectorColor: color,
            col: c,
            row: r,
            isLight,
            squareColor: isLight ? 'light' : 'dark',
            isRosette: ROSETTE_SQUARES.has(id),
            corners,
            center: centerPt,
          };
          this.squares.set(id, node);
          this.coordToId.set(this._key(s, c, r), id);
        }
      }
    }
  }

  getSquare(id) {
    return this.squares.get(id) || null;
  }

  getSquareByCoord(s, c, r) {
    const id = this.coordToId.get(this._key(s, c, r));
    return id ? this.squares.get(id) : null;
  }

  getAllSquares() {
    return [...this.squares.values()];
  }

  /**
   * Computes a single orthogonal step from `(s, c, r)` in local direction `(dc, dr)`
   * where `(dc, dr)` is one of `(0, 1)` [UP], `(0, -1)` [DOWN], `(-1, 0)` [LEFT], `(1, 0)` [RIGHT].
   * Returns `{ s, c, r, dc, dr, id, crossedSector }` or `null` if off-board.
   */
  stepOrthogonal(s, c, r, dc, dr) {
    if (dr !== 0) {
      const nr = r + dr;
      if (nr >= 0 && nr <= 3) {
        const id = this.coordToId.get(this._key(s, c, nr));
        return { s, c, r: nr, dc: 0, dr, id, crossedSector: false };
      }
      if (nr > 3) {
        // Crosses inner sector boundary (row 3 -> other sector row 3, heading DOWN dr = -1)
        const ns = c < 4 ? (s + 1) % 3 : (s + 2) % 3;
        const nc = 7 - c;
        const id = this.coordToId.get(this._key(ns, nc, 3));
        return { s: ns, c: nc, r: 3, dc: 0, dr: -1, id, crossedSector: true };
      }
      return null; // nr < 0: off outer back-rank edge
    }

    if (dc !== 0) {
      const nc = c + dc;
      if (nc >= 0 && nc <= 7) {
        const id = this.coordToId.get(this._key(s, nc, r));
        return { s, c: nc, r, dc, dr: 0, id, crossedSector: false };
      }
      return null;
    }
    return null;
  }

  /**
   * Returns the 4 orthogonal rays starting from `squareId`.
   * Each ray is an object `{ dirName, steps: Array<{id, crossedSector}> }`.
   * Respects rules [01:38], [01:48], [01:56]: Rooks always pass through opposite lateral edges
   * and NEVER jump across the central Rosette vertex.
   */
  getOrthogonalRays(squareId) {
    const start = this.getSquare(squareId);
    if (!start) return [];
    const dirs = [
      { dirName: 'forward', dc: 0, dr: 1 },
      { dirName: 'backward', dc: 0, dr: -1 },
      { dirName: 'left', dc: -1, dr: 0 },
      { dirName: 'right', dc: 1, dr: 0 },
    ];
    const rays = [];
    for (const d of dirs) {
      const steps = [];
      let cur = { s: start.sector, c: start.col, r: start.row, dc: d.dc, dr: d.dr };
      const visited = new Set([squareId]);
      while (true) {
        const next = this.stepOrthogonal(cur.s, cur.c, cur.r, cur.dc, cur.dr);
        if (!next || visited.has(next.id)) break;
        visited.add(next.id);
        steps.push({
          id: next.id,
          crossedSector: next.crossedSector,
          isRosette: ROSETTE_SQUARES.has(next.id),
        });
        cur = next;
      }
      if (steps.length > 0) {
        rays.push({
          dirName: d.dirName,
          rayKind: 'orthogonal',
          steps,
        });
      }
    }
    return rays;
  }

  /**
   * Computes the next diagonal step(s) from `(s, c, r)` moving in local diagonal `(dc, dr)`
   * where `dc ∈ {-1, +1}` and `dr ∈ {-1, +1}`.
   *
   * Returns an array of 0, 1, or 2 continuations:
   * - 1 continuation for normal internal steps or side-of-rosette outward deflections [00:58].
   * - 2 continuations (Y-fork!) when crossing the exact central 6-way Rosette vertex [00:48],
   *   staying strictly on the SAME square color (`Light->Light` or `Dark->Dark`) [01:15].
   */
  stepDiagonal(s, c, r, dc, dr) {
    const nc = c + dc;
    const nr = r + dr;

    // Case 1: Stays within sector s
    if (nr >= 0 && nr <= 3) {
      if (nc >= 0 && nc <= 7) {
        const id = this.coordToId.get(this._key(s, nc, nr));
        return [{ s, c: nc, r: nr, dc, dr, id, crossedRosetteCenter: false, deflectedSide: false }];
      }
      return []; // Hit outer left/right edge
    }

    // Case 2: Hit outer back-rank edge (nr < 0)
    if (nr < 0) {
      return [];
    }

    // Case 3: Crosses inner sector boundary (r === 3 and dr === +1, so nr === 4)
    // Which vertex along row=4 does this diagonal step pass through?
    // Vertex column index v_c in {0..8} is `c + (dc === 1 ? 1 : 0)`.
    const vc = c + (dc === 1 ? 1 : 0);

    // Sub-case 3A: Exact Central 6-Way Rosette Vertex (`vc === 4`)! [00:48] & [01:15]
    // This occurs from:
    // - (s, 3, 3) [Dark: D4, I5, E9] with dc = +1, dr = +1 -> branches into ((s+1)%3, 3, 3) and ((s+2)%3, 3, 3) with dc = -1, dr = -1!
    // - (s, 4, 3) [Light: E4, D5, I9] with dc = -1, dr = +1 -> branches into ((s+1)%3, 4, 3) and ((s+2)%3, 4, 3) with dc = +1, dr = -1!
    if (vc === 4) {
      const results = [];
      for (const deltaS of [1, 2]) {
        const ns = (s + deltaS) % 3;
        const targetCol = c; // 3 stays 3 (Dark), 4 stays 4 (Light)!
        const id = this.coordToId.get(this._key(ns, targetCol, 3));
        results.push({
          s: ns,
          c: targetCol,
          r: 3,
          dc: -dc,
          dr: -1,
          id,
          crossedRosetteCenter: true,
          deflectedSide: false,
          branchSector: ns,
        });
      }
      return results;
    }

    // Sub-case 3B: Outer border corner (`vc === 0` or `vc === 8`) -> off board
    if (vc <= 0 || vc >= 8) {
      return [];
    }

    // Sub-case 3C: Side of Rosette (`vc === 3` or `vc === 5`) or Sector Mid-Boundary (`vc ∈ {1,2,6,7}`) [00:58]
    // Deflects outward into neighboring sector maintaining square color!
    const ns = vc < 4 ? (s + 1) % 3 : (s + 2) % 3;
    const targetCol = 7 - nc;
    const id = this.coordToId.get(this._key(ns, targetCol, 3));
    return [
      {
        s: ns,
        c: targetCol,
        r: 3,
        dc: -dc,
        dr: -1,
        id,
        crossedRosetteCenter: false,
        deflectedSide: vc === 3 || vc === 5,
      },
    ];
  }

  /**
   * Returns all diagonal ray branches starting from `squareId`.
   * If a diagonal crosses the central Rosette vertex (`vc === 4`), it splits into 2 distinct rays
   * (Left Branch and Right Branch) that share the prefix steps up to the Rosette entrance!
   */
  getDiagonalRays(squareId) {
    const start = this.getSquare(squareId);
    if (!start) return [];
    const initDirs = [
      { dirName: 'diag_NW', dc: -1, dr: 1 },
      { dirName: 'diag_NE', dc: 1, dr: 1 },
      { dirName: 'diag_SW', dc: -1, dr: -1 },
      { dirName: 'diag_SE', dc: 1, dr: -1 },
    ];

    const rays = [];

    for (const d of initDirs) {
      // BFS/DFS over ray branches (since crossing vc===4 forks into 2 rays)
      const queue = [
        {
          s: start.sector,
          c: start.col,
          r: start.row,
          dc: d.dc,
          dr: d.dr,
          steps: [],
          visited: new Set([squareId]),
          forkTag: '',
          crossedRosette: false,
          deflectedSide: false,
        },
      ];

      while (queue.length > 0) {
        const branch = queue.shift();
        const nextList = this.stepDiagonal(branch.s, branch.c, branch.r, branch.dc, branch.dr);

        if (nextList.length === 0) {
          if (branch.steps.length > 0) {
            rays.push({
              dirName: branch.forkTag ? `${d.dirName}_${branch.forkTag}` : d.dirName,
              rayKind: branch.crossedRosette
                ? 'diagonal_rosette'
                : branch.deflectedSide
                  ? 'diagonal_deflect'
                  : 'diagonal',
              steps: branch.steps,
            });
          }
          continue;
        }

        if (nextList.length === 1) {
          const nx = nextList[0];
          if (branch.visited.has(nx.id)) {
            if (branch.steps.length > 0) {
              rays.push({
                dirName: branch.forkTag ? `${d.dirName}_${branch.forkTag}` : d.dirName,
                rayKind: branch.crossedRosette
                  ? 'diagonal_rosette'
                  : branch.deflectedSide
                    ? 'diagonal_deflect'
                    : 'diagonal',
                steps: branch.steps,
              });
            }
            continue;
          }
          branch.visited.add(nx.id);
          branch.steps.push({
            id: nx.id,
            crossedRosetteCenter: nx.crossedRosetteCenter,
            deflectedSide: nx.deflectedSide,
            isRosette: ROSETTE_SQUARES.has(nx.id),
          });
          branch.s = nx.s;
          branch.c = nx.c;
          branch.r = nx.r;
          branch.dc = nx.dc;
          branch.dr = nx.dr;
          branch.crossedRosette = branch.crossedRosette || nx.crossedRosetteCenter;
          branch.deflectedSide = branch.deflectedSide || nx.deflectedSide;
          queue.push(branch);
        } else {
          // Fork into 2 branches across the central Rosette vertex!
          for (let i = 0; i < nextList.length; i++) {
            const nx = nextList[i];
            if (branch.visited.has(nx.id)) continue;
            const clonedVisited = new Set(branch.visited);
            clonedVisited.add(nx.id);
            const clonedSteps = [
              ...branch.steps,
              {
                id: nx.id,
                crossedRosetteCenter: true,
                deflectedSide: false,
                isRosette: ROSETTE_SQUARES.has(nx.id),
              },
            ];
            queue.push({
              s: nx.s,
              c: nx.c,
              r: nx.r,
              dc: nx.dc,
              dr: nx.dr,
              steps: clonedSteps,
              visited: clonedVisited,
              forkTag: `branch${i + 1}_${PLAYER_COLORS[nx.s]}`,
              crossedRosette: true,
              deflectedSide: branch.deflectedSide,
            });
          }
        }
      }
    }

    return rays;
  }

  /**
   * Computes all Knight "L" jumps from `squareId` ([02:36]: never crosses the center point directly;
   * travels around it using adjacent orthogonal spaces: 2 orthogonal + 1 perpendicular).
   * Returns an array of `{ to, path: [step1Id, step2Id, toId], rayKind: 'knight_L' }`.
   */
  getKnightJumps(squareId) {
    const start = this.getSquare(squareId);
    if (!start) return [];
    const initDirs = [
      { dc: 0, dr: 1 },
      { dc: 0, dr: -1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];

    /** @type {Map<string, {to: string, path: string[], rayKind: string}>} */
    const jumpsByTarget = new Map();

    // Pattern A: 2 steps straight, then 1 step perpendicular
    for (const d1 of initDirs) {
      const s1 = this.stepOrthogonal(start.sector, start.col, start.row, d1.dc, d1.dr);
      if (!s1) continue;
      const s2 = this.stepOrthogonal(s1.s, s1.c, s1.r, s1.dc, s1.dr);
      if (!s2) continue;

      // Perpendicular directions to s2's arrival vector (s2.dc, s2.dr)
      const perpDirs =
        s2.dr !== 0
          ? [
              { dc: -1, dr: 0 },
              { dc: 1, dr: 0 },
            ]
          : [
              { dc: 0, dr: -1 },
              { dc: 0, dr: 1 },
            ];

      for (const dp of perpDirs) {
        const s3 = this.stepOrthogonal(s2.s, s2.c, s2.r, dp.dc, dp.dr);
        if (!s3 || s3.id === squareId) continue;
        if (!jumpsByTarget.has(s3.id)) {
          jumpsByTarget.set(s3.id, {
            to: s3.id,
            path: [squareId, s1.id, s2.id, s3.id],
            rayKind: 'knight_L',
          });
        }
      }
    }

    return [...jumpsByTarget.values()];
  }
}

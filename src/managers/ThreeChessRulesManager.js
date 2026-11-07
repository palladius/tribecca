/**
 * @fileoverview ThreeChessRulesManager — Headless 3-Player Chess Rules Engine for TriBecca.
 * Implements:
 * - Setup for White (`A1..H2`), Red (`L8..A7`), Green/Black (`H12..L11`) with all 3 Queens on Light (`D1, I8, E12`)
 *   and all 3 Kings on Dark (`E1, D8, I12`) [00:15].
 * - Clockwise turn order (`white -> red -> green` or `red -> white -> green`) [00:22].
 * - Full Rosette rules for Bishop [00:48-01:15], Rook [01:38-01:56], Queen [01:15], King [01:22],
 *   Knight [02:36], and Pawn [02:14-02:29].
 * - All 4 Elimination / Victory modes from Riccardo's Google Doc:
 *   1. `destroy` (Default): remove pieces of loser and continue.
 *   2. `protoss_conquer`: conqueror inherits control of loser's surviving pieces.
 *   3. `flotsam_obstacles`: loser's pieces remain as inert obstacles (cannot move or give check, can be captured).
 *   4. `sudden_death`: first checkmate immediately wins the game.
 * - Unlimited Undo / Redo stack & Free Board Editor ("Specchio della Scacchiera Vera").
 */

import {
  PLAYER_COLORS,
  SECTOR_META,
  ROSETTE_SQUARES,
  FORBIDDEN_ROSETTE_OPPOSITE,
} from './BoardTopologyManager.js';

export const ELIMINATION_MODES = {
  destroy: {
    id: 'destroy',
    labelIt: '💥 Distruzione (Default)',
    labelEn: '💥 Destroy (Default)',
    descIt: 'I pezzi dello sconfitto vengono rimossi e gli altri 2 continuano.',
  },
  protoss_conquer: {
    id: 'protoss_conquer',
    labelIt: '🔮 Assimilazione (Conquista)',
    labelEn: '🔮 Army Absorption',
    descIt: 'Chi dà scacco matto prende il controllo dei pezzi superstiti dello sconfitto.',
  },
  flotsam_obstacles: {
    id: 'flotsam_obstacles',
    labelIt: '🪵 Relitti Inerti (Flotsam)',
    labelEn: '🪵 Flotsam Obstacles',
    descIt: 'I pezzi dello sconfitto restano fermi: non muovono e non danno scacco, ma si possono mangiare.',
  },
  sudden_death: {
    id: 'sudden_death',
    labelIt: '⚡ Morte Improvvisa (1° Matto)',
    labelEn: '⚡ Sudden Death',
    descIt: 'La partita finisce subito al primo scacco matto.',
  },
};

export const PIECE_VALUES = {
  p: 100,
  n: 310,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

export class ThreeChessRulesManager {
  /**
   * @param {import('./BoardTopologyManager.js').BoardTopologyManager} topology
   * @param {import('../core/GameEventBus.js').GameEventBus} [bus]
   */
  constructor(topology, bus = null) {
    this.topology = topology;
    this.bus = bus;

    /** @type {'destroy' | 'protoss_conquer' | 'flotsam_obstacles' | 'sudden_death'} */
    this.eliminationMode = 'destroy';
    this.editorMode = false;

    /** @type {Map<string, PieceState>} squareId -> { type, color, originalColor, homeSector, moved, isFlotsam } */
    this.board = new Map();
    /** @type {string[]} */
    this.turnOrder = [...PLAYER_COLORS];
    this.activeColorIndex = 0;
    /** @type {Set<string>} */
    this.eliminatedColors = new Set();
    /** @type {string | null} */
    this.winnerColor = null;
    this.isGameOver = false;
    this.gameOverReason = '';

    /** @type {string | null} */
    this.selectedSquare = null;
    /** @type {Array<any>} */
    this.undoStack = [];
    /** @type {Array<any>} */
    this.redoStack = [];
    /** @type {Array<MoveRecord>} */
    this.moveHistory = [];
    /** @type {Record<string, Array<PieceState>>} */
    this.capturedByColor = { white: [], red: [], green: [] };

    this.resetGame();
  }

  init(ctx) {
    this.ctx = ctx;
    if (!this.bus && ctx?.bus) {
      this.bus = ctx.bus;
    }
  }

  update() {}
  lateUpdate() {}
  dispose() {}

  getActiveColor() {
    return this.turnOrder[this.activeColorIndex];
  }

  setEliminationMode(mode) {
    if (ELIMINATION_MODES[mode]) {
      this.eliminationMode = mode;
      this.bus?.emit({ type: 'ELIMINATION_MODE_CHANGED', mode });
    }
  }

  /**
   * Resets the board to the standard 48-piece starting position matching Riccardo's board photo.
   * Queens start on Light squares (`D1`, `I8`, `E12`), Kings on Dark squares (`E1`, `D8`, `I12`).
   */
  resetGame(firstColor = 'white') {
    this.board.clear();
    this.eliminatedColors.clear();
    this.winnerColor = null;
    this.isGameOver = false;
    this.gameOverReason = '';
    this.selectedSquare = null;
    this.undoStack = [];
    this.redoStack = [];
    this.moveHistory = [];
    this.capturedByColor = { white: [], red: [], green: [] };

    const backRankTypes = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

    for (let s = 0; s < 3; s++) {
      const color = PLAYER_COLORS[s];
      for (let c = 0; c < 8; c++) {
        const backSq = this.topology.getSquareByCoord(s, c, 0);
        const pawnSq = this.topology.getSquareByCoord(s, c, 1);
        this.board.set(backSq.id, {
          type: backRankTypes[c],
          color,
          originalColor: color,
          homeSector: s,
          moved: false,
          isFlotsam: false,
        });
        this.board.set(pawnSq.id, {
          type: 'p',
          color,
          originalColor: color,
          homeSector: s,
          moved: false,
          isFlotsam: false,
          pawnHeadingSector: null, // Locked once pawn enters an enemy sector
        });
      }
    }

    this.activeColorIndex = Math.max(0, this.turnOrder.indexOf(firstColor));
    this.bus?.emit({
      type: 'GAME_RESET',
      activeColor: this.getActiveColor(),
      eliminationMode: this.eliminationMode,
    });
  }

  getPiece(squareId) {
    return this.board.get(squareId) || null;
  }

  /**
   * Serializes a lightweight snapshot for Undo/Redo and AI lookahead.
   */
  _snapshot() {
    const entries = [];
    for (const [sq, p] of this.board.entries()) {
      entries.push([sq, { ...p }]);
    }
    return {
      entries,
      activeColorIndex: this.activeColorIndex,
      eliminatedColors: [...this.eliminatedColors],
      winnerColor: this.winnerColor,
      isGameOver: this.isGameOver,
      gameOverReason: this.gameOverReason,
      moveHistory: [...this.moveHistory],
      capturedByColor: {
        white: [...this.capturedByColor.white],
        red: [...this.capturedByColor.red],
        green: [...this.capturedByColor.green],
      },
    };
  }

  _restoreSnapshot(snap) {
    this.board.clear();
    for (const [sq, p] of snap.entries) {
      this.board.set(sq, { ...p });
    }
    this.activeColorIndex = snap.activeColorIndex;
    this.eliminatedColors = new Set(snap.eliminatedColors);
    this.winnerColor = snap.winnerColor;
    this.isGameOver = snap.isGameOver;
    this.gameOverReason = snap.gameOverReason;
    this.moveHistory = [...snap.moveHistory];
    this.capturedByColor = {
      white: [...snap.capturedByColor.white],
      red: [...snap.capturedByColor.red],
      green: [...snap.capturedByColor.green],
    };
    this.selectedSquare = null;
  }

  /**
   * Generates all pseudo-legal moves and continuous ray trajectories for the piece on `squareId`.
   * Returns `{ moves: LegalMove[], rays: RayDescriptor[], forbiddenRosetteSquare: string | null }`.
   */
  getPseudoLegalMovesAndRays(squareId) {
    const piece = this.board.get(squareId);
    const sqNode = this.topology.getSquare(squareId);
    if (!piece || !sqNode || piece.isFlotsam) {
      return { moves: [], rays: [], forbiddenRosetteSquare: null };
    }

    const moves = [];
    const rays = [];
    let forbiddenRosetteSquare = null;

    if (
      sqNode.isRosette &&
      (piece.type === 'b' || piece.type === 'q' || piece.type === 'k' || piece.type === 'p')
    ) {
      forbiddenRosetteSquare = FORBIDDEN_ROSETTE_OPPOSITE[squareId] || null;
    }

    const canCapture = (targetPiece) => {
      if (!targetPiece) return false;
      if (targetPiece.isFlotsam) return true; // Flotsam obstacles can be captured by anyone [03:30]
      return targetPiece.color !== piece.color;
    };

    // Helper to trace sliding rays (Rook, Bishop, Queen)
    const traceSlidingRays = (topoRays) => {
      for (const r of topoRays) {
        const visibleSteps = [];
        const blockedSteps = [];
        const pathSoFar = [squareId];
        let blocked = false;

        for (const step of r.steps) {
          const occupant = this.board.get(step.id);
          if (!blocked) {
            pathSoFar.push(step.id);
            if (!occupant) {
              visibleSteps.push({ ...step, status: 'empty' });
              moves.push({
                from: squareId,
                to: step.id,
                piece: { ...piece },
                captured: null,
                path: [...pathSoFar],
                rayKind: r.rayKind,
                dirName: r.dirName,
                crossesRosette: Boolean(step.crossedRosetteCenter || r.rayKind === 'diagonal_rosette'),
              });
            } else {
              if (canCapture(occupant)) {
                visibleSteps.push({ ...step, status: 'capture' });
                moves.push({
                  from: squareId,
                  to: step.id,
                  piece: { ...piece },
                  captured: { ...occupant },
                  path: [...pathSoFar],
                  rayKind: r.rayKind,
                  dirName: r.dirName,
                  crossesRosette: Boolean(
                    step.crossedRosetteCenter || r.rayKind === 'diagonal_rosette'
                  ),
                });
              } else {
                visibleSteps.push({ ...step, status: 'blocked_ally' });
              }
              blocked = true;
            }
          } else {
            blockedSteps.push({ ...step, status: 'shadow' });
          }
        }

        if (visibleSteps.length > 0) {
          rays.push({
            from: squareId,
            dirName: r.dirName,
            rayKind: r.rayKind,
            steps: visibleSteps,
            blockedSteps,
          });
        }
      }
    };

    if (piece.type === 'r' || piece.type === 'q') {
      traceSlidingRays(this.topology.getOrthogonalRays(squareId));
    }

    if (piece.type === 'b' || piece.type === 'q') {
      traceSlidingRays(this.topology.getDiagonalRays(squareId));
    }

    if (piece.type === 'k') {
      // King moves 1 step along any orthogonal or diagonal ray (which automatically excludes
      // the opposite-colored Rosette square [01:22])
      const allKingRays = [
        ...this.topology.getOrthogonalRays(squareId),
        ...this.topology.getDiagonalRays(squareId),
      ];
      const seenTargets = new Set();
      for (const r of allKingRays) {
        if (r.steps.length === 0) continue;
        const first = r.steps[0];
        if (seenTargets.has(first.id)) continue;
        seenTargets.add(first.id);

        const occupant = this.board.get(first.id);
        if (!occupant || canCapture(occupant)) {
          const status = occupant ? 'capture' : 'empty';
          moves.push({
            from: squareId,
            to: first.id,
            piece: { ...piece },
            captured: occupant ? { ...occupant } : null,
            path: [squareId, first.id],
            rayKind: r.rayKind,
            dirName: r.dirName,
            crossesRosette: Boolean(first.crossedRosetteCenter),
          });
          rays.push({
            from: squareId,
            dirName: r.dirName,
            rayKind: r.rayKind,
            steps: [{ ...first, status }],
            blockedSteps: [],
          });
        }
      }

      // Castling (Arrocco corto col=6 e lungo col=2 sulla propria traversa di base)
      if (!piece.moved && sqNode.sector === piece.homeSector && sqNode.row === 0 && sqNode.col === 4) {
        // Kingside (col 4 -> col 6, Rook at col 7)
        const rookK = this.topology.getSquareByCoord(sqNode.sector, 7, 0);
        const f1 = this.topology.getSquareByCoord(sqNode.sector, 5, 0);
        const g1 = this.topology.getSquareByCoord(sqNode.sector, 6, 0);
        const rkPiece = rookK ? this.board.get(rookK.id) : null;
        if (
          rkPiece &&
          rkPiece.type === 'r' &&
          rkPiece.color === piece.color &&
          !rkPiece.moved &&
          !this.board.get(f1.id) &&
          !this.board.get(g1.id)
        ) {
          moves.push({
            from: squareId,
            to: g1.id,
            piece: { ...piece },
            captured: null,
            path: [squareId, f1.id, g1.id],
            rayKind: 'castle',
            dirName: 'castle_kingside',
            castleRookFrom: rookK.id,
            castleRookTo: f1.id,
          });
          rays.push({
            from: squareId,
            dirName: 'castle_kingside',
            rayKind: 'castle',
            steps: [
              { id: f1.id, status: 'empty' },
              { id: g1.id, status: 'empty' },
            ],
            blockedSteps: [],
          });
        }

        // Queenside (col 4 -> col 2, Rook at col 0)
        const rookQ = this.topology.getSquareByCoord(sqNode.sector, 0, 0);
        const d1 = this.topology.getSquareByCoord(sqNode.sector, 3, 0);
        const c1 = this.topology.getSquareByCoord(sqNode.sector, 2, 0);
        const b1 = this.topology.getSquareByCoord(sqNode.sector, 1, 0);
        const rqPiece = rookQ ? this.board.get(rookQ.id) : null;
        if (
          rqPiece &&
          rqPiece.type === 'r' &&
          rqPiece.color === piece.color &&
          !rqPiece.moved &&
          !this.board.get(d1.id) &&
          !this.board.get(c1.id) &&
          !this.board.get(b1.id)
        ) {
          moves.push({
            from: squareId,
            to: c1.id,
            piece: { ...piece },
            captured: null,
            path: [squareId, d1.id, c1.id],
            rayKind: 'castle',
            dirName: 'castle_queenside',
            castleRookFrom: rookQ.id,
            castleRookTo: d1.id,
          });
          rays.push({
            from: squareId,
            dirName: 'castle_queenside',
            rayKind: 'castle',
            steps: [
              { id: d1.id, status: 'empty' },
              { id: c1.id, status: 'empty' },
            ],
            blockedSteps: [],
          });
        }
      }
    }

    if (piece.type === 'n') {
      // Knight "L" jumps around the Rosette [02:36]
      const jumps = this.topology.getKnightJumps(squareId);
      for (const j of jumps) {
        const occupant = this.board.get(j.to);
        if (!occupant || canCapture(occupant)) {
          const status = occupant ? 'capture' : 'empty';
          moves.push({
            from: squareId,
            to: j.to,
            piece: { ...piece },
            captured: occupant ? { ...occupant } : null,
            path: j.path,
            rayKind: 'knight_L',
            dirName: `knight_${j.to}`,
            crossesRosette: j.path.some((id) => ROSETTE_SQUARES.has(id)),
          });
          rays.push({
            from: squareId,
            dirName: `knight_${j.to}`,
            rayKind: 'knight_L',
            pathIds: j.path,
            steps: [
              { id: j.path[1], status: 'transit' },
              { id: j.path[2], status: 'transit' },
              { id: j.to, status },
            ],
            blockedSteps: [],
          });
        }
      }
    }

    if (piece.type === 'p') {
      // Pawn movement & captures [02:14 - 02:29]
      // In its home sector (`sqNode.sector === piece.homeSector`), a pawn advances with `dr = +1` (toward the center).
      // Once it is in an enemy sector (`sqNode.sector !== piece.homeSector`), "forward" is toward that enemy's
      // back rank (`dr = -1`) [02:14]!
      const isInHomeSector = sqNode.sector === piece.homeSector;
      const forwardDr = isInHomeSector ? 1 : -1;

      // 1. Forward 1 step (and 2 steps from starting rank)
      const step1 = this.topology.stepOrthogonal(sqNode.sector, sqNode.col, sqNode.row, 0, forwardDr);
      if (step1 && !this.board.get(step1.id)) {
        const step1Node = this.topology.getSquare(step1.id);
        const isPromo1 = step1Node.sector !== piece.homeSector && step1Node.row === 0;
        const forwardSteps = [{ id: step1.id, status: 'empty', isPromotion: isPromo1 }];

        moves.push({
          from: squareId,
          to: step1.id,
          piece: { ...piece },
          captured: null,
          path: [squareId, step1.id],
          rayKind: 'pawn',
          dirName: 'pawn_forward',
          isPromotion: isPromo1,
          promotionPiece: isPromo1 ? 'q' : null,
        });

        // Double step from initial rank (`isInHomeSector && sqNode.row === 1`)
        if (isInHomeSector && sqNode.row === 1) {
          const step2 = this.topology.stepOrthogonal(step1.s, step1.c, step1.r, 0, forwardDr);
          if (step2 && !this.board.get(step2.id)) {
            forwardSteps.push({ id: step2.id, status: 'empty' });
            moves.push({
              from: squareId,
              to: step2.id,
              piece: { ...piece },
              captured: null,
              path: [squareId, step1.id, step2.id],
              rayKind: 'pawn',
              dirName: 'pawn_double',
            });
          }
        }

        rays.push({
          from: squareId,
          dirName: 'pawn_forward',
          rayKind: 'pawn',
          steps: forwardSteps,
          blockedSteps: [],
        });
      }

      // 2. Diagonal forward captures (including into same-color Rosette squares [02:22])
      for (const dc of [-1, 1]) {
        const diagTargets = this.topology.stepDiagonal(
          sqNode.sector,
          sqNode.col,
          sqNode.row,
          dc,
          forwardDr
        );
        for (const dt of diagTargets) {
          // Never re-enter home sector when capturing from an enemy sector
          if (!isInHomeSector && dt.s === piece.homeSector) continue;
          const occupant = this.board.get(dt.id);
          if (occupant && canCapture(occupant)) {
            const dtNode = this.topology.getSquare(dt.id);
            const isPromo = dtNode.sector !== piece.homeSector && dtNode.row === 0;
            moves.push({
              from: squareId,
              to: dt.id,
              piece: { ...piece },
              captured: { ...occupant },
              path: [squareId, dt.id],
              rayKind: dt.crossedRosetteCenter ? 'diagonal_rosette' : 'pawn_capture',
              dirName: `pawn_cap_${dt.id}`,
              crossesRosette: Boolean(dt.crossedRosetteCenter),
              isPromotion: isPromo,
              promotionPiece: isPromo ? 'q' : null,
            });
            rays.push({
              from: squareId,
              dirName: `pawn_cap_${dt.id}`,
              rayKind: dt.crossedRosetteCenter ? 'diagonal_rosette' : 'pawn_capture',
              steps: [{ id: dt.id, status: 'capture', isPromotion: isPromo }],
              blockedSteps: [],
            });
          }
        }
      }
    }

    return { moves, rays, forbiddenRosetteSquare };
  }

  /**
   * Finds the squareId of the King belonging to `color`.
   */
  findKingSquare(color) {
    for (const [sq, p] of [...this.board.entries()]) {
      if (p.type === 'k' && p.color === color && !p.isFlotsam) {
        return sq;
      }
    }
    return null;
  }

  /**
   * Returns all enemy pieces currently attacking `targetSquareId` (excluding Flotsam pieces [03:30]).
   */
  getAttackersOf(targetSquareId, defenderColor) {
    const attackers = [];
    for (const [sq, p] of [...this.board.entries()]) {
      if (p.color === defenderColor || p.isFlotsam) continue;
      if (this.eliminatedColors.has(p.color)) continue;
      const { moves } = this.getPseudoLegalMovesAndRays(sq);
      for (const m of moves) {
        if (m.to === targetSquareId) {
          attackers.push({ from: sq, piece: p, path: m.path });
        }
      }
    }
    return attackers;
  }

  /**
   * Checks whether `color`'s King is currently in check.
   */
  isKingInCheck(color) {
    const kingSq = this.findKingSquare(color);
    if (!kingSq) return false;
    return this.getAttackersOf(kingSq, color).length > 0;
  }

  /**
   * Returns strictly legal moves + filtered rays for `squareId` (filtering out moves that leave
   * the moving player's own King in check).
   */
  getLegalMovesAndRays(squareId) {
    const piece = this.board.get(squareId);
    if (!piece || piece.isFlotsam) {
      return { moves: [], rays: [], forbiddenRosetteSquare: null };
    }

    const pseudo = this.getPseudoLegalMovesAndRays(squareId);
    if (this.editorMode) {
      return pseudo;
    }

    const legalMoves = [];
    const legalTargetSet = new Set();

    for (const m of pseudo.moves) {
      const savedFrom = this.board.get(m.from);
      const savedTo = this.board.get(m.to);
      let savedRook = null;
      if (m.castleRookFrom) {
        savedRook = this.board.get(m.castleRookFrom);
        this.board.delete(m.castleRookFrom);
        this.board.set(m.castleRookTo, { ...savedRook, moved: true });
      }

      this.board.delete(m.from);
      this.board.set(m.to, {
        ...savedFrom,
        type: m.promotionPiece || savedFrom.type,
        moved: true,
      });

      const inCheck = this.isKingInCheck(piece.color);

      // Restore
      this.board.set(m.from, savedFrom);
      if (savedTo) {
        this.board.set(m.to, savedTo);
      } else {
        this.board.delete(m.to);
      }
      if (m.castleRookFrom && savedRook) {
        this.board.set(m.castleRookFrom, savedRook);
        this.board.delete(m.castleRookTo);
      }

      if (!inCheck) {
        legalMoves.push(m);
        legalTargetSet.add(m.to);
      }
    }

    // Filter ray steps to highlight legal destinations while keeping transit paths visible
    const filteredRays = [];
    for (const r of pseudo.rays) {
      const hasLegalStep = r.steps.some((st) => legalTargetSet.has(st.id));
      if (hasLegalStep) {
        filteredRays.push({
          ...r,
          steps: r.steps.map((st) => ({
            ...st,
            isLegalDestination: legalTargetSet.has(st.id),
          })),
        });
      }
    }

    return {
      moves: legalMoves,
      rays: filteredRays,
      forbiddenRosetteSquare: pseudo.forbiddenRosetteSquare,
    };
  }

  /**
   * Returns all legal moves for a given army color across the entire board.
   */
  getAllLegalMovesForColor(color) {
    const all = [];
    for (const [sq, p] of [...this.board.entries()]) {
      if (p.color === color && !p.isFlotsam) {
        const { moves } = this.getLegalMovesAndRays(sq);
        all.push(...moves);
      }
    }
    return all;
  }

  /**
   * Selects a square and emits `PIECE_SELECTED` with all illuminated branching rays.
   */
  selectSquare(squareId) {
    if (!squareId || !this.board.has(squareId)) {
      this.selectedSquare = null;
      this.bus?.emit({ type: 'SELECTION_CLEARED' });
      return null;
    }

    this.selectedSquare = squareId;
    const piece = this.board.get(squareId);
    const { moves, rays, forbiddenRosetteSquare } = this.getLegalMovesAndRays(squareId);
    const payload = {
      type: 'PIECE_SELECTED',
      squareId,
      piece,
      isOwnTurn: piece.color === this.getActiveColor() && !piece.isFlotsam,
      moves,
      rays,
      forbiddenRosetteSquare,
    };
    this.bus?.emit(payload);
    return payload;
  }

  /**
   * Executes a legal move from `from` to `to` (or free placement in editorMode),
   * handles elimination rules (`destroy`, `protoss_conquer`, `flotsam_obstacles`, `sudden_death`),
   * and advances the turn clockwise by 120°.
   */
  executeMove(from, to, promotionType = 'q') {
    if (this.isGameOver && !this.editorMode) return null;

    const movingPiece = this.board.get(from);
    if (!movingPiece) return null;

    let chosenMove = null;
    if (!this.editorMode) {
      if (movingPiece.color !== this.getActiveColor() || movingPiece.isFlotsam) {
        return null;
      }
      const { moves } = this.getLegalMovesAndRays(from);
      chosenMove = moves.find((m) => m.to === to);
      if (!chosenMove) return null;
    } else {
      const captured = this.board.get(to) || null;
      chosenMove = {
        from,
        to,
        piece: { ...movingPiece },
        captured: captured ? { ...captured } : null,
        path: [from, to],
        rayKind: 'editor',
      };
    }

    // Save undo snapshot
    this.undoStack.push(this._snapshot());
    this.redoStack.length = 0;

    // Apply move
    this.board.delete(from);
    if (chosenMove.castleRookFrom) {
      const rk = this.board.get(chosenMove.castleRookFrom);
      this.board.delete(chosenMove.castleRookFrom);
      if (rk) {
        this.board.set(chosenMove.castleRookTo, { ...rk, moved: true });
      }
    }

    const finalType = chosenMove.isPromotion ? promotionType || 'q' : movingPiece.type;
    const updatedPiece = {
      ...movingPiece,
      type: finalType,
      moved: true,
    };
    this.board.set(to, updatedPiece);

    if (chosenMove.captured) {
      this.capturedByColor[movingPiece.color].push(chosenMove.captured);
    }

    const notation = `${movingPiece.color[0].toUpperCase()}: ${movingPiece.type.toUpperCase()}${from}-${to}${chosenMove.captured ? 'x' : ''}${chosenMove.isPromotion ? '=' + finalType.toUpperCase() : ''}`;
    const record = {
      moveNumber: this.moveHistory.length + 1,
      color: movingPiece.color,
      from,
      to,
      pieceType: movingPiece.type,
      captured: chosenMove.captured,
      path: chosenMove.path,
      notation,
    };
    this.moveHistory.push(record);
    this.selectedSquare = null;

    this.bus?.emit({
      type: 'MOVE_EXECUTED',
      move: chosenMove,
      record,
    });

    if (chosenMove.crossesRosette) {
      this.bus?.emit({
        type: 'ROSETTE_CROSSED',
        color: movingPiece.color,
        from,
        to,
        path: chosenMove.path,
      });
    }

    if (!this.editorMode) {
      this._advanceTurnAndCheckEliminations(movingPiece.color);
    }

    return record;
  }

  /**
   * Advances turn clockwise, checking whether any opponent is checkmated or stalemated,
   * and applies the active elimination rule (`destroy`, `protoss_conquer`, `flotsam_obstacles`, `sudden_death`).
   */
  _advanceTurnAndCheckEliminations(attackerColor) {
    // Check if any surviving opponent was just checkmated (or captured their King)
    for (const color of this.turnOrder) {
      if (color === attackerColor || this.eliminatedColors.has(color)) continue;
      const kingSq = this.findKingSquare(color);
      const legalMoves = this.getAllLegalMovesForColor(color);
      const inCheck = this.isKingInCheck(color);

      if (inCheck && legalMoves.length > 0) {
        this.bus?.emit({ type: 'PLAYER_CHECKED', color, byColor: attackerColor, kingSquare: kingSq });
      }

      if (!kingSq || (legalMoves.length === 0 && inCheck)) {
        this._eliminatePlayer(color, attackerColor, 'checkmate');
        if (this.isGameOver) return;
      }
    }

    // Advance to next surviving player clockwise
    for (let step = 1; step <= 3; step++) {
      const nextIdx = (this.activeColorIndex + step) % 3;
      const nextColor = this.turnOrder[nextIdx];
      if (this.eliminatedColors.has(nextColor)) continue;

      const nextMoves = this.getAllLegalMovesForColor(nextColor);
      if (nextMoves.length === 0) {
        if (this.isKingInCheck(nextColor)) {
          this._eliminatePlayer(nextColor, attackerColor, 'checkmate');
          if (this.isGameOver) return;
          continue;
        } else {
          // Stalemate: if 3 players alive, skip turn; if 2 players left, draw
          const aliveCount = 3 - this.eliminatedColors.size;
          if (aliveCount <= 2) {
            this.isGameOver = true;
            this.winnerColor = null;
            this.gameOverReason = `Patta per Stallo (${SECTOR_META[nextColor].labelIt} senza mosse legali)`;
            this.bus?.emit({
              type: 'GAME_OVER',
              winnerColor: null,
              reason: this.gameOverReason,
            });
            return;
          }
          continue;
        }
      }

      this.activeColorIndex = nextIdx;
      this.bus?.emit({
        type: 'TURN_CHANGED',
        activeColor: nextColor,
        cameraAngleDeg: SECTOR_META[nextColor].cameraAngleDeg,
      });
      return;
    }
  }

  _eliminatePlayer(loserColor, conquerorColor, reason) {
    this.eliminatedColors.add(loserColor);

    if (this.eliminationMode === 'sudden_death') {
      this.isGameOver = true;
      this.winnerColor = conquerorColor;
      this.gameOverReason = `⚡ Vittoria per Scacco Matto (${SECTOR_META[conquerorColor].labelIt} dà matto a ${SECTOR_META[loserColor].labelIt})!`;
      this.bus?.emit({
        type: 'PLAYER_ELIMINATED',
        loserColor,
        conquerorColor,
        mode: this.eliminationMode,
      });
      this.bus?.emit({
        type: 'GAME_OVER',
        winnerColor: conquerorColor,
        reason: this.gameOverReason,
      });
      return;
    }

    if (this.eliminationMode === 'destroy') {
      // 1. Default / Destroy: remove all pieces of loser from the board
      for (const [sq, p] of [...this.board.entries()]) {
        if (p.color === loserColor) {
          this.board.delete(sq);
        }
      }
    } else if (this.eliminationMode === 'protoss_conquer') {
      // 2. Protoss Conquer: remove loser's King, convert remaining pieces to conquerorColor!
      for (const [sq, p] of [...this.board.entries()]) {
        if (p.color === loserColor) {
          if (p.type === 'k') {
            this.board.delete(sq);
          } else {
            this.board.set(sq, {
              ...p,
              color: conquerorColor,
              isFlotsam: false,
            });
          }
        }
      }
    } else if (this.eliminationMode === 'flotsam_obstacles') {
      // 3. Flotsam: remove loser's King, turn remaining pieces into inert obstacles
      for (const [sq, p] of [...this.board.entries()]) {
        if (p.color === loserColor) {
          if (p.type === 'k') {
            this.board.delete(sq);
          } else {
            this.board.set(sq, {
              ...p,
              isFlotsam: true,
            });
          }
        }
      }
    }

    this.bus?.emit({
      type: 'PLAYER_ELIMINATED',
      loserColor,
      conquerorColor,
      mode: this.eliminationMode,
      reason,
    });

    const surviving = this.turnOrder.filter((c) => !this.eliminatedColors.has(c));
    if (surviving.length <= 1) {
      this.isGameOver = true;
      this.winnerColor = surviving[0] || conquerorColor;
      this.gameOverReason = `🏆 Vittoria Finale dell'Armata ${SECTOR_META[this.winnerColor].labelIt}!`;
      this.bus?.emit({
        type: 'GAME_OVER',
        winnerColor: this.winnerColor,
        reason: this.gameOverReason,
      });
    }
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this._snapshot());
    const prev = this.undoStack.pop();
    this._restoreSnapshot(prev);
    const activeColor = this.getActiveColor();
    this.bus?.emit({
      type: 'HISTORY_CHANGED',
      action: 'undo',
      activeColor,
      cameraAngleDeg: SECTOR_META[activeColor].cameraAngleDeg,
    });
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this._snapshot());
    const next = this.redoStack.pop();
    this._restoreSnapshot(next);
    const activeColor = this.getActiveColor();
    this.bus?.emit({
      type: 'HISTORY_CHANGED',
      action: 'redo',
      activeColor,
      cameraAngleDeg: SECTOR_META[activeColor].cameraAngleDeg,
    });
    return true;
  }
}

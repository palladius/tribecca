/**
 * @fileoverview SimpleAIManager — Tactical 3-player chess AI for TriBecca.
 * Evaluates Checkmate (+100000), Check & king restriction, captures, enemy-sector pawn promotion
 * march, tactical piece safety, King-hunt endgame approach, and anti-oscillation in < 15ms,
 * while illuminating the chosen piece's branching rays before moving so Ale and Seby can follow!
 */

import { PIECE_VALUES } from './ThreeChessRulesManager.js';
import { ROSETTE_SQUARES } from './BoardTopologyManager.js';

export class SimpleAIManager {
  /**
   * @param {import('./ThreeChessRulesManager.js').ThreeChessRulesManager} rules
   * @param {import('../core/GameEventBus.js').GameEventBus} [bus]
   */
  constructor(rules, bus = null) {
    this.rules = rules;
    this.bus = bus;
    this._previewTimer = null;
    /** @type {number | null} Optional deterministic PRNG state */
    this._rngState = null;
  }

  init(ctx) {
    this.ctx = ctx;
    if (!this.bus && ctx?.bus) {
      this.bus = ctx.bus;
    }

    this.bus?.on('AI_TURN_REQUESTED', (evt) => this._onAiTurnRequested(evt));
    this.bus?.on('GAME_RESET', () => this._cancelPreview());
    this.bus?.on('HISTORY_CHANGED', () => this._cancelPreview());
    this.bus?.on('SEAT_CONFIG_CHANGED', () => this._cancelPreview());
    this.bus?.on('AUTOPLAY_TOGGLED', (evt) => {
      if (evt?.paused) this._cancelPreview();
    });
  }

  update() {}
  lateUpdate() {}
  dispose() {
    this._cancelPreview();
  }

  /**
   * Sets an optional integer seed for reproducible AI self-play games.
   * Pass `null` to restore standard `Math.random()`.
   * @param {number | null} seed
   */
  setSeed(seed) {
    this._rngState = typeof seed === 'number' ? seed >>> 0 : null;
  }

  _random() {
    if (this._rngState === null) return Math.random();
    // Mulberry32 PRNG
    let t = (this._rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  _cancelPreview() {
    if (this._previewTimer) {
      clearTimeout(this._previewTimer);
      this._previewTimer = null;
    }
  }

  /**
   * Picks a tactical move for `color` using 1-ply lookahead for Checkmate, Check,
   * hanging-piece safety, pawn promotion march, King-hunt constriction, and anti-oscillation.
   */
  chooseMove(color) {
    const legalMoves = this.rules.getAllLegalMovesForColor(color);
    if (legalMoves.length === 0) return null;

    const topo = this.rules.topology;
    const totalPieces = this.rules.board.size;
    const enemies = this.rules.turnOrder.filter(
      (c) => c !== color && !this.rules.eliminatedColors.has(c)
    );

    // Identify enemy Kings and remaining material to focus pressure on the weakest opponent
    const enemyInfo = enemies
      .map((ec) => {
        const kSq = this.rules.findKingSquare(ec);
        const kNode = kSq ? topo.getSquare(kSq) : null;
        let material = 0;
        for (const [, p] of this.rules.board.entries()) {
          if (p.color === ec && !p.isFlotsam && p.type !== 'k') {
            material += PIECE_VALUES[p.type] || 100;
          }
        }
        return { color: ec, kingSq: kSq, kingNode: kNode, material };
      })
      .filter((e) => e.kingNode);

    enemyInfo.sort((a, b) => a.material - b.material);
    const primaryTarget = enemyInfo[0] || null;

    // Anti-oscillation: inspect recent moves by this color
    const ownHistory = this.rules.moveHistory.filter((h) => h.color === color);
    const lastOwnMove = ownHistory[ownHistory.length - 1] || null;
    const recentOwnMoves = ownHistory.slice(-4);

    // Check which of our own pieces are currently under attack
    const currentlyAttacked = new Set();
    for (const [sq, p] of this.rules.board.entries()) {
      if (p.color === color && !p.isFlotsam) {
        if (this.rules.getAttackersOf(sq, color).length > 0) {
          currentlyAttacked.add(sq);
        }
      }
    }

    let bestScore = -Infinity;
    let bestMoves = [];

    for (const m of legalMoves) {
      let score = 0;
      const myType = m.promotionPiece || m.piece.type;
      const myVal = PIECE_VALUES[myType] || 100;

      // 1. Material capture reward
      if (m.captured) {
        const victimVal = PIECE_VALUES[m.captured.type] || 100;
        score += victimVal * 1.35 - (PIECE_VALUES[m.piece.type] || 100) * 0.08;
        if (m.captured.isFlotsam) {
          score += 40;
        }
        if (primaryTarget && m.captured.color === primaryTarget.color) {
          score += 35;
        }
      }

      // 2. Pawn promotion & advancement (both home sector AND enemy sector toward row 0!)
      const fromSq = topo.getSquare(m.from);
      const toSq = topo.getSquare(m.to);
      if (m.isPromotion) {
        score += 950;
      } else if (m.piece.type === 'p' && fromSq && toSq) {
        if (fromSq.sector === m.piece.homeSector && toSq.sector !== m.piece.homeSector) {
          score += 75;
        } else if (fromSq.sector === m.piece.homeSector && toSq.row > fromSq.row) {
          score += (toSq.row - fromSq.row) * 26;
        } else if (toSq.sector !== m.piece.homeSector && toSq.row < fromSq.row) {
          score += (4 - toSq.row) * 58;
        }
      }

      // 3. Central Rosette control & piece development
      if (ROSETTE_SQUARES.has(m.to)) {
        score += 45;
      } else if (m.crossesRosette) {
        score += 35;
      }
      if ((m.piece.type === 'n' || m.piece.type === 'b' || m.piece.type === 'q') && !m.piece.moved) {
        score += 28;
      }

      // 4. King-hunt approach toward the most vulnerable enemy King
      if (primaryTarget && fromSq && toSq && m.piece.type !== 'p') {
        const kx = primaryTarget.kingNode.center.x;
        const kz = primaryTarget.kingNode.center.z;
        const dBefore = Math.hypot(fromSq.center.x - kx, fromSq.center.z - kz);
        const dAfter = Math.hypot(toSq.center.x - kx, toSq.center.z - kz);
        const huntWeight = totalPieces < 16 ? 42 : totalPieces < 28 ? 24 : 12;
        if (m.piece.type !== 'k' || totalPieces < 12) {
          score += (dBefore - dAfter) * huntWeight;
        }
      }

      // 5. Anti-oscillation penalty (never shuffle back and forth)
      if (lastOwnMove && lastOwnMove.from === m.to && lastOwnMove.to === m.from) {
        score -= 340;
      } else if (recentOwnMoves.some((r) => r.from === m.from && r.to === m.to)) {
        score -= 160;
      }

      // 6. Simulate move on board to evaluate Checkmate, Check, and Tactical Safety
      const savedFrom = this.rules.board.get(m.from);
      const savedTo = this.rules.board.get(m.to);
      let savedRook = null;
      if (m.castleRookFrom) {
        savedRook = this.rules.board.get(m.castleRookFrom);
        this.rules.board.delete(m.castleRookFrom);
        this.rules.board.set(m.castleRookTo, { ...savedRook, moved: true });
      }
      this.rules.board.delete(m.from);
      this.rules.board.set(m.to, { ...savedFrom, type: myType, moved: true });

      let deliversMate = false;
      try {
        for (const e of enemyInfo) {
          if (this.rules.isKingInCheck(e.color)) {
            const escapes = this.rules.getAllLegalMovesForColor(e.color).length;
            if (escapes === 0) {
              score += 100000;
              deliversMate = true;
            } else if (escapes === 1) {
              score += 750;
            } else if (escapes === 2) {
              score += 420;
            } else {
              score += 220;
            }
          } else if (
            totalPieces < 22 &&
            e.color === primaryTarget?.color &&
            (myType === 'q' || myType === 'r')
          ) {
            const kMoves = this.rules.getLegalMovesAndRays(e.kingSq).moves.length;
            if (kMoves === 0) score += 90;
            else if (kMoves === 1) score += 45;
          }
        }

        if (!deliversMate) {
          const attackers = this.rules.getAttackersOf(m.to, color);
          if (attackers.length > 0) {
            score -= myVal * 0.85;
          } else if (currentlyAttacked.has(m.from)) {
            score += (PIECE_VALUES[m.piece.type] || 100) * 0.55;
          }
        }
      } finally {
        this.rules.board.set(m.from, savedFrom);
        if (savedTo) this.rules.board.set(m.to, savedTo);
        else this.rules.board.delete(m.to);
        if (m.castleRookFrom && savedRook) {
          this.rules.board.set(m.castleRookFrom, savedRook);
          this.rules.board.delete(m.castleRookTo);
        }
      }

      // 7. Small jitter so computer games stay varied
      score += this._random() * 14;

      if (score > bestScore + 6) {
        bestScore = score;
        bestMoves = [m];
      } else if (Math.abs(score - bestScore) <= 6) {
        bestMoves.push(m);
      }
    }

    return bestMoves[Math.floor(this._random() * bestMoves.length)] || legalMoves[0];
  }

  _onAiTurnRequested({ color, previewRaysMs = 300 }) {
    this._cancelPreview();
    if (this.rules.isGameOver || this.rules.getActiveColor() !== color) return;

    const chosen = this.chooseMove(color);
    if (!chosen) return;

    if (previewRaysMs > 0) {
      // Select the square first so the human sees all the illuminated branching rays of the CPU's piece!
      this.rules.selectSquare(chosen.from);
      this._previewTimer = setTimeout(() => {
        this._previewTimer = null;
        if (!this.rules.isGameOver && this.rules.getActiveColor() === color) {
          this.rules.executeMove(chosen.from, chosen.to, chosen.promotionPiece || 'q');
        }
      }, previewRaysMs);
    } else {
      this.rules.executeMove(chosen.from, chosen.to, chosen.promotionPiece || 'q');
    }
  }
}

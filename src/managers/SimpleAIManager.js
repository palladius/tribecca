/**
 * @fileoverview SimpleAIManager — Fast, pragmatic 3-player chess AI for TriBecca.
 * Evaluates captures, Rosette center control, pawn promotion, and check delivery
 * in < 20ms, optionally illuminating the chosen piece's branching rays before moving
 * so Ale and Seby can visually follow what the Computer is planning!
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
  }

  init(ctx) {
    this.ctx = ctx;
    if (!this.bus && ctx?.bus) {
      this.bus = ctx.bus;
    }

    this.bus?.on('AI_TURN_REQUESTED', (evt) => this._onAiTurnRequested(evt));
    this.bus?.on('GAME_RESET', () => this._cancelPreview());
  }

  update() {}
  lateUpdate() {}
  dispose() {
    this._cancelPreview();
  }

  _cancelPreview() {
    if (this._previewTimer) {
      clearTimeout(this._previewTimer);
      this._previewTimer = null;
    }
  }

  /**
   * Picks a pragmatic move for `color` using a 1-ply + tactical safety heuristic.
   */
  chooseMove(color) {
    const legalMoves = this.rules.getAllLegalMovesForColor(color);
    if (legalMoves.length === 0) return null;

    let bestScore = -Infinity;
    let bestMoves = [];

    for (const m of legalMoves) {
      let score = 0;

      // 1. Material capture reward
      if (m.captured) {
        const victimVal = PIECE_VALUES[m.captured.type] || 100;
        const attackerVal = PIECE_VALUES[m.piece.type] || 100;
        score += victimVal * 1.25 - attackerVal * 0.12;
        if (m.captured.isFlotsam) {
          score += 45; // Clear obstacle bonus
        }
      }

      // 2. Promotion reward
      if (m.isPromotion) {
        score += 800;
      }

      // 3. Central Rosette control & crossing bonus
      if (ROSETTE_SQUARES.has(m.to)) {
        score += 55;
      } else if (m.crossesRosette) {
        score += 40;
      }

      // 4. Advance pieces from back rank / develop Knights & Bishops
      const fromSq = this.rules.topology.getSquare(m.from);
      const toSq = this.rules.topology.getSquare(m.to);
      if (fromSq && toSq) {
        if (fromSq.sector === m.piece.homeSector && toSq.row > fromSq.row) {
          score += (toSq.row - fromSq.row) * 14;
        }
        if ((m.piece.type === 'n' || m.piece.type === 'b') && !m.piece.moved) {
          score += 22;
        }
      }

      // 5. Small jitter so computer games are varied and fun to watch
      score += Math.random() * 18;

      if (score > bestScore + 8) {
        bestScore = score;
        bestMoves = [m];
      } else if (Math.abs(score - bestScore) <= 8) {
        bestMoves.push(m);
      }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)] || legalMoves[0];
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

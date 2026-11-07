/**
 * @fileoverview TriBecca (Scacchi Tricolore 3D) — Main Application Entrypoint.
 * Wires only Managers, Event Bus, and Thin Views (Niccolò Rule #2: No Gameplay Rules in main.js).
 */

import { GameEventBus, GameContext } from './core/GameEventBus.js';
import { BoardTopologyManager, SECTOR_META, PLAYER_COLORS } from './managers/BoardTopologyManager.js';
import { ThreeChessRulesManager, ELIMINATION_MODES } from './managers/ThreeChessRulesManager.js';
import { PlayerSeatManager, PUFFIN_SEAT_PROFILES } from './managers/PlayerSeatManager.js';
import { SimpleAIManager } from './managers/SimpleAIManager.js';
import { AudioListener } from './listeners/AudioListener.js';
import { Board2DView } from './views/Board2DView.js';
import { Board3DView } from './views/Board3DView.js';
import { PuffinLogin } from './puffin-login.js';

const PIECE_NAMES_IT = {
  k: 'Re ♔',
  q: 'Regina ♕',
  r: 'Torre ♖',
  b: 'Alfiere ♗',
  n: 'Cavallo ♘',
  p: 'Pedone ♙',
};

function initTriBeccaApp() {
  const bus = new GameEventBus();
  const ctx = new GameContext(bus);

  const topology = ctx.register('topology', new BoardTopologyManager(6.0));
  const rules = ctx.register('rules', new ThreeChessRulesManager(topology, bus));
  const seats = ctx.register('seats', new PlayerSeatManager(rules, bus));
  const ai = ctx.register('ai', new SimpleAIManager(rules, bus));
  const audio = ctx.register('audio', new AudioListener());

  topology.init(ctx);
  rules.init(ctx);
  seats.init(ctx);
  ai.init(ctx);
  audio.init(ctx);

  const view3dContainer = document.getElementById('board-3d-container');
  const view2dContainer = document.getElementById('board-2d-container');

  // Shared click handler for both 2D and 3D views
  const handleSquareClick = (squareId) => {
    const selectedSq = rules.selectedSquare;

    // If a piece of the active turn is already selected and user clicks a legal destination -> execute move!
    if (selectedSq && selectedSq !== squareId) {
      const selPiece = rules.getPiece(selectedSq);
      const isTurnPiece = selPiece && selPiece.color === rules.getActiveColor() && !selPiece.isFlotsam;
      const canAct = seats.isHumanTurn() || rules.editorMode;

      if (canAct && (isTurnPiece || rules.editorMode)) {
        const { moves } = rules.getLegalMovesAndRays(selectedSq);
        const isLegalTarget = rules.editorMode || moves.some((m) => m.to === squareId);
        if (isLegalTarget) {
          rules.executeMove(selectedSq, squareId, 'q');
          return;
        }
      }
    }

    // Otherwise: select or inspect the clicked piece (illuminates all branching rays!)
    if (selectedSq === squareId) {
      rules.selectSquare(null);
    } else if (rules.getPiece(squareId)) {
      rules.selectSquare(squareId);
    } else {
      rules.selectSquare(null);
    }
  };

  const view2D = new Board2DView(view2dContainer, topology, rules, bus, handleSquareClick);
  const view3D = new Board3DView(view3dContainer, topology, rules, seats, bus, handleSquareClick);

  // View Mode Switcher ('3d' | '2d' | 'split')
  const stageEl = document.getElementById('game-stage');
  const setViewMode = (mode) => {
    stageEl.dataset.viewMode = mode;
    document.querySelectorAll('[data-view-btn]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viewBtn === mode);
    });
    setTimeout(() => {
      view3D.resize();
      view2D.render();
    }, 30);
  };

  document.querySelectorAll('[data-view-btn]').forEach((btn) => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.viewBtn));
  });

  // Theme Toggle ('tricolore' | 'wood')
  const themeBtn = document.getElementById('btn-theme-toggle');
  themeBtn?.addEventListener('click', () => {
    const nextTheme = view3D.boardTheme === 'tricolore' ? 'wood' : 'tricolore';
    view3D.setTheme(nextTheme);
    view2D.setTheme(nextTheme);
    themeBtn.textContent =
      nextTheme === 'tricolore' ? '🇮🇹 Tema: Tricolore' : '🪵 Tema: Legno Vera';
    updateTurnAndSeatsHud();
  });

  // 120° Rotation Mode Selector
  const rotSelect = document.getElementById('select-rotation-mode');
  rotSelect?.addEventListener('change', () => {
    const val = rotSelect.value;
    view3D.rotationMode = val;
    view2D.rotate2DWithTurn = val === 'every_turn';
  });

  // Quick Camera Angle Buttons (0°, 120°, 240°)
  document.querySelectorAll('[data-cam-angle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const deg = Number(btn.dataset.camAngle) || 0;
      view3D.tweenCameraToAngle(deg, 500);
      view2D.setRotationAngle(deg);
    });
  });

  // Seat Profile Selectors (White, Red, Green <=> Papino, Ale, Seby, Kate, Nonna, Ospite, Computer)
  for (const color of PLAYER_COLORS) {
    const sel = document.getElementById(`seat-select-${color}`);
    sel?.addEventListener('change', () => {
      seats.setSeatProfile(color, sel.value);
    });
  }

  // Preset Combo Buttons (1v2, 2v1, 3v0, 0v3)
  document.querySelectorAll('[data-preset-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const currentUser = PuffinLogin.getCurrentUser();
      seats.applyPreset(btn.dataset.presetBtn, currentUser?.id || 'riccardo');
      syncSeatSelectorsUI();
    });
  });

  // Elimination Mode Selector
  const elimSelect = document.getElementById('select-elimination-mode');
  elimSelect?.addEventListener('change', () => {
    rules.setEliminationMode(elimSelect.value);
  });

  // Auto-Play Controls (Pause/Play, Step, Speed)
  const btnPausePlay = document.getElementById('btn-autoplay-toggle');
  btnPausePlay?.addEventListener('click', () => {
    seats.setAutoPlayPaused(!seats.autoPlayPaused);
  });

  const btnStepAi = document.getElementById('btn-step-ai');
  btnStepAi?.addEventListener('click', () => {
    seats.stepSingleAiTurn();
  });

  const speedSelect = document.getElementById('select-ai-speed');
  speedSelect?.addEventListener('change', () => {
    seats.setAiSpeedMs(Number(speedSelect.value));
  });

  // Bottom Dock Actions: Undo, Redo, Hint, Editor, New Game
  document.getElementById('btn-undo')?.addEventListener('click', () => rules.undo());
  document.getElementById('btn-redo')?.addEventListener('click', () => rules.redo());
  document.getElementById('btn-hint')?.addEventListener('click', () => {
    const activeColor = rules.getActiveColor();
    const suggested = ai.chooseMove(activeColor);
    if (suggested) {
      rules.selectSquare(suggested.from);
      const inspectorEl = document.getElementById('ray-inspector-banner');
      if (inspectorEl) {
        inspectorEl.innerHTML = `💡 <strong>Consiglio del Maestro per ${SECTOR_META[activeColor].labelIt}:</strong> Muovi <strong>${PIECE_NAMES_IT[suggested.piece.type]}</strong> da <code>${suggested.from}</code> a <code>${suggested.to}</code> (${suggested.path.join(' → ')})!`;
      }
    }
  });

  const btnEditor = document.getElementById('btn-editor-mode');
  btnEditor?.addEventListener('click', () => {
    rules.editorMode = !rules.editorMode;
    btnEditor.classList.toggle('active', rules.editorMode);
    btnEditor.textContent = rules.editorMode
      ? '🛠️ Specchio Scacchiera: ON (Muovi Libero)'
      : '🛠️ Specchio Scacchiera Vera';
    updateTurnAndSeatsHud();
  });

  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    document.getElementById('hof-section')?.setAttribute('hidden', '');
    rules.resetGame('white');
  });

  // React to PuffinLogin authentication change -> assign logged-in hero to White seat!
  window.addEventListener('puffin-auth-change', (e) => {
    const user = e.detail?.user;
    if (user?.id && PUFFIN_SEAT_PROFILES[user.id]) {
      seats.setSeatProfile('white', user.id);
      syncSeatSelectorsUI();
    }
  });

  function syncSeatSelectorsUI() {
    for (const color of PLAYER_COLORS) {
      const seat = seats.getSeat(color);
      const sel = document.getElementById(`seat-select-${color}`);
      const avatarImg = document.getElementById(`seat-avatar-${color}`);
      if (sel && seat) sel.value = seat.profileId;
      if (avatarImg && seat) avatarImg.src = seat.avatar;
    }
    updateTurnAndSeatsHud();
  }

  function updateTurnAndSeatsHud() {
    const activeColor = rules.getActiveColor();
    const seat = seats.getSeat(activeColor);
    const turnBanner = document.getElementById('active-turn-banner');
    const colorDot =
      activeColor === 'white'
        ? '⚪'
        : activeColor === 'red'
          ? '🔴'
          : view3D.boardTheme === 'wood'
            ? '⚫'
            : '🟢';
    const colorLabel =
      activeColor === 'green' && view3D.boardTheme === 'wood'
        ? 'Nero'
        : SECTOR_META[activeColor].labelIt;

    if (turnBanner) {
      if (rules.isGameOver) {
        turnBanner.innerHTML = `🏁 <strong>${rules.gameOverReason}</strong>`;
      } else if (rules.editorMode) {
        turnBanner.innerHTML = `🛠️ <strong>Modalità Specchio Scacchiera Vera:</strong> Clicca qualsiasi pezzo per vedere i raggi o spostarlo liberamente`;
      } else {
        const inCheck = rules.isKingInCheck(activeColor);
        turnBanner.innerHTML = `${colorDot} Turno: <strong>${colorLabel}</strong> (${seat?.shortName || ''}) ${inCheck ? '<span class="check-badge">⚠️ SOTTO SCACCO!</span>' : ''}`;
      }
    }

    // Highlight active seat card
    for (const c of PLAYER_COLORS) {
      const card = document.getElementById(`seat-card-${c}`);
      if (card) {
        card.classList.toggle('active-turn', c === activeColor && !rules.isGameOver);
        card.classList.toggle('eliminated', rules.eliminatedColors.has(c));
      }
    }

    if (btnPausePlay) {
      btnPausePlay.textContent = seats.autoPlayPaused ? '▶️ Riprendi CPU' : '⏸️ Pausa CPU';
    }
  }

  // Update Ray Inspector Banner whenever a piece is selected
  bus.on('PIECE_SELECTED', ({ squareId, piece, moves, rays, forbiddenRosetteSquare }) => {
    const inspectorEl = document.getElementById('ray-inspector-banner');
    if (!inspectorEl) return;
    const rosetteCount = moves.filter((m) => m.crossesRosette).length;
    const captureCount = moves.filter((m) => m.captured).length;
    const colorName = SECTOR_META[piece.color]?.labelIt || piece.color;

    const extras = [];
    if (rosetteCount > 0) extras.push(`🔵 <strong>${rosetteCount} attraverso la Rosetta</strong>`);
    if (captureCount > 0) extras.push(`🔴 <strong>${captureCount} catture</strong>`);
    if (forbiddenRosetteSquare)
      extras.push(`🚫 <code>${forbiddenRosetteSquare}</code> vietata (colore diverso nella Rosetta)`);

    inspectorEl.innerHTML = `🔦 <strong>${PIECE_NAMES_IT[piece.type]} ${colorName} in <code>${squareId}</code>:</strong> si dipartono <strong>${rays.length} raggi</strong> versando su <strong>${moves.length} caselle legali</strong> ${extras.length ? ' · ' + extras.join(' · ') : ''}`;
  });

  bus.on('SELECTION_CLEARED', () => {
    const inspectorEl = document.getElementById('ray-inspector-banner');
    if (inspectorEl) {
      inspectorEl.innerHTML = `👆 <strong>Clicca su qualsiasi pezzo</strong> (anche avversario!) per illuminare tutti i raggi e le mosse che si dipartono attraverso la Rosetta centrale.`;
    }
  });

  bus.on('MOVE_EXECUTED', ({ record }) => {
    updateTurnAndSeatsHud();
    const historyEl = document.getElementById('move-history-pill');
    if (historyEl) {
      historyEl.textContent = `#${record.moveNumber} ${record.notation}`;
    }
  });

  bus.on('TURN_CHANGED', () => updateTurnAndSeatsHud());
  bus.on('GAME_RESET', () => updateTurnAndSeatsHud());
  bus.on('HISTORY_CHANGED', () => updateTurnAndSeatsHud());
  bus.on('SEAT_CONFIG_CHANGED', () => syncSeatSelectorsUI());
  bus.on('AUTOPLAY_TOGGLED', () => updateTurnAndSeatsHud());

  bus.on('GAME_OVER', async ({ winnerColor, reason }) => {
    updateTurnAndSeatsHud();
    const hofSection = document.getElementById('hof-section');
    if (hofSection) {
      hofSection.hidden = false;
    }
    try {
      await PuffinLogin.submitScore({
        appId: 'tricolore-chess-3d',
        score: winnerColor ? 1000 - rules.moveHistory.length * 2 : 500,
        startedAt: new Date(Date.now() - rules.moveHistory.length * 3000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSec: Math.max(10, rules.moveHistory.length * 3),
        extra: {
          winner_color: winnerColor || 'draw',
          elimination_mode: rules.eliminationMode,
          moves_count: rules.moveHistory.length,
          reason,
        },
      });
    } catch (_) {
      // Offline / guest fallback
    }
  });

  syncSeatSelectorsUI();
  updateTurnAndSeatsHud();

  // Expose debug handle for automated verification & tests
  window.__TRIBECCA__ = {
    bus,
    ctx,
    topology,
    rules,
    seats,
    ai,
    view2D,
    view3D,
    setViewMode,
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTriBeccaApp);
  } else {
    initTriBeccaApp();
  }
}

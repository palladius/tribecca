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
import { PuffinLogin, validateAndNormalizeScorePayload } from './puffin-login.js';

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

  // Pawn Promotion Modal state & handlers
  const promoSectionEl = document.getElementById('promotion-section');
  const promoAvatarEl = document.getElementById('promo-player-avatar');
  const promoTitleEl = document.getElementById('promo-title');
  const promoSubtitleEl = document.getElementById('promo-subtitle');
  const promoCancelBtn = document.getElementById('btn-promo-cancel');
  let pendingPromotion = null; // { from, to }

  const openPromotionModal = (from, to, piece) => {
    pendingPromotion = { from, to };
    const seat = seats.getSeat(piece.color);
    const meta = SECTOR_META[piece.color];
    if (promoAvatarEl && seat?.avatar) {
      promoAvatarEl.src = seat.avatar;
    }
    if (promoTitleEl) {
      promoTitleEl.textContent = `👑 Promozione Pedone (${from} → ${to})!`;
    }
    if (promoSubtitleEl) {
      promoSubtitleEl.textContent = `${seat?.shortName || meta?.labelIt}: scegli in quale pezzo trasformare il tuo Pedone ${meta?.badge || ''}:`;
    }
    const iconColor =
      piece.color === 'white' ? '#f8fafc' : piece.color === 'red' ? '#f87171' : '#4ade80';
    document.querySelectorAll('.promo-choice-icon').forEach((el) => {
      el.style.color = iconColor;
    });
    if (promoSectionEl) {
      promoSectionEl.hidden = false;
    }
  };

  const closePromotionModal = () => {
    pendingPromotion = null;
    if (promoSectionEl) {
      promoSectionEl.hidden = true;
    }
  };

  document.querySelectorAll('.promo-choice-btn[data-promo-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!pendingPromotion) return;
      const { from, to } = pendingPromotion;
      const chosenType = btn.dataset.promoType || 'q';
      closePromotionModal();
      rules.executeMove(from, to, chosenType);
    });
  });

  if (promoCancelBtn) {
    promoCancelBtn.addEventListener('click', () => {
      closePromotionModal();
    });
  }

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
        const matchedMove = moves.find((m) => m.to === squareId);
        const isLegalTarget = rules.editorMode || Boolean(matchedMove);
        if (isLegalTarget) {
          const toNode = topology.getSquare(squareId);
          const isEditorPromo =
            rules.editorMode &&
            selPiece?.type === 'p' &&
            Boolean(toNode && toNode.sector !== selPiece.homeSector && toNode.row === 0);

          if (matchedMove?.isPromotion || isEditorPromo) {
            openPromotionModal(selectedSq, squareId, selPiece);
            return;
          }
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

  const view2D = new Board2DView(view2dContainer, topology, rules, bus, handleSquareClick, seats);
  const view3D = new Board3DView(view3dContainer, topology, rules, seats, bus, handleSquareClick);

  const puffinWidget = document.getElementById('puffin-widget');
  const btnMultiLogin = document.getElementById('btn-multilogin-table');
  const btnClaimWinner = document.getElementById('btn-claim-winner-login');
  let activeAuthTargetColor = null;
  let multiLoginQueueActive = false;
  let lastSubmittedScoreId = null;
  let lastWinnerColor = null;

  // Retroactively upgrade any unauthenticated White victory (like Riccardo's 95-move 810pt game!) from Guest to Papino Riccardo
  function upgradeHistoricalGuestScoresForRiccardo() {
    try {
      const raw = localStorage.getItem('puffin_leaderboard_scores_v2');
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      let changed = false;
      const updated = list.map((item) => {
        if (
          item &&
          item.game_id === 'tricolore-chess-3d' &&
          !item.player_id &&
          (item.score === 810 || item.extra?.winner_color === 'white')
        ) {
          changed = true;
          return validateAndNormalizeScorePayload({
            ...item,
            player_id: 'riccardo',
          });
        }
        return item;
      });
      if (changed) {
        localStorage.setItem('puffin_leaderboard_scores_v2', JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('puffin-score-recorded'));
      }
    } catch (_) {}
  }
  upgradeHistoricalGuestScoresForRiccardo();

  function upgradeScoreOwnerInStorage(scoreId, newProfileId) {
    if (!scoreId || !newProfileId || newProfileId === 'guest' || newProfileId === 'cpu') return;
    try {
      const raw = localStorage.getItem('puffin_leaderboard_scores_v2');
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      let updatedRecord = null;
      const updated = list.map((item) => {
        if (item && item.id === scoreId) {
          updatedRecord = validateAndNormalizeScorePayload({
            ...item,
            player_id: newProfileId,
          });
          return updatedRecord;
        }
        return item;
      });
      if (updatedRecord) {
        localStorage.setItem('puffin_leaderboard_scores_v2', JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('puffin-score-recorded', { detail: updatedRecord }));
      }
    } catch (_) {}
  }

  function promptSeatLogin(color, continueQueue = false) {
    const seat = seats.getSeat(color);
    if (!seat || seat.kind !== 'human' || !seats.requiresAuth(seat.profileId)) return;
    activeAuthTargetColor = color;
    multiLoginQueueActive = continueQueue;
    const colorLabel = SECTOR_META[color]?.labelIt || color;
    showTacticalToast(
      `🔐 <strong>Multi-Login (${colorLabel}):</strong> Inserisci PIN/Password per <strong>${seat.displayName}</strong> (oppure scegli Ospite)`,
      'toast-mate',
      3500
    );
    if (puffinWidget && typeof puffinWidget.openModal === 'function') {
      puffinWidget.openModal(seat.profileId);
    }
  }

  function startTableMultiLoginQueue() {
    const unverified = seats.getUnverifiedHumanSeats();
    if (unverified.length === 0) {
      const named = seats.getNamedHumanSeats();
      showTacticalToast(
        `✅ <strong>Tutti i ${named.length} giocatori umani al tavolo sono già autenticati!</strong> Modalità NON-Guest attiva.`,
        'toast-mate',
        2600
      );
      return;
    }
    promptSeatLogin(unverified[0].color, true);
  }

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
      if (seats.requiresAuth(sel.value) && !seats.isProfileVerified(sel.value)) {
        promptSeatLogin(color, false);
      }
    });

    const authBtn = document.getElementById(`seat-auth-btn-${color}`);
    authBtn?.addEventListener('click', () => {
      const seat = seats.getSeat(color);
      if (seat?.kind === 'human' && seats.requiresAuth(seat.profileId)) {
        promptSeatLogin(color, false);
      }
    });
  }

  btnMultiLogin?.addEventListener('click', () => {
    startTableMultiLoginQueue();
  });

  btnClaimWinner?.addEventListener('click', () => {
    if (lastWinnerColor) {
      promptSeatLogin(lastWinnerColor, false);
    }
  });

  // Preset Combo Buttons (1v2, 2v1, 3v0, 0v3)
  document.querySelectorAll('[data-preset-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const currentUser = PuffinLogin.getCurrentUser();
      const preset = btn.dataset.presetBtn;
      seats.applyPreset(preset, currentUser?.id || 'riccardo');
      syncSeatSelectorsUI();
      if (preset !== '0v3' && seats.getUnverifiedHumanSeats().length > 0) {
        startTableMultiLoginQueue();
      }
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

  // React to PuffinLogin authentication event (`puffin-auth-updated`) for Multi-Login!
  let _suppressAuthCascade = false;
  window.addEventListener('puffin-auth-updated', (e) => {
    if (_suppressAuthCascade) return;
    const user = e.detail?.user;
    if (!user) {
      seats.clearVerifiedProfiles();
      multiLoginQueueActive = false;
      activeAuthTargetColor = null;
      syncSeatSelectorsUI();
      return;
    }

    if (user.id === 'guest') {
      if (activeAuthTargetColor) {
        seats.setSeatProfile(activeAuthTargetColor, 'guest');
      }
    } else if (PUFFIN_SEAT_PROFILES[user.id]) {
      seats.markProfileVerified(user.id);
      if (activeAuthTargetColor) {
        seats.setSeatProfile(activeAuthTargetColor, user.id);
      } else {
        // If user clicked the top-right PuffinLogin widget directly, assign to White if no seat has this user yet
        const alreadySeated = PLAYER_COLORS.some((c) => seats.getSeat(c)?.profileId === user.id);
        if (!alreadySeated) {
          seats.setSeatProfile('white', user.id);
        }
      }

      // If this user just logged in to claim a Game Over victory score, upgrade the score in localStorage!
      if (lastSubmittedScoreId && lastWinnerColor) {
        const winSeat = seats.getSeat(lastWinnerColor);
        if (winSeat?.profileId === user.id) {
          upgradeScoreOwnerInStorage(lastSubmittedScoreId, user.id);
          if (btnClaimWinner) btnClaimWinner.hidden = true;
          showTacticalToast(
            `🏆 <strong>Vittoria accreditata a ${winSeat.displayName}</strong> nella Hall of Fame!`,
            'toast-mate',
            3200
          );
        }
      }
    }

    activeAuthTargetColor = null;
    syncSeatSelectorsUI();

    if (multiLoginQueueActive) {
      const remaining = seats.getUnverifiedHumanSeats();
      if (remaining.length > 0) {
        setTimeout(() => {
          promptSeatLogin(remaining[0].color, true);
        }, 260);
      } else {
        multiLoginQueueActive = false;
        const named = seats.getNamedHumanSeats();
        showTacticalToast(
          `🔓 <strong>Multi-Login completato (${named.length}/${named.length})!</strong> Partita ufficiale NON-Guest abilitata!`,
          'toast-mate',
          3400
        );
      }
    }
  });

  function syncSeatSelectorsUI() {
    for (const color of PLAYER_COLORS) {
      const seat = seats.getSeat(color);
      const sel = document.getElementById(`seat-select-${color}`);
      const avatarImg = document.getElementById(`seat-avatar-${color}`);
      const authBtn = document.getElementById(`seat-auth-btn-${color}`);
      if (sel && seat) sel.value = seat.profileId;
      if (avatarImg && seat) avatarImg.src = seat.avatar;
      if (authBtn && seat) {
        if (seat.kind === 'cpu') {
          authBtn.className = 'seat-auth-pill neutral';
          authBtn.textContent = '🤖 Auto';
        } else if (seat.profileId === 'guest') {
          authBtn.className = 'seat-auth-pill neutral';
          authBtn.textContent = '🐧 Guest';
        } else if (seats.isProfileVerified(seat.profileId)) {
          authBtn.className = 'seat-auth-pill verified';
          authBtn.textContent = '✅ Loggato';
        } else {
          authBtn.className = 'seat-auth-pill unverified';
          authBtn.textContent = '🔒 Login';
        }
      }
    }

    if (btnMultiLogin) {
      const named = seats.getNamedHumanSeats();
      const verifiedCount = named.filter((s) => s.verified).length;
      if (named.length === 0) {
        btnMultiLogin.className = 'multilogin-btn all-verified';
        btnMultiLogin.textContent = '🤖 Tavolo Auto/Guest';
      } else if (verifiedCount === named.length) {
        btnMultiLogin.className = 'multilogin-btn all-verified';
        btnMultiLogin.textContent = `✅ Multi-Login (${verifiedCount}/${named.length} OK)`;
      } else {
        btnMultiLogin.className = 'multilogin-btn needs-auth';
        btnMultiLogin.textContent = `🔑 Multi-Login (${verifiedCount}/${named.length} Loggati)`;
      }
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

    const borderHex =
      activeColor === 'white'
        ? '#f8fafc'
        : activeColor === 'red'
          ? '#ef4444'
          : view3D.boardTheme === 'wood'
            ? '#a8a29e'
            : '#22c55e';
    const avatarSrc = seat?.avatar || 'assets/avatars/guest.png';

    if (turnBanner) {
      if (rules.isGameOver) {
        const winSeat = rules.winnerColor ? seats.getSeat(rules.winnerColor) : null;
        const winAv = winSeat?.avatar || avatarSrc;
        turnBanner.innerHTML = `<img src="${winAv}" alt="Vincitore" class="turn-pill-avatar" /> <span>🏁 <strong>${rules.gameOverReason}</strong></span>`;
      } else if (rules.editorMode) {
        turnBanner.innerHTML = `🛠️ <strong>Modalità Specchio Scacchiera Vera:</strong> Clicca qualsiasi pezzo per vedere i raggi o spostarlo liberamente`;
      } else {
        const inCheck = rules.isKingInCheck(activeColor);
        turnBanner.innerHTML = `<img src="${avatarSrc}" alt="${seat?.shortName || colorLabel}" class="turn-pill-avatar" style="border-color:${borderHex}" /> <span>Tocca a: <strong>${seat?.shortName || colorLabel}</strong> (${colorDot} ${colorLabel}) ${inCheck ? '<span class="check-badge">⚠️ SOTTO SCACCO!</span>' : ''}</span>`;
      }
    }

    const stageHeroAv = document.getElementById('stage-turn-avatar');
    const stageHeroTitle = document.getElementById('stage-turn-title');
    const stageHeroSub = document.getElementById('stage-turn-sub');
    if (stageHeroAv) {
      stageHeroAv.src = avatarSrc;
      stageHeroAv.style.borderColor = borderHex;
    }
    if (stageHeroTitle) {
      stageHeroTitle.textContent = rules.isGameOver
        ? `🏆 Vincitore: ${ (rules.winnerColor ? seats.getSeat(rules.winnerColor)?.shortName : 'Patta') || '' }`
        : `Tocca a: ${seat?.shortName || colorLabel}`;
    }
    if (stageHeroSub) {
      stageHeroSub.textContent = rules.isGameOver
        ? rules.gameOverReason
        : `${colorDot} Armata ${colorLabel}`;
    }

    // Highlight active seat card
    for (const c of PLAYER_COLORS) {
      const card = document.getElementById(`seat-card-${c}`);
      if (card) {
        card.classList.toggle('active-turn', c === activeColor && !rules.isGameOver);
        card.classList.toggle('eliminated', rules.eliminatedColors.has(c));
      }
    }

    // Keep top-right <puffin-login> badge synced to the active turn's verified human player!
    if (
      seat?.kind === 'human' &&
      seats.requiresAuth(seat.profileId) &&
      seats.isProfileVerified(seat.profileId) &&
      puffinWidget &&
      typeof puffinWidget.saveActiveSession === 'function' &&
      puffinWidget.getCurrentUser()?.id !== seat.profileId
    ) {
      _suppressAuthCascade = true;
      try {
        puffinWidget.saveActiveSession(seat.profileId, false);
      } finally {
        _suppressAuthCascade = false;
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

  let toastTimer = null;
  function showTacticalToast(html, kind = 'toast-check', durationMs = 2600) {
    const toastEl = document.getElementById('tactical-toast');
    if (!toastEl) return;
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.className = kind;
    toastEl.innerHTML = html;
    toastEl.hidden = false;
    if (durationMs > 0) {
      toastTimer = setTimeout(() => {
        toastEl.hidden = true;
      }, durationMs);
    }
  }

  bus.on('PLAYER_CHECKED', ({ color, byColor, kingSquare }) => {
    const defLabel = SECTOR_META[color]?.labelIt || color;
    const atkLabel = SECTOR_META[byColor]?.labelIt || byColor;
    showTacticalToast(
      `⚠️ <strong>SCACCO AL RE ${defLabel.toUpperCase()}</strong> in <code>${kingSquare}</code> (da ${atkLabel})!`,
      'toast-check',
      2200
    );
  });

  bus.on('PLAYER_ELIMINATED', ({ loserColor, conquerorColor, reason }) => {
    const loserLabel = SECTOR_META[loserColor]?.labelIt || loserColor;
    const conqLabel = SECTOR_META[conquerorColor]?.labelIt || conquerorColor;
    const verb = reason === 'stalemate' ? 'Stallo' : 'SCACCO MATTO';
    showTacticalToast(
      `👑 <strong>${verb}!</strong> L'Armata <strong>${conqLabel}</strong> elimina il Re <strong>${loserLabel}</strong>!`,
      'toast-mate',
      3800
    );
    updateTurnAndSeatsHud();
  });

  bus.on('TURN_CHANGED', () => updateTurnAndSeatsHud());
  bus.on('GAME_RESET', () => {
    const toastEl = document.getElementById('tactical-toast');
    if (toastEl) toastEl.hidden = true;
    updateTurnAndSeatsHud();
  });
  bus.on('HISTORY_CHANGED', () => updateTurnAndSeatsHud());
  bus.on('SEAT_CONFIG_CHANGED', () => syncSeatSelectorsUI());
  bus.on('AUTOPLAY_TOGGLED', () => updateTurnAndSeatsHud());

  bus.on('GAME_OVER', async ({ winnerColor, reason }) => {
    updateTurnAndSeatsHud();
    const lastRec = rules.moveHistory[rules.moveHistory.length - 1];
    const winSeat = winnerColor ? seats.getSeat(winnerColor) : null;
    const winLabel = winnerColor ? SECTOR_META[winnerColor]?.labelIt : 'Patta';

    showTacticalToast(
      `👑 <strong>SCACCO MATTO!</strong> ${reason}`,
      'toast-mate',
      0
    );

    const hofTitle = document.getElementById('hof-victory-title');
    const hofSub = document.getElementById('hof-victory-subtitle');
    if (hofTitle) {
      hofTitle.textContent = winnerColor
        ? `👑 SCACCO MATTO! Vince ${winLabel} (${winSeat?.shortName || 'CPU'})`
        : '🤝 Partita Patta';
    }
    if (hofSub) {
      hofSub.textContent = `${reason} · ${rules.moveHistory.length} mosse${lastRec ? ' · Ultima mossa: ' + lastRec.notation : ''}`;
    }

    const hofSection = document.getElementById('hof-section');
    if (hofSection) {
      hofSection.hidden = false;
    }

    lastWinnerColor = winnerColor || null;
    const effectivePlayerId = winnerColor ? seats.getEffectiveLeaderboardUserId(winnerColor) : 'guest';
    const isUnverifiedNamedWinner =
      Boolean(winSeat && winSeat.kind === 'human' && seats.requiresAuth(winSeat.profileId)) &&
      !seats.isProfileVerified(winSeat.profileId);

    if (btnClaimWinner) {
      if (isUnverifiedNamedWinner) {
        btnClaimWinner.hidden = false;
        btnClaimWinner.textContent = `🔐 Fai Login ora come ${winSeat.displayName} per salvare questa vittoria a tuo nome (non Guest)!`;
      } else {
        btnClaimWinner.hidden = true;
      }
    }

    try {
      const submitted = await PuffinLogin.submitScore({
        appId: 'tricolore-chess-3d',
        player_id: effectivePlayerId === 'guest' ? null : effectivePlayerId,
        score: winnerColor ? 1000 - rules.moveHistory.length * 2 : 500,
        startedAt: new Date(Date.now() - rules.moveHistory.length * 3000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSec: Math.max(10, rules.moveHistory.length * 3),
        extra: {
          winner_color: winnerColor || 'draw',
          winner_profile: winSeat?.profileId || 'cpu',
          seats_summary: `${seats.getSeat('white')?.shortName} vs ${seats.getSeat('red')?.shortName} vs ${seats.getSeat('green')?.shortName}`,
          elimination_mode: rules.eliminationMode,
          moves_count: rules.moveHistory.length,
          reason,
        },
      });
      lastSubmittedScoreId = submitted?.id || null;
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
    handleSquareClick,
    openPromotionModal,
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTriBeccaApp);
  } else {
    initTriBeccaApp();
  }
}

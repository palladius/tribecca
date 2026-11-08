/**
 * @fileoverview PlayerSeatManager — Owns the mapping between the 3 board armies
 * (`white`, `red`, `green`) and PuffinLogin family profiles (`riccardo`, `ale`, `seby`,
 * `kate`, `lucilla`, `guest`) or `cpu` (Computer), Progressive Multi-Login seat assignment
 * ("Ah sei Riccardo? Bene, allora ti do Giocatore 1!"), and Auto-Play timing.
 */

import { PLAYER_COLORS, SECTOR_META } from './BoardTopologyManager.js';

export const PUFFIN_SEAT_PROFILES = {
  riccardo: {
    id: 'riccardo',
    kind: 'human',
    displayName: 'Papino Riccardo',
    shortName: 'Papino',
    avatar: 'assets/avatars/riccardo.png',
    badgeColor: '#FACC15',
  },
  ale: {
    id: 'ale',
    kind: 'human',
    displayName: 'Ale',
    shortName: 'Ale',
    avatar: 'assets/avatars/ale.png',
    badgeColor: '#EF4444',
  },
  seby: {
    id: 'seby',
    kind: 'human',
    displayName: 'Seby',
    shortName: 'Seby',
    avatar: 'assets/avatars/seby.png',
    badgeColor: '#3B82F6',
  },
  kate: {
    id: 'kate',
    kind: 'human',
    displayName: 'Mamma Kate',
    shortName: 'Kate',
    avatar: 'assets/avatars/kate.png',
    badgeColor: '#A855F7',
  },
  lucilla: {
    id: 'lucilla',
    kind: 'human',
    displayName: 'Nonna Lucilla',
    shortName: 'Nonna',
    avatar: 'assets/avatars/lucilla.png',
    badgeColor: '#EC4899',
  },
  guest: {
    id: 'guest',
    kind: 'human',
    displayName: 'Ospite',
    shortName: 'Ospite',
    avatar: 'assets/avatars/guest.png',
    badgeColor: '#9CA3AF',
  },
  cpu: {
    id: 'cpu',
    kind: 'cpu',
    displayName: 'Computer',
    shortName: 'Computer',
    avatar: 'assets/avatars/guest.png',
    badgeColor: '#10B981',
  },
};

export class PlayerSeatManager {
  /**
   * @param {import('./ThreeChessRulesManager.js').ThreeChessRulesManager} rules
   * @param {import('../core/GameEventBus.js').GameEventBus} [bus]
   */
  constructor(rules, bus = null) {
    this.rules = rules;
    this.bus = bus;

    /**
     * Default for 99% of casual players: Guest (Bianco) vs 2 Computers (Rosso, Verde).
     * As family members log in via PuffinLogin, `assignNextProgressiveLogin()` upgrades
     * seats 1 -> 2 -> 3 sequentially!
     * @type {Record<string, {profileId: string, kind: 'human' | 'cpu', displayName: string, shortName: string, avatar: string, badgeColor: string}>}
     */
    this.seats = {
      white: { ...PUFFIN_SEAT_PROFILES.guest, profileId: 'guest' },
      red: { ...PUFFIN_SEAT_PROFILES.cpu, profileId: 'cpu' },
      green: { ...PUFFIN_SEAT_PROFILES.cpu, profileId: 'cpu' },
    };

    /** @type {'1v2' | '2v1' | '3v0' | '0v3'} */
    this.activePreset = '1v2';
    this.autoPlayPaused = false;
    this.modalBlocking = false;
    this.aiDelayMs = 950;
    this.previewAiRays = true;
    this._timerId = null;

    /** @type {Set<string>} Set of PuffinLogin profileIds verified via PIN/password in this multi-login session */
    this.verifiedProfiles = new Set();
    /** @type {string[]} Ordered list of verified family profiles seated via progressive login */
    this.progressiveLoginOrder = [];
    this._loadVerifiedProfiles();
  }

  _loadVerifiedProfiles() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('tribecca_verified_profiles_v1');
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            for (const id of arr) {
              if (id && id !== 'guest' && id !== 'cpu' && PUFFIN_SEAT_PROFILES[id]) {
                this.verifiedProfiles.add(id);
              }
            }
          }
        }
        const puffinAuthRaw = localStorage.getItem('puffin_active_user_v2');
        if (puffinAuthRaw) {
          const parsed = JSON.parse(puffinAuthRaw);
          if (parsed?.userId && parsed.userId !== 'guest' && PUFFIN_SEAT_PROFILES[parsed.userId]) {
            this.verifiedProfiles.add(parsed.userId);
          }
        }
      }
    } catch (_) {}
  }

  _saveVerifiedProfiles() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          'tribecca_verified_profiles_v1',
          JSON.stringify([...this.verifiedProfiles])
        );
      }
    } catch (_) {}
  }

  requiresAuth(profileId) {
    return Boolean(profileId && profileId !== 'guest' && profileId !== 'cpu');
  }

  isProfileVerified(profileId) {
    if (!this.requiresAuth(profileId)) return true;
    return this.verifiedProfiles.has(profileId);
  }

  isSeatVerified(color) {
    const seat = this.seats[color];
    if (!seat) return false;
    return this.isProfileVerified(seat.profileId);
  }

  markProfileVerified(profileId) {
    if (!this.requiresAuth(profileId)) return;
    this.verifiedProfiles.add(profileId);
    if (!this.progressiveLoginOrder.includes(profileId)) {
      this.progressiveLoginOrder.push(profileId);
    }
    this._saveVerifiedProfiles();
    this.bus?.emit({
      type: 'SEAT_CONFIG_CHANGED',
      seats: { ...this.seats },
      verifiedProfiles: [...this.verifiedProfiles],
    });
  }

  clearVerifiedProfiles() {
    this.verifiedProfiles.clear();
    this.progressiveLoginOrder = [];
    this._saveVerifiedProfiles();
    this.bus?.emit({
      type: 'SEAT_CONFIG_CHANGED',
      seats: { ...this.seats },
      verifiedProfiles: [],
    });
  }

  /**
   * Progressive Multi-Login assignment:
   * - 1st family login -> Giocatore 1 (`white`, Bianco)
   * - 2nd family login -> Giocatore 2 (`red`, Rosso)
   * - 3rd family login -> Giocatore 3 (`green`, Verde)
   * Returns a structured greeting payload:
   * `"Ah sei Papino Riccardo? Bene, allora ti do Giocatore 1 (Bianco)!"`
   *
   * @param {string} profileId
   * @param {'white' | 'red' | 'green' | null} [preferredColor=null]
   */
  assignNextProgressiveLogin(profileId, preferredColor = null) {
    if (!PUFFIN_SEAT_PROFILES[profileId] || profileId === 'cpu') return null;

    if (profileId === 'guest') {
      const targetColor = preferredColor || 'white';
      this.setSeatProfile(targetColor, 'guest');
      const playerNumber = PLAYER_COLORS.indexOf(targetColor) + 1;
      const armyLabel = SECTOR_META[targetColor]?.labelIt || targetColor;
      return {
        color: targetColor,
        playerNumber,
        seat: this.seats[targetColor],
        greetingIt: `Giochi come Ospite sul posto Giocatore ${playerNumber} (${armyLabel}).`,
        nextSeatColor: this.getNextOpenProgressiveColor(),
      };
    }

    this.markProfileVerified(profileId);

    // Determine which seat gets this logged-in family member
    let targetColor = preferredColor;
    if (!targetColor) {
      // Check if this user is already seated in one of the 3 seats
      const existingColor = PLAYER_COLORS.find((c) => this.seats[c]?.profileId === profileId);
      if (existingColor) {
        targetColor = existingColor;
      } else {
        // Pick the first seat in ['white', 'red', 'green'] that does NOT yet have a verified family profile
        targetColor =
          PLAYER_COLORS.find((c) => {
            const st = this.seats[c];
            return !st || !this.requiresAuth(st.profileId) || !this.isProfileVerified(st.profileId);
          }) || 'green';
      }
    }

    this.setSeatProfile(targetColor, profileId);

    // Sync activePreset badge based on how many human seats are now active
    const humanCount = this.getHumanCount();
    if (humanCount === 1) this.activePreset = '1v2';
    else if (humanCount === 2) this.activePreset = '2v1';
    else if (humanCount === 3) this.activePreset = '3v0';

    const playerNumber = PLAYER_COLORS.indexOf(targetColor) + 1;
    const armyLabel = SECTOR_META[targetColor]?.labelIt || targetColor;
    const seat = this.seats[targetColor];
    const nextSeatColor = this.getNextOpenProgressiveColor();
    const nextPlayerNumber = nextSeatColor ? PLAYER_COLORS.indexOf(nextSeatColor) + 1 : null;

    const greetingIt = `Ah sei ${seat.displayName}? Bene, allora ti do Giocatore ${playerNumber} (${armyLabel})!`;

    const payload = {
      color: targetColor,
      playerNumber,
      armyLabel,
      seat,
      greetingIt,
      nextSeatColor,
      nextPlayerNumber,
    };

    this.bus?.emit({
      type: 'PROGRESSIVE_LOGIN_ASSIGNED',
      ...payload,
    });

    return payload;
  }

  /**
   * Returns the next board color (`'white' | 'red' | 'green' | null`) that does not yet have
   * a verified named family member assigned.
   */
  getNextOpenProgressiveColor() {
    return (
      PLAYER_COLORS.find((c) => {
        const st = this.seats[c];
        return !st || !this.requiresAuth(st.profileId) || !this.isProfileVerified(st.profileId);
      }) || null
    );
  }

  /**
   * Returns all human seats that use a named family profile (`riccardo`, `ale`, `seby`, `kate`, `lucilla`)
   * and have NOT yet entered their PIN/password.
   */
  getUnverifiedHumanSeats() {
    const list = [];
    for (const color of PLAYER_COLORS) {
      const seat = this.seats[color];
      if (seat && seat.kind === 'human' && this.requiresAuth(seat.profileId)) {
        if (!this.verifiedProfiles.has(seat.profileId)) {
          list.push({ color, profileId: seat.profileId, seat });
        }
      }
    }
    return list;
  }

  /**
   * Returns all human seats that use a named family profile (`riccardo`, `ale`, `seby`, `kate`, `lucilla`).
   */
  getNamedHumanSeats() {
    const list = [];
    for (const color of PLAYER_COLORS) {
      const seat = this.seats[color];
      if (seat && seat.kind === 'human' && this.requiresAuth(seat.profileId)) {
        list.push({
          color,
          profileId: seat.profileId,
          seat,
          verified: this.verifiedProfiles.has(seat.profileId),
        });
      }
    }
    return list;
  }

  /**
   * Returns the official PuffinLogin `player_id` for Leaderboard submission when `color` wins:
   * - If `color` is a verified named human (`riccardo`, `ale`, `seby`, `kate`, `lucilla`), returns `seat.profileId`.
   * - Otherwise returns `'guest'` (unless verified right before saving).
   */
  getEffectiveLeaderboardUserId(color) {
    const seat = this.seats[color];
    if (!seat || seat.kind !== 'human') return 'guest';
    if (this.requiresAuth(seat.profileId) && this.verifiedProfiles.has(seat.profileId)) {
      return seat.profileId;
    }
    return 'guest';
  }

  init(ctx) {
    this.ctx = ctx;
    if (!this.bus && ctx?.bus) {
      this.bus = ctx.bus;
    }

    this.bus?.on('TURN_CHANGED', () => this._scheduleAiIfNeeded());
    this.bus?.on('GAME_RESET', () => this._scheduleAiIfNeeded());
    this.bus?.on('HISTORY_CHANGED', () => this._scheduleAiIfNeeded());
  }

  update() {}
  lateUpdate() {}

  dispose() {
    this._clearTimer();
  }

  _clearTimer() {
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  setModalBlocking(isBlocking) {
    this.modalBlocking = Boolean(isBlocking);
    if (this.modalBlocking) {
      this._clearTimer();
    } else {
      this._scheduleAiIfNeeded();
    }
  }

  getSeat(color) {
    return this.seats[color];
  }

  isHumanTurn() {
    const active = this.rules.getActiveColor();
    return this.seats[active]?.kind === 'human';
  }

  getHumanCount() {
    return PLAYER_COLORS.filter((c) => this.seats[c]?.kind === 'human').length;
  }

  /**
   * Assigns a PuffinLogin profile (`riccardo`, `ale`, `seby`, `kate`, `lucilla`, `guest`) or `cpu`
   * to a board color (`white`, `red`, `green`).
   */
  setSeatProfile(color, profileId) {
    const meta = PUFFIN_SEAT_PROFILES[profileId] || PUFFIN_SEAT_PROFILES.guest;
    this.seats[color] = {
      ...meta,
      profileId: meta.id,
    };
    this.bus?.emit({
      type: 'SEAT_CONFIG_CHANGED',
      seats: { ...this.seats },
    });
    this._scheduleAiIfNeeded();
  }

  /**
   * Quick combo presets:
   * - `1v2`: White = Guest (or 1st verified human), Red = CPU, Green = CPU
   * - `2v1`: White = Guest 1 (or 1st verified human), Red = Guest 2 (or 2nd verified human), Green = CPU
   * - `3v0`: White = Papino (if family mode) or Guest 1, Red = Ale or Guest 2, Green = Seby or Guest 3
   * - `0v3`: All 3 = CPU (Il Gioco Gioca da Solo!)
   *
   * @param {'1v2' | '2v1' | '3v0' | '0v3' | 'guest_1v2' | 'guest_2v1' | 'guest_3v0'} presetId
   * @param {string} [loggedInUserId='guest']
   */
  applyPreset(presetId, loggedInUserId = 'guest') {
    const verifiedList = [...this.verifiedProfiles];
    const fallbackFirst =
      verifiedList[0] ||
      (loggedInUserId && PUFFIN_SEAT_PROFILES[loggedInUserId] ? loggedInUserId : 'guest');

    if (presetId === '1v2' || presetId === 'guest_1v2') {
      this.activePreset = '1v2';
      const p1 = presetId === 'guest_1v2' ? (verifiedList[0] || 'guest') : fallbackFirst;
      this.setSeatProfile('white', p1);
      this.setSeatProfile('red', 'cpu');
      this.setSeatProfile('green', 'cpu');
      this.autoPlayPaused = false;
    } else if (presetId === '2v1' || presetId === 'guest_2v1') {
      this.activePreset = '2v1';
      const p1 = verifiedList[0] || 'guest';
      const p2 = verifiedList[1] || 'guest';
      this.setSeatProfile('white', p1);
      this.setSeatProfile('red', p2);
      this.setSeatProfile('green', 'cpu');
      this.autoPlayPaused = false;
    } else if (presetId === 'guest_3v0') {
      this.activePreset = '3v0';
      this.setSeatProfile('white', verifiedList[0] || 'guest');
      this.setSeatProfile('red', verifiedList[1] || 'guest');
      this.setSeatProfile('green', verifiedList[2] || 'guest');
      this.autoPlayPaused = false;
    } else if (presetId === '3v0') {
      this.activePreset = '3v0';
      this.setSeatProfile('white', verifiedList[0] || 'riccardo');
      this.setSeatProfile('red', verifiedList[1] || 'ale');
      this.setSeatProfile('green', verifiedList[2] || 'seby');
      this.autoPlayPaused = false;
    } else if (presetId === '0v3') {
      this.activePreset = '0v3';
      this.seats.white = {
        ...PUFFIN_SEAT_PROFILES.riccardo,
        profileId: 'cpu',
        kind: 'cpu',
        shortName: 'Papino (CPU)',
      };
      this.seats.red = {
        ...PUFFIN_SEAT_PROFILES.ale,
        profileId: 'cpu',
        kind: 'cpu',
        shortName: 'Ale (CPU)',
      };
      this.seats.green = {
        ...PUFFIN_SEAT_PROFILES.seby,
        profileId: 'cpu',
        kind: 'cpu',
        shortName: 'Seby (CPU)',
      };
      this.autoPlayPaused = false;
      this.bus?.emit({
        type: 'SEAT_CONFIG_CHANGED',
        seats: { ...this.seats },
      });
    }
    this._scheduleAiIfNeeded();
  }

  setAutoPlayPaused(paused) {
    this.autoPlayPaused = Boolean(paused);
    this.bus?.emit({
      type: 'AUTOPLAY_TOGGLED',
      paused: this.autoPlayPaused,
    });
    if (this.autoPlayPaused) {
      this._clearTimer();
    } else {
      this._scheduleAiIfNeeded();
    }
  }

  setAiSpeedMs(ms) {
    this.aiDelayMs = Math.max(120, Number(ms) || 950);
  }

  /**
   * Triggers a single AI move immediately (even when paused in Step mode).
   */
  stepSingleAiTurn() {
    this._clearTimer();
    const active = this.rules.getActiveColor();
    if (!this.rules.isGameOver && !this.rules.editorMode && this.seats[active]?.kind === 'cpu') {
      this.bus?.emit({
        type: 'AI_TURN_REQUESTED',
        color: active,
        previewRaysMs: this.previewAiRays ? Math.min(420, Math.floor(this.aiDelayMs * 0.45)) : 0,
      });
    }
  }

  _scheduleAiIfNeeded() {
    this._clearTimer();
    if (
      this.rules.isGameOver ||
      this.rules.editorMode ||
      this.autoPlayPaused ||
      this.modalBlocking
    ) {
      return;
    }
    const active = this.rules.getActiveColor();
    if (this.seats[active]?.kind !== 'cpu') return;

    this._timerId = setTimeout(() => {
      this._timerId = null;
      if (
        this.rules.isGameOver ||
        this.rules.editorMode ||
        this.autoPlayPaused ||
        this.modalBlocking
      ) {
        return;
      }
      const currentActive = this.rules.getActiveColor();
      if (this.seats[currentActive]?.kind === 'cpu') {
        this.bus?.emit({
          type: 'AI_TURN_REQUESTED',
          color: currentActive,
          previewRaysMs: this.previewAiRays ? Math.min(420, Math.floor(this.aiDelayMs * 0.45)) : 0,
        });
      }
    }, this.aiDelayMs);
  }
}

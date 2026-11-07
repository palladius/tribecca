/**
 * @fileoverview PlayerSeatManager — Owns the mapping between the 3 board armies
 * (`white`, `red`, `green`) and PuffinLogin family profiles (`riccardo`, `ale`, `seby`,
 * `kate`, `lucilla`, `guest`) or `cpu` (Computer), plus Auto-Play (`0v3` / `1v2` / `2v1`) timing.
 */

import { PLAYER_COLORS } from './BoardTopologyManager.js';

export const PUFFIN_SEAT_PROFILES = {
  riccardo: {
    id: 'riccardo',
    kind: 'human',
    displayName: 'Papino Riccardo',
    shortName: 'Papino 🦖',
    avatar: 'assets/avatars/riccardo.png',
    badgeColor: '#FACC15',
  },
  ale: {
    id: 'ale',
    kind: 'human',
    displayName: 'Ale',
    shortName: 'Ale 🐉',
    avatar: 'assets/avatars/ale.png',
    badgeColor: '#EF4444',
  },
  seby: {
    id: 'seby',
    kind: 'human',
    displayName: 'Seby',
    shortName: 'Seby 🐴',
    avatar: 'assets/avatars/seby.png',
    badgeColor: '#3B82F6',
  },
  kate: {
    id: 'kate',
    kind: 'human',
    displayName: 'Mamma Kate',
    shortName: 'Kate 👸',
    avatar: 'assets/avatars/kate.png',
    badgeColor: '#A855F7',
  },
  lucilla: {
    id: 'lucilla',
    kind: 'human',
    displayName: 'Nonna Lucilla',
    shortName: 'Nonna 👵',
    avatar: 'assets/avatars/lucilla.png',
    badgeColor: '#EC4899',
  },
  guest: {
    id: 'guest',
    kind: 'human',
    displayName: 'Ospite',
    shortName: 'Ospite 🐧',
    avatar: 'assets/avatars/guest.png',
    badgeColor: '#9CA3AF',
  },
  cpu: {
    id: 'cpu',
    kind: 'cpu',
    displayName: 'Computer',
    shortName: 'Computer 🤖',
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

    /** @type {Record<string, {profileId: string, kind: 'human' | 'cpu', displayName: string, shortName: string, avatar: string}>} */
    this.seats = {
      white: { ...PUFFIN_SEAT_PROFILES.riccardo, profileId: 'riccardo' },
      red: { ...PUFFIN_SEAT_PROFILES.cpu, profileId: 'cpu' },
      green: { ...PUFFIN_SEAT_PROFILES.cpu, profileId: 'cpu' },
    };

    this.autoPlayPaused = false;
    this.aiDelayMs = 950;
    this.previewAiRays = true;
    this._timerId = null;

    /** @type {Set<string>} Set of PuffinLogin profileIds verified via PIN/password in this multi-login session */
    this.verifiedProfiles = new Set();
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
              if (id && id !== 'guest' && id !== 'cpu') {
                this.verifiedProfiles.add(id);
              }
            }
          }
        }
        const puffinAuthRaw = localStorage.getItem('puffin_active_user_v2');
        if (puffinAuthRaw) {
          const parsed = JSON.parse(puffinAuthRaw);
          if (parsed?.userId && parsed.userId !== 'guest') {
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
    this._saveVerifiedProfiles();
    this.bus?.emit({
      type: 'SEAT_CONFIG_CHANGED',
      seats: { ...this.seats },
      verifiedProfiles: [...this.verifiedProfiles],
    });
  }

  clearVerifiedProfiles() {
    this.verifiedProfiles.clear();
    this._saveVerifiedProfiles();
    this.bus?.emit({
      type: 'SEAT_CONFIG_CHANGED',
      seats: { ...this.seats },
      verifiedProfiles: [],
    });
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
   * - `1v2`: White = logged-in human (or Papino), Red = CPU, Green = CPU
   * - `2v1`: White = Ale, Red = Seby, Green = CPU
   * - `3v0`: White = Papino, Red = Ale, Green = Seby
   * - `0v3`: All 3 = CPU (Il Gioco Gioca da Solo!)
   */
  applyPreset(presetId, loggedInUserId = 'riccardo') {
    const primaryHuman = PUFFIN_SEAT_PROFILES[loggedInUserId] ? loggedInUserId : 'riccardo';
    if (presetId === '1v2') {
      this.setSeatProfile('white', primaryHuman);
      this.setSeatProfile('red', 'cpu');
      this.setSeatProfile('green', 'cpu');
      this.autoPlayPaused = false;
    } else if (presetId === '2v1') {
      this.setSeatProfile('white', primaryHuman === 'ale' ? 'seby' : primaryHuman);
      this.setSeatProfile('red', 'ale');
      this.setSeatProfile('green', 'cpu');
      this.autoPlayPaused = false;
    } else if (presetId === '3v0') {
      this.setSeatProfile('white', 'riccardo');
      this.setSeatProfile('red', 'ale');
      this.setSeatProfile('green', 'seby');
      this.autoPlayPaused = false;
    } else if (presetId === '0v3') {
      this.seats.white = {
        ...PUFFIN_SEAT_PROFILES.riccardo,
        profileId: 'cpu',
        kind: 'cpu',
        shortName: 'Papino 🦖 (🤖)',
      };
      this.seats.red = {
        ...PUFFIN_SEAT_PROFILES.ale,
        profileId: 'cpu',
        kind: 'cpu',
        shortName: 'Ale 🐉 (🤖)',
      };
      this.seats.green = {
        ...PUFFIN_SEAT_PROFILES.seby,
        profileId: 'cpu',
        kind: 'cpu',
        shortName: 'Seby 🐴 (🤖)',
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
    if (this.rules.isGameOver || this.rules.editorMode || this.autoPlayPaused) return;
    const active = this.rules.getActiveColor();
    if (this.seats[active]?.kind !== 'cpu') return;

    this._timerId = setTimeout(() => {
      this._timerId = null;
      if (this.rules.isGameOver || this.rules.editorMode || this.autoPlayPaused) return;
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

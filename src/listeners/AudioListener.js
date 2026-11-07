/**
 * @fileoverview AudioListener — Lightweight WebAudio synthesizer for tactile piece clacks,
 * Rosette crossing chimes, check warnings, and checkmate fanfare.
 */

export class AudioListener {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  init(gameCtx) {
    const bus = gameCtx.bus;
    bus.on('PIECE_SELECTED', () => this.playSelectPop());
    bus.on('MOVE_EXECUTED', (e) => {
      if (e.move?.captured) {
        this.playCaptureClack();
      } else {
        this.playMoveClack();
      }
    });
    bus.on('ROSETTE_CROSSED', () => this.playRosetteChime());
    bus.on('PLAYER_CHECKED', () => this.playCheckAlert());
    bus.on('GAME_OVER', () => this.playVictoryFanfare());
  }

  _ensureCtx() {
    if (!this.enabled || typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _tone(freq, durationSec, type = 'sine', gainPeak = 0.08, delaySec = 0) {
    const ac = this._ensureCtx();
    if (!ac) return;
    const now = ac.currentTime + delaySec;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  playSelectPop() {
    this._tone(520, 0.06, 'triangle', 0.05);
  }

  playMoveClack() {
    this._tone(190, 0.07, 'triangle', 0.09);
    this._tone(340, 0.04, 'sine', 0.04, 0.015);
  }

  playCaptureClack() {
    this._tone(140, 0.11, 'sawtooth', 0.1);
    this._tone(420, 0.09, 'triangle', 0.08, 0.025);
  }

  playRosetteChime() {
    this._tone(660, 0.12, 'sine', 0.05, 0.04);
    this._tone(880, 0.16, 'sine', 0.05, 0.1);
  }

  playCheckAlert() {
    this._tone(587.33, 0.14, 'sawtooth', 0.08, 0);
    this._tone(880, 0.22, 'sawtooth', 0.08, 0.12);
  }

  playVictoryFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, idx) => this._tone(f, 0.24, 'triangle', 0.09, idx * 0.11));
  }
}

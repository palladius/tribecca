/**
 * @fileoverview Typed Event Bus with deferred queue delivery (Niccolò Game Design Pattern).
 * Facts are emitted in past tense (e.g., 'MOVE_EXECUTED', 'PIECE_SELECTED', 'TURN_CHANGED')
 * and can be flushed deterministically or dispatched synchronously for UI responsiveness.
 */

export class GameEventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    /** @type {Array<{type: string, [key: string]: any}>} */
    this.queue = [];
  }

  /**
   * Subscribe to a specific event type.
   * @param {string} type
   * @param {Function} handler
   * @returns {() => void} Unsubscribe function
   */
  on(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  /**
   * Unsubscribe a handler.
   * @param {string} type
   * @param {Function} handler
   */
  off(type, handler) {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * Enqueue an event fact and flush if not already flushing.
   * @param {{type: string, [key: string]: any}} event
   */
  emit(event) {
    this.queue.push(event);
    if (!this._flushing) {
      this.flush();
    }
  }

  /**
   * Flush all queued events in FIFO order without re-entrancy hazards.
   */
  flush() {
    if (this._flushing) return;
    this._flushing = true;
    try {
      while (this.queue.length > 0) {
        const evt = this.queue.shift();
        const handlers = this.listeners.get(evt.type);
        if (handlers) {
          for (const fn of [...handlers]) {
            fn(evt);
          }
        }
        const wildcard = this.listeners.get('*');
        if (wildcard) {
          for (const fn of [...wildcard]) {
            fn(evt);
          }
        }
      }
    } finally {
      this._flushing = false;
    }
  }

  dispose() {
    this.listeners.clear();
    this.queue.length = 0;
  }
}

export class GameContext {
  /**
   * @param {GameEventBus} bus
   */
  constructor(bus) {
    this.bus = bus;
    /** @type {Record<string, any>} */
    this.managers = {};
  }

  register(name, manager) {
    this.managers[name] = manager;
    return manager;
  }

  get(name) {
    return this.managers[name];
  }
}

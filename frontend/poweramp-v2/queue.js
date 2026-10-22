/** Original V2 queue order. It owns navigation, never playback or media URLs. */
export class QueueOrder {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.shuffle = false;
    this.reset(0);
  }

  reset(length, index = 0) {
    this.length = Math.max(0, Math.trunc(length));
    this.index = this.length ? Math.max(0, Math.min(this.length - 1, index)) : -1;
    this.history = this.index < 0 ? [] : [this.index];
    this.cursor = this.history.length - 1;
    this.bag = this.#bag(this.index);
  }

  #bag(exclude = -1) {
    const bag = Array.from({ length: this.length }, (_, i) => i).filter(i => i !== exclude);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(Math.max(0, this.random()) * (i + 1)));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return false;
    this.reset(this.length, index);
    return true;
  }

  setShuffle(enabled) {
    if (this.shuffle === Boolean(enabled)) return;
    this.shuffle = Boolean(enabled);
    this.reset(this.length, this.index);
  }

  next({ repeat = 'off', ended = false } = {}) {
    if (this.index < 0) return null;
    if (ended && repeat === 'one') return this.index;
    if (!this.shuffle) {
      const index = this.index + 1;
      if (index >= this.length && repeat !== 'all') return null;
      this.index = index % this.length;
      return this.index;
    }
    if (this.cursor < this.history.length - 1) {
      this.index = this.history[++this.cursor];
      return this.index;
    }
    if (!this.bag.length) {
      if (repeat !== 'all') return null;
      this.bag = this.#bag();
      // A new cycle includes every track, but cannot immediately repeat its predecessor.
      if (this.bag.length > 1 && this.bag[0] === this.index) {
        [this.bag[0], this.bag[1]] = [this.bag[1], this.bag[0]];
      }
    }
    this.index = this.bag.shift();
    this.history.push(this.index);
    if (this.history.length > 10000) this.history.shift();
    this.cursor = this.history.length - 1;
    return this.index;
  }

  previous() {
    if (this.index < 0) return null;
    if (this.shuffle) {
      if (this.cursor <= 0) return null;
      this.index = this.history[--this.cursor];
    } else {
      if (this.index === 0) return null;
      this.index--;
    }
    return this.index;
  }
}

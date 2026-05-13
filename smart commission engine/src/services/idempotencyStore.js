class IdempotencyStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  get(key) {
    const item = this.entries.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value) {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });
  }
}

module.exports = {
  IdempotencyStore
};

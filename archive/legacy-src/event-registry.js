// ── event-registry.js ─────────────────────────────────────────────
// Factory for isolated event listener registries.
// Each module creates its own registry — teardown() removes only that module's listeners.
//
// WHY: prevents duplicate bindings and guarantees clean listener removal on teardown,
// without cross-module interference from a shared global registry.

export function createRegistry() {
  const _list = [];

  return {
    // Register and track a listener
    on(target, type, handler, options = {}) {
      target.addEventListener(type, handler, options);
      _list.push({ target, type, handler });
    },

    // Remove one specific listener
    off(target, type, handler) {
      target.removeEventListener(type, handler);
      const idx = _list.findIndex(
        r => r.target === target && r.type === type && r.handler === handler
      );
      if (idx !== -1) _list.splice(idx, 1);
    },

    // Remove all listeners registered through this registry instance
    teardown() {
      for (const { target, type, handler } of _list) {
        target.removeEventListener(type, handler);
      }
      _list.length = 0;
    },
  };
}

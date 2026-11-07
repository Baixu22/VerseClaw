import type { StoreApi } from 'zustand';

/** Coalesce notifications; the existing store still commits each state synchronously. */
export function createFramePublication<T>() {
  let deferred = false;
  return {
    defer(work: () => void): void {
      const previous = deferred;
      deferred = true;
      try { work(); } finally { deferred = previous; }
    },
    attach(store: StoreApi<T>): void {
      const subscribe = store.subscribe;
      const listeners = new Set<(state: T, previous: T) => void>();
      let disconnect: (() => void) | undefined;
      let published = store.getState();
      let frame: number | undefined;
      let fallback: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        if (fallback !== undefined) clearTimeout(fallback);
        frame = undefined; fallback = undefined;
      };
      const flush = () => {
        cancel();
        const state = store.getState();
        if (Object.is(state, published)) return;
        const previous = published;
        published = state;
        listeners.forEach(listener => listener(state, previous));
      };
      store.subscribe = listener => {
        if (listeners.size === 0) {
          published = store.getState();
          disconnect = subscribe(() => {
            if (!deferred) { flush(); return; }
            if (fallback !== undefined) return;
            // Hidden renderers may suspend frames; keep their state publication bounded.
            fallback = setTimeout(flush, 100);
            if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush);
          });
        }
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) { cancel(); disconnect?.(); disconnect = undefined; }
        };
      };
    },
  };
}

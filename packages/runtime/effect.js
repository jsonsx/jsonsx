/**
 * effect.js — microtask-batched effect scheduler for signal-polyfill
 *
 * The TC39 Signals proposal omits effects because scheduling is framework-specific.
 * This is the ~20 lines JSONsx needs. Based on the reference implementation in the
 * signal-polyfill README.
 *
 * @module effect
 */

import { Signal } from 'signal-polyfill';

let needsEnqueue = true;

const watcher = new Signal.subtle.Watcher(() => {
  if (needsEnqueue) {
    needsEnqueue = false;
    queueMicrotask(flush);
  }
});

function flush() {
  needsEnqueue = true;
  for (const s of watcher.getPending()) s.get();
  watcher.watch();
}

/**
 * Run fn immediately, re-run whenever any signal it reads changes.
 * Returns a dispose function to stop tracking.
 *
 * @param {() => void} fn
 * @returns {() => void} dispose
 */
export function effect(fn) {
  const computed = new Signal.Computed(fn);
  watcher.watch(computed);
  computed.get();
  return () => watcher.unwatch(computed);
}

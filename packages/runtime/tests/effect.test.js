import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();

import { describe, test, expect } from 'bun:test';
import { Signal } from 'signal-polyfill';
import { effect } from '../runtime/effect.js';

describe('effect', () => {
  test('runs fn immediately on creation', () => {
    let ran = 0;
    effect(() => { ran++; });
    expect(ran).toBe(1);
  });

  test('re-runs when a read signal changes', async () => {
    const sig = new Signal.State(0);
    let last = -1;
    effect(() => { last = sig.get(); });
    expect(last).toBe(0);

    sig.set(42);
    await Promise.resolve(); // flush microtask
    expect(last).toBe(42);
  });

  test('dispose prevents further re-runs', async () => {
    const sig = new Signal.State(0);
    let count = 0;
    const dispose = effect(() => { sig.get(); count++; });
    expect(count).toBe(1);

    dispose();
    sig.set(1);
    await Promise.resolve();
    expect(count).toBe(1); // still 1 — no re-run after dispose
  });

  test('batches multiple signal writes into a single flush', async () => {
    const a = new Signal.State(0);
    const b = new Signal.State(0);
    let runs = 0;
    effect(() => { a.get(); b.get(); runs++; });
    expect(runs).toBe(1);

    a.set(1);
    b.set(2);
    await Promise.resolve(); // single microtask flush
    expect(runs).toBe(2); // exactly one re-run, not two
  });

  test('handles multiple independent effects on the same signal', async () => {
    const sig = new Signal.State('x');
    const results = [];
    effect(() => results.push('A:' + sig.get()));
    effect(() => results.push('B:' + sig.get()));
    expect(results).toEqual(['A:x', 'B:x']);

    sig.set('y');
    await Promise.resolve();
    expect(results).toEqual(['A:x', 'B:x', 'A:y', 'B:y']);
  });

  test('fn reads no signals — runs once and never again', async () => {
    let count = 0;
    effect(() => { count++; });
    expect(count).toBe(1);
    await Promise.resolve();
    expect(count).toBe(1);
  });

  test('derived computed signal triggers effect', async () => {
    const base = new Signal.State(2);
    const doubled = new Signal.Computed(() => base.get() * 2);
    let seen = null;
    effect(() => { seen = doubled.get(); });
    expect(seen).toBe(4);

    base.set(5);
    await Promise.resolve();
    expect(seen).toBe(10);
  });
});

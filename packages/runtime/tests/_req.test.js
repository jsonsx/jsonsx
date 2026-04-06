import { GlobalRegistrator } from '@happy-dom/global-registrator';
try { GlobalRegistrator.register(); } catch {}

import { describe, test, expect, mock, spyOn } from 'bun:test';
import { Signal } from 'signal-polyfill';
import { resolvePrototype, isSignal } from '../runtime/runtime.js';

const wait = () => new Promise(r => setTimeout(r, 0));

describe('resolvePrototype', () => {
  test('Request: returns Signal.State', async () => {
    global.fetch = mock(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    }));
    const sig = await resolvePrototype({ $prototype: 'Request', url: '/api/test' }, {}, '$data');
    expect(isSignal(sig)).toBe(true);
    await wait();
    expect(sig.get()).toEqual({ id: 1 });
  });
});

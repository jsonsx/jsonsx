import { GlobalRegistrator } from '@happy-dom/global-registrator';
try { GlobalRegistrator.register(); } catch {}

import { describe, test, expect } from 'bun:test';
import { Signal } from 'signal-polyfill';
import {
  resolve,
  buildScope,
  renderNode,
  applyStyle,
  resolveRef,
  resolvePrototype,
  isSignal,
  camelToKebab,
  toCSSText,
  RESERVED_KEYS,
  JSONsx,
} from '../runtime/runtime.js';

describe('sanity', () => {
  test('import works', () => {
    expect(typeof isSignal).toBe('function');
  });
});

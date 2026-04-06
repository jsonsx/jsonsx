import { GlobalRegistrator } from '@happy-dom/global-registrator';
try { GlobalRegistrator.register(); } catch {}

import { describe, test, expect, mock, spyOn } from 'bun:test';
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

const wait = () => new Promise(r => setTimeout(r, 0));
function mkState(v) { return new Signal.State(v); }

describe('isSignal', () => {
  test('true for State', () => expect(isSignal(new Signal.State(0))).toBe(true));
});

describe('resolvePrototype', () => {
  test('Set: default empty', async () => {
    const sig = await resolvePrototype({ $prototype: 'Set' }, {}, '$s');
    expect(sig.get()).toBeInstanceOf(Set);
  });
});

describe('JSONsx', () => {
  test('mounts object doc into target', async () => {
    const target = document.createElement('div');
    await JSONsx({ tagName: 'span', textContent: 'mounted' }, target);
    expect(target.children[0].tagName.toLowerCase()).toBe('span');
  });

  test('defaults target to document.body', async () => {
    const before = document.body.children.length;
    await JSONsx({ tagName: 'div' });
    expect(document.body.children.length).toBe(before + 1);
  });
});

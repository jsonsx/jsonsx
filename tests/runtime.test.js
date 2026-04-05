import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const wait = () => new Promise(r => setTimeout(r, 0));

function mkState(v) { return new Signal.State(v); }

// ─── isSignal ─────────────────────────────────────────────────────────────────

describe('isSignal', () => {
  test('true for Signal.State', () => expect(isSignal(new Signal.State(0))).toBe(true));
  test('true for Signal.Computed', () => {
    expect(isSignal(new Signal.Computed(() => 1))).toBe(true);
  });
  test('false for plain value', () => expect(isSignal(42)).toBe(false));
  test('false for null', () => expect(isSignal(null)).toBe(false));
  test('false for object', () => expect(isSignal({})).toBe(false));
});

// ─── camelToKebab ─────────────────────────────────────────────────────────────

describe('camelToKebab', () => {
  test('single word unchanged', () => expect(camelToKebab('color')).toBe('color'));
  test('converts camelCase', () => expect(camelToKebab('backgroundColor')).toBe('background-color'));
  test('multiple humps', () => expect(camelToKebab('marginTopLeft')).toBe('margin-top-left'));
  test('already kebab', () => expect(camelToKebab('font-size')).toBe('font-size'));
});

// ─── toCSSText ────────────────────────────────────────────────────────────────

describe('toCSSText', () => {
  test('converts properties to CSS text', () => {
    expect(toCSSText({ backgroundColor: 'red', fontSize: '16px' }))
      .toBe('background-color: red; font-size: 16px');
  });
  test('skips nested selectors', () => {
    expect(toCSSText({ color: 'blue', ':hover': { color: 'red' }, '.child': {} }))
      .toBe('color: blue');
  });
  test('empty object', () => expect(toCSSText({})).toBe(''));
});

// ─── RESERVED_KEYS ────────────────────────────────────────────────────────────

describe('RESERVED_KEYS', () => {
  test('is a Set', () => expect(RESERVED_KEYS).toBeInstanceOf(Set));
  const required = ['$schema', '$id', '$defs', '$handlers', '$ref', '$props',
    '$switch', '$prototype', '$handler', '$compute', '$deps', '$media',
    'signal', 'timing', 'default', 'tagName', 'children', 'style', 'attributes',
    'items', 'map', 'filter', 'sort', 'cases'];
  for (const k of required) {
    test(`contains "${k}"`, () => expect(RESERVED_KEYS.has(k)).toBe(true));
  }
});

// ─── resolveRef ───────────────────────────────────────────────────────────────

describe('resolveRef', () => {
  const scope = {
    '$count': mkState(5),
    '$name':  'Alice',
    '$map/item':  { text: 'hello', nested: { deep: 42 } },
    '$map/index': 3,
  };

  test('non-string returns as-is', () => expect(resolveRef(42, scope)).toBe(42));
  test('#/$defs/ prefix resolves from scope', () => {
    expect(resolveRef('#/$defs/$count', scope)).toBe(scope['$count']);
  });
  test('parent#/ prefix resolves from scope', () => {
    expect(resolveRef('parent#/$name', scope)).toBe('Alice');
  });
  test('window#/ resolves global window property', () => {
    window._testProp = 'win';
    expect(resolveRef('window#/_testProp', scope)).toBe('win');
    delete window._testProp;
  });
  test('document#/ resolves global document property', () => {
    document._testProp = 'doc';
    expect(resolveRef('document#/_testProp', scope)).toBe('doc');
    delete document._testProp;
  });
  test('$map/item resolves map item', () => {
    expect(resolveRef('$map/item', scope)).toEqual({ text: 'hello', nested: { deep: 42 } });
  });
  test('$map/index resolves map index', () => {
    expect(resolveRef('$map/index', scope)).toBe(3);
  });
  test('$map/item/text resolves nested path', () => {
    expect(resolveRef('$map/item/text', scope)).toBe('hello');
  });
  test('$map/item/nested/deep resolves deep nested path', () => {
    expect(resolveRef('$map/item/nested/deep', scope)).toBe(42);
  });
  test('unknown ref returns null', () => {
    expect(resolveRef('$nonexistent', scope)).toBeNull();
  });
  test('bare key resolves from scope', () => {
    expect(resolveRef('$name', scope)).toBe('Alice');
  });
});

// ─── resolve ──────────────────────────────────────────────────────────────────

describe('resolve', () => {
  test('returns object as-is (no fetch)', async () => {
    const obj = { tagName: 'div' };
    expect(await resolve(obj)).toBe(obj);
  });

  test('fetches string URL and parses JSON', async () => {
    const payload = { tagName: 'span' };
    global.fetch = mock(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payload),
    }));
    const result = await resolve('http://example.com/comp.json');
    expect(result).toEqual(payload);
  });

  test('throws on non-ok response', async () => {
    global.fetch = mock(() => Promise.resolve({ ok: false, status: 404 }));
    await expect(resolve('http://example.com/missing.json')).rejects.toThrow('404');
  });
});

// ─── buildScope ───────────────────────────────────────────────────────────────

describe('buildScope', () => {
  const BASE = 'http://localhost/';

  test('returns empty scope for empty doc', async () => {
    const scope = await buildScope({}, {}, BASE);
    expect(scope).toEqual({});
  });

  test('creates Signal.State for signal:true defs', async () => {
    const doc = { $defs: { $count: { signal: true, default: 7 } } };
    const scope = await buildScope(doc, {}, BASE);
    expect(isSignal(scope['$count'])).toBe(true);
    expect(scope['$count'].get()).toBe(7);
  });

  test('default null when no default provided', async () => {
    const doc = { $defs: { $x: { signal: true } } };
    const scope = await buildScope(doc, {}, BASE);
    expect(scope['$x'].get()).toBeNull();
  });

  test('skips $handler:true entries', async () => {
    const doc = { $defs: { onClick: { $handler: true } } };
    const scope = await buildScope(doc, {}, BASE);
    expect(scope['onClick']).toBeUndefined();
  });

  test('creates computed signal for $compute', async () => {
    const doc = {
      $defs: {
        $n:  { signal: true, default: 3 },
        $d:  { $compute: 'n * 2', $deps: ['#/$defs/$n'], signal: true },
      },
    };
    const scope = await buildScope(doc, {}, 'http://localhost/');
    expect(isSignal(scope['$d'])).toBe(true);
    // JSONata.evaluate() is async — wait for effect to flush and Promise to resolve
    await new Promise(r => setTimeout(r, 50));
    expect(scope['$d'].get()).toBe(6);
  });

  test('creates prototype signal for $prototype without signal:true', async () => {
    const doc = { $defs: { $items: { $prototype: 'Set', default: [1, 2] } } };
    const scope = await buildScope(doc, {}, 'http://localhost/');
    expect(isSignal(scope['$items'])).toBe(true);
  });

  test('creates prototype signal for $prototype with signal:true', async () => {
    const doc = { $defs: { $items: { $prototype: 'Set', signal: true, default: [1] } } };
    const scope = await buildScope(doc, {}, 'http://localhost/');
    expect(isSignal(scope['$items'])).toBe(true);
  });

  test('merges parentScope', async () => {
    const parent = { $existing: 'from-parent' };
    const scope = await buildScope({}, parent, 'http://localhost/');
    expect(scope['$existing']).toBe('from-parent');
  });

  test('stores $media in scope', async () => {
    const doc = { $media: { '--md': '(min-width: 768px)' } };
    const scope = await buildScope(doc, {}, 'http://localhost/');
    expect(scope['$media']).toEqual({ '--md': '(min-width: 768px)' });
  });

  test('loads $handlers and merges exports', async () => {
    const dataUrl = 'data:text/javascript,export default { myFn() { return 42; } }';
    const scope = await buildScope({ $handlers: dataUrl }, {}, 'http://localhost/');
    expect(typeof scope['myFn']).toBe('function');
  });
});

// ─── applyStyle ───────────────────────────────────────────────────────────────

describe('applyStyle', () => {
  let el;
  beforeEach(() => {
    el = document.createElement('div');
    // Clean up any <style> tags appended by previous test
    document.head.querySelectorAll('style').forEach(s => s.remove());
  });

  test('sets inline style properties', () => {
    applyStyle(el, { color: 'red', fontSize: '14px' });
    expect(el.style.color).toBe('red');
    expect(el.style.fontSize).toBe('14px');
  });

  test('empty style object — no side effects', () => {
    applyStyle(el, {});
    expect(el.dataset.jsonsx).toBeUndefined();
    expect(document.head.querySelectorAll('style').length).toBe(0);
  });

  test('emits scoped <style> for :pseudo selector', () => {
    applyStyle(el, { ':hover': { color: 'blue' } });
    expect(el.dataset.jsonsx).toBeDefined();
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector('style');
    expect(style).not.toBeNull();
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"]:hover`);
    expect(style.textContent).toContain('color: blue');
  });

  test('emits scoped <style> for .class selector', () => {
    applyStyle(el, { '.child': { marginTop: '4px' } });
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector('style');
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"] .child`);
  });

  test('emits scoped <style> for &.compound selector', () => {
    applyStyle(el, { '&.active': { fontWeight: 'bold' } });
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector('style');
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"].active`);
  });

  test('emits scoped <style> for [attr] selector', () => {
    applyStyle(el, { '[disabled]': { opacity: '0.5' } });
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector('style');
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"][disabled]`);
  });

  test('resolves named @--breakpoint from mediaQueries', () => {
    applyStyle(el, { '@--md': { fontSize: '18px' } }, { '--md': '(min-width: 768px)' });
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector('style');
    expect(style.textContent).toContain('@media (min-width: 768px)');
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"]`);
    expect(style.textContent).toContain('font-size: 18px');
  });

  test('uses literal condition for @(min-width:...) keys', () => {
    applyStyle(el, { '@(min-width: 1024px)': { padding: '2rem' } });
    const style = document.head.querySelector('style');
    expect(style.textContent).toContain('@media (min-width: 1024px)');
  });

  test('falls back to raw name when @--name not found in mediaQueries', () => {
    applyStyle(el, { '@--xl': { gap: '2rem' } }, {});
    const style = document.head.querySelector('style');
    // Falls back to the name itself "--xl" as the media condition
    expect(style.textContent).toContain('@media --xl');
  });

  test('combined inline + nested + media', () => {
    applyStyle(
      el,
      { color: 'green', ':focus': { outline: '2px solid blue' }, '@--sm': { color: 'red' } },
      { '--sm': '(min-width: 640px)' }
    );
    expect(el.style.color).toBe('green');
    const style = document.head.querySelector('style');
    expect(style.textContent).toContain(':focus');
    expect(style.textContent).toContain('@media (min-width: 640px)');
  });
});

// ─── resolvePrototype ─────────────────────────────────────────────────────────

describe('resolvePrototype', () => {
  test('Request: returns Signal.State, starts null, fetches and sets data', async () => {
    global.fetch = mock(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    }));
    const sig = resolvePrototype({ $prototype: 'Request', url: '/api/test' }, {}, '$data');
    expect(isSignal(sig)).toBe(true);
    await wait();
    expect(sig.get()).toEqual({ id: 1 });
  });

  test('Request: manual:true does not auto-fetch', async () => {
    const fetchMock = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    global.fetch = fetchMock;
    resolvePrototype({ $prototype: 'Request', url: '/api/x', manual: true }, {}, '$x');
    await wait();
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  test('Request: exposes .fetch() method for manual refetch', async () => {
    global.fetch = mock(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ n: 2 }),
    }));
    const sig = resolvePrototype({ $prototype: 'Request', url: '/api/y', manual: true }, {}, '$y');
    sig.fetch();
    await wait();
    expect(sig.get()).toEqual({ n: 2 });
  });

  test('Request: sets error on non-ok response', async () => {
    global.fetch = mock(() => Promise.resolve({
      ok: false,
      statusText: 'Not Found',
      json: () => Promise.resolve({}),
    }));
    const sig = resolvePrototype({ $prototype: 'Request', url: '/api/z' }, {}, '$z');
    await wait();
    expect(sig.get()).toHaveProperty('error');
  });

  test('Request: skips fetch when url resolves to undefined', async () => {
    const fetchMock = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    global.fetch = fetchMock;
    resolvePrototype({ $prototype: 'Request', url: undefined }, {}, '$r');
    await wait();
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  test('Request: POST with headers and body', async () => {
    let captured;
    global.fetch = mock((_url, opts) => { captured = opts; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
    resolvePrototype({ $prototype: 'Request', url: '/api', method: 'POST', headers: { 'x': '1' }, body: { a: 1 } }, {}, '$r');
    await wait();
    expect(captured.method).toBe('POST');
    expect(captured.headers).toEqual({ x: '1' });
    expect(captured.body).toBe('{"a":1}');
  });

  test('URLSearchParams: returns computed signal', () => {
    const scope = { $q: mkState('hello') };
    const sig = resolvePrototype({ $prototype: 'URLSearchParams', q: { $ref: '#/$defs/$q' } }, scope, '$params');
    expect(sig).toBeInstanceOf(Signal.Computed);
  });

  test('LocalStorage: reads existing value', () => {
    localStorage.setItem('lsKey', JSON.stringify(99));
    const sig = resolvePrototype({ $prototype: 'LocalStorage', key: 'lsKey' }, {}, '$ls');
    expect(sig.get()).toBe(99);
    localStorage.removeItem('lsKey');
  });

  test('LocalStorage: defaults to def.default when key absent', () => {
    localStorage.removeItem('lsMissing');
    const sig = resolvePrototype({ $prototype: 'LocalStorage', key: 'lsMissing', default: 'fallback' }, {}, '$ls');
    expect(sig.get()).toBe('fallback');
  });

  test('LocalStorage: uses def key name when key prop absent', () => {
    const sig = resolvePrototype({ $prototype: 'LocalStorage', default: 'x' }, {}, 'myKey');
    expect(sig.get()).toBe('x');
  });

  test('LocalStorage: .set() persists to storage', () => {
    const sig = resolvePrototype({ $prototype: 'LocalStorage', key: 'lsPersist', default: 0 }, {}, '$ls');
    sig.set(123);
    expect(JSON.parse(localStorage.getItem('lsPersist'))).toBe(123);
  });

  test('LocalStorage: .clear() removes from storage', () => {
    localStorage.setItem('lsClear', JSON.stringify(1));
    const sig = resolvePrototype({ $prototype: 'LocalStorage', key: 'lsClear' }, {}, '$ls');
    sig.clear();
    expect(localStorage.getItem('lsClear')).toBeNull();
    expect(sig.get()).toBeNull();
  });

  test('SessionStorage: reads and writes session storage', () => {
    sessionStorage.setItem('ssKey', JSON.stringify('hello'));
    const sig = resolvePrototype({ $prototype: 'SessionStorage', key: 'ssKey' }, {}, '$ss');
    expect(sig.get()).toBe('hello');
    sig.set('world');
    expect(JSON.parse(sessionStorage.getItem('ssKey'))).toBe('world');
    sig.clear();
    expect(sessionStorage.getItem('ssKey')).toBeNull();
  });

  test('Cookie: reads, writes, and clears cookie', () => {
    const sig = resolvePrototype({
      $prototype: 'Cookie', name: 'testCookie', default: null,
      maxAge: 3600, path: '/', secure: false,
    }, {}, '$ck');
    expect(sig.get()).toBeNull();
    sig.set({ user: 'bob' });
    expect(sig.get()).toEqual({ user: 'bob' });
    sig.clear();
    expect(sig.get()).toBeNull();
  });

  test('Cookie: uses def key name when name prop absent', () => {
    const sig = resolvePrototype({ $prototype: 'Cookie', default: 'ck' }, {}, 'myCookie');
    expect(sig.get()).toBe('ck');
  });

  test('Cookie: with domain and sameSite', () => {
    const sig = resolvePrototype({
      $prototype: 'Cookie', name: 'c2', default: null,
      domain: 'localhost', sameSite: 'Strict',
    }, {}, '$c2');
    sig.set('val');
    expect(sig.get()).toBe('val');
  });

  test('IndexedDB: returns Signal.State', () => {
    // happy-dom doesn't provide indexedDB — stub it for this test
    const fakeReq = { onupgradeneeded: null, onsuccess: null, onerror: null };
    global.indexedDB = { open: () => fakeReq };
    const sig = resolvePrototype({
      $prototype: 'IndexedDB', database: 'testDB', store: 'items',
    }, {}, '$db');
    expect(isSignal(sig)).toBe(true);
    delete global.indexedDB;
  });

  test('Set: default empty', () => {
    const sig = resolvePrototype({ $prototype: 'Set' }, {}, '$s');
    expect(sig.get()).toBeInstanceOf(Set);
    expect(sig.get().size).toBe(0);
  });

  test('Set: default values', () => {
    const sig = resolvePrototype({ $prototype: 'Set', default: [1, 2] }, {}, '$s');
    expect(sig.get().has(1)).toBe(true);
  });

  test('Set: .add()', () => {
    const sig = resolvePrototype({ $prototype: 'Set' }, {}, '$s');
    sig.add('x');
    expect(sig.get().has('x')).toBe(true);
  });

  test('Set: .delete()', () => {
    const sig = resolvePrototype({ $prototype: 'Set', default: ['a', 'b'] }, {}, '$s');
    sig.delete('a');
    expect(sig.get().has('a')).toBe(false);
  });

  test('Set: .clear()', () => {
    const sig = resolvePrototype({ $prototype: 'Set', default: [1] }, {}, '$s');
    sig.clear();
    expect(sig.get().size).toBe(0);
  });

  test('Map: default empty', () => {
    const sig = resolvePrototype({ $prototype: 'Map' }, {}, '$m');
    expect(sig.get()).toBeInstanceOf(Map);
  });

  test('Map: default object', () => {
    const sig = resolvePrototype({ $prototype: 'Map', default: { a: 1 } }, {}, '$m');
    expect(sig.get().get('a')).toBe(1);
  });

  test('Map: .put()', () => {
    const sig = resolvePrototype({ $prototype: 'Map' }, {}, '$m');
    sig.put('k', 'v');
    expect(sig.get().get('k')).toBe('v');
  });

  test('Map: .remove()', () => {
    const sig = resolvePrototype({ $prototype: 'Map', default: { x: 9 } }, {}, '$m');
    sig.remove('x');
    expect(sig.get().has('x')).toBe(false);
  });

  test('Map: .clear()', () => {
    const sig = resolvePrototype({ $prototype: 'Map', default: { a: 1 } }, {}, '$m');
    sig.clear();
    expect(sig.get().size).toBe(0);
  });

  test('FormData: returns Signal.State with FormData', () => {
    const sig = resolvePrototype({ $prototype: 'FormData', fields: { name: 'Alice' } }, {}, '$fd');
    expect(sig.get()).toBeInstanceOf(FormData);
    expect(sig.get().get('name')).toBe('Alice');
  });

  test('FormData: no fields', () => {
    const sig = resolvePrototype({ $prototype: 'FormData' }, {}, '$fd');
    expect(sig.get()).toBeInstanceOf(FormData);
  });

  test('Blob: returns Signal.State with Blob', () => {
    const sig = resolvePrototype({ $prototype: 'Blob', parts: ['hello'], type: 'text/plain' }, {}, '$b');
    expect(sig.get()).toBeInstanceOf(Blob);
  });

  test('Blob: no parts or type', () => {
    const sig = resolvePrototype({ $prototype: 'Blob' }, {}, '$b');
    expect(sig.get()).toBeInstanceOf(Blob);
  });

  test('ReadableStream: returns Signal.State(null)', () => {
    const sig = resolvePrototype({ $prototype: 'ReadableStream' }, {}, '$rs');
    expect(isSignal(sig)).toBe(true);
    expect(sig.get()).toBeNull();
  });

  test('unknown $prototype: warns and returns Signal.State(null)', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const sig = resolvePrototype({ $prototype: 'Unknown' }, {}, '$u');
    expect(isSignal(sig)).toBe(true);
    expect(sig.get()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown'));
    warn.mockRestore();
  });
});

// ─── renderNode ───────────────────────────────────────────────────────────────

describe('renderNode', () => {
  test('creates element with correct tagName', () => {
    const el = renderNode({ tagName: 'section' }, {});
    expect(el.tagName.toLowerCase()).toBe('section');
  });

  test('defaults tagName to div', () => {
    const el = renderNode({}, {});
    expect(el.tagName.toLowerCase()).toBe('div');
  });

  test('sets plain string property', () => {
    const el = renderNode({ tagName: 'p', textContent: 'Hello' }, {});
    expect(el.textContent).toBe('Hello');
  });

  test('sets plain boolean property', () => {
    const el = renderNode({ tagName: 'button', disabled: true }, {});
    expect(el.disabled).toBe(true);
  });

  test('sets reactive property from Signal.State via $ref', async () => {
    const $msg = mkState('initial');
    const scope = { '$msg': $msg };
    const el = renderNode({ tagName: 'span', textContent: { $ref: '#/$defs/$msg' } }, scope);
    expect(el.textContent).toBe('initial');
    $msg.set('updated');
    await Promise.resolve();
    expect(el.textContent).toBe('updated');
  });

  test('sets non-reactive property from plain value $ref', () => {
    const scope = { '$label': 'static' };
    const el = renderNode({ tagName: 'span', textContent: { $ref: '#/$defs/$label' } }, scope);
    expect(el.textContent).toBe('static');
  });

  test('protected id property: set once, not reactive', () => {
    const $id = mkState('my-id');
    const scope = { '$id': $id };
    const el = renderNode({ tagName: 'div', id: { $ref: '#/$defs/$id' } }, scope);
    expect(el.id).toBe('my-id');
  });

  test('binds event handler via onclick $ref', () => {
    let called = false;
    const scope = { clickHandler: function() { called = true; } };
    const el = renderNode({ tagName: 'button', onclick: { $ref: 'clickHandler' } }, scope);
    el.dispatchEvent(new Event('click'));
    expect(called).toBe(true);
  });

  test('ignores handler $ref when not a function', () => {
    const scope = { $notFn: 42 };
    // Should not throw
    expect(() => renderNode({ tagName: 'div', onclick: { $ref: '#/$defs/$notFn' } }, scope)).not.toThrow();
  });

  test('applies attributes', () => {
    const el = renderNode({ tagName: 'div', attributes: { 'data-x': 'val' } }, {});
    expect(el.getAttribute('data-x')).toBe('val');
  });

  test('applies reactive attribute from signal', async () => {
    const $cls = mkState('a');
    const scope = { '$cls': $cls };
    const el = renderNode({ tagName: 'div', attributes: { 'data-cls': { $ref: '#/$defs/$cls' } } }, scope);
    expect(el.getAttribute('data-cls')).toBe('a');
    $cls.set('b');
    await Promise.resolve();
    expect(el.getAttribute('data-cls')).toBe('b');
  });

  test('applies static attribute from plain $ref', () => {
    const scope = { '$val': 'hello' };
    const el = renderNode({ tagName: 'div', attributes: { 'aria-label': { $ref: '#/$defs/$val' } } }, scope);
    expect(el.getAttribute('aria-label')).toBe('hello');
  });

  test('renders children recursively', () => {
    const el = renderNode({
      tagName: 'ul',
      children: [
        { tagName: 'li', textContent: 'A' },
        { tagName: 'li', textContent: 'B' },
      ],
    }, {});
    expect(el.children.length).toBe(2);
    expect(el.children[0].textContent).toBe('A');
    expect(el.children[1].textContent).toBe('B');
  });

  test('$-prefixed local binding extends scope for children', () => {
    const scope = { '$map/item': { label: 'hello' } };
    const el = renderNode({
      tagName: 'div',
      '$item': { $ref: '$map/item' },
      children: [{ tagName: 'span', textContent: 'child' }],
    }, scope);
    expect(el.children[0].textContent).toBe('child');
  });

  test('$-prefixed non-ref local binding', () => {
    const el = renderNode({
      tagName: 'div',
      '$data': { raw: true },
    }, {});
    expect(el.tagName.toLowerCase()).toBe('div');
  });

  test('$switch renders correct case', () => {
    const $route = mkState('about');
    const scope = { '$route': $route };
    const el = renderNode({
      tagName: 'div',
      $switch: { $ref: '#/$defs/$route' },
      cases: {
        home:  { tagName: 'section', textContent: 'Home' },
        about: { tagName: 'section', textContent: 'About' },
      },
    }, scope);
    expect(el.textContent).toBe('About');
  });

  test('$switch reacts to signal change', async () => {
    const $route = mkState('home');
    const scope = { '$route': $route };
    const el = renderNode({
      tagName: 'div',
      $switch: { $ref: '#/$defs/$route' },
      cases: {
        home:  { tagName: 'div', textContent: 'Home' },
        about: { tagName: 'div', textContent: 'About' },
      },
    }, scope);
    expect(el.textContent).toBe('Home');
    $route.set('about');
    await Promise.resolve();
    expect(el.textContent).toBe('About');
  });

  test('$switch with missing case renders empty', () => {
    const $route = mkState('404');
    const scope = { '$route': $route };
    const el = renderNode({
      tagName: 'div',
      $switch: { $ref: '#/$defs/$route' },
      cases: { home: { tagName: 'div', textContent: 'Home' } },
    }, scope);
    expect(el.textContent).toBe('');
  });

  test('$switch with non-signal renders once', () => {
    const scope = { '$route': 'home' };
    const el = renderNode({
      tagName: 'div',
      $switch: { $ref: '#/$defs/$route' },
      cases: { home: { tagName: 'div', textContent: 'Home' } },
    }, scope);
    expect(el.textContent).toBe('Home');
  });

  test('Array map renders static items', () => {
    const el = renderNode({
      tagName: 'ul',
      children: {
        $prototype: 'Array',
        items: [{ id: 1, label: 'X' }],
        map: { tagName: 'li', '$item': { $ref: '$map/item' } },
      },
    }, {});
    expect(el.children.length).toBe(1);
  });

  test('Array map re-renders on signal change', async () => {
    const $list = mkState([{ v: 'a' }, { v: 'b' }]);
    const scope = { '$list': $list };
    const el = renderNode({
      tagName: 'ul',
      children: {
        $prototype: 'Array',
        items: { $ref: '#/$defs/$list' },
        map: { tagName: 'li' },
      },
    }, scope);
    expect(el.children.length).toBe(2);
    $list.set([{ v: 'x' }]);
    await Promise.resolve();
    expect(el.children.length).toBe(1);
  });

  test('Array map with filter', () => {
    const $list = mkState([1, 2, 3, 4]);
    const scope = {
      '$list': $list,
      'isEven': (x) => x % 2 === 0,
    };
    const el = renderNode({
      tagName: 'div',
      children: {
        $prototype: 'Array',
        items: { $ref: '#/$defs/$list' },
        filter: { $ref: 'isEven' },
        map: { tagName: 'span' },
      },
    }, scope);
    expect(el.children.length).toBe(2);
  });

  test('Array map with sort', () => {
    const $list = mkState([3, 1, 2]);
    const scope = {
      '$list': $list,
      'sortAsc': (a, b) => a - b,
    };
    const el = renderNode({
      tagName: 'div',
      children: {
        $prototype: 'Array',
        items: { $ref: '#/$defs/$list' },
        sort: { $ref: 'sortAsc' },
        map: { tagName: 'span' },
      },
    }, scope);
    expect(el.children.length).toBe(3);
  });

  test('Array map: items not an array returns empty', () => {
    const scope = { '$list': mkState(null) };
    const el = renderNode({
      tagName: 'div',
      children: {
        $prototype: 'Array',
        items: { $ref: '#/$defs/$list' },
        map: { tagName: 'span' },
      },
    }, scope);
    expect(el.children.length).toBe(0);
  });

  test('$props merges into scope', () => {
    const $count = mkState(10);
    const scope = { '$count': $count };
    const def = {
      tagName: 'span',
      $props: { '$val': { $ref: '#/$defs/$count' } },
      textContent: 'ok',
    };
    // renderNode calls mergeProps then re-renders without $props
    const el = renderNode(def, scope);
    expect(el.textContent).toBe('ok');
  });

  test('style object applied', () => {
    const el = renderNode({ tagName: 'div', style: { color: 'green' } }, {});
    expect(el.style.color).toBe('green');
  });
});

// ─── JSONsx (top-level mount) ─────────────────────────────────────────────────

describe('JSONsx', () => {
  test('mounts object doc into target', async () => {
    const target = document.createElement('div');
    await JSONsx({ tagName: 'span', textContent: 'mounted' }, target);
    expect(target.children[0].tagName.toLowerCase()).toBe('span');
    expect(target.children[0].textContent).toBe('mounted');
  });

  test('returns scope', async () => {
    const target = document.createElement('div');
    const scope = await JSONsx({ tagName: 'div', $defs: { $x: { signal: true, default: 1 } } }, target);
    expect(isSignal(scope['$x'])).toBe(true);
  });

  test('calls onMount if present in scope', async () => {
    const target = document.createElement('div');
    // onMount is called after mount; inject it via $handlers data URL
    const dataUrl = 'data:text/javascript,export default { onMount() { globalThis._testMounted = true; } }';
    await JSONsx({ tagName: 'div', $handlers: dataUrl }, target);
    await wait();
    expect(globalThis._testMounted).toBe(true);
    delete globalThis._testMounted;
  });

  test('fetches string source', async () => {
    const doc = { tagName: 'article' };
    global.fetch = mock(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(doc),
    }));
    const target = document.createElement('div');
    await JSONsx('http://example.com/test.json', target);
    expect(target.children[0].tagName.toLowerCase()).toBe('article');
  });

  test('defaults target to document.body', async () => {
    const before = document.body.children.length;
    await JSONsx({ tagName: 'div' });
    expect(document.body.children.length).toBe(before + 1);
  });
});

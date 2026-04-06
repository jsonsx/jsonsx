/**
 * JSONsx — JSON-native reactive web component runtime
 * @version 1.0.0
 * @license MIT
 *
 * Four-step pipeline:
 *   1. resolve    — fetch JSON source (or accept raw object)
 *   2. buildScope — five-shape $defs detection + signal/function creation
 *   3. render     — walk resolved tree, build DOM, wire reactive effects
 *   4. output     — append to target
 *
 * @module jsonsx
 */

import { Signal } from 'signal-polyfill';
import { effect } from './effect.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Mount a JSONsx document into a DOM container.
 *
 * @param {string | object} source - Path to .json file, URL, or raw document object
 * @param {HTMLElement} [target=document.body]
 * @returns {Promise<object>} Resolves with the live component scope
 *
 * @example
 * import { JSONsx } from '@jsonsx/runtime';
 * const scope = await JSONsx('./counter.json', document.getElementById('app'));
 */
export async function JSONsx(source, target = document.body) {
  const base  = typeof source === 'string'
    ? new URL(source, location.href).href
    : location.href;
  const doc   = await resolve(source);
  const scope = await buildScope(doc, {}, base);
  target.appendChild(renderNode(doc, scope));
  if (typeof scope.onMount === 'function') scope.onMount.call(scope);
  return scope;
}

// ─── Step 1: Resolve ──────────────────────────────────────────────────────────

/**
 * Fetch and parse a JSONsx JSON source.
 * Accepts a URL string, absolute URL, or a pre-parsed object.
 *
 * @param {string | object} source
 * @returns {Promise<object>}
 */
export async function resolve(source) {
  if (typeof source !== 'string') return source;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`JSONsx: failed to fetch ${source} (${res.status})`);
  return res.json();
}

// ─── Step 2: Build scope ──────────────────────────────────────────────────────

/**
 * JSON Schema keywords used to identify pure type definitions (Shape 2b).
 */
const SCHEMA_KEYWORDS = new Set([
  'type', 'properties', 'items', 'enum', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'required', 'examples',
]);

/**
 * Build the reactive scope from $defs using the five-shape detection algorithm.
 *
 * @param {object} doc
 * @param {object} [parentScope={}]
 * @param {string} [base=location.href]  Base URL for resolving $src imports
 * @returns {Promise<object>}
 */
export async function buildScope(doc, parentScope = {}, base = location.href) {
  const scope = { ...parentScope };

  for (const [key, def] of Object.entries(doc.$defs ?? {})) {

    // 1. String value
    if (typeof def === 'string') {
      if (def.includes('${')) {
        // Shape 3: Computed signal (template string)
        scope[key] = makeTemplateComputed(def, scope);
      } else {
        // Shape 1: String state signal
        scope[key] = new Signal.State(def);
      }
      continue;
    }

    // 2. Number, boolean, or null
    if (typeof def === 'number' || typeof def === 'boolean' || def === null) {
      scope[key] = new Signal.State(def);
      continue;
    }

    // 3. Array
    if (Array.isArray(def)) {
      scope[key] = new Signal.State(def);
      continue;
    }

    // 4. Object
    if (typeof def === 'object') {
      // 4a. $prototype: "Function" → Shape 4
      if (def.$prototype === 'Function') {
        scope[key] = await resolveFunction(def, scope, key, base);
        continue;
      }

      // 4b. $prototype: <other> → Shape 5: External class / Web API namespace
      if (def.$prototype) {
        scope[key] = await resolvePrototype(def, scope, key, base);
        continue;
      }

      // 4c. Has "default" → Shape 2: Expanded signal
      if ('default' in def) {
        scope[key] = new Signal.State(def.default);
        continue;
      }

      // 4d. Has JSON Schema keywords but no default, no $prototype → Shape 2b: pure type def
      if (hasSchemaKeywords(def)) {
        continue; // no-op: tooling only
      }

      // 4e. Plain object → Shape 1: Object state signal
      scope[key] = new Signal.State(def);
      continue;
    }
  }

  if (doc.$media) {
    scope['$media'] = doc.$media;
  }

  return scope;
}

/**
 * Check whether an object contains any JSON Schema keywords.
 * Used to discriminate Shape 2b (pure type definition) from Shape 1 (naked object).
 */
function hasSchemaKeywords(obj) {
  for (const k of Object.keys(obj)) {
    if (SCHEMA_KEYWORDS.has(k)) return true;
  }
  return false;
}
export { hasSchemaKeywords };

/**
 * Create a Signal.Computed from a template string containing ${}.
 * The template is evaluated as a JS template literal with `this` mapped to scope.
 */
function makeTemplateComputed(template, scope) {
  const fn = new Function('scope', `with(scope){return \`${template}\`}`);
  return new Signal.Computed(() => fn(scope));
}

// ─── Step 2b: Function resolution (Shape 4) ─────────────────────────────────

/**
 * Module cache for $src imports (shared with external class resolution).
 */
const _moduleCache = new Map();

/**
 * Resolve a $prototype: "Function" entry into a bound function or Signal.Computed.
 *
 * @param {object} def   - $defs entry with $prototype: "Function"
 * @param {object} scope
 * @param {string} key   - def key name
 * @param {string} [base] - Base URL for resolving $src imports
 * @returns {Promise<Function|Signal.Computed>}
 */
async function resolveFunction(def, scope, key, base) {
  if (def.body && def.$src) {
    throw new Error(`JSONsx: '${key}' declares both body and $src — these are mutually exclusive`);
  }
  if (!def.body && !def.$src) {
    throw new Error(`JSONsx: '${key}' is a Function prototype with no body or $src`);
  }

  let fn;

  if (def.body) {
    const args = def.arguments ?? [];
    fn = new Function(...args, def.body);
    Object.defineProperty(fn, 'name', { value: def.name ?? key, configurable: true });
  } else {
    // $src: dynamic import
    const src = def.$src;
    const exportName = def.$export ?? key;
    let mod;
    if (_moduleCache.has(src)) {
      mod = _moduleCache.get(src);
    } else {
      try {
        mod = await import(src);
      } catch {
        if (base) {
          const resolvedSrc = new URL(src, base).href;
          mod = await import(resolvedSrc);
        } else {
          throw new Error(`JSONsx: failed to import '$src' "${src}" for "${key}"`);
        }
      }
      _moduleCache.set(src, mod);
    }
    fn = mod[exportName] ?? mod.default?.[exportName];
    if (typeof fn !== 'function') {
      throw new Error(`JSONsx: export "${exportName}" not found or not a function in "${src}"`);
    }
  }

  // signal: true → wrap in Signal.Computed
  if (def.signal) {
    return new Signal.Computed(fn.bind(scope));
  }

  return fn.bind(scope);
}

// ─── Step 3: Render ───────────────────────────────────────────────────────────

/**
 * Reserved JSONsx keys — never set as DOM properties.
 * @type {Set<string>}
 */
export const RESERVED_KEYS = new Set([
  '$schema', '$id', '$defs', '$ref', '$props',
  '$switch', '$prototype', '$src', '$export',
  '$media', '$map',
  'signal', 'timing', 'default', 'description',
  'body', 'arguments', 'name',
  'tagName', 'children', 'style', 'attributes',
  'items', 'map', 'filter', 'sort', 'cases',
]);

/**
 * Recursively render a JSONsx element definition into a DOM element.
 *
 * @param {object} def
 * @param {object} scope
 * @returns {HTMLElement}
 */
export function renderNode(def, scope) {
  // Extend scope with any $-prefixed local bindings declared on this node
  let localScope = scope;
  for (const [key, val] of Object.entries(def)) {
    if (key.startsWith('$') && !RESERVED_KEYS.has(key)) {
      if (localScope === scope) localScope = { ...scope };
      localScope[key] = isRefObj(val) ? resolveRef(val.$ref, scope) : val;
    }
  }

  if (def.$props) {
    const { $props, ...rest } = def;
    return renderNode(rest, mergeProps(def, localScope));
  }
  if (def.$switch)                          return renderSwitch(def, localScope);
  if (def.children?.$prototype === 'Array') return renderMappedArray(def, localScope);

  const el = document.createElement(def.tagName ?? 'div');

  applyProperties(el, def, localScope);
  applyStyle(el, def.style ?? {}, localScope['$media'] ?? {}, localScope);
  applyAttributes(el, def.attributes ?? {}, localScope);

  for (const child of (Array.isArray(def.children) ? def.children : [])) {
    el.appendChild(renderNode(child, localScope));
  }

  return el;
}

// ─── Template string utilities ────────────────────────────────────────────────

/**
 * Check if a value is a template string (contains ${}).
 */
function isTemplateString(val) {
  return typeof val === 'string' && val.includes('${');
}

/**
 * Evaluate a template string in the context of a scope.
 * Template strings use `this.$name` syntax which maps to `scope.$name`.
 */
function evaluateTemplate(str, scope) {
  const fn = new Function('scope', `with(scope){return \`${str}\`}`);
  return fn(scope);
}

// ─── Property / style / attribute application ─────────────────────────────────

function applyProperties(el, def, scope) {
  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key.startsWith('$')) continue;   // scope bindings — handled in renderNode

    if (key.startsWith('on') && isRefObj(val)) {
      const handler = resolveRef(val.$ref, scope);
      if (typeof handler === 'function') el.addEventListener(key.slice(2), handler.bind(scope));
      continue;
    }

    bindProperty(el, key, val, scope);
  }
}

function bindProperty(el, key, val, scope) {
  if (isRefObj(val)) {
    const resolved = resolveRef(val.$ref, scope);
    if (isSignal(resolved)) {
      if (key === 'id') { el[key] = resolved.get(); return; }
      effect(() => { el[key] = resolved.get(); });
    } else {
      el[key] = resolved;
    }
    return;
  }

  // Universal ${} reactivity — template strings in element properties
  if (isTemplateString(val)) {
    effect(() => { el[key] = evaluateTemplate(val, scope); });
    return;
  }

  el[key] = val;
}

/**
 * Apply inline styles and emit a scoped <style> block for nested CSS selectors
 * and @custom-media breakpoint rules.
 *
 * @param {HTMLElement} el
 * @param {object}      styleDef
 * @param {object}      [mediaQueries={}]  Named breakpoints from root $media
 * @param {object}      [scope={}]         Component scope for template string evaluation
 */
export function applyStyle(el, styleDef, mediaQueries = {}, scope = {}) {
  const nested = {};
  const media  = {};

  for (const [prop, val] of Object.entries(styleDef)) {
    if (prop.startsWith('@'))            media[prop]  = val;
    else if (isNestedSelector(prop))     nested[prop] = val;
    else if (isTemplateString(val))      effect(() => { el.style[prop] = evaluateTemplate(val, scope); });
    else el.style[prop] = val;
  }

  const hasNested = Object.keys(nested).length > 0;
  const hasMedia  = Object.keys(media).length  > 0;
  if (!hasNested && !hasMedia) return;

  const uid = `jsonsx-${Math.random().toString(36).slice(2, 7)}`;
  el.dataset.jsonsx = uid;

  let css = '';

  for (const [sel, rules] of Object.entries(nested)) {
    const resolved = sel.startsWith('&')
      ? sel.replace('&', `[data-jsonsx="${uid}"]`)
      : sel.startsWith('[')
        ? `[data-jsonsx="${uid}"]${sel}`
        : `[data-jsonsx="${uid}"] ${sel}`;
    css += `${resolved} { ${toCSSText(rules)} }\n`;
  }

  for (const [key, rules] of Object.entries(media)) {
    const query = key.startsWith('@--')
      ? (mediaQueries[key.slice(1)] ?? key.slice(1))
      : key.slice(1);
    css += `@media ${query} { [data-jsonsx="${uid}"] { ${toCSSText(rules)} } }\n`;
  }

  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

function applyAttributes(el, attrs, scope) {
  for (const [k, v] of Object.entries(attrs)) {
    if (isRefObj(v)) {
      const resolved = resolveRef(v.$ref, scope);
      if (isSignal(resolved)) effect(() => el.setAttribute(k, String(resolved.get())));
      else el.setAttribute(k, String(resolved ?? ''));
    } else if (isTemplateString(v)) {
      effect(() => el.setAttribute(k, String(evaluateTemplate(v, scope))));
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

// ─── Array mapping ────────────────────────────────────────────────────────────

function renderMappedArray(def, scope) {
  const container = document.createElement(def.tagName ?? 'div');
  const { items: itemsSrc, map: mapDef, filter: filterRef, sort: sortRef } = def.children;

  const getItems = () => {
    let items;
    if (isRefObj(itemsSrc)) {
      const sig = resolveRef(itemsSrc.$ref, scope);
      items = isSignal(sig) ? sig.get() : sig;
    } else { items = itemsSrc; }
    if (!Array.isArray(items)) return [];
    if (filterRef) { const fn = resolveRef(filterRef.$ref, scope); if (typeof fn === 'function') items = items.filter(fn); }
    if (sortRef)   { const fn = resolveRef(sortRef.$ref, scope);   if (typeof fn === 'function') items = [...items].sort(fn); }
    return items;
  };

  const render = () => {
    container.innerHTML = '';
    getItems().forEach((item, index) => {
      const child = { ...scope, '$map/item': item, '$map/index': index, '$map': { item, index } };
      container.appendChild(renderNode(mapDef, child));
    });
  };

  const sig = isRefObj(itemsSrc) && resolveRef(itemsSrc.$ref, scope);
  if (isSignal(sig)) effect(render);
  else render();

  return container;
}

// ─── $switch ──────────────────────────────────────────────────────────────────

function renderSwitch(def, scope) {
  const container = document.createElement(def.tagName ?? 'div');
  const sig = resolveRef(def.$switch.$ref, scope);
  const getKey = () => isSignal(sig) ? sig.get() : sig;

  const render = () => {
    container.innerHTML = '';
    const caseDef = def.cases?.[getKey()];
    if (caseDef) container.appendChild(renderNode(caseDef, scope));
  };

  if (isSignal(sig)) effect(render);
  else render();

  return container;
}

// ─── Prototype namespaces (Shape 5) ──────────────────────────────────────────

/**
 * Resolve a $prototype definition into a reactive signal wrapping a Web API
 * or an external class loaded via $src.
 *
 * @param {object} def   - $defs entry with $prototype
 * @param {object} scope
 * @param {string} key   - def key (for diagnostics)
 * @param {string} [base] - Base URL for resolving $src imports
 * @returns {Promise<Signal.State>|Signal.State}
 */
export async function resolvePrototype(def, scope, key, base) {

  // ── External class via $src ─────────────────────────────────────────────────
  if (def.$src) {
    return resolveExternalPrototype(def, scope, key, base);
  }

  switch (def.$prototype) {

    case 'Request': {
      const state = new Signal.State(null);
      const doFetch = () => {
        const url = interpolateRef(def.url, scope);
        if (!url || url === 'undefined') return;
        fetch(url, {
          method: def.method ?? 'GET',
          ...(def.headers && { headers: def.headers }),
          ...(def.body    && { body: typeof def.body === 'object' ? JSON.stringify(def.body) : def.body }),
        })
          .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
          .then(d => state.set(d))
          .catch(e => state.set({ error: String(e) }));
      };
      if (!def.manual) doFetch();
      state.fetch = doFetch;
      return state;
    }

    case 'URLSearchParams':
      return new Signal.Computed(() => {
        const p = {};
        for (const [k, v] of Object.entries(def)) {
          if (k !== '$prototype' && k !== 'signal') p[k] = interpolateRef(v, scope);
        }
        return new URLSearchParams(p).toString();
      });

    case 'LocalStorage':
    case 'SessionStorage': {
      const store = def.$prototype === 'LocalStorage' ? localStorage : sessionStorage;
      const k = def.key ?? key;
      let init;
      try { const s = store.getItem(k); init = s !== null ? JSON.parse(s) : (def.default ?? null); }
      catch { init = def.default ?? null; }
      const sig = new Signal.State(init);
      const orig = sig.set.bind(sig);
      sig.set   = v => { try { store.setItem(k, JSON.stringify(v)); } catch {} orig(v); };
      sig.clear = () => { try { store.removeItem(k); } catch {} orig(null); };
      return sig;
    }

    case 'Cookie': {
      const name = def.name ?? key;
      const read = () => { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); if (!m) return null; try { return JSON.parse(decodeURIComponent(m[1])); } catch { return m[1]; } };
      const write = v => { let s = `${name}=${encodeURIComponent(JSON.stringify(v))}`; if (def.maxAge !== undefined) s += `; Max-Age=${def.maxAge}`; if (def.path) s += `; Path=${def.path}`; if (def.domain) s += `; Domain=${def.domain}`; if (def.secure) s += `; Secure`; if (def.sameSite) s += `; SameSite=${def.sameSite}`; document.cookie = s; };
      const sig = new Signal.State(read() ?? def.default ?? null);
      const orig = sig.set.bind(sig);
      sig.set   = v => { write(v); orig(v); };
      sig.clear = () => { document.cookie = `${name}=; Max-Age=-99999999`; orig(null); };
      return sig;
    }

    case 'IndexedDB': {
      const state = new Signal.State(null);
      const { database, store, version = 1, keyPath = 'id', autoIncrement = true, indexes = [] } = def;
      const req = indexedDB.open(database, version);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, { keyPath, autoIncrement });
          for (const i of indexes) os.createIndex(i.name, i.keyPath, { unique: i.unique ?? false });
        }
      };
      req.onsuccess = e => {
        const db = e.target.result;
        state.set({ database, store, version, isReady: true, getStore: (mode = 'readwrite') => Promise.resolve(db.transaction(store, mode).objectStore(store)) });
      };
      req.onerror = () => state.set({ error: req.error?.message });
      return state;
    }

    case 'Set': {
      const sig = new Signal.State(new Set(def.default ?? []));
      const orig = sig.set.bind(sig);
      sig.add    = v => orig(new Set([...sig.get(), v]));
      sig.delete = v => { const s = new Set(sig.get()); s.delete(v); orig(s); };
      sig.clear  = () => orig(new Set());
      return sig;
    }

    case 'Map': {
      const sig = new Signal.State(new Map(Object.entries(def.default ?? {})));
      const orig = sig.set.bind(sig);
      sig.put    = (k, v) => orig(new Map([...sig.get(), [k, v]]));
      sig.remove = k => { const m = new Map(sig.get()); m.delete(k); orig(m); };
      sig.clear  = () => orig(new Map());
      return sig;
    }

    case 'FormData': {
      const fd = new FormData();
      for (const [k, v] of Object.entries(def.fields ?? {})) fd.append(k, v);
      return new Signal.State(fd);
    }

    case 'Blob':
      return new Signal.State(new Blob(def.parts ?? [], { type: def.type ?? 'text/plain' }));

    case 'ReadableStream':
      return new Signal.State(null);

    default:
      console.warn(`JSONsx: unknown $prototype "${def.$prototype}" for "${key}". Did you mean to add '$src'?`);
      return new Signal.State(null);
  }
}

// ─── External class resolution ────────────────────────────────────────────────

/**
 * Reserved keys stripped from the config object passed to external class constructors.
 */
const EXTERNAL_RESERVED = new Set([
  '$prototype', '$src', '$export', 'signal', 'timing',
  'default', 'description', 'body', 'arguments', 'name',
]);

/**
 * Resolve an external class prototype via $src.
 */
async function resolveExternalPrototype(def, scope, key, base) {
  const src = def.$src;
  const exportName = def.$export ?? def.$prototype;

  let mod;
  if (_moduleCache.has(src)) {
    mod = _moduleCache.get(src);
  } else {
    try {
      mod = await import(src);
    } catch {
      if (base) {
        const resolvedSrc = new URL(src, base).href;
        mod = await import(resolvedSrc);
      } else {
        throw new Error(`JSONsx: failed to import '$src' "${src}" for "${key}"`);
      }
    }
    _moduleCache.set(src, mod);
  }

  const ExportedClass = mod[exportName] ?? mod.default?.[exportName];
  if (!ExportedClass) {
    throw new Error(`JSONsx: export "${exportName}" not found in "${src}"`);
  }
  if (typeof ExportedClass !== 'function') {
    throw new Error(`JSONsx: "${exportName}" from "${src}" is not a class`);
  }

  const config = {};
  for (const [k, v] of Object.entries(def)) {
    if (!EXTERNAL_RESERVED.has(k)) config[k] = v;
  }

  const instance = new ExportedClass(config);

  let value;
  if (typeof instance.resolve === 'function') {
    value = await instance.resolve();
  } else if ('value' in instance) {
    value = instance.value;
  } else {
    value = instance;
  }

  const state = new Signal.State(value);

  if (typeof instance.subscribe === 'function') {
    instance.subscribe((newVal) => state.set(newVal));
  }

  return state;
}

// ─── $ref resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a $ref string to a value in scope or on window/document.
 *
 * @param {string} ref
 * @param {object} scope
 * @returns {*}
 */
export function resolveRef(ref, scope) {
  if (typeof ref !== 'string') return ref;
  if (ref.startsWith('$map/')) {
    const parts = ref.split('/');
    const baseKey = parts[0] + '/' + parts[1];
    const base = scope[baseKey];
    return parts.length > 2 ? getPath(base, parts.slice(2).join('/')) : base;
  }
  if (ref.startsWith('#/$defs/'))    return scope[ref.slice('#/$defs/'.length)];
  if (ref.startsWith('parent#/'))    return scope[ref.slice('parent#/'.length)];
  if (ref.startsWith('window#/'))    return getPath(globalThis.window,   ref.slice('window#/'.length));
  if (ref.startsWith('document#/')) return getPath(globalThis.document, ref.slice('document#/'.length));
  return scope[ref] ?? null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** @param {*} v @returns {boolean} */
export function isSignal(v) {
  return v instanceof Signal.State || v instanceof Signal.Computed;
}

function isRefObj(v) {
  return v !== null && typeof v === 'object' && typeof v.$ref === 'string';
}

function isNestedSelector(k) {
  return k.startsWith(':') || k.startsWith('.') || k.startsWith('&') || k.startsWith('[');
}

function getPath(obj, path) {
  return path.split(/[./]/).reduce((o, k) => o?.[k], obj);
}

function mergeProps(def, parentScope) {
  const scope = { ...parentScope };
  for (const [k, v] of Object.entries(def.$props ?? {})) {
    scope[k] = isRefObj(v) ? resolveRef(v.$ref, parentScope) : new Signal.State(v);
  }
  return scope;
}

function interpolateRef(val, scope) {
  if (isRefObj(val)) { const r = resolveRef(val.$ref, scope); return isSignal(r) ? r.get() : r; }
  if (typeof val !== 'string') return val;
  return val.replace(/\$\{([^}]+)\}/g, (_, e) => { const r = resolveRef(e.trim(), scope); return isSignal(r) ? r.get() : (r ?? ''); });
}

/**
 * Convert camelCase to kebab-case.
 * @param {string} s
 * @returns {string}
 */
export function camelToKebab(s) {
  return s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

/**
 * Convert a style rules object to a CSS text string (skipping nested selectors).
 * @param {object} rules
 * @returns {string}
 */
export function toCSSText(rules) {
  return Object.entries(rules)
    .filter(([k]) => !isNestedSelector(k))
    .map(([p, v]) => `${camelToKebab(p)}: ${v}`)
    .join('; ');
}

export { Signal };

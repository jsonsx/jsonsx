/**
 * jsonsx-compiler.js — Static HTML emitter + hydration island detector
 * @version 0.1.0
 * @license MIT
 *
 * Usage (Node.js build step):
 *   node jsonsx-compiler.js <source.json> [output.html]
 *   node jsonsx-compiler.js todo-app.json > dist/todo-app.html
 *
 * Output tiers (§16.2 of spec):
 *   Fully static subtree           → plain HTML, zero JS
 *   Signals only (no handlers)     → HTML + inline signal init script
 *   Signals + handlers             → HTML + <script type="module"> for $handlers
 *   Server-timed Request           → HTML with baked response data
 *   Dynamic subtree                → <script type="application/jsonsx+json"> island
 *
 * The compiler has zero novel static-analysis logic for JS — it reads only JSON.
 * The JSON IS the bundle manifest (§16.5).
 */

import $RefParser from '@apidevtools/json-schema-ref-parser';
import { camelToKebab, toCSSText, RESERVED_KEYS } from '../runtime/runtime.js';

// ─── Entry ────────────────────────────────────────────────────────────────────

/**
 * Compile a JSONsx document to an HTML string.
 *
 * @param {string | object} sourcePath - Path to .json file, URL, or raw object
 * @param {object}          [opts]
 * @param {string}          [opts.title='JSONsx App'] - HTML document title
 * @param {string}          [opts.runtimeSrc='./dist/runtime.js'] - Path to JSONsx runtime for islands
 * @returns {Promise<string>} Full HTML document string
 *
 * @example
 * const html = await compile('./todo-app.json', { title: 'Todo App' });
 * fs.writeFileSync('dist/index.html', html);
 */
export async function compile(sourcePath, opts = {}) {
  const { title = 'JSONsx App', runtimeSrc = './dist/runtime.js' } = opts;
  const doc = await $RefParser.dereference(sourcePath);

  const styleBlock    = compileStyles(doc);
  const bodyContent   = compileNode(doc, isDynamic(doc));
  const handlerScript = doc.$handlers
    ? `<script type="module" src="${doc.$handlers}"></script>`
    : '';
  const runtimeScript = hasAnyIsland(doc)
    ? `<script type="module">
  import { JSONsx } from '${runtimeSrc}';
  document.querySelectorAll('[data-jsonsx-island]').forEach(el => {
    const descriptor = el.querySelector('script[type="application/jsonsx+json"]');
    if (descriptor) JSONsx(JSON.parse(descriptor.textContent), el);
  });
</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${styleBlock}
  ${handlerScript}
</head>
<body>
  ${bodyContent}
  ${runtimeScript}
</body>
</html>`;
}

// ─── Static detection (§16.1) ─────────────────────────────────────────────────

/**
 * Determine whether a node (or any of its descendants) requires client-side
 * JavaScript. A node is static if and only if:
 *
 *   - No signal:true $defs entry
 *   - No $compute expression
 *   - No $handler:true declaration
 *   - No $prototype namespace
 *   - No $switch node
 *   - No Array prototype children
 *   - No $ref bindings on element properties
 *
 * @param {object} def - JSONsx element definition
 * @returns {boolean}
 */
export function isDynamic(def) {
  if (!def || typeof def !== 'object') return false;

  if (def.$defs) {
    for (const d of Object.values(def.$defs)) {
      if (d.signal || d.$compute || d.$handler || d.$prototype) return true;
    }
  }

  if (def.$switch)                           return true;
  if (def.children?.$prototype === 'Array') return true;

  if (Array.isArray(def.children)) {
    if (def.children.some(isDynamic))        return true;
  }

  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (val !== null && typeof val === 'object' && typeof val.$ref === 'string') return true;
  }

  return false;
}

/**
 * Returns true if any node in the tree will be emitted as a hydration island.
 *
 * @param {object} def
 * @returns {boolean}
 */
function hasAnyIsland(def) {
  if (!def || typeof def !== 'object') return false;
  if (isDynamic(def)) return true;
  if (Array.isArray(def.children)) return def.children.some(hasAnyIsland);
  return false;
}

// ─── Node compilation ─────────────────────────────────────────────────────────

/**
 * Compile a single JSONsx node to an HTML string.
 * Dynamic nodes become hydration islands; static nodes become plain HTML.
 *
 * @param {object}  def     - Element definition
 * @param {boolean} dynamic - Whether this node is dynamic
 * @returns {string} HTML string
 */
function compileNode(def, dynamic) {
  if (dynamic) {
    const tag = def.tagName ?? 'div';
    return `<${tag} data-jsonsx-island>
  <script type="application/jsonsx+json">${JSON.stringify(def, null, 2)}</script>
</${tag}>`;
  }

  const tag   = def.tagName ?? 'div';
  const attrs = buildAttrs(def);
  const inner = buildInner(def);

  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/**
 * Build an HTML attribute string from a static element definition.
 *
 * @param {object} def
 * @returns {string}
 */
function buildAttrs(def) {
  let out = '';

  if (def.id)         out += ` id="${escapeHtml(def.id)}"`;
  if (def.className)  out += ` class="${escapeHtml(def.className)}"`;
  if (def.hidden)     out += ` hidden`;
  if (def.tabIndex !== undefined) out += ` tabindex="${def.tabIndex}"`;
  if (def.title)      out += ` title="${escapeHtml(def.title)}"`;
  if (def.lang)       out += ` lang="${escapeHtml(def.lang)}"`;
  if (def.dir)        out += ` dir="${escapeHtml(def.dir)}"`;

  // Inline style (static, no nested selectors)
  if (def.style) {
    const inline = Object.entries(def.style)
      .filter(([k]) => !k.startsWith(':') && !k.startsWith('.') &&
                       !k.startsWith('&') && !k.startsWith('['))
      .map(([k, v]) => `${camelToKebab(k)}: ${v}`)
      .join('; ');
    if (inline) out += ` style="${inline}"`;
  }

  // Custom attributes
  if (def.attributes) {
    for (const [k, v] of Object.entries(def.attributes)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out += ` ${k}="${escapeHtml(String(v))}"`;
      }
    }
  }

  return out;
}

/**
 * Build the inner HTML (textContent or children) for a static node.
 *
 * @param {object} def
 * @returns {string}
 */
function buildInner(def) {
  if (typeof def.textContent === 'string') return escapeHtml(def.textContent);
  if (def.innerHTML) return def.innerHTML; // trusted static HTML
  if (Array.isArray(def.children)) {
    return def.children
      .map(c => compileNode(c, isDynamic(c)))
      .join('\n  ');
  }
  return '';
}

// ─── Style extraction (§16.4) ─────────────────────────────────────────────────

/**
 * Walk the entire document tree and collect all static nested CSS rules into a
 * single `<style>` block for the document `<head>`.
 * Static inline styles are emitted as HTML style attributes, not here.
 *
 * @param {object} doc - Root document
 * @returns {string} `<style>` HTML string, or empty string if no rules
 */
function compileStyles(doc) {
  const rules = [];
  collectStyles(doc, rules, '');
  if (rules.length === 0) return '';
  return `<style>\n${rules.join('\n')}\n</style>`;
}

/**
 * Recursively collect nested CSS rules from style definitions.
 *
 * @param {object}   def            - Element definition
 * @param {string[]} rules          - Accumulator for CSS rule strings
 * @param {string}   [parentSel=''] - Inherited CSS selector context
 */
function collectStyles(def, rules, _parentSel = '') {
  if (!def || typeof def !== 'object') return;

  const selector = def.id
    ? `#${def.id}`
    : def.className
      ? `.${def.className.split(' ')[0]}`
      : (def.tagName ?? '*');

  if (def.style) {
    for (const [prop, val] of Object.entries(def.style)) {
      if (prop.startsWith(':') || prop.startsWith('.') ||
          prop.startsWith('&') || prop.startsWith('[')) {
        const resolved = prop.startsWith('&')
          ? prop.replace('&', selector)
          : `${selector}${prop}`;
        rules.push(`${resolved} { ${toCSSText(val)} }`);
      }
    }
  }

  if (Array.isArray(def.children)) {
    def.children.forEach(c => collectStyles(c, rules, selector));
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * HTML-escape a string for safe attribute and text content embedding.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[2]) {
  const [,, src, out] = process.argv;

  compile(src)
    .then(async html => {
      if (out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(out, html, 'utf8');
        console.error(`Written to ${out}`);
      } else {
        process.stdout.write(html);
      }
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

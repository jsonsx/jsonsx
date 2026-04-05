/**
 * jsonsx-schema.js — JSONsx JSON Schema 2020-12 meta-schema generator
 * @version 0.1.0
 * @license MIT
 *
 * Generates a comprehensive JSON Schema 2020-12 document that validates JSONsx
 * source files. All HTML element names, CSS property names, and DOM event
 * handler names are derived at generation time from upstream web standards via:
 *
 *   @webref/elements — HTML element tag names
 *   @webref/css      — CSS property names (camelCase CSSOM)
 *   @webref/idl      — DOM EventHandler attribute names
 *
 * Usage:
 *   import { generateSchema } from './jsonsx-schema.js';
 *   const schema = await generateSchema();
 *   fs.writeFileSync('jsonsx-schema.json', JSON.stringify(schema, null, 2));
 *
 * CLI:
 *   bun run jsonsx-schema.js [output-path]
 *
 * @module jsonsx-schema
 */

import { listAll as listElements } from '@webref/elements';
import css                         from '@webref/css';
import idl                         from '@webref/idl';

// ─── $prototype values (JSONsx-specific, not from web standards) ──────────────

const PROTOTYPES = [
  'Request', 'URLSearchParams', 'FormData',
  'LocalStorage', 'SessionStorage', 'Cookie',
  'IndexedDB', 'Array', 'Set', 'Map',
  'Blob', 'ReadableStream',
];

// ─── Web standards data loader ────────────────────────────────────────────────

/**
 * Fetch and normalise the three webref datasets in parallel.
 *
 * @returns {Promise<{ tagExamples: string[], cssProps: string[], eventHandlers: string[] }>}
 */
async function loadWebData() {
  const [elementsData, cssData, idlData] = await Promise.all([
    listElements(),
    css.listAll(),
    idl.parseAll(),
  ]);

  // ── Tag names ──────────────────────────────────────────────────────────────
  const tagSet = new Set();
  for (const { elements } of Object.values(elementsData)) {
    for (const el of elements) {
      if (!el.obsolete) tagSet.add(el.name);
    }
  }
  const tagExamples = [...tagSet].sort();

  // ── CSS camelCase property names (CSSOM styleDeclaration) ─────────────────
  const cssSet = new Set();
  for (const prop of cssData.properties) {
    for (const decl of (prop.styleDeclaration ?? [])) {
      cssSet.add(decl);
    }
  }
  const cssProps = [...cssSet].sort();

  // ── EventHandler attribute names from IDL ─────────────────────────────────
  const handlerSet = new Set();
  for (const ast of Object.values(idlData)) {
    for (const def of ast) {
      if (def.type !== 'interface' && def.type !== 'interface mixin') continue;
      for (const member of def.members) {
        if (
          member.type === 'attribute' &&
          member.name?.startsWith('on') &&
          typeof member.idlType?.idlType === 'string' &&
          member.idlType.idlType === 'EventHandler'
        ) {
          handlerSet.add(member.name);
        }
      }
    }
  }
  const eventHandlers = [...handlerSet].sort();

  return { tagExamples, cssProps, eventHandlers };
}

// ─── Generator ────────────────────────────────────────────────────────────────

/**
 * Generate the full JSONsx meta-schema as a plain JavaScript object.
 * Derives HTML elements, CSS properties, and event handlers from upstream
 * web standards data at generation time.
 *
 * @returns {Promise<object>} JSON Schema 2020-12 document
 */
export async function generateSchema() {
  const { tagExamples, cssProps, eventHandlers } = await loadWebData();

  return {
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    '$id':     'https://jsonsx.dev/schema/v1',
    'title':   'JSONsx Document',
    'description':
      'Schema for JSONsx component files. ' +
      'A JSONsx document is a JSON object that declaratively describes a reactive ' +
      'web component: its structure (DOM tree), styling, reactive state ($defs), ' +
      'and a reference to its companion JavaScript handler file.',
    'type':     'object',
    'required': ['tagName'],

    // ── Top-level properties ────────────────────────────────────────────────
    'properties': {
      '$schema': {
        'description': 'URI identifying the JSONsx dialect version. Enables schema-aware IDE tooling.',
        'type': 'string',
        'examples': ['https://jsonsx.dev/schema/v1'],
      },
      '$id': {
        'description': 'Component identifier string. Used by tooling and the builder.',
        'type': 'string',
        'examples': ['Counter', 'TodoApp', 'UserCard'],
      },
      '$handlers': {
        'description':
          'Relative path to the companion .js ES module that exports event handlers. ' +
          'IDE CTRL-click navigation works natively.',
        'type': 'string',
        'examples': ['./counter.js', './components/my-widget.js'],
      },
      '$defs': {
        'description':
          'Signal and handler declarations for this component. ' +
          '$-prefixed keys are signals; plain keys are handler declarations.',
        '$ref': '#/$defs/DefsMap',
      },
      'tagName':    { '$ref': '#/$defs/TagName' },
      'children':   { '$ref': '#/$defs/ChildrenValue' },
      'style':      { '$ref': '#/$defs/StyleObject' },
      'attributes': { '$ref': '#/$defs/AttributesObject' },
    },
    'additionalProperties': { '$ref': '#/$defs/ElementPropertyValue' },

    // ── Reusable sub-schemas ────────────────────────────────────────────────
    '$defs': {

      // ── $defs map ──────────────────────────────────────────────────────────
      'DefsMap': {
        'description': 'Map of signal, computed signal, handler, and prototype namespace declarations.',
        'type': 'object',
        'additionalProperties': { '$ref': '#/$defs/DefEntry' },
      },

      'DefEntry': {
        'description': 'A single $defs entry.',
        'oneOf': [
          { '$ref': '#/$defs/StateSignalDef' },
          { '$ref': '#/$defs/ComputedSignalDef' },
          { '$ref': '#/$defs/HandlerDef' },
          { '$ref': '#/$defs/PrototypeDef' },
        ],
      },

      'StateSignalDef': {
        'description': 'A reactive state signal. Wraps the default value in a Signal.State at runtime.',
        'type': 'object',
        'required': ['signal'],
        'properties': {
          'signal':      { 'type': 'boolean', 'const': true },
          'type':        { '$ref': '#/$defs/JsonSchemaType' },
          'default':     { 'description': 'Initial signal value.' },
          'description': { 'type': 'string' },
        },
        'additionalProperties': false,
      },

      'ComputedSignalDef': {
        'description':
          'A read-only computed signal. Evaluated as a JSONata expression whenever any $dep changes.',
        'type': 'object',
        'required': ['$compute', 'signal'],
        'properties': {
          '$compute': {
            'description': 'JSONata expression. Dep signal values are available by their key name.',
            'type': 'string',
            'examples': [
              '$count * 2',
              '$firstName & \' \' & $lastName',
              'count($items[done = false])',
            ],
          },
          '$deps': {
            'description': 'Explicit dependencies. Each entry is an #/$defs/ ref string.',
            'type': 'array',
            'items': { '$ref': '#/$defs/InternalRef' },
          },
          'signal':      { 'type': 'boolean', 'const': true },
          'type':        { '$ref': '#/$defs/JsonSchemaType' },
          'description': { 'type': 'string' },
        },
        'additionalProperties': false,
      },

      'HandlerDef': {
        'description': 'Declares that this key must be exported from the $handlers module.',
        'type': 'object',
        'required': ['$handler'],
        'properties': {
          '$handler':    { 'type': 'boolean', 'const': true },
          'description': { 'type': 'string' },
        },
        'additionalProperties': false,
      },

      'PrototypeDef': {
        'description': 'A Web API namespace signal.',
        'type': 'object',
        'required': ['$prototype'],
        'properties': {
          '$prototype': {
            'description': 'Web API constructor name identifying the namespace handler.',
            'type': 'string',
            'enum': PROTOTYPES,
          },
          'signal':       { 'type': 'boolean' },
          'timing':       { 'type': 'string', 'enum': ['server', 'client'] },
          'manual':       { 'type': 'boolean' },
          'debounce':     { 'type': 'integer', 'minimum': 0 },
          'url':          { '$ref': '#/$defs/StringOrRef' },
          'method':       { 'type': 'string', 'enum': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
          'headers':      { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
          'body':         {},
          'responseType': { 'type': 'string', 'enum': ['json', 'text', 'blob', 'arraybuffer', 'document', ''] },
          'key':          { 'type': 'string' },
          'name':         { 'type': 'string' },
          'maxAge':       { 'type': 'integer' },
          'expires':      { 'type': 'string' },
          'path':         { 'type': 'string' },
          'domain':       { 'type': 'string' },
          'secure':       { 'type': 'boolean' },
          'sameSite':     { 'type': 'string', 'enum': ['strict', 'lax', 'none'] },
          'database':     { 'type': 'string' },
          'store':        { 'type': 'string' },
          'version':      { 'type': 'integer', 'minimum': 1 },
          'keyPath':      { 'type': 'string' },
          'autoIncrement': { 'type': 'boolean' },
          'indexes': {
            'type': 'array',
            'items': {
              'type': 'object',
              'required': ['name', 'keyPath'],
              'properties': {
                'name':    { 'type': 'string' },
                'keyPath': { 'oneOf': [{ 'type': 'string' }, { 'type': 'array', 'items': { 'type': 'string' } }] },
                'unique':  { 'type': 'boolean' },
              },
            },
          },
          'default':     {},
          'description': { 'type': 'string' },
          'items':       {},
          'map':         { '$ref': '#/$defs/ElementDef' },
          'filter':      { '$ref': '#/$defs/RefObject' },
          'sort':        { '$ref': '#/$defs/RefObject' },
        },
      },

      // ── Element definition ────────────────────────────────────────────────
      'ElementDef': {
        'description': 'A JSONsx element definition. Maps directly to a DOM element.',
        'type': 'object',
        'required': ['tagName'],
        'properties': {
          'tagName':     { '$ref': '#/$defs/TagName' },
          'id':          { 'type': 'string' },
          'className':   { '$ref': '#/$defs/StringOrRef' },
          'textContent': { '$ref': '#/$defs/StringOrRef' },
          'innerHTML':   { '$ref': '#/$defs/StringOrRef' },
          'innerText':   { '$ref': '#/$defs/StringOrRef' },
          'hidden':      { '$ref': '#/$defs/BoolOrRef' },
          'tabIndex':    { '$ref': '#/$defs/NumberOrRef' },
          'title':       { '$ref': '#/$defs/StringOrRef' },
          'lang':        { '$ref': '#/$defs/StringOrRef' },
          'dir':         { 'type': 'string', 'enum': ['ltr', 'rtl', 'auto'] },
          'value':       { '$ref': '#/$defs/StringOrRef' },
          'checked':     { '$ref': '#/$defs/BoolOrRef' },
          'disabled':    { '$ref': '#/$defs/BoolOrRef' },
          'selected':    { '$ref': '#/$defs/BoolOrRef' },
          'src':         { '$ref': '#/$defs/StringOrRef' },
          'href':        { '$ref': '#/$defs/StringOrRef' },
          'alt':         { '$ref': '#/$defs/StringOrRef' },
          'type':        { '$ref': '#/$defs/StringOrRef' },
          'name':        { '$ref': '#/$defs/StringOrRef' },
          'placeholder': { '$ref': '#/$defs/StringOrRef' },
          'children':    { '$ref': '#/$defs/ChildrenValue' },
          'style':       { '$ref': '#/$defs/StyleObject' },
          'attributes':  { '$ref': '#/$defs/AttributesObject' },
          '$switch':     { '$ref': '#/$defs/SwitchDef' },
          '$ref':        { '$ref': '#/$defs/ExternalRef' },
          '$props':      { '$ref': '#/$defs/PropsObject' },
          '$map/item':   { '$ref': '#/$defs/RefObject' },
          '$map/index':  { '$ref': '#/$defs/RefObject' },
          // Event handlers (derived from @webref/idl at generation time)
          ...buildEventHandlerProperties(eventHandlers),
        },
        'additionalProperties': { '$ref': '#/$defs/ElementPropertyValue' },
      },

      // ── Children ─────────────────────────────────────────────────────────
      'ChildrenValue': {
        'description': 'Static array of child definitions, or an Array namespace for dynamic lists.',
        'oneOf': [
          { 'type': 'array', 'items': { '$ref': '#/$defs/ElementDef' } },
          { '$ref': '#/$defs/ArrayNamespace' },
        ],
      },

      'ArrayNamespace': {
        'description': 'Dynamic mapped list. Re-renders when the items signal changes.',
        'type': 'object',
        'required': ['$prototype', 'items', 'map'],
        'properties': {
          '$prototype': { 'type': 'string', 'const': 'Array' },
          'items': {
            'oneOf': [
              { '$ref': '#/$defs/RefObject' },
              { 'type': 'array' },
            ],
          },
          'map':    { '$ref': '#/$defs/ElementDef' },
          'filter': { '$ref': '#/$defs/RefObject' },
          'sort':   { '$ref': '#/$defs/RefObject' },
        },
        'additionalProperties': false,
      },

      // ── $switch ───────────────────────────────────────────────────────────
      'SwitchDef': {
        'description': 'Signal-driven $ref that drives which case to render.',
        'type': 'object',
        'required': ['$ref'],
        'properties': { '$ref': { '$ref': '#/$defs/InternalRef' } },
        'additionalProperties': false,
      },

      'SwitchNode': {
        'type': 'object',
        'required': ['$switch', 'cases'],
        'properties': {
          'tagName': { '$ref': '#/$defs/TagName' },
          '$switch': { '$ref': '#/$defs/SwitchDef' },
          'cases': {
            'type': 'object',
            'additionalProperties': {
              'oneOf': [
                { '$ref': '#/$defs/ElementDef' },
                { '$ref': '#/$defs/ExternalComponentRef' },
              ],
            },
          },
        },
      },

      // ── Style (CSS properties derived from @webref/css) ───────────────────
      'StyleObject': {
        'description':
          'CSS style definition. camelCase property names follow CSSOM convention. ' +
          'Keys starting with :, ., &, or [ are treated as nested CSS selectors.',
        'type': 'object',
        // Known camelCase CSS properties give IDE autocompletion
        'properties': buildCssProperties(cssProps),
        // Nested selectors and custom / unknown properties are still allowed
        'additionalProperties': {
          'oneOf': [
            { 'type': 'string' },
            { 'type': 'number' },
            {
              'description': 'Nested CSS selector rules.',
              'type': 'object',
              'additionalProperties': { 'oneOf': [{ 'type': 'string' }, { 'type': 'number' }] },
            },
          ],
        },
      },

      'AttributesObject': {
        'description': 'HTML attributes and ARIA attributes set via element.setAttribute().',
        'type': 'object',
        'additionalProperties': {
          'oneOf': [
            { 'type': 'string' },
            { 'type': 'number' },
            { 'type': 'boolean' },
            { '$ref': '#/$defs/RefObject' },
          ],
        },
      },

      'PropsObject': {
        'description': 'Explicit prop passing at a component boundary.',
        'type': 'object',
        'additionalProperties': {
          'oneOf': [
            { 'type': 'string' },
            { 'type': 'number' },
            { 'type': 'boolean' },
            { 'type': 'array' },
            { 'type': 'object' },
            { '$ref': '#/$defs/RefObject' },
          ],
        },
      },

      // ── $ref types ────────────────────────────────────────────────────────
      'RefObject': {
        'description': 'A $ref binding. Resolves to a signal (reactive) or plain value (static).',
        'type': 'object',
        'required': ['$ref'],
        'properties': { '$ref': { '$ref': '#/$defs/AnyRef' } },
        'additionalProperties': false,
      },

      'AnyRef': {
        'type': 'string',
        'oneOf': [
          { '$ref': '#/$defs/InternalRef' },
          { '$ref': '#/$defs/ExternalRef' },
          { '$ref': '#/$defs/GlobalRef' },
          { '$ref': '#/$defs/MapRef' },
        ],
      },

      'InternalRef': {
        'description': 'Reference to a $defs entry in the current component.',
        'type': 'string',
        'pattern': '^#/\\$defs/',
        'examples': ['#/$defs/$count', '#/$defs/increment'],
      },

      'ExternalRef': {
        'description': 'Reference to an external JSONsx component file.',
        'type': 'string',
        'pattern': '^(\\./|\\.\\./).*\\.json$|^https?://',
        'examples': ['./card.json', 'https://cdn.example.com/button.json'],
      },

      'ExternalComponentRef': {
        'type': 'object',
        'required': ['$ref'],
        'properties': {
          '$ref':   { '$ref': '#/$defs/ExternalRef' },
          '$props': { '$ref': '#/$defs/PropsObject' },
        },
      },

      'GlobalRef': {
        'description': 'Reference to a window or document global.',
        'type': 'string',
        'pattern': '^(window|document)#/',
        'examples': ['window#/currentUser', 'document#/appConfig'],
      },

      'MapRef': {
        'description': 'Reference to the current Array map iteration context.',
        'type': 'string',
        'pattern': '^\\$map/(item|index)(/.*)?$',
        'examples': ['$map/item', '$map/index', '$map/item/text', '$map/item/done'],
      },

      // ── Property value types ──────────────────────────────────────────────
      'ElementPropertyValue': {
        'oneOf': [
          { 'type': 'string' },
          { 'type': 'number' },
          { 'type': 'boolean' },
          { 'type': 'null' },
          { '$ref': '#/$defs/RefObject' },
        ],
      },

      'StringOrRef': {
        'oneOf': [{ 'type': 'string' }, { '$ref': '#/$defs/RefObject' }],
      },

      'BoolOrRef': {
        'oneOf': [{ 'type': 'boolean' }, { '$ref': '#/$defs/RefObject' }],
      },

      'NumberOrRef': {
        'oneOf': [{ 'type': 'number' }, { '$ref': '#/$defs/RefObject' }],
      },

      // ── Primitives ────────────────────────────────────────────────────────
      'TagName': {
        'description':
          'HTML element tag name or custom element name (must contain a hyphen per Web Components spec).',
        'type': 'string',
        'minLength': 1,
        // Examples derived from @webref/elements at generation time
        'examples': [...tagExamples, 'my-counter', 'todo-app', 'user-card'],
      },

      'JsonSchemaType': {
        'type': 'string',
        'enum': ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'],
      },
    },
  };
}

// ─── Schema building helpers ──────────────────────────────────────────────────

/**
 * Build the event handler `properties` fragment for ElementDef.
 * Each key maps to a RefObject pointing at a declared handler function.
 * Derived from @webref/idl EventHandler attributes at generation time.
 *
 * @param {string[]} eventHandlers
 * @returns {object}
 */
function buildEventHandlerProperties(eventHandlers) {
  const properties = {};
  for (const name of eventHandlers) {
    properties[name] = {
      'description': `Event handler for the "${name.slice(2)}" event.`,
      '$ref': '#/$defs/RefObject',
    };
  }
  return properties;
}

/**
 * Build the explicit CSS `properties` fragment for StyleObject.
 * Each key is a camelCase CSSOM property name; the value schema accepts
 * strings and numbers (CSS values are always coerced to strings at runtime).
 * Derived from @webref/css styleDeclaration names at generation time.
 *
 * @param {string[]} cssProps
 * @returns {object}
 */
function buildCssProperties(cssProps) {
  const properties = {};
  for (const name of cssProps) {
    properties[name] = { 'oneOf': [{ 'type': 'string' }, { 'type': 'number' }] };
  }
  return properties;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the meta-schema as a formatted JSON string.
 *
 * @returns {Promise<string>}
 */
export async function generateSchemaString() {
  return JSON.stringify(await generateSchema(), null, 2);
}

/**
 * Validate a JSONsx document against the generated schema using Ajv.
 *
 * @param {object} doc
 * @returns {Promise<{ valid: boolean, errors: object[] | null }>}
 */
export async function validateDocument(doc) {
  let Ajv, addFormats;
  try {
    ({ default: Ajv }        = await import('ajv'));
    ({ default: addFormats } = await import('ajv-formats'));
  } catch {
    throw new Error('Schema validation requires ajv and ajv-formats: bun add ajv ajv-formats');
  }

  const ajv      = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const schema   = await generateSchema();
  const validate = ajv.compile(schema);
  const valid    = validate(doc);

  return { valid, errors: validate.errors ?? null };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('jsonsx-schema.js')) {
  const [,, out] = process.argv;
  const schemaStr = await generateSchemaString();

  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, schemaStr, 'utf8');
    console.error(`JSONsx meta-schema written to ${out}`);
  } else {
    process.stdout.write(schemaStr + '\n');
  }
}

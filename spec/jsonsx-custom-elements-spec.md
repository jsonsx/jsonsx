# JSONsx Custom Element Definitions
## Spec Amendment: Declarative Custom Element Registration and Compilation

**Amendment to:** JSONsx Specification v1.0.0-draft
**Status:** Draft
**Version:** 0.1.0

---

## Table of Contents

1. [Overview](#1-overview)
2. [Motivation](#2-motivation)
3. [Definition Syntax](#3-definition-syntax)
4. [Property-Based Interface](#4-property-based-interface)
5. [Dependency Registration](#5-dependency-registration)
6. [Lifecycle Hooks](#6-lifecycle-hooks)
7. [Observed Attributes](#7-observed-attributes)
8. [Light DOM Rendering](#8-light-dom-rendering)
9. [Slot Support](#9-slot-support)
10. [Scope Isolation](#10-scope-isolation)
11. [Cleanup](#11-cleanup)
12. [Development vs. Production Architecture](#12-development-vs-production-architecture)
13. [Compiler Output](#13-compiler-output)
14. [Runtime Registration](#14-runtime-registration)
15. [Complete Examples](#15-complete-examples)
16. [Standards Alignment](#16-standards-alignment)
17. [Appendix A — Pattern Migration from DDOM](#appendix-a--pattern-migration-from-ddom)

---

## 1. Overview

This amendment specifies first-class custom element support for JSONsx. A JSONsx component whose root `tagName` contains a hyphen is a custom element definition. The compiler emits a `class extends HTMLElement` controller that uses `@vue/reactivity` for state and `lit-html` for light DOM rendering. The runtime provides equivalent behavior via its existing `renderNode()` pipeline.

Custom elements in JSONsx are **property-driven, not attribute-driven**. The primary interface for passing data into a custom element is JavaScript properties — `$defs` entries set directly on the element instance. This allows passing signals, functions, objects, and arrays across component boundaries with full type fidelity, matching the pattern established by DDOM and aligning with the direction of modern Web Component frameworks.

HTML observed attributes are supported as a secondary mechanism for interoperability with HTML authoring and third-party consumers, but they are not the primary communication channel.

---

## 2. Motivation

### 2.1 The Gap

The JSONsx spec (§19.4) states that "tagName values containing a hyphen are registered as autonomous custom elements" and (§13.3) that "signal scope is bounded at the component level." But the spec defines no mechanism for:

- Registering a custom element class with `customElements.define()`
- Mapping `$defs` to reactive instance state
- Rendering a JSONsx template into the element's DOM
- Managing the custom element lifecycle (connected, disconnected, adopted)
- Declaring sub-component dependencies
- Passing properties (including signals and functions) across element boundaries

Without these, custom element support is aspirational rather than functional.

### 2.2 Properties Over Attributes

HTML attributes are string-only. Custom element `attributeChangedCallback` receives strings. This is sufficient for primitive configuration but fundamentally inadequate for:

- Passing reactive signal references (two-way binding by reference)
- Passing callback functions and event handlers
- Passing complex objects and arrays
- Passing other custom element references

In practice, production DDOM applications pass signals, functions, and structured data as JavaScript properties on the element instance. The child element reads these properties directly — no serialization, no parsing, no string conversion. This pattern is natural in JSONsx because `$ref` bindings and `$defs` entries are already JavaScript values, not strings.

JSONsx formalizes this as the **property-first interface model**: custom elements declare their public interface as `$defs` entries, and parent components set those entries as properties on the element instance at render time.

### 2.3 Design Principles

The custom element system follows JSONsx's existing design philosophy:

- **No new keywords** — Uses existing `$defs`, `$ref`, `$prototype`, `children`, `style` vocabulary
- **DOM-first** — Mirrors `customElements.define()` and standard lifecycle callbacks
- **Property-first** — JS properties for data flow; HTML attributes as a secondary channel
- **Compilation target** — Emits standard `class extends HTMLElement` with `@vue/reactivity` + `lit-html`
- **Zero framework lock-in** — The compiled output is framework-free vanilla Web Components

---

## 3. Definition Syntax

### 3.1 A Component File IS an Element Definition

A JSONsx component file whose root `tagName` contains a hyphen is automatically a custom element definition. No additional flags or keywords are required:

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "UserCard",
  "tagName": "user-card",

  "$defs": {
    "username": "Guest",
    "status": "offline",
    "displayName": "${$defs.username} (${$defs.status})"
  },

  "style": {
    "display": "block",
    "padding": "1em",
    "border": "1px solid #ccc",
    "borderRadius": "8px"
  },

  "children": [
    { "tagName": "h3", "textContent": "${$defs.displayName}" },
    { "tagName": "p", "textContent": "Status: ${$defs.status}" }
  ]
}
```

The presence of a hyphenated `tagName` at root level is the sole discriminator. The compiler and runtime treat this file as both:

1. A **component definition** that registers a custom element class
2. A **reusable template** that can be instantiated multiple times with different properties

### 3.2 Non-Hyphenated Root `tagName`

A component file whose root `tagName` does not contain a hyphen (e.g. `"div"`, `"section"`) is a **page-level document**, not a custom element definition. It is rendered directly into the target container and is not registered with `customElements.define()`.

### 3.3 Detection Algorithm

```
Given a JSONsx component file:

1. Read root-level "tagName"
2. If tagName contains a hyphen → custom element definition
   a. Register with customElements.define(tagName, GeneratedClass)
   b. $defs become reactive instance state
   c. children become the element's template
3. If tagName does not contain a hyphen → page document
   a. Render directly into target container
   b. No customElements.define() call
```

---

## 4. Property-Based Interface

### 4.1 `$defs` as the Public Interface

Every `$defs` entry on a custom element definition serves double duty: it is both the element's internal reactive state and its public property interface. Parent components set these properties when using the element:

**Definition** (`button-selector.json`):
```json
{
  "tagName": "button-selector",
  "$defs": {
    "choiceIndex": 0,
    "choiceName": "",
    "options": [],
    "multiSelect": false,
    "selections": {},
    "displayProperty": ""
  },
  "children": [ ... ]
}
```

**Usage:**
```json
{
  "tagName": "button-selector",
  "$props": {
    "options": { "$ref": "#/$defs/availableProducts" },
    "selections": { "$ref": "#/$defs/productGroupSelections" },
    "choiceName": "Select Product",
    "displayProperty": "name"
  }
}
```

### 4.2 Signal Forwarding

When a `$props` value is a `$ref` to a signal, the child receives the same reactive reference — not a copy. Writes to the signal inside the child are visible to the parent and vice versa. This enables two-way binding by reference:

```json
{
  "tagName": "bom-options-selector",
  "$props": {
    "selectedVariants": { "$ref": "#/$defs/variantItems" },
    "selectedOptions": { "$ref": "#/$defs/selectedBOMOptions" }
  }
}
```

The child element's `$defs.selectedOptions` and the parent's `$defs.selectedBOMOptions` point to the same reactive object. Mutations in either scope are tracked by Vue's reactivity system and trigger effects in both.

### 4.3 Static and Dynamic Props

`$props` values follow the same resolution rules as any JSONsx property value:

| Value type | Behavior |
|---|---|
| `{ "$ref": "#/$defs/signal" }` | Signal reference — reactive, two-way |
| `"${$defs.expr}"` | Template string — computed, one-way |
| `"literal"` | Static string — set once |
| `42`, `true`, `null` | Static scalar — set once |
| `{ ... }` | Static object — set once (deep copy) |
| `[ ... ]` | Static array — set once (deep copy) |

### 4.4 Prop Initialization Order

When a custom element is instantiated:

1. `$defs` default values initialize the reactive state
2. `$props` from the parent overwrite matching `$defs` entries
3. Template strings and computed entries re-evaluate with the merged state
4. The template renders with the final state

This means `$defs` entries serve as **default values** that are overridden by the parent's `$props`. Entries not provided in `$props` retain their defaults.

---

## 5. Dependency Registration

### 5.1 The `$elements` Field

Custom elements may declare sub-component dependencies via a top-level `$elements` array. Each entry is a `$ref` to another JSONsx component file:

```json
{
  "tagName": "variant-item-list",
  "$elements": [
    { "$ref": "./components/variant-card.json" }
  ],
  "$defs": { ... },
  "children": [ ... ]
}
```

Sub-components may declare their own `$elements`, forming a dependency tree. The runtime and compiler follow this tree to ensure all required custom elements are registered before any component that uses them is rendered.

### 5.2 Registration Deduplication

Custom elements are registered once globally. If multiple components declare the same dependency, the first registration wins. Subsequent attempts to register the same `tagName` are silently skipped, matching the behavior of `customElements.get()` / `customElements.define()`.

### 5.3 Registration Order

The compiler and runtime process `$elements` in depth-first order: leaf components are registered before their parents. This ensures that when a parent's template references a child custom element, that child is already defined.

```
proposal-builder
├── bom-options-selector
│   └── button-selector
│       └── button-selector-choice
├── variant-item-list
│   └── variant-card
│       └── variant-attribute
└── customer-details
```

Registration order: `button-selector-choice` → `button-selector` → `bom-options-selector` → `variant-attribute` → `variant-card` → `variant-item-list` → `customer-details` → `proposal-builder`

---

## 6. Lifecycle Hooks

### 6.1 Lifecycle Mapping

JSONsx maps custom element lifecycle callbacks to optional `$defs` entries with `$prototype: "Function"`:

| Custom Element Callback | JSONsx `$defs` Entry | Called When |
|---|---|---|
| `connectedCallback` | `onMount` | Element inserted into DOM |
| `disconnectedCallback` | `onUnmount` | Element removed from DOM |
| `adoptedCallback` | `onAdopted` | Element moved to new document |
| `attributeChangedCallback` | (automatic) | Observed attribute changes |

### 6.2 `onMount`

Called after the element's template has been rendered into the light DOM. The function receives `$defs` as its first argument (standard JSONsx convention):

```json
{
  "$defs": {
    "autoSelect": false,
    "onMount": {
      "$prototype": "Function",
      "body": "if ($defs.autoSelect) { $defs.autoSelectSingleChoice($defs) }"
    },
    "autoSelectSingleChoice": {
      "$prototype": "Function",
      "$src": "./button-selector.js",
      "$export": "autoSelectSingleChoice"
    }
  }
}
```

`onMount` is called inside a `queueMicrotask()` to ensure the element is fully connected before logic executes.

### 6.3 `onUnmount`

Called when the element is removed from the DOM. Used for imperative cleanup beyond what the automatic AbortController handles (§11):

```json
{
  "$defs": {
    "onUnmount": {
      "$prototype": "Function",
      "body": "console.log('Component removed')"
    }
  }
}
```

### 6.4 `onAdopted`

Called when the element is moved to a new document (e.g. via `document.adoptNode()`). Rarely used but included for completeness.

### 6.5 Non-Lifecycle Methods

Functions declared in `$defs` that are not lifecycle hooks are available as methods on the component's reactive scope. They can be called from event handlers, other functions, and template expressions:

```json
{
  "$defs": {
    "getOptionValue": {
      "$prototype": "Function",
      "arguments": ["option"],
      "body": "return ($defs.valueProperty && typeof option === 'object') ? option[$defs.valueProperty] : option"
    },
    "hasSelection": {
      "$prototype": "Function",
      "signal": true,
      "body": "const sel = $defs.selections[$defs.choiceName]; return $defs.multiSelect ? (Array.isArray(sel) && sel.length > 0) : (sel != null && sel !== '')"
    }
  }
}
```

Note `hasSelection` uses `signal: true` because it is a derived computation. `getOptionValue` does not — it is a utility function called imperatively.

---

## 7. Observed Attributes

### 7.1 Declaration

An optional top-level `observedAttributes` array declares which HTML attributes the element watches. This is the **secondary** interface — primarily for HTML authoring interop and for consumers who cannot set JS properties directly:

```json
{
  "tagName": "user-card",
  "observedAttributes": ["username", "status"],
  "$defs": {
    "username": "Guest",
    "status": "offline"
  }
}
```

### 7.2 Attribute-to-Property Sync

When an observed attribute changes, the runtime writes the new value to the matching `$defs` signal. Attribute names are kebab-case; `$defs` keys are camelCase. The runtime converts between them:

| HTML attribute | `$defs` key |
|---|---|
| `username` | `username` |
| `display-property` | `displayProperty` |
| `multi-select` | `multiSelect` |

### 7.3 Type Coercion

HTML attributes are always strings. The runtime coerces the attribute string to match the `$defs` entry's current type:

| `$defs` default type | Coercion |
|---|---|
| `string` | No conversion |
| `number` | `Number(value)` |
| `boolean` | `value !== null && value !== "false"` |
| `object` / `array` | `JSON.parse(value)` with fallback to string |

### 7.4 When to Use Attributes vs Properties

| Use case | Mechanism |
|---|---|
| JSONsx parent → JSONsx child | `$props` (JS properties via `$ref`) |
| HTML markup → JSONsx element | Observed attributes |
| Markdown directive → JSONsx element | Observed attributes |
| Third-party JS → JSONsx element | Either; properties preferred |

---

## 8. Light DOM Rendering

### 8.1 Default: Light DOM

JSONsx custom elements render to the **light DOM** by default. The `children` tree is rendered directly into the host element (`this`), not into a shadow root. This matches the compilation target pattern:

```js
connectedCallback() {
  effect(() => {
    render(this.template(), this);
  });
}
```

### 8.2 Rationale

Light DOM rendering:

- Allows global CSS to style element internals (no shadow boundary)
- Enables CSS custom properties, utility classes, and design tokens to cascade naturally
- Avoids the complexity of shadow DOM style encapsulation
- Matches the behavior of the DDOM runtime

### 8.3 Style Scoping

Without shadow DOM, style isolation is achieved through the same mechanism JSONsx already uses for nested CSS selectors (§9.2): a generated `data-jsonsx` attribute creates a scoping context. Nested CSS rules within the element's `style` definition target descendants via this attribute.

### 8.4 Future: Shadow DOM Opt-In

A future amendment may add an optional `shadow` property to opt into shadow DOM rendering:

```json
{
  "tagName": "my-element",
  "shadow": "open",
  ...
}
```

This is **not** part of this amendment. Light DOM is the only rendering mode defined here.

---

## 9. Slot Support

### 9.1 Slot Declaration

Custom elements may declare content insertion points using `<slot>` elements in their template:

```json
{
  "tagName": "card-component",
  "children": [
    {
      "tagName": "header",
      "children": [
        { "tagName": "slot", "attributes": { "name": "header" } }
      ]
    },
    {
      "tagName": "main",
      "children": [
        { "tagName": "slot" }
      ]
    }
  ]
}
```

### 9.2 Slot Usage

Content is directed to named slots via the `slot` attribute:

```json
{
  "tagName": "card-component",
  "children": [
    { "tagName": "h2", "attributes": { "slot": "header" }, "textContent": "Title" },
    { "tagName": "p", "textContent": "Default slot content" }
  ]
}
```

### 9.3 Fallback Content

Slot elements may contain fallback children that are displayed when no content is provided for that slot:

```json
{
  "tagName": "slot",
  "attributes": { "name": "icon" },
  "children": [
    { "tagName": "span", "textContent": "..." }
  ]
}
```

### 9.4 Distribution Algorithm

Because JSONsx uses light DOM (not shadow DOM), native slot distribution does not apply. The runtime performs manual slot distribution:

```
On connectedCallback:

1. Capture the host element's child nodes (light DOM children provided by the parent)
2. Clear the host element
3. Render the element's own template into the host
4. For each <slot> element in the rendered template:
   a. If the slot has a "name" attribute:
      - Find light DOM children with a matching slot="name" attribute
      - If found: clear slot fallback content, append matched children
      - If not found: keep fallback content
   b. If the slot has no "name" attribute (default slot):
      - Collect light DOM children without a slot attribute
      - If found: clear slot fallback content, append collected children
      - If not found: keep fallback content
```

### 9.5 Slots and Properties

Slots and `$props` serve complementary roles:

| Mechanism | Passes | Use when |
|---|---|---|
| `$props` | Data (signals, functions, scalars, objects) | Structured data, reactive state, callbacks |
| Slots | DOM subtrees (arbitrary element trees) | Compositional content, layout customization |

A component may use both: `$props` for its data interface and slots for its content interface.

---

## 10. Scope Isolation

### 10.1 Instance Isolation

Each custom element instance maintains its own reactive scope. Two instances of `<button-selector>` have independent `$defs` state — setting `$defs.choiceName` on one does not affect the other.

### 10.2 Scope Boundary

Signals declared in a parent component's `$defs` are **not** automatically available to child custom elements. Data crosses the custom element boundary only via:

1. **`$props`** — explicit property passing (recommended)
2. **Observed attributes** — string-only HTML attributes (interop)
3. **`window` scope** — application-wide globals (use sparingly)

This matches §13.3 and §15.3 of the base spec.

### 10.3 Signal Forwarding Semantics

When a `$ref` in `$props` points to a signal, the child receives the signal reference, not a snapshot. This is intentional: it enables two-way data flow without event dispatching:

```json
{
  "tagName": "parent-component",
  "$defs": {
    "selections": {}
  },
  "children": [{
    "tagName": "child-component",
    "$props": {
      "selections": { "$ref": "#/$defs/selections" }
    }
  }]
}
```

The child's `$defs.selections` and the parent's `$defs.selections` are the **same reactive object**. Writes from either side trigger effects in both scopes. This is the property-first equivalent of two-way binding and is the dominant pattern in production DDOM applications.

---

## 11. Cleanup

### 11.1 Effect Disposal

Each custom element instance tracks its top-level `effect()`. When `disconnectedCallback` fires, the effect's `ReactiveEffectRunner` is called to stop it. This halts all reactive updates and prevents the template from re-rendering into a detached element.

### 11.2 Re-Connection

If a disconnected element is re-inserted into the DOM, `connectedCallback` fires again. A new `effect()` is created and the template re-renders. `$defs` state is **preserved** across disconnect/reconnect cycles — only the render effect is re-established.

---

## 12. Development vs. Production Architecture

### 12.1 Two Rendering Paths

JSONsx has two distinct rendering paths — one for development, one for production. They consume the same `.json` source files but produce different outputs:

| | Development | Production |
|---|---|---|
| **Renderer** | `@jsonsx/runtime` | `lit-html` |
| **State** | `@vue/reactivity` | `@vue/reactivity` |
| **Source format** | JSON interpreted at runtime | JSON compiled away |
| **Ships to browser** | `.json` + runtime + vue | `.js` classes + lit-html + vue |
| **JSONsx code in bundle** | Yes | **No** |

The runtime (`@jsonsx/runtime`) is a **development tool**. It interprets JSONsx JSON files live in the browser for fast iteration, hot reloading, and dev server integration. It is never shipped to production.

The compiler (`@jsonsx/compiler`) **erases JSONsx entirely**. It transforms `.json` component files into standalone JavaScript modules that a developer could have written by hand. The compiled output depends only on `@vue/reactivity` (~7 kB gzip) and `lit-html` (~3 kB gzip) — no JSONsx runtime, no JSON files, no interpretation layer.

### 12.2 Why lit-html

The compiler needs to emit a template rendering strategy. Three options were considered:

**Option A: Direct DOM (`document.createElement` + per-binding `effect()`)** — This is what the JSONsx runtime uses. It produces fine-grained reactivity (one effect per binding) but generates verbose, hard-to-read compiled output. More critically, it cannot express property-first child element binding: there is no declarative way to set JS properties on a child custom element in imperative DOM code without createElement/set/append boilerplate.

**Option B: lit-html (`html` tagged template + `render()` inside `effect()`)** — Produces clean, readable output that looks like hand-written code. lit-html's `.property` binding syntax (`.items="${this.state.items}"`) is the natural expression of JSONsx's property-first interface — it sets JavaScript properties on child custom elements by reference, enabling signal forwarding. lit-html's `@event` syntax maps directly from JSONsx's `on*` handlers. At 3.2 kB gzip with zero dependencies, it is the lightest full template-to-DOM library available.

**Option C: No template library (raw template literals + innerHTML)** — Loses reactivity entirely. Not viable.

lit-html wins because:

1. **`.property` binding** — The only natural way to express `$props` signal forwarding in compiled output. `<child-el .selections="${this.state.selections}">` passes the reactive object by reference.
2. **`@event` binding** — Direct mapping from JSONsx's `"onclick": { "$ref": "..." }` pattern.
3. **`?attribute` binding** — Boolean attribute toggling: `?hidden="${this.state.loading}"`.
4. **Surgical DOM updates** — lit-html marks static vs. dynamic parts at parse time, only updating `${}` expressions on re-render. Inside a Vue `effect()`, this means only the expressions that read changed signals trigger DOM writes.
5. **Readable output** — The compiled code looks like something a developer would write by hand.
6. **Tiny** — 3.2 kB gzip, zero dependencies, tree-shakeable.

### 12.3 Production Dependency Stack

The compiled output of a full JSONsx application has exactly two production dependencies:

| Package | Size (gzip) | Purpose |
|---|---|---|
| `@vue/reactivity` | ~7 kB | `reactive()`, `computed()`, `effect()` |
| `lit-html` | ~3 kB | `html`, `render()` |
| **Total** | **~10 kB** | |

No framework. No virtual DOM. No JSONsx runtime. No JSON shipped.

---

## 13. Compiler Output

### 13.1 Target Structure

For each custom element definition, the compiler emits a self-contained ES module containing:

1. Imports for `@vue/reactivity` and `lit-html`
2. Imports for `$elements` dependencies (sub-component registrations)
3. A `class extends HTMLElement` with reactive state and lit-html template
4. Static CSS extracted to a `<style>` block
5. A `customElements.define()` registration call

### 13.2 Compilation Example

**Input** (`user-card.json`):
```json
{
  "tagName": "user-card",
  "$defs": {
    "username": "Guest",
    "status": "online",
    "displayStatus": "${$defs.status === 'online' ? 'Available' : 'Away'}",
    "setAway": {
      "$prototype": "Function",
      "body": "$defs.status = 'away'"
    }
  },
  "style": {
    "display": "block",
    "padding": "1em"
  },
  "children": [
    { "tagName": "h3", "textContent": "${$defs.username}" },
    {
      "tagName": "p",
      "children": [
        { "tagName": "span", "textContent": "Status: " },
        { "tagName": "strong", "textContent": "${$defs.displayStatus}" }
      ]
    },
    {
      "tagName": "input",
      "attributes": { "type": "text", "placeholder": "Change name..." },
      "oninput": {
        "$prototype": "Function",
        "arguments": ["event"],
        "body": "$defs.username = event.target.value"
      }
    },
    {
      "tagName": "button",
      "textContent": "Set Away",
      "onclick": { "$ref": "#/$defs/setAway" }
    }
  ]
}
```

**Output** (`user-card.js`):
```js
// Generated by @jsonsx/compiler — do not edit manually
import { reactive, computed, effect } from '@vue/reactivity';
import { render, html } from 'lit-html';

class UserCard extends HTMLElement {
  #dispose = null;

  constructor() {
    super();
    this.state = reactive({
      username: 'Guest',
      status: 'online',
    });

    this.state.displayStatus = computed(
      () => this.state.status === 'online' ? 'Available' : 'Away'
    );

    this.state.setAway = ($defs) => { $defs.status = 'away' };
  }

  template() {
    const s = this.state;
    return html`
      <h3>${s.username}</h3>
      <p>Status: <strong>${s.displayStatus}</strong></p>
      <input
        type="text"
        .value="${s.username}"
        @input="${(e) => { s.username = e.target.value }}"
        placeholder="Change name..."
      >
      <button @click="${() => s.setAway(s)}">Set Away</button>
    `;
  }

  connectedCallback() {
    // Merge $props set as JS properties by parent before connection
    for (const key of Object.keys(this.state)) {
      if (key in this && this[key] !== undefined) {
        this.state[key] = this[key];
      }
    }
    this.#dispose = effect(() => render(this.template(), this));
  }

  disconnectedCallback() {
    if (this.#dispose) { this.#dispose(); this.#dispose = null; }
  }
}

customElements.define('user-card', UserCard);
```

Note: this is 40 lines of clean, hand-readable JavaScript. No JSONsx runtime. No JSON. A developer could maintain this output directly if needed.

### 13.3 lit-html Binding Syntax

The compiler maps JSONsx constructs to lit-html's binding types:

| JSONsx | lit-html | What it does |
|---|---|---|
| `"textContent": "${$defs.name}"` | `${s.name}` (text interpolation) | Reactive text node |
| `"onclick": { "$ref": "#/$defs/fn" }` | `@click="${() => s.fn(s)}"` | Event listener |
| `"$props": { "items": { "$ref": "..." } }` | `.items="${s.items}"` | JS property (by reference) |
| `"hidden": "${$defs.loading}"` | `?hidden="${s.loading}"` | Boolean attribute |
| `"className": "${$defs.cls}"` | `class="${s.cls}"` | Attribute binding |
| `"style": { "color": "${$defs.c}" }` | `style="color: ${s.c}"` | Inline style |
| `"attributes": { "data-x": "..." }` | `data-x="${s.x}"` | HTML attribute |

The `.property` syntax is the key enabler for the property-first interface. When a parent's template contains:

```js
html`<child-element .selections="${s.selections}">`
```

lit-html sets `el.selections = s.selections` as a **JavaScript property assignment** — passing the reactive object by reference. This is how signal forwarding works in compiled output without any JSONsx runtime involved.

### 13.4 Property Bridge

The compiled `connectedCallback` merges properties into reactive state:

```js
connectedCallback() {
  for (const key of Object.keys(this.state)) {
    if (key in this && this[key] !== undefined) {
      this.state[key] = this[key];
    }
  }
  this.#dispose = effect(() => render(this.template(), this));
}
```

This handles two scenarios:

1. **lit-html parent** (compiled output): Parent's `.property` binding sets `el.propName = value` before `connectedCallback`. The bridge merges it into `this.state`.
2. **Imperative JS**: External code can do `el.selections = myReactiveObj` before appending to DOM.

### 13.5 Nested CSS Compilation

Nested CSS selectors compile to a `<style>` block using the custom element tag name as the natural scoping selector:

```json
{
  "style": {
    "display": "block",
    ":hover": { "backgroundColor": "#f0f0f0" },
    ".child": { "color": "red" }
  }
}
```

Emits (once per element type, not per instance):
```css
user-card { display: block; }
user-card:hover { background-color: #f0f0f0; }
user-card .child { color: red; }
```

Inline styles (non-nested) are emitted directly in the lit-html template.

### 13.6 `$elements` Compilation

The compiler resolves `$elements` references, compiles each sub-component to its own module, and emits import statements in the parent. Imports execute the sub-component's `customElements.define()` call as a side effect, guaranteeing registration order:

```js
// Generated by @jsonsx/compiler — do not edit manually
import './variant-card.js';       // registers <variant-card>
import './variant-attribute.js';  // registers <variant-attribute>
import { reactive, computed, effect } from '@vue/reactivity';
import { render, html } from 'lit-html';

class VariantItemList extends HTMLElement { ... }
customElements.define('variant-item-list', VariantItemList);
```

### 13.7 Mapped Array Compilation

`$prototype: "Array"` children in the template compile to `.map()` inside the lit-html template. Child custom elements use `.property` bindings for `$props`:

```json
{
  "children": {
    "$prototype": "Array",
    "items": { "$ref": "#/$defs/options" },
    "map": {
      "tagName": "button-selector-choice",
      "$props": {
        "option": { "$ref": "$map/item" },
        "choiceIndex": { "$ref": "#/$defs/choiceIndex" },
        "selections": { "$ref": "#/$defs/selections" }
      }
    }
  }
}
```

Compiles to:
```js
template() {
  const s = this.state;
  return html`
    ${s.options.map((item, index) => html`
      <button-selector-choice
        .option="${item}"
        .choiceIndex="${s.choiceIndex}"
        .selections="${s.selections}"
      ></button-selector-choice>
    `)}
  `;
}
```

Note how `.selections="${s.selections}"` passes the parent's reactive object by reference — the child receives the same object and can write to it. This is two-way binding with zero framework magic.

### 13.8 `$switch` Compilation

`$switch` nodes compile to conditional expressions in the template:

```json
{
  "$switch": { "$ref": "#/$defs/currentRoute" },
  "cases": {
    "home":    { "tagName": "div", "textContent": "Home page" },
    "about":   { "tagName": "div", "textContent": "About page" },
    "profile": { "tagName": "div", "textContent": "Profile page" }
  }
}
```

Compiles to:
```js
${s.currentRoute === 'home' ? html`<div>Home page</div>` : ''}
${s.currentRoute === 'about' ? html`<div>About page</div>` : ''}
${s.currentRoute === 'profile' ? html`<div>Profile page</div>` : ''}
```

### 13.9 `$defs` Array Prototypes

`$defs` entries using `$prototype: "Array"` (as data transforms, not as `children`) compile to computed signals:

```json
{
  "$defs": {
    "variantCodes": {
      "$prototype": "Array",
      "items": { "$ref": "#/$defs/selectedVariants" },
      "map": "${$map.item?.name}"
    }
  }
}
```

Compiles to:
```js
this.state.variantCodes = computed(() => {
  const items = this.state.selectedVariants;
  if (!Array.isArray(items)) return [];
  return items.map(item => item?.name);
});
```

### 13.10 External `$src` Functions

`$prototype: "Function"` entries with `$src` compile to static imports at the top of the module:

```json
{
  "$defs": {
    "autoSelectSingleChoice": {
      "$prototype": "Function",
      "$src": "./button-selector.js",
      "$export": "autoSelectSingleChoice"
    }
  }
}
```

Compiles to:
```js
import { autoSelectSingleChoice } from './button-selector.js';

// In constructor:
this.state.autoSelectSingleChoice = autoSelectSingleChoice;
```

### 13.11 Page Document Compilation

A non-custom-element root document (no hyphen in `tagName`) compiles to an immediately-invoked module that renders into `document.body`:

```js
// Generated by @jsonsx/compiler — do not edit manually
import './components/customer-details.js';
import './components/product-selector.js';
import './components/bom-options-selector.js';
import { reactive, computed, effect } from '@vue/reactivity';
import { render, html } from 'lit-html';

const state = reactive({
  salesPartner: '',
  customerName: '',
  variantItems: [],
  selectedBOMOptions: {},
});

const template = () => html`
  <customer-details
    .salesPartner="${state.salesPartner}"
    .customerName="${state.customerName}"
  ></customer-details>
  <product-selector
    .variantItems="${state.variantItems}"
  ></product-selector>
  <bom-options-selector
    .selectedVariants="${state.variantItems}"
    .selectedOptions="${state.selectedBOMOptions}"
  ></bom-options-selector>
`;

effect(() => render(template(), document.body));
```

---

## 14. Runtime Registration

> **Note:** The runtime is a **development tool** (§12). It interprets JSONsx JSON live for fast iteration. Production applications use the compiler output (§13) and do not ship the runtime.

### 14.1 `defineElement(source)`

The runtime exports a `defineElement()` function that registers a custom element from a JSONsx document:

```js
import { defineElement } from '@jsonsx/runtime';

// From URL
await defineElement('./components/user-card.json');

// From raw object
await defineElement({
  tagName: 'user-card',
  $defs: { username: 'Guest', status: 'online' },
  children: [ ... ]
});
```

### 14.2 Runtime Registration Pipeline

```
defineElement(source):

1. Resolve source (fetch JSON if URL, or use raw object)
2. Extract tagName from root
3. Check customElements.get(tagName) — skip if already registered
4. Recursively process $elements (depth-first)
5. Create class extending HTMLElement:
   a. constructor: buildScope($defs) → reactive state
   b. connectedCallback: renderNode(children, state) → light DOM
   c. disconnectedCallback: dispose effects
   d. attributeChangedCallback: sync to state (if observedAttributes)
6. customElements.define(tagName, GeneratedClass)
```

### 14.3 Automatic Registration in `JSONsx()`

When the main `JSONsx()` mount function encounters a document with `$elements`, it registers all dependencies before rendering. When `renderNode()` encounters a hyphenated `tagName`, it checks whether the element is registered and renders it as a custom element instance (with property passing) rather than a generic `document.createElement()`.

### 14.4 Dev Server Integration

In dev mode, `$elements` entries with `$ref` paths are resolved by the dev server's file system. The dev server watches these files for changes and triggers live reload when a component definition changes.

---

## 15. Complete Examples

### 15.1 Reusable Button Selector

A configurable multi-select button group with signal forwarding:

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "ButtonSelector",
  "tagName": "button-selector",

  "$elements": [
    { "$ref": "./button-selector-choice.json" }
  ],

  "$defs": {
    "choiceIndex": 0,
    "choiceName": "",
    "options": [],
    "multiSelect": false,
    "displayProperty": "",
    "selections": {},

    "hasSelection": {
      "$prototype": "Function",
      "signal": true,
      "body": "const sel = $defs.selections[$defs.choiceName]; return $defs.multiSelect ? (Array.isArray(sel) && sel.length > 0) : (sel != null && sel !== '')"
    }
  },

  "style": {
    "display": "block",
    "borderBottom": "1px solid #f0f0f0",
    ":last-child": { "borderBottom": "none" }
  },

  "children": [
    {
      "tagName": "div",
      "style": { "padding": "1em 1.5em 0.5em", "backgroundColor": "#fafafa" },
      "hidden": "${!$defs.choiceName}",
      "children": [
        {
          "tagName": "h3",
          "textContent": "${$defs.choiceName}",
          "style": { "margin": "0 0 0.5em", "fontSize": "1.1em", "fontWeight": "600" }
        }
      ]
    },
    {
      "tagName": "div",
      "style": { "padding": "0.5em 1.5em 1.5em", "display": "flex", "flexWrap": "wrap", "gap": "0.75em" },
      "children": {
        "$prototype": "Array",
        "items": { "$ref": "#/$defs/options" },
        "map": {
          "tagName": "button-selector-choice",
          "$props": {
            "option": { "$ref": "$map/item" },
            "choiceIndex": { "$ref": "#/$defs/choiceIndex" },
            "choiceName": { "$ref": "#/$defs/choiceName" },
            "multiSelect": { "$ref": "#/$defs/multiSelect" },
            "displayProperty": { "$ref": "#/$defs/displayProperty" },
            "selections": { "$ref": "#/$defs/selections" }
          }
        }
      }
    }
  ]
}
```

### 15.2 Nested Component Tree

A component that registers and uses sub-components:

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "VariantItemList",
  "tagName": "variant-item-list",

  "$elements": [
    { "$ref": "./components/variant-card.json" }
  ],

  "$defs": {
    "collapsed": false,
    "variantItems": [],

    "headerContent": {
      "$prototype": "Function",
      "signal": true,
      "body": "const count = $defs.variantItems.length; return count === 0 ? 'No Variants Found' : `${count} Variant${count === 1 ? '' : 's'} Found`"
    },

    "toggleCollapsed": {
      "$prototype": "Function",
      "body": "$defs.collapsed = !$defs.collapsed"
    }
  },

  "style": {
    "position": "fixed",
    "bottom": "20px",
    "right": "20px",
    "width": "400px",
    "maxHeight": "500px",
    "backgroundColor": "white",
    "border": "1px solid #ddd",
    "borderRadius": "8px",
    "boxShadow": "0 4px 12px rgba(0,0,0,0.15)",
    "zIndex": "1000",
    "overflow": "hidden",
    "transition": "all 0.3s ease"
  },

  "attributes": {
    "data-collapsed": "${$defs.collapsed}"
  },

  "children": [
    {
      "tagName": "div",
      "style": {
        "display": "flex",
        "alignItems": "center",
        "justifyContent": "space-between",
        "padding": "12px 16px",
        "borderBottom": "1px solid #e9ecef",
        "backgroundColor": "#f8f9fa",
        "cursor": "pointer"
      },
      "onclick": { "$ref": "#/$defs/toggleCollapsed" },
      "children": [
        {
          "tagName": "h3",
          "style": { "margin": "0", "fontSize": "1em", "fontWeight": "600" },
          "textContent": "${$defs.headerContent}"
        }
      ]
    },
    {
      "tagName": "div",
      "hidden": "${$defs.collapsed}",
      "style": { "maxHeight": "420px", "overflowY": "auto", "padding": "12px" },
      "children": [
        {
          "tagName": "div",
          "style": { "display": "flex", "flexDirection": "column", "gap": "8px" },
          "children": {
            "$prototype": "Array",
            "items": { "$ref": "#/$defs/variantItems" },
            "map": {
              "tagName": "variant-card",
              "$props": {
                "item": { "$ref": "$map/item" }
              }
            }
          }
        }
      ]
    }
  ]
}
```

### 15.3 Top-Level Application Document

A page-level document that registers custom elements and wires up global state:

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "ProposalBuilder",
  "tagName": "div",

  "$elements": [
    { "$ref": "./components/page-header.json" },
    { "$ref": "./components/customer-details.json" },
    { "$ref": "./components/product-selector.json" },
    { "$ref": "./components/bom-options-selector.json" },
    { "$ref": "./components/variant-item-list.json" },
    { "$ref": "./components/quote-combinations.json" }
  ],

  "$defs": {
    "salesPartner": "",
    "customerName": "",
    "jobLocation": null,
    "productGroupSelections": {},
    "selectedProduct": {},
    "variantItems": [],
    "selectedBOMOptions": {},
    "selectedDeliveryTypes": {}
  },

  "children": [
    {
      "tagName": "customer-details",
      "$props": {
        "salesPartner": { "$ref": "#/$defs/salesPartner" },
        "customerName": { "$ref": "#/$defs/customerName" },
        "jobLocation": { "$ref": "#/$defs/jobLocation" }
      }
    },
    {
      "tagName": "product-selector",
      "$props": {
        "selectedProduct": { "$ref": "#/$defs/selectedProduct" },
        "variantItems": { "$ref": "#/$defs/variantItems" }
      }
    },
    {
      "tagName": "bom-options-selector",
      "$props": {
        "selectedVariants": { "$ref": "#/$defs/variantItems" },
        "selectedOptions": { "$ref": "#/$defs/selectedBOMOptions" }
      }
    },
    {
      "tagName": "quote-combinations",
      "$props": {
        "selectedBOMOptions": { "$ref": "#/$defs/selectedBOMOptions" },
        "selectedDeliveryTypes": { "$ref": "#/$defs/selectedDeliveryTypes" },
        "variantItems": { "$ref": "#/$defs/variantItems" }
      }
    }
  ]
}
```

---

## 16. Standards Alignment

### 16.1 Web Components

| Feature | Standard | JSONsx Behavior |
|---|---|---|
| `customElements.define()` | Custom Elements v1 | Used directly |
| `class extends HTMLElement` | Custom Elements v1 | Compilation target |
| `connectedCallback` / `disconnectedCallback` | Custom Elements v1 | Mapped from `onMount` / `onUnmount` |
| `observedAttributes` / `attributeChangedCallback` | Custom Elements v1 | Supported via `observedAttributes` array |
| `<slot>` element | HTML5 | Light DOM slot distribution |
| Autonomous custom elements | Custom Elements v1 | Hyphenated `tagName` |

### 16.2 Lit

| Feature | Lit Equivalent | JSONsx |
|---|---|---|
| `html` tagged template | Template declaration | Compiled from `children` tree |
| `render(template, container)` | DOM update | Called inside `effect()` |
| Reactive properties | `@property()` decorator | `$defs` entries |
| Event bindings | `@click` syntax | `onclick` / `$ref` to handler |

### 16.3 What Is Novel

- **Property-first interface** — `$props` passes JS values (including signals and functions), not just strings. This is common practice in component frameworks but not formalized in the Custom Elements spec.
- **`$elements` dependency tree** — Declarative sub-component registration. No standard equivalent; solves the "registration order" problem declaratively.
- **Signal forwarding** — Two-way reactivity by passing the same `reactive()` object reference across boundaries. This is a Vue reactivity pattern applied to custom elements.

---

## Appendix A — Pattern Migration from DDOM

This appendix maps DDOM production patterns to their JSONsx equivalents, demonstrating that the spec is sufficient for clean migration.

### A.1 Dollar-Prefixed Signals → `$defs` Entries

**DDOM:**
```js
{
  $count: 0,
  $name: 'World',
  $displayText: '${this.$count} items',
}
```

**JSONsx:**
```json
{
  "$defs": {
    "count": 0,
    "name": "World",
    "displayText": "${$defs.count} items"
  }
}
```

### A.2 Property Accessors → `$ref` / `$props`

**DDOM:**
```js
{
  tagName: 'child-component',
  $selections: 'this.$selectedOptions',
  $items: 'window.$variantItems',
}
```

**JSONsx:**
```json
{
  "tagName": "child-component",
  "$props": {
    "selections": { "$ref": "#/$defs/selectedOptions" },
    "items": { "$ref": "window#/variantItems" }
  }
}
```

### A.3 `customElements` Array → `$elements`

**DDOM:**
```js
{
  customElements: [buttonSelector, variantCard, customerDetails],
  children: [ ... ]
}
```

**JSONsx:**
```json
{
  "$elements": [
    { "$ref": "./components/button-selector.json" },
    { "$ref": "./components/variant-card.json" },
    { "$ref": "./components/customer-details.json" }
  ],
  "children": [ ... ]
}
```

### A.4 Inline Sub-Component Definitions → Separate Files

In DDOM, sub-components could be defined inline as JS objects in the same file. In JSONsx, each custom element is its own `.json` file referenced via `$elements`. This enforces file-per-component separation but enables better tooling, visual builder support, and independent compilation.

**DDOM:**
```js
const variantAttribute = {
  tagName: 'variant-attribute',
  $itemAttribute: '',
  $item: {},
  textContent: '${this.$dynamicContent()}'
};

export default {
  tagName: 'variant-card',
  customElements: [variantAttribute],
  ...
}
```

**JSONsx:** `variant-attribute.json` + `variant-card.json` with `"$elements": [{ "$ref": "./variant-attribute.json" }]`

### A.5 Prototype-Based Namespace in `$defs` → Same, With Explicit `$prototype`

**DDOM:**
```js
{
  $variantsList: {
    prototype: 'Array',
    items: 'this.$selectedVariants',
    map: { variant_item_code: 'item.code' }
  }
}
```

**JSONsx:**
```json
{
  "$defs": {
    "variantsList": {
      "$prototype": "Array",
      "items": { "$ref": "#/$defs/selectedVariants" },
      "map": {
        "variant_item_code": { "$ref": "$map/item/code" }
      }
    }
  }
}
```

### A.6 `connectedCallback` → `onMount` in `$defs`

**DDOM:**
```js
{
  connectedCallback: function() {
    if (this.$autoSelect.get()) {
      DDOM.createEffect(() => { this.autoSelectSingleChoice(); });
    }
  }
}
```

**JSONsx:**
```json
{
  "$defs": {
    "onMount": {
      "$prototype": "Function",
      "body": "if ($defs.autoSelect) { /* effect is implicit via signal reads */ }"
    }
  }
}
```

### A.7 `window` Scope Signals → Top-Level `$defs` in Page Document

**DDOM:**
```js
{
  window: {
    $salesPartner: '',
    $variantItems: [],
  }
}
```

**JSONsx:** The top-level page document's `$defs` are the application scope. Child custom elements access them via `$props`, not via `window` globals.

```json
{
  "tagName": "div",
  "$defs": {
    "salesPartner": "",
    "variantItems": []
  },
  "children": [{
    "tagName": "child-component",
    "$props": {
      "variantItems": { "$ref": "#/$defs/variantItems" }
    }
  }]
}
```

---

*JSONsx Custom Element Definitions — Amendment v0.1.0-draft*

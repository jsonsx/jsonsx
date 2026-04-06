# JSONsx Scope Parameter Convention
## Spec Amendment: Full Destructure Pattern, Zero Static Analysis

**Amends:** JSONsx Explicit `$defs` Parameter Amendment v0.1.0  
**Supersedes:** JSONsx Explicit `$defs` Parameter Amendment v0.1.0 in its entirety  
**Also supersedes:** JSONsx Scope Binding Amendment v0.1.0  
**Status:** Draft  
**Version:** 0.2.0

---

## 1. The Single Rule

The compiler collects all `$defs` keys into one flat list. That same full destructure pattern is emitted as the first parameter of **every** compiled function, `Signal.Computed` arrow function, and `effect()` callback — without exception, without variation, without any per-function analysis.

```
GIVEN $defs keys: [$firstName, $lastName, $score, $items, addItem, toggleItem]

EVERY compiled callable receives:
({ $firstName, $lastName, $score, $items, addItem, toggleItem })

No exceptions. No per-function subsets. The same pattern everywhere.
```

The body string or template string is emitted verbatim after the parameter. Every identifier the author could possibly reference is already a named parameter — so bare identifiers just work. Unused destructured bindings are silently ignored by the JavaScript engine.

**The compiler performs zero static analysis of body strings or template strings to determine what to pass.** It does not scan for identifiers. It does not build per-function dependency lists. It collects `$defs` keys once, builds the destructure pattern once, and stamps it uniformly onto everything.

---

## 2. The Destructure Pattern

Given a component with these `$defs`:

```json
{
  "$defs": {
    "$firstName": "Jane",
    "$lastName":  "Smith",
    "$score":     92,
    "$items":     [],

    "$fullName": "${$firstName.get()} ${$lastName.get()}",

    "increment":  { "$prototype": "Function", "body": "$score.set($score.get() + 1)" },
    "addItem":    { "$prototype": "Function", "body": "$items.set([...$items.get(), 'new'])" }
  }
}
```

The compiler collects all keys: `$firstName`, `$lastName`, `$score`, `$items`, `$fullName`, `increment`, `addItem`.

It builds one destructure pattern:

```js
{ $firstName, $lastName, $score, $items, $fullName, increment, addItem }
```

This pattern — and only this pattern — is used as the first parameter of every compiled callable in this component. No substitutions. No subsets.

---

## 3. Emission Examples

Every example below uses the same component `$defs` from §2.

### Template string signal in `$defs`

```json
"$fullName": "${$firstName.get()} ${$lastName.get()}"
```

Compiler emits:

```js
const $fullName = new Signal.Computed(
  ({ $firstName, $lastName, $score, $items, $fullName, increment, addItem }) =>
    `${$firstName.get()} ${$lastName.get()}`
);
```

The arrow function receives all six keys. It uses two. The other four are unused bindings — ignored by the engine, cost nothing at runtime.

### Inline handler

```json
"increment": {
  "$prototype": "Function",
  "body": "$score.set($score.get() + 1)"
}
```

Compiler emits:

```js
function increment({ $firstName, $lastName, $score, $items, $fullName, increment, addItem }) {
  $score.set($score.get() + 1);
}
```

### Inline handler with declared `arguments`

```json
"handleInput": {
  "$prototype": "Function",
  "arguments": ["event"],
  "body": "$score.set(event.target.value)"
}
```

Compiler emits:

```js
function handleInput({ $firstName, $lastName, $score, $items, $fullName, increment, addItem }, event) {
  $score.set(event.target.value);
}
```

The full destructure is always first. Author-declared `arguments` follow.

### Inline computed function

```json
"$titleClass": {
  "$prototype": "Function",
  "body": "return $score.get() >= 90 ? 'gold' : 'silver'",
  "signal": true
}
```

Compiler emits:

```js
const $titleClass = new Signal.Computed(
  ({ $firstName, $lastName, $score, $items, $fullName, $titleClass, increment, addItem }) =>
    (function({ $firstName, $lastName, $score, $items, $fullName, $titleClass, increment, addItem }) {
      return $score.get() >= 90 ? 'gold' : 'silver';
    })(...arguments)
);
```

Or more simply, since the arrow function already has the destructure:

```js
const $titleClass = new Signal.Computed(
  ({ $firstName, $lastName, $score, $items, $fullName, $titleClass, increment, addItem }) => {
    return $score.get() >= 90 ? 'gold' : 'silver';
  }
);
```

### Reactive element property

```json
"textContent": "${$score.get()} points"
```

Compiler emits:

```js
effect(
  ({ $firstName, $lastName, $score, $items, $fullName, increment, addItem }) => {
    el.textContent = `${$score.get()} points`;
  },
  scope
);
```

Or if `effect` receives a plain thunk and the runtime passes scope differently:

```js
effect(() =>
  el.textContent = (({ $firstName, $lastName, $score, $items, $fullName, increment, addItem }) =>
    `${$score.get()} points`
  )(scope)
);
```

The specific `effect` calling convention is an implementation detail. The requirement is that the full destructure pattern is the parameter of the function receiving it, and `scope` is the argument passed.

---

## 4. Runtime Calling Convention

The runtime calls every function with the scope object as the first argument:

```js
fn(scope)           // no additional args
fn(scope, event)    // with event
fn(scope, id, idx)  // with multiple args
```

Because the compiler has already emitted the full destructure as the first parameter, the function receives all `$defs` values immediately. The runtime never inspects what the function actually uses — it blindly passes `scope` first, every time.

The runtime wrapper for sidecar functions follows the same convention:

```js
const module = await import('./handlers.js');
scope.addItem    = (...args) => module.addItem(scope, ...args);
scope.toggleItem = (...args) => module.toggleItem(scope, ...args);
```

`scope` first. Everything else after. Always.

---

## 5. External Sidecar Functions

Sidecar functions declare the scope parameter using any pattern they choose. The most idiomatic form is destructuring, which makes dependencies visible in the signature:

```js
// todo-handlers.js

// Destructure only what you need — idiomatic and self-documenting
export function addItem({ $items }) {
  $items.set([...$items.get(), { id: Date.now(), text: 'New item', done: false }]);
}

// Destructure multiple signals
export function toggleItem({ $items }, id) {
  $items.set($items.get().map(i => i.id === id ? { ...i, done: !i.done } : i));
}

// Name the full scope when you need everything
export function syncAll(scope) {
  scope.$status.set('loading');
  scope.$error.set(null);
  scope.$retryCount.set(0);
}

// Ignore scope entirely if not needed
export function logClick() {
  console.log('clicked');
}
```

The runtime passes the full scope object as the first argument regardless of how the function declares it. A function that destructures only `{ $items }` still receives the full scope — it just ignores the rest. This is standard JavaScript destructuring behavior.

**The spec does not mandate a parameter name or destructure pattern for sidecar functions.** The calling convention (`scope` first) is fixed. The receiving convention is the author's choice.

---

## 6. What Requires Zero Static Analysis

The following operations require **no** static analysis of body strings or template strings:

| Operation | How it works without analysis |
|---|---|
| Making signals available in body strings | Full destructure in parameter — all keys present unconditionally |
| Making signals available in template strings | Full destructure in arrow function parameter — all keys present unconditionally |
| Making signals available in `effect()` callbacks | Full destructure in callback parameter — all keys present unconditionally |
| Calling a sibling function from a handler | Sibling is in the destructure — present unconditionally |
| Ensuring new signals are available everywhere | Adding a key to `$defs` adds it to the destructure — one place, propagates everywhere |

The compiler's only job regarding scope is:

1. Collect all `$defs` keys into a flat array — **once**
2. Emit the full destructure pattern as the first parameter of every compiled callable — **unconditionally**

That is all.

---

## 7. What the Compiler Does Not Do

To be unambiguous:

- ❌ Does not scan body strings for `$identifier` references
- ❌ Does not scan template strings for `$identifier` references  
- ❌ Does not build per-function lists of required signals
- ❌ Does not emit different destructure patterns for different functions
- ❌ Does not use `.bind()` anywhere
- ❌ Does not use `this` anywhere
- ❌ Does not inspect sidecar function parameter lists
- ❌ Does not perform any analysis that requires reading the content of a body or template string for scope purposes

The only analysis the compiler performs on body strings and template strings is **syntax validation** via acorn — confirming the string is valid JavaScript before emitting it. This is unrelated to scope.

---

## 8. Complete Updated Example

### `todo-app.json`

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "TodoApp",

  "$defs": {
    "TodoItem": {
      "type": "object",
      "properties": {
        "id":   { "type": "integer" },
        "text": { "type": "string" },
        "done": { "type": "boolean" }
      },
      "required": ["id", "text", "done"]
    },

    "$items": {
      "type": "array",
      "default": [{ "id": 1, "text": "Learn JSONsx", "done": false }],
      "items": { "$ref": "#/$defs/TodoItem" }
    },

    "$remaining": "${$items.get().filter(i => !i.done).length}",
    "$total":     "${$items.get().length}",
    "$summary":   "${$remaining.get()} of ${$total.get()} remaining",
    "$allDone":   "${$remaining.get() === 0}",

    "addItem": {
      "$prototype": "Function",
      "body": "$items.set([...$items.get(), { id: Date.now(), text: 'New item', done: false }])"
    },
    "toggleItem": {
      "$prototype": "Function",
      "arguments": ["id"],
      "body": "$items.set($items.get().map(i => i.id === id ? { ...i, done: !i.done } : i))"
    },
    "clearDone": {
      "$prototype": "Function",
      "body": "$items.set($items.get().filter(i => !i.done))"
    }
  },

  "tagName": "todo-app",
  "style": { "fontFamily": "system-ui", "maxWidth": "480px", "margin": "2rem auto" },

  "children": [
    {
      "tagName": "h1",
      "textContent": "${$summary.get()}"
    },
    {
      "tagName": "p",
      "textContent": "All done! 🎉",
      "hidden": "${$allDone.get()}"
    },
    {
      "tagName": "div",
      "style": { "display": "flex", "gap": "0.5rem" },
      "children": [
        {
          "tagName": "button",
          "textContent": "Add item",
          "onclick": { "$ref": "#/$defs/addItem" }
        },
        {
          "tagName": "button",
          "textContent": "Clear done",
          "onclick": { "$ref": "#/$defs/clearDone" }
        }
      ]
    },
    {
      "tagName": "ul",
      "children": {
        "$prototype": "Array",
        "items": { "$ref": "#/$defs/$items" },
        "map": {
          "tagName": "li",
          "style": {
            "textDecoration": "${$map.item.done ? 'line-through' : 'none'}",
            "opacity":        "${$map.item.done ? '0.5' : '1'}"
          },
          "textContent": "${$map.item.text}",
          "onclick": { "$ref": "#/$defs/toggleItem" }
        }
      }
    }
  ]
}
```

### What the compiler emits for this component

The `$defs` keys are: `$items`, `$remaining`, `$total`, `$summary`, `$allDone`, `addItem`, `toggleItem`, `clearDone`.

The destructure pattern built once:

```js
{ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }
```

Every compiled callable uses this exact pattern:

```js
// Computed signals
const $remaining = new Signal.Computed(
  ({ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }) =>
    `${$items.get().filter(i => !i.done).length}`
);

const $total = new Signal.Computed(
  ({ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }) =>
    `${$items.get().length}`
);

const $summary = new Signal.Computed(
  ({ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }) =>
    `${$remaining.get()} of ${$total.get()} remaining`
);

const $allDone = new Signal.Computed(
  ({ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }) =>
    `${$remaining.get() === 0}`
);

// Handler functions
function addItem({ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }) {
  $items.set([...$items.get(), { id: Date.now(), text: 'New item', done: false }]);
}

function toggleItem({ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }, id) {
  $items.set($items.get().map(i => i.id === id ? { ...i, done: !i.done } : i));
}

function clearDone({ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }) {
  $items.set($items.get().filter(i => !i.done));
}

// Element property effects
effect(
  ({ $items, $remaining, $total, $summary, $allDone, addItem, toggleItem, clearDone }) => {
    el_h1.textContent = `${$summary.get()}`;
  },
  scope
);
```

The same pattern. Every time. Mechanically stamped. No analysis required.

### External sidecar variant

```js
// todo-handlers.js
// Authors destructure only what they need — the runtime passes everything

export function addItem({ $items }) {
  $items.set([
    ...$items.get(),
    { id: Date.now(), text: 'New item', done: false }
  ]);
}

export function toggleItem({ $items }, id) {
  $items.set(
    $items.get().map(i => i.id === id ? { ...i, done: !i.done } : i)
  );
}

export function clearDone({ $items }) {
  $items.set($items.get().filter(i => !i.done));
}
```

---

## 9. Corrections to Prior Spec Language

This amendment supersedes the JSONsx Scope Binding Amendment v0.1.0 and JSONsx Explicit `$defs` Parameter Amendment v0.1.0 in their entirety.

Corrections to the `$defs` Unified Grammar Amendment v0.2.0:

**§2 Shape 3 and §3:** Replace emitted `Signal.Computed` examples to use full destructure pattern in arrow function parameter. Remove any examples showing per-function or per-template-string identifier extraction.

**§2 Shape 4e:** Replace emitted function declaration examples to show full destructure pattern as first parameter, body string verbatim after.

**§9 (Compilation Model), template string compilation:** Remove "Pass 1 — Dependency extraction" as a compiler step involving string scanning. Dependency tracking for `Signal.Computed` is handled by the TC39 Signals runtime through reactive tracking during evaluation — not by the compiler scanning strings. The compiler's only string-related pass is syntax validation.

**§13 (Codebase Refactoring Targets):** Remove all references to `.bind()`, `this`, and `$defs.` prefix. Update `buildScope()` description to: collect all `$defs` keys into one array; emit full destructure pattern unconditionally as first parameter of all compiled callables.

---

## 10. A Note on Reactive Dependency Tracking

A natural question: if the compiler does not scan template strings for signal references, how does `Signal.Computed` know which signals to track for recomputation?

The answer is that it doesn't need to — and neither does the compiler. The TC39 Signals proposal uses **automatic dependency tracking**: when a `Signal.Computed` evaluates its function, the Signals runtime records every signal whose `.get()` is called during that evaluation. Those become the dependencies. If a signal's value changes, any `Signal.Computed` that read it during its last evaluation is automatically invalidated and scheduled for recomputation.

This is the same mechanism React hooks use for `useMemo` and `useEffect` — dependencies are discovered at runtime during execution, not declared or analyzed statically. The compiler has nothing to do with it. The author writes `$score.get()` in a template string; the Signals runtime sees that `.get()` was called on `$score` and registers the dependency automatically.

This is why the compiler's only job regarding template strings is **syntax validation** — not dependency extraction. The runtime handles reactivity completely.

---

*JSONsx Scope Parameter Convention Amendment v0.2.0-draft*

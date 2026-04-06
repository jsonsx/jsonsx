# JSONsx Vue Reactivity Migration
## Spec Amendment: `@vue/reactivity` Runtime + `$defs` Universal Script Context

**Amends:** All prior JSONsx amendments  
**Supersedes:** JSONsx Scope Parameter Convention Amendment v0.2.0  
**Supersedes:** JSONsx Scope Binding Amendment v0.1.0  
**Supersedes:** JSONsx Explicit `$defs` Parameter Amendment v0.1.0  
**Status:** Draft  
**Version:** 0.1.0

---

## 1. Summary

This amendment makes three interconnected changes:

1. **Drop `signal-polyfill`** — the TC39 Signals polyfill is replaced by `@vue/reactivity` as the JSONsx reactivity runtime
2. **Adopt `@vue/reactivity`** — `ref`, `computed`, `reactive`, and `watchEffect` replace `Signal.State`, `Signal.Computed`, `Signal.subtle.Watcher`, and the custom `effect.js` scheduler
3. **Establish `$defs` as the universal script context** — all inline `body` strings, template expressions, and sidecar functions operate on `$defs`, a `reactive()` proxy of the component scope

These three changes are inseparable. `$defs` as a named scope object is required by proxy-based reactivity (destructuring breaks Vue reactive). `@vue/reactivity` enables the ergonomic authoring model (no `.get()` / `.set()`). Dropping the polyfill removes the only dependency that couldn't be compiled away.

### What changes

| Before | After |
|---|---|
| `signal-polyfill` runtime dep | `@vue/reactivity` runtime dep |
| `Signal.State(v)` | Property on `reactive({})` |
| `Signal.Computed(() => expr)` | `computed(() => expr)` |
| `Signal.subtle.Watcher` + `effect.js` | `watchEffect()` |
| `$defs.$count` (dollar in property name) | `$defs.count` (no dollar prefix on signals) |
| `$count.get()` in expressions | `$defs.count` |
| `$count.set(v)` in handlers | `$defs.count = v` |
| `$items.push(...)` broken (signals) | `$defs.items.push(...)` works (deep proxy) |
| Manual `interpolateRef` for URLs | `watchEffect` auto-tracks URL reads |
| No request cancellation | `onCleanup` + `AbortController` |
| Destructured scope parameter | `$defs` named scope parameter |
| Signal keys with `$` prefix in `$defs` JSON | Signal keys without `$` prefix in `$defs` JSON |

### What does not change

- The `$defs` grammar (five shapes, JSON Schema types, naked values, template strings, Function prototype, external classes)
- All `$ref` binding semantics
- All element, style, slot, and child array syntax
- Component encapsulation and `$props`
- The compiler's responsibilities (validation, wrapping, emission)
- The `$prototype` registry and external class resolution

---

## 2. Why `@vue/reactivity`

### 2.1 Production readiness

The TC39 signal-polyfill is explicitly not production-ready. <br>
`@vue/reactivity` is the battle-tested reactivity core of Vue 3, used in production by millions of applications, published as a standalone framework-agnostic package specifically for this use case.

### 2.2 Automatic dependency tracking with no `.get()`

Vue's `reactive()` proxy intercepts property reads transparently. Inside any `watchEffect` or `computed`, reading `$defs.userId` registers `userId` as a dependency automatically — no `.get()` call required. When `$defs.userId` changes, every effect and computed that read it re-runs.

### 2.3 Deep reactivity

Vue's `reactive()` is deeply reactive by default. Nested mutations work without any special handling:

```js
$defs.user.name = 'Alice'        // tracked
$defs.items.push(newItem)        // tracked
$defs.items.splice(0, 1)         // tracked
$defs.coords.lat = 51.5          // tracked
```

TC39 Signals are shallow — each signal is a separate primitive. Deep reactivity requires wrapping every nested object in its own signal, manually.

### 2.4 `watchEffect` with `onCleanup`

Vue's `watchEffect` provides first-class cleanup before re-execution, enabling automatic request cancellation:

```js
watchEffect((onCleanup) => {
  const url = `...${$defs.userId}...`
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  fetch(url, { signal: controller.signal })
    .then(r => r.json())
    .then(d => { $defs.userData = d })
})
```

This pattern was impossible with the signals polyfill without custom infrastructure.

### 2.5 Clear migration path to native Signals

Vue's reactivity team is a primary contributor to the TC39 Signals proposal. When native Signals land, Vue will adopt them internally. JSONsx can follow the same path — swapping `@vue/reactivity` for native Signals at that point is a bounded, non-breaking change to the runtime internals. The `$defs` authoring model remains unchanged throughout.

### 2.6 Bundle size

`@vue/reactivity` is approximately **20kb min+gzip** — larger than the 9kb polyfill, but production-ready, deeply reactive, and carrying no framework baggage. It ships only the reactivity primitives: `ref`, `reactive`, `computed`, `watchEffect`, `watch`, `readonly`, `toRefs`, `effectScope`, and utilities. No renderer, no compiler, no component model.

---

## 3. The `$defs` Scope Object

### 3.1 What it is

`$defs` is the component scope object — a `reactive()` proxy constructed from all `$defs` signal declarations. It is:

- A plain JavaScript object wrapped by Vue's `reactive()` proxy
- The single authoritative reference to all component state
- The argument passed to every compiled function and sidecar function
- The context in which all template strings are evaluated

### 3.2 Why it must be a named object (not destructured)

Vue's proxy reactivity lives in the proxy object itself. Destructuring extracts primitive values — breaking the reactive connection:

```js
const $defs = reactive({ count: 0 })

// BROKEN — count is now a plain number, not reactive
const { count } = $defs
$defs.count = 1
console.log(count) // still 0

// CORRECT — always access through the proxy
$defs.count = 1
console.log($defs.count) // 1
```

This is Vue's documented limitation for primitives, and it is why `$defs` must be a named proxy object rather than a destructured parameter list. The `$defs.` prefix is not a stylistic choice — it is the mechanism that keeps every read and write inside the reactive proxy.

### 3.3 Why `$defs` is the right name

- It is the same vocabulary as the JSON document's `$defs` key
- `$ref: "#/$defs/count"` in JSON corresponds directly to `$defs.count` in code
- The `$` prefix on the container signals JSONsx-managed scope, consistent throughout the spec
- It is unambiguous — `$defs` in any JSONsx context refers to the component scope
- Signal entries within `$defs` no longer carry a `$` prefix (e.g. `"count": 0` not `"$count": 0`) — the `$defs.` namespace makes per-signal prefixes redundant

### 3.4 Construction

The runtime constructs `$defs` in a single pass:

```js
import { reactive, ref, computed, watchEffect } from '@vue/reactivity'

function buildScope(defs, resolvedRefs) {
  // 1. Start with a plain object of all naked/expanded state values
  const raw = {}
  for (const [key, entry] of Object.entries(defs)) {
    if (isNakedValue(entry)) raw[key] = entry
    else if (hasDefault(entry)) raw[key] = entry.default
    else if (isTypeDefinition(entry)) continue // tooling only
    // Functions and external classes handled after reactive() wraps raw
  }

  // 2. Wrap in Vue reactive proxy — deep reactivity from this point on
  const $defs = reactive(raw)

  // 3. Add computed signals (template strings)
  for (const [key, entry] of Object.entries(defs)) {
    if (isTemplateString(entry)) {
      $defs[key] = computed(() => evaluateTemplate(entry, $defs))
    }
  }

  // 4. Add Function prototype entries (bound to $defs)
  for (const [key, entry] of Object.entries(defs)) {
    if (isFunctionPrototype(entry)) {
      $defs[key] = buildFunction(key, entry, $defs)
    }
  }

  // 5. Add external class entries
  for (const [key, entry] of Object.entries(defs)) {
    if (isExternalClass(entry)) {
      $defs[key] = buildExternalClass(key, entry, $defs)
    }
  }

  return $defs
}
```

All state exists on `$defs` before any function runs. Sibling access within handlers works naturally because the scope is an object reference — fully constructed before any function executes.

---

## 4. Template Strings

### 4.1 Syntax (unchanged)

```json
{
  "$defs": {
    "firstName": "Jane",
    "lastName":  "Smith",
    "score":     92,

    "fullName":     "${$defs.firstName} ${$defs.lastName}",
    "displayTitle": "${$defs.score >= 90 ? 'Expert' : 'Beginner'}",
    "scoreLabel":   "${$defs.score}%",
    "greeting":     "Hello, ${$defs.firstName}!"
  }
}
```

### 4.2 Compilation

Template strings compile to `computed()` instead of `Signal.Computed`:

```js
// Given:
"fullName": "${$defs.firstName} ${$defs.lastName}"

// Compiler emits:
$defs.fullName = computed(() =>
  `${$defs.firstName} ${$defs.lastName}`
)
```

Vue's proxy intercepts the reads of `$defs.firstName` and `$defs.lastName` during `computed` evaluation and registers them as dependencies automatically. No explicit dependency list. No `.get()` calls. When either changes, `fullName` is invalidated and recomputed on next access.

### 4.3 Template strings in element properties

```json
{
  "tagName": "div",
  "textContent": "${$defs.count} items remaining",
  "className":   "${$defs.active ? 'card active' : 'card'}",
  "hidden":      "${$defs.items.length === 0}"
}
```

The compiler wraps element property template strings in `watchEffect`:

```js
watchEffect(() => {
  el.textContent = `${$defs.count} items remaining`
})

watchEffect(() => {
  el.className = `${$defs.active ? 'card active' : 'card'}`
})

watchEffect(() => {
  el.hidden = $defs.items.length === 0
})
```

Each `watchEffect` independently tracks only the signals it reads. Changing `count` re-runs the first effect but not the second or third.

### 4.4 `.value` access for `computed` refs

Vue's `computed()` returns a `ref` — a wrapper whose value is accessed via `.value`. Inside `watchEffect`, Vue automatically unwraps `computed` refs when they're accessed as properties of a `reactive()` object. Since computed signals are stored on the `reactive($defs)` object, they unwrap transparently:

```js
// $defs.fullName is a computed ref stored on reactive($defs)
// Accessing it inside watchEffect auto-unwraps:
watchEffect(() => {
  el.textContent = $defs.fullName // Vue unwraps .value automatically
})
```

Authors never write `.value` anywhere. This is Vue's automatic ref unwrapping in reactive objects — documented behavior, not magic.

---

## 5. Inline Function Bodies

### 5.1 Syntax

Authors write direct mutations — no `.set()`, no `.get()`:

```json
{
  "$defs": {
    "count": 0,
    "items": [],
    "name":  "",

    "increment": {
      "$prototype": "Function",
      "body": "$defs.count++"
    },
    "decrement": {
      "$prototype": "Function",
      "body": "$defs.count = Math.max(0, $defs.count - 1)"
    },
    "handleInput": {
      "$prototype": "Function",
      "arguments": ["event"],
      "body": "$defs.name = event.target.value"
    },
    "addItem": {
      "$prototype": "Function",
      "body": "$defs.items.push({ id: Date.now(), text: 'New item', done: false })"
    },
    "toggleItem": {
      "$prototype": "Function",
      "arguments": ["id"],
      "body": "const i = $defs.items.findIndex(x => x.id === id); if (i >= 0) $defs.items[i].done = !$defs.items[i].done"
    },
    "resetAll": {
      "$prototype": "Function",
      "body": "$defs.count = 0; $defs.name = ''; $defs.items.splice(0)"
    }
  }
}
```

### 5.2 Compilation

The compiler wraps the body in a function that receives `$defs` as its first parameter and emits the full `$defs` destructure of all keys — then emits the body verbatim:

```js
// Given:
"increment": { "$prototype": "Function", "body": "$defs.count++" }

// Compiler emits:
function increment($defs) {
  $defs.count++
}
```

Note that unlike the earlier spec's destructure-everything approach, functions receive `$defs` as a **named object parameter** — not a destructured parameter list. This is required for Vue proxy reactivity (see §3.2).

### 5.3 Runtime calling convention

The runtime calls every function with `$defs` as the first argument:

```js
el.addEventListener('click', () => $defs.increment($defs))
el.addEventListener('click', (e) => $defs.handleInput($defs, e))
```

### 5.4 Computed functions with `signal: true`

```json
"titleClass": {
  "$prototype": "Function",
  "body": "return $defs.score >= 90 ? 'gold' : 'silver'",
  "signal": true
}
```

Compiles to:

```js
$defs.titleClass = computed(($defs) => {
  return $defs.score >= 90 ? 'gold' : 'silver'
})
```

Or equivalently, since `$defs` is already in closure scope at construction time:

```js
$defs.titleClass = computed(() => {
  return $defs.score >= 90 ? 'gold' : 'silver'
})
```

`$defs.score` is read during `computed` evaluation — Vue tracks it automatically.

---

## 6. External Sidecar Functions

### 6.1 Authoring

Sidecar functions declare `$defs` as their first parameter and mutate directly:

```js
// todo-handlers.js

export function addItem($defs) {
  $defs.items.push({
    id: Date.now(),
    text: 'New item',
    done: false
  })
}

export function toggleItem($defs, id) {
  const item = $defs.items.find(i => i.id === id)
  if (item) item.done = !item.done  // deep mutation — Vue tracks this
}

export function clearDone($defs) {
  // splice mutates in place — Vue tracks array mutations
  $defs.items.splice(0, $defs.items.length,
    ...$defs.items.filter(i => !i.done)
  )
}

export function resetAll($defs) {
  $defs.count = 0
  $defs.name = ''
  $defs.items.splice(0)  // Vue tracks splice
}
```

### 6.2 Deep mutation

Vue's `reactive()` proxy tracks array mutations (`push`, `pop`, `splice`, `sort`, `reverse`, `shift`, `unshift`) and nested object mutations transparently. Authors write natural JavaScript. No immutable update patterns needed.

### 6.3 Runtime wrapping

```js
const module = await import('./todo-handlers.js')
$defs.addItem    = (...args) => module.addItem($defs, ...args)
$defs.toggleItem = (...args) => module.toggleItem($defs, ...args)
$defs.clearDone  = (...args) => module.clearDone($defs, ...args)
```

---

## 7. The `Request` Prototype (Updated)

The `Request` prototype is the most significantly improved by this migration. The new implementation uses `watchEffect` with `onCleanup` for automatic re-triggering and request cancellation.

### 7.1 Implementation

```js
import { ref, watchEffect } from '@vue/reactivity'

case 'Request': {
  const state = ref(null)
  const debounceMs = def.debounce ?? 0
  let debounceTimer = null

  watchEffect((onCleanup) => {
    // Evaluate URL template — Vue tracks any $defs reads here
    const url = def.url.replace(/\$\{([^}]+)\}/g, (_, expr) =>
      Function('$defs', `return ${expr}`)($defs)
    )

    if (!url || url.includes('undefined') || url.includes('null')) return

    const controller = new AbortController()

    onCleanup(() => {
      controller.abort()
      clearTimeout(debounceTimer)
    })

    const doFetch = () =>
      fetch(url, {
        signal: controller.signal,
        method: def.method ?? 'GET',
        ...(def.headers && { headers: def.headers }),
        ...(def.body && {
          body: typeof def.body === 'object'
            ? JSON.stringify(def.body)
            : def.body
        })
      })
        .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
        .then(d => { state.value = d })
        .catch(e => {
          if (e.name !== 'AbortError')
            state.value = { error: String(e) }
        })

    if (debounceMs > 0) {
      debounceTimer = setTimeout(doFetch, debounceMs)
    } else {
      doFetch()
    }
  })

  // Expose manual re-fetch for $prototype: "Request" entries with manual: true
  state.fetch = () => {
    // Re-run by touching a sentinel — or expose doFetch directly
    // Implementation detail left to runtime author
  }

  return state
}
```

### 7.2 How automatic re-triggering works

The URL template evaluation happens **synchronously** inside `watchEffect`:

```js
const url = def.url.replace(/\$\{([^}]+)\}/g, (_, expr) =>
  Function('$defs', `return ${expr}`)($defs)  // reads $defs.userId — tracked
)
```

Vue intercepts the `$defs.userId` read during this synchronous evaluation and registers it as a dependency of the `watchEffect`. When `$defs.userId` changes:

1. Vue invalidates the `watchEffect`
2. `onCleanup` runs — aborts the previous in-flight request
3. The `watchEffect` body re-executes
4. The URL is re-evaluated with the new `userId`
5. A new fetch fires

The debounce is applied only to the network call. Dependency tracking happens on the synchronous URL evaluation regardless of debounce.

### 7.3 Usage (updated syntax)

```json
{
  "$defs": {
    "userId": {
      "type": "integer",
      "default": 1,
      "description": "Currently selected user ID"
    },

    "user": {
      "$prototype": "Request",
      "url": "https://jsonplaceholder.typicode.com/users/${$defs.userId}",
      "method": "GET",
      "signal": true,
      "description": "Reactive user fetch — re-fetches automatically when userId changes"
    },

    "posts": {
      "$prototype": "Request",
      "url": "https://jsonplaceholder.typicode.com/posts?userId=${$defs.userId}",
      "method": "GET",
      "debounce": 300,
      "signal": true,
      "description": "Posts for the selected user — debounced 300ms"
    },

    "selectUser": {
      "$prototype": "Function",
      "arguments": ["id"],
      "body": "$defs.userId = id"
    }
  }
}
```

Calling `selectUser(3)` sets `$defs.userId = 3`. Both `user` and `posts` watchEffects are invalidated. Previous in-flight requests are cancelled. New fetches fire. `posts` fetch is debounced — if `selectUser` is called rapidly, only one fetch fires after the 300ms settles.

---

## 8. Updated `$defs` Shape Grammar

The five shapes from the Unified Grammar Amendment v0.2.0 are unchanged in their JSON syntax. Only the emitted runtime code changes.

| Shape | JSON form | Emitted as |
|---|---|---|
| Naked value | `0`, `"hello"`, `[]`, `{}` | Property on `reactive({})` |
| Expanded signal | `{ "type": ..., "default": ... }` | Property on `reactive({})` initialized to `default` |
| Pure type def | `{ "type": ..., no "default" }` | Nothing — tooling only |
| Template string | `"${$defs.x} ..."` | `computed(() => \`...\`)` on `$defs` |
| Function | `{ "$prototype": "Function", ... }` | Named function, `$defs` as first param |
| External class | `{ "$prototype": "ClassName", ... }` | Class instance, optionally `ref()`-wrapped |

### `signal: true` semantics with Vue

With `@vue/reactivity`, `signal: true` on external class entries means the runtime wraps the resolved value in `ref()` and sets up a `watchEffect` or `subscribe` to update it:

```js
// $prototype: "Request", signal: true
// → wrapped in ref(), updated by watchEffect (§7)

// $prototype: "MarkdownCollection", signal: true, timing: "client"
// → wrapped in ref(), updated via class's subscribe() method
```

External class entries without `signal: true` are resolved once and stored as a plain value on `$defs`.

---

## 9. Updated Dependency Stack

| Package | Version | Purpose | Change |
|---|---|---|---|
| `@apidevtools/json-schema-ref-parser` | `^15.0` | `$ref` resolution | Unchanged |
| `@vue/reactivity` | `^3.5` | Reactive primitives | **Replaces `signal-polyfill`** |
| ~~`signal-polyfill`~~ | ~~`^0.2`~~ | ~~TC39 Signals polyfill~~ | **Removed** |

`effect.js` — the custom 20-line effect scheduler in the prior runtime — is also **removed**. Vue's `watchEffect` replaces it entirely.

### Bundle impact

| Library | Min+gzip |
|---|---|
| `signal-polyfill` (removed) | ~9kb |
| `@vue/reactivity` (added) | ~20kb |
| Net change | +11kb |

The 11kb increase buys: production-ready reactivity, deep proxy tracking, automatic request re-triggering, request cancellation, no `.get()`/`.set()` in authoring, and a clear TC39 Signals migration path. It is the right tradeoff.

---

## 10. Updated Codebase Refactoring Targets

### `ddom.js` (runtime)

**Remove:**
- `signal-polyfill` import
- `Signal.State`, `Signal.Computed`, `Signal.subtle.Watcher` usage
- `effect.js` import and custom scheduler
- `interpolateRef()` function
- `makeComputed()` function
- `loadHandlers()` function

**Add:**
- `import { reactive, ref, computed, watchEffect } from '@vue/reactivity'`
- `buildScope()` rewrite using `reactive()` — single pass per §3.4
- `evaluateTemplate(str, $defs)` — replaces `interpolateRef`, uses `Function('$defs', ...)` evaluation
- Updated `Request` prototype case — full implementation per §7.1
- `watchEffect` wrappers for element property template strings

**Update:**
- All `state.get()` → `$defs.signalName` (read via proxy)
- All `state.set(v)` → `$defs.signalName = v` (write via proxy)
- Event handler attachment — call as `fn($defs, event)` not `fn.bind(scope)(event)`

### `ddom-compiler.js` (compiler)

**Remove:**
- Any references to `Signal.State`, `Signal.Computed` in emitted code
- `signal-polyfill` import in emitted output
- `interpolateRef` calls in emitted output
- Destructure-all parameter pattern (replaced by named `$defs` parameter)

**Update:**
- Function body wrapper — emit `function name($defs) { body }` not destructured form
- Template string emission — emit `computed(() => \`...\`)` not `Signal.Computed`
- Element property template string emission — emit `watchEffect(() => { el.prop = \`...\` })`
- Computed function (`signal: true`) emission — emit `computed(() => { body })`

**Unchanged:**
- Syntax validation via acorn
- `$defs` shape detection algorithm
- JSON Schema stripping
- TypeScript declaration generation
- Bundle manifest generation

### `effect.js`

**Delete entirely.** Vue's `watchEffect` replaces all functionality.

### `todo-app.json` (example)

Update all template strings and body strings:
- `${$count.get()}` → `${$defs.count}`
- `$count.set(v)` → `$defs.count = v`
- `$items.set([...$items.get(), x])` → `$defs.items.push(x)`
- `$items.set($items.get().filter(...))` → `$defs.items.splice(0, $defs.items.length, ...$defs.items.filter(...))`

### `ddom-spec.md` (root spec)

| Section | Change |
|---|---|
| §3.2 JSON Schema Dialect | Update reserved keywords — remove `$compute`, `$deps`, `$handler`, `$handlers` |
| §5 Signal Declarations | Rewrite entirely — five-shape grammar, `$defs` scope, Vue reactive |
| §9 Event Handlers | Update to `$prototype: "Function"` with `$defs` parameter |
| §11 Web API Namespaces | Update `Request` prototype documentation per §7 |
| §13 Computed Expressions | Remove JSONata; replace with template string + `$defs` convention |
| §17 Runtime Pipeline | Step 2 rewrite: `reactive($defs)` construction, `watchEffect` for effects |
| §18 Reserved Keywords | Apply updated table from §11 of Grammar Amendment v0.2.0 |
| §19.3 | Replace TC39 Signals alignment note with `@vue/reactivity` alignment note |
| Appendix B | Replace `signal-polyfill` with `@vue/reactivity` in dependency table |
| Appendix C | Update checklist — remove `.get()`/`.set()` references |

---

## 11. Updated Author-Facing Summary

- State lives on `$defs` — a reactive proxy of the component scope
- Read state with `$defs.signalName` — no `.get()` call needed
- Write state with `$defs.signalName = newValue` — no `.set()` call needed
- Mutate arrays directly: `$defs.items.push(x)`, `$defs.items.splice(...)` — Vue tracks all of these
- Mutate nested objects directly: `$defs.user.name = 'Alice'` — Vue tracks nested reads and writes
- Template strings use `$defs.signalName` — dependencies are tracked automatically when the template evaluates
- Computed signals (`${...}`) re-evaluate automatically when any `$defs` property they read changes
- Element property template strings re-apply to the DOM automatically when dependencies change
- `Request` prototypes re-fetch automatically when any `$defs` property in their URL changes
- Sidecar functions receive `$defs` as their first parameter — mutate directly, no wrappers
- `this` is never used in JSONsx-managed code

---

## 12. Complete Updated Example

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

    "items": {
      "type": "array",
      "default": [{ "id": 1, "text": "Learn JSONsx", "done": false }],
      "items": { "$ref": "#/$defs/TodoItem" }
    },

    "remaining": "${$defs.items.filter(i => !i.done).length}",
    "total":     "${$defs.items.length}",
    "summary":   "${$defs.remaining} of ${$defs.total} remaining",
    "allDone":   "${$defs.remaining === 0}",

    "addItem": {
      "$prototype": "Function",
      "body": "$defs.items.push({ id: Date.now(), text: 'New item', done: false })"
    },
    "toggleItem": {
      "$prototype": "Function",
      "arguments": ["id"],
      "body": "const item = $defs.items.find(i => i.id === id); if (item) item.done = !item.done"
    },
    "clearDone": {
      "$prototype": "Function",
      "body": "$defs.items.splice(0, $defs.items.length, ...$defs.items.filter(i => !i.done))"
    }
  },

  "tagName": "todo-app",
  "style": { "fontFamily": "system-ui", "maxWidth": "480px", "margin": "2rem auto" },

  "children": [
    {
      "tagName": "h1",
      "textContent": "${$defs.summary}"
    },
    {
      "tagName": "p",
      "textContent": "All done! 🎉",
      "hidden": "${!$defs.allDone}"
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
        "items": { "$ref": "#/$defs/items" },
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

Notice `toggleItem` directly mutates the item object in place — `item.done = !item.done`. Because `$defs.items` is a deeply reactive Vue proxy, this nested mutation is tracked and any DOM effects reading `item.done` re-run automatically.

### External sidecar variant

```js
// todo-handlers.js

export function addItem($defs) {
  $defs.items.push({
    id: Date.now(),
    text: 'New item',
    done: false
  })
}

export function toggleItem($defs, id) {
  const item = $defs.items.find(i => i.id === id)
  if (item) item.done = !item.done  // deep mutation — Vue tracks
}

export function clearDone($defs) {
  $defs.items.splice(
    0,
    $defs.items.length,
    ...$defs.items.filter(i => !i.done)
  )
}
```

---

## 13. On the TC39 Signals Future

Dropping the signal-polyfill is not a rejection of the TC39 Signals proposal — it is a pragmatic deferral until the proposal matures. The polyfill is explicitly not production-ready and significantly slower than alternatives.

When native Signals land in browsers, the migration path is:

1. Replace `@vue/reactivity` primitives with native equivalents: `ref` → `Signal.State`, `computed` → `Signal.Computed`, `watchEffect` → native effect
2. The `$defs` authoring model is unchanged — authors still write `$defs.count = v` and `${$defs.count}` throughout
3. Deep reactivity would require a thin Proxy wrapper over native Signals — or native Signals may gain deep tracking support by that point
4. The `$defs` named scope convention is compatible with either approach

The `$defs` convention is the durable interface. The reactivity library underneath it is an implementation detail.

---

*JSONsx Vue Reactivity Migration Amendment v0.1.0-draft*

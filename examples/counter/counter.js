/**
 * counter.js — external function examples for counter.json
 *
 * With the new $defs grammar, handlers are defined inline as
 * $prototype: "Function" entries with `body`. This sidecar is
 * kept as documentation of the external $src pattern.
 *
 * `$defs` is passed as the first parameter.
 * Signals are accessed as plain properties on $defs.
 */

export function increment($defs) {
  $defs.count++;
}

export function decrement($defs) {
  $defs.count = Math.max(0, $defs.count - 1);
}

export function reset($defs) {
  $defs.count = 0;
}

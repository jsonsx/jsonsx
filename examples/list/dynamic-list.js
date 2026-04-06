/**
 * dynamic-list.js — external functions for dynamic-list.json
 *
 * With the new $defs grammar, handlers are defined inline as
 * $prototype: "Function" entries with `body`. This sidecar is
 * kept as documentation of the external $src pattern.
 */

export function addItem($defs) {
  const text = $defs.newText.trim();
  if (!text) return;
  $defs.items.push(text);
  $defs.newText = '';
}

export function removeItem($defs, event) {
  const index = $defs.$map?.index ?? -1;
  if (index < 0) return;
  $defs.items.splice(index, 1);
}

export function updateText($defs, event) {
  $defs.newText = event.target.value;
}

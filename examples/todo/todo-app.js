/**
 * todo-app.js — external functions for todo-app.json
 *
 * With the new $defs grammar, handlers are defined inline as
 * $prototype: "Function" entries with `body`. This sidecar is
 * kept as documentation of the external $src pattern.
 */

export function addItem($defs, event) {
  if (event.key !== 'Enter') return;
  const text = event.target.value.trim();
  if (!text) return;
  $defs.items.push({ id: Date.now(), text, done: false });
  event.target.value = '';
}

export function toggleItem($defs, _event) {
  const index = $defs.$map?.index ?? -1;
  if (index < 0) return;
  $defs.items[index].done = !$defs.items[index].done;
}

export function clearDone($defs) {
  $defs.items.splice(0, $defs.items.length, ...$defs.items.filter(item => !item.done));
}

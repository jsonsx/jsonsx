/**
 * dynamic-list.js — handlers for the dynamic list demo.
 *
 * Editable items: click to edit inline, Enter to save, Escape to cancel.
 * All mutations to $defs.items are automatically persisted by the
 * LocalStorage prototype — no explicit save calls required.
 */

export function addItem($defs) {
  const text = $defs.newText.trim();
  if (!text) return;
  $defs.items.push(text);
  $defs.newText = '';
}

export function addKeydown($defs, event) {
  if (event.key === 'Enter') addItem($defs);
}

export function removeItem($defs) {
  const index = $defs.$map?.index ?? -1;
  if (index < 0) return;
  $defs.items.splice(index, 1);
}

export function saveEdit($defs, event) {
  const index = $defs.$map?.index ?? -1;
  if (index < 0) return;
  const newText = event.target.textContent.trim();
  if (!newText) {
    event.target.textContent = $defs.$map?.item ?? '';
    return;
  }
  $defs.items[index] = newText;
}

export function editKeydown($defs, event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
  } else if (event.key === 'Escape') {
    event.target.textContent = $defs.$map?.item ?? '';
    event.target.blur();
  }
}

export function updateText($defs, event) {
  $defs.newText = event.target.value;
}

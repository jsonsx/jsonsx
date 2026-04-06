/**
 * router.js — external function for router.json
 *
 * With the new $defs grammar, the navigate handler is defined inline
 * as a $prototype: "Function" entry with `body`. This sidecar is
 * kept as documentation of the external $src pattern.
 */

export function navigate($defs, event) {
  const route = event.currentTarget?.dataset?.route
    ?? event.target?.dataset?.route;
  if (route) $defs.currentRoute = route;
}

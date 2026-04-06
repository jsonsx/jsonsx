/**
 * blog.js — external function for blog.json
 *
 * With the new $defs grammar, the selectPost handler is defined inline
 * as a $prototype: "Function" entry with `body`. This sidecar is
 * kept as documentation of the external $src pattern.
 */

export function selectPost($defs, event) {
  const slug = event.target.dataset?.slug;
  if (slug) {
    $defs.currentSlug = slug;
  }
}

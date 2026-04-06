/**
 * contact-form.js — external functions for contact-form.json
 *
 * With the new $defs grammar, all handlers are defined inline as
 * $prototype: "Function" entries with `body`. This sidecar is
 * kept as documentation of the external $src pattern.
 */

export function setName($defs, event) { $defs.name = event.target.value; }
export function setEmail($defs, event) { $defs.email = event.target.value; }
export function setMessage($defs, event) { $defs.message = event.target.value; }

export function submit($defs) {
  if (!$defs.formValid) return;
  console.log('Form submitted:', {
    name:    $defs.name,
    email:   $defs.email,
    message: $defs.message,
  });
  $defs.submitted = true;
  $defs.reset();
}

export function reset($defs) {
  $defs.name = '';
  $defs.email = '';
  $defs.message = '';
  $defs.submitted = false;
}

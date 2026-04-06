/**
 * fetch-demo.js — external functions for fetch-demo.json
 *
 * The user and posts Request prototypes auto-fetch at mount time.
 * These handlers change userId and manually re-fetch since the URL
 * is not yet composed from a signal reference.
 */

export function prevUser($defs) {
  const id = Math.max(1, $defs.userId - 1);
  $defs.userId = id;
  _refetch($defs, id);
}

export function nextUser($defs) {
  const id = Math.min(10, $defs.userId + 1);
  $defs.userId = id;
  _refetch($defs, id);
}

function _refetch($defs, id) {
  const base = 'https://jsonplaceholder.typicode.com';
  fetch(`${base}/users/${id}`)
    .then(r => r.json())
    .then(data => $defs.user = data);

  fetch(`${base}/posts?userId=${id}`)
    .then(r => r.json())
    .then(data => $defs.posts = data);
}

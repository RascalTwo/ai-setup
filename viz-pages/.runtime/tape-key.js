// tape-key.js — the canonical tape record-key logic, in ONE place.
//
// This is plain ES-module JavaScript on purpose: it must run verbatim in BOTH
// environments that compute a tape key, with zero transpile step between them.
//   1. Bun (server) — recordings.ts imports { keyFor, sortedQuery } here for the
//      --record and --frozen playback paths.
//   2. The browser — build.ts inlines this file's source verbatim into the
//      self-contained export's client-side fetch shim.
// Because both sides run the *same bytes*, a hosted frozen viz keys its api/*
// calls identically to how the server taped them — the keys cannot drift.
//
// `URLSearchParams`, `Math.imul`, and string methods used below are all native to
// both Bun and every modern browser, so nothing here is environment-specific.

// Deterministic, dependency-free short hash (FNV-1a) for keying request bodies.
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Canonical, order-independent query string: `a=1&b=2` (no leading `?`), params
// sorted by key then value so param order never changes the key. Takes a
// URLSearchParams (present in both Bun and the browser).
export function sortedQuery(searchParams) {
  const params = [...searchParams.entries()].sort(([a, av], [b, bv]) =>
    a === b ? av.localeCompare(bv) : a.localeCompare(b),
  );
  return params.map(([k, v]) => `${k}=${v}`).join("&");
}

// The canonical record key: `METHOD /route?sorted-query` (+ ` #bodyhash` when a
// body is present). `route` is the api-relative path (e.g. "meta",
// "failover/break"); `query` is the already-sorted string from sortedQuery() (may
// be ""); `body` is the raw request body text (may be ""). Method-prefixed so GET
// vs POST never collide; body-less keys stay clean and diff-reviewable.
export function keyFor(method, route, query, body) {
  const qs = query ? "?" + query : "";
  let key = `${method} /${route}${qs}`;
  if (body) key += ` #${fnv1a(body)}`;
  return key;
}

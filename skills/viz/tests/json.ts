// tests/json.ts — JSON.parse with the shape stated by the caller. A test trusts the output of the
// command it just ran, so the one untyped boundary lives here instead of a cast at every call site.

/** Parse `text` as JSON, typed as `T` (a statement of the shape the test expects, not a check). */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the type parameter appears once on purpose: it only names the shape the caller expects
export function parseJson<T = unknown>(text: string): T {
  // oxlint-disable-next-line typescript/no-unsafe-return -- the single trusted JSON boundary for the tests; the caller names the shape
  return JSON.parse(text);
}

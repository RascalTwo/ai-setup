// lib/testing/global.d.ts — the TYPE of the `viz` global a viz's tests get (ADR 0022).
//
// preload.ts provides the value; this is what `viz verify` type-checks a viz's tests against
// (lib/verify/types.ts roots it), so a test calling `viz.screenshot(page)` is an error here rather
// than a failed run later. A viz's helpers do not redeclare it.
import type { Page } from "puppeteer-core";

/** The page `viz.open()` gives: puppeteer's Page, plus the uncaught page errors so far. */
export type VizPage = Page & { errors: string[] };
// Every option also takes an explicit `undefined`: preload.ts destructures them with defaults, so
// `{ before: maybeFn }` is fine at runtime and the strict optional-property check should not refuse it.
/** `before` runs ahead of the page loading (request interception, init scripts). */
export type OpenOptions = { width?: number | undefined; height?: number | undefined; before?: ((page: Page) => unknown) | undefined };
export type ScreenshotOptions = { selector?: string | undefined; mask?: string[] | undefined; maxDiffPixels?: number | undefined; threshold?: number | undefined };

export type VizGlobal = {
  url: string;
  dir: string;
  /** `hash` becomes the link's #<JSON>: an object is JSON-encoded, as the kit's links are. */
  open(hash?: string | object, options?: OpenOptions): Promise<VizPage>;
  screenshot(page: Page, name: string, options?: ScreenshotOptions): Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var viz: VizGlobal;
}

// Bun accepts `it.todo("label")` with no body (measured, Bun 1.3.11), but bun-types 1.4.2 types `todo` as an
// ordinary test, which needs one. `todo` is declared as the same type as the test itself, so "only todo may
// omit its body" cannot be said: the body-less form is added to every test. That is loose in exactly one way,
// and loudly: an ordinary test with no body still fails the moment the file runs ("test expects a function
// as the second argument"), it is never silently skipped.
declare module "bun:test" {
  interface Test<T extends ReadonlyArray<unknown>> {
    (label: string): void;
  }
}

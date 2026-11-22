// lib/testing/global.d.ts — the TYPE of the `viz` global a viz's tests get (ADR 0022).
//
// preload.ts provides the value; this is what `viz verify` type-checks a viz's tests against
// (lib/verify/types.ts roots it), so a test calling `viz.screenshot(page)` is an error here rather
// than a failed run later. A viz's helpers do not redeclare it.
// `describe`, `it`, `expect` and the hooks are globals too (vitest runs with `globals: true`).
/// <reference types="vitest/globals" />
import type { Page } from "puppeteer-core";

/** The page `viz.open()` gives: puppeteer's Page, plus the uncaught page errors so far. */
export type VizPage = Page & { errors: string[] };
// Every option also takes an explicit `undefined`: preload.ts destructures them with defaults, so
// `{ before: maybeFn }` is fine at runtime and the strict optional-property check should not refuse it.
/** `before` runs ahead of the page loading (request interception, init scripts). */
export type OpenOptions = {
  width?: number | undefined;
  height?: number | undefined;
  before?: ((page: Page) => unknown) | undefined;
};
export type ScreenshotOptions = {
  selector?: string | undefined;
  mask?: string[] | undefined;
  maxDiffPixels?: number | undefined;
  threshold?: number | undefined;
};

/** A GIVEN / WHEN / THEN step: runs `fn`, returns its result, and names the step if it throws. Without `fn` it only records the sentence. */
export type Step = {
  (sentence: string): Promise<void>;
  <T>(sentence: string, fn: () => T | Promise<T>): Promise<T>;
};

export type VizGlobal = {
  url: string;
  dir: string;
  /** `hash` becomes the link's #<JSON>: an object is JSON-encoded, as the kit's links are. */
  open(hash?: string | object, options?: OpenOptions): Promise<VizPage>;
  screenshot(page: Page, name: string, options?: ScreenshotOptions): Promise<void>;
  given: Step;
  when: Step;
  then: Step;
};

declare global {
  // eslint-disable-next-line no-var
  var viz: VizGlobal;
}

declare module "vitest" {
  // oxlint-disable-next-line typescript/no-explicit-any -- vitest's own declaration of Matchers has this parameter
  interface Matchers<T = any> {
    /** The received string begins with `prefix` (preload.ts adds it). */
    toStartWith(prefix: string): T;
  }
}

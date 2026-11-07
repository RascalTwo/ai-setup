// tests/kit-need.test.ts — `need` throws on a miss and names the selector; `$` still returns null on one.
import { expect, test } from "bun:test";
// @ts-expect-error TS7016 — kit/viz.js is generated from kit/src/viz.ts, which sync:kit checks with browser settings
import * as vizBundle from "../kit/viz.js";

interface VizApi {
  $: (sel: string, root: ParentNode) => Element | null;
  need: (sel: string, root: ParentNode) => Element;
}
const bundle: unknown = vizBundle;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kit's .js has no declarations (its source is checked by sync:kit); VizApi is the part tested
const { $, need } = bundle as VizApi;

/** A root whose querySelector answers `el` (Bun has no DOM; both helpers call only querySelector). */
const rootWith = (el: object | null): ParentNode =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stand-in for a ParentNode: only the one method the helpers call
  ({ querySelector: () => el }) as unknown as ParentNode;

test("Given a page with no #out, when need('#out') runs, then it throws 'no element #out'", () => {
  expect(() => need("#out", rootWith(null))).toThrow(new Error("no element #out"));
});

test("Given a page with no #out, when $('#out') runs, then it returns null", () => {
  expect($("#out", rootWith(null))).toBeNull();
});

test("Given a page with #out, when need('#out') runs, then it returns that element", () => {
  const el = { id: "out" };
  const found: unknown = need("#out", rootWith(el));
  expect(found).toBe(el);
});

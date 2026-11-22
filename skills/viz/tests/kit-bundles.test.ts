import { afterAll, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundle, KIT_DIR, kitBundles } from "../maintainer/sync-kit.ts";

const bundles = Object.entries(await kitBundles());

test("kitBundles lists at least one generated kit file", () => {
  // GIVEN package.json
  // WHEN its kitBundles are read
  // THEN the pairwise engine is among them
  expect(bundles).toContainEqual(["pairwise.js", "@rascaltwo/pairwise-sorter"]);
});

for (const [file, pkg] of bundles) {
  test(`kit/${file} is exactly the pinned ${pkg} bundle (else: npm run sync:kit)`, async () => {
    // GIVEN the committed kit file
    // WHEN it is compared with a fresh bundle of the pinned package
    // THEN they are identical
    expect(await readFile(path.join(KIT_DIR, file), "utf8")).toBe(await bundle(pkg));
  });
}

test("kit/pairwise-element.js defines <pairwise-compare> as it loads", async () => {
  // GIVEN a page with no custom elements yet (only the bare browser globals the bundle touches)
  const defined = new Map<string, unknown>();
  vi.stubGlobal("HTMLElement", vi.fn());
  vi.stubGlobal(
    "CSSStyleSheet",
    vi.fn(function sheet() {
      return { replaceSync: vi.fn() };
    }),
  );
  vi.stubGlobal("customElements", {
    get: (tag: string) => defined.get(tag),
    define: (tag: string, cls: unknown) => defined.set(tag, cls),
  });
  afterAll(() => vi.unstubAllGlobals());
  // WHEN the kit file is imported
  await import(pathToFileURL(path.join(KIT_DIR, "pairwise-element.js")).href);
  // THEN the compare card is registered, with no other call needed
  expect([...defined.keys()]).toContain("pairwise-compare");
});

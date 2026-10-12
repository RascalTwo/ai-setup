import { expect, test } from "bun:test";
import path from "node:path";
import { bundle, KIT_DIR, kitBundles } from "../maintainer/sync-kit.ts";

const bundles = Object.entries(await kitBundles());

test("kitBundles lists at least one generated kit file", () => {
  // GIVEN package.json
  // WHEN its kitBundles are read
  // THEN the pairwise engine is among them
  expect(bundles).toContainEqual(["pairwise.js", "@rascaltwo/pairwise-sorter"]);
});

for (const [file, pkg] of bundles) {
  test(`kit/${file} is exactly the pinned ${pkg} bundle (else: bun run sync:kit)`, async () => {
    // GIVEN the committed kit file
    // WHEN it is compared with a fresh bundle of the pinned package
    // THEN they are identical
    expect(await Bun.file(path.join(KIT_DIR, file)).text()).toBe(await bundle(pkg));
  });
}

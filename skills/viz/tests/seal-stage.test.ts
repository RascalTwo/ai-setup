// tests/seal-stage.test.ts — plaintext waiting to be sealed is staged in a folder no other build shares.
//
// WHY: the stage used to be `$TMPDIR/viz-publish-stage/<slug>` (and `.../viz-lobby-index-stage/.viz-dist`
// for every lobby publish), so two builds at once could overwrite each other's plaintext and seal the wrong page.

import { expect, test } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { runSync } from "../lib/proc.ts";

const SEAL = path.join(path.dirname(import.meta.dirname), "lib", "publish", "seal.ts");
const stageOf = (name: string) =>
  runSync([
    process.execPath,
    "--input-type=module",
    "-e",
    `const { sealStage } = await import(${JSON.stringify(SEAL)}); console.log(sealStage(${JSON.stringify(name)}));`,
  ]).stdout.trim();

test("Given two builds staging a viz of the same name, when each asks for its stage, then the folders differ", () => {
  // GIVEN two separate processes (two publishes or previews), each staging a viz called "card"
  // WHEN each asks for its stage folder
  const a = stageOf("card"),
    b = stageOf("card");

  // THEN both are named for the viz, but neither is the other's
  expect(path.basename(a)).toBe("card");
  expect(a).not.toBe(b);
  // THEN the plaintext does not outlive the build
  expect(existsSync(a)).toBe(false);
});

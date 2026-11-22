// The skill's own suite, on the viz skill's vitest (this skill has no node_modules of its own):
//   node ../viz/node_modules/vitest/vitest.mjs run --config vitest.config.mjs   (from this folder)
// The tests in template/tests run under `viz verify` on a page made from the template, and skip here.
import path from "node:path";

const VIZ = path.resolve(import.meta.dirname, "../viz");
const KIT = path.join(VIZ, "kit");

export default {
  root: import.meta.dirname,
  resolve: {
    alias: [
      { find: /^vitest$/u, replacement: path.join(VIZ, "node_modules/vitest/dist/index.js") },
      { find: /^@viz\/kit$/u, replacement: path.join(KIT, "viz.js") },
      { find: /^(?:@viz\/kit|\/_kit)\//u, replacement: `${KIT}/` },
    ],
  },
  test: {
    include: ["*.test.ts", "template/tests/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
};

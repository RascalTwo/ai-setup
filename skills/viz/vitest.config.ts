import { istanbul } from "@rascaltwo/r2-test-kit/vite";
import path from "node:path";
import { defineConfig } from "vitest/config";

const KIT = path.join(import.meta.dirname, "kit");

export default defineConfig(({ mode }) => ({
  plugins: [mode === "test" && istanbul()],
  // A backend a test loads imports the kit by its alias, which lib/server/kit-resolve.ts gives Node;
  // vitest loads through Vite, so the same two spellings are mapped here.
  resolve: {
    alias: [
      { find: /^@viz\/kit$/u, replacement: path.join(KIT, "viz.js") },
      { find: /^(?:@viz\/kit|\/_kit)\//u, replacement: `${KIT}/` },
    ],
  },
  test: {
    // The skill's own suite only. A viz's tests (viz-pages/*/tests) run inside viz verify, which
    // gives them the viz global; picked up here they fail on its absence.
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**", "tests/.tmp-*/**", "node_modules/**"],
    setupFiles: ["@rascaltwo/r2-test-kit/vitest"],
    // Most of this suite drives headless Chrome through the real CLI; on a loaded machine a
    // launch alone outlives vitest's 5s default. A hung test still fails, after three minutes.
    // test.concurrent starts up to 20 headless-Chrome CLIs per file; capped so a busy machine does not time them out.
    maxConcurrency: 6,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    reporters: ["default", ["junit", { outputFile: "out/results/vitest.xml" }]],
  },
}));

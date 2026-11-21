import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.mjs"],
      // runner glue: needs a live vitest worker or browser, so the example app's check proves it end to end
      exclude: ["src/vitest-setup.mjs", "src/playwright.mjs"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});

import { istanbul } from "@rascaltwo/r2-test-kit/vite";
import { defineConfig } from "vitest/config";

// The repo-level suite: tests/*.test.ts. Each skill and tool runs its own suite (see scripts/check.ts).
export default defineConfig(({ mode }) => ({
  plugins: [mode === "test" && istanbul()],
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["@rascaltwo/r2-test-kit/vitest"],
    // These tests run real CLIs against throwaway git repos; a loaded machine outlives vitest's 5 s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ["default", ["junit", { outputFile: "out/results/vitest.xml" }]],
  },
}));

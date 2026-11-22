import { istanbul } from "@rascaltwo/r2-test-kit/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  // vitest runs in mode "test"; the journeys' build uses `vite build --mode test`
  plugins: [react(), mode === "test" && istanbul()],
  build: { rollupOptions: { input: ["index.html", "checkout.html"] } },
  test: {
    setupFiles: ["@rascaltwo/r2-test-kit/vitest"],
    reporters: ["default", ["junit", { outputFile: "out/results/vitest.xml" }]],
    projects: [
      { extends: true, test: { name: "node", include: ["src/**/*.test.ts"], environment: "node" } },
      {
        extends: true,
        test: { name: "component", include: ["src/**/*.test.tsx"], environment: "jsdom" },
      },
    ],
  },
}));

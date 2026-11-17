import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "journeys",
  testMatch: "*.ts",
  outputDir: "out/results/pw",
  reporter: [["list"], ["junit", { outputFile: "out/results/playwright.xml" }]],
  use: { baseURL: "http://localhost:4189", trace: "retain-on-failure" },
  // an instrumented build (mode test), so the page fills window.__coverage__
  webServer: {
    command:
      "vite build --mode test --minify false --outDir out/dist && vite preview --outDir out/dist --port 4189 --strictPort",
    port: 4189,
  },
});

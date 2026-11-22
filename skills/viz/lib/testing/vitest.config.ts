// lib/testing/vitest.config.ts — how `viz verify` runs a viz's own tests (ADR 0022): vitest, rooted at the viz
// (`--root <viz>`), with the `viz` global (preload.ts), a runner that scopes pages to their test (runner.ts) and
// Istanbul counting whatever the tests import directly. The page's own scripts are measured in Chrome instead (tier.ts).
// The skill's own suite has its own config, at the skill's root.
import { istanbul } from "@rascaltwo/r2-test-kit/vite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const SKILL = path.resolve(import.meta.dirname, "../..");
const KIT = path.join(SKILL, "kit");
const { VIZ_OUT = "" } = process.env;

export default defineConfig({
  plugins: [
    // The viz's own scripts, not its tests, vendored libraries or anything outside it (the skill's lib/ a backend imports).
    istanbul({
      include: (rel) =>
        !rel.startsWith("..") &&
        !/(^|\/)(tests|vendor|node_modules)\//u.test(rel) &&
        /(?<!\.d)\.[cm]?[jt]s$/u.test(rel),
    }),
  ],
  resolve: {
    alias: [
      // A viz lives in any repo, with no node_modules beside it: its tests import vitest, and its modules the kit, from the skill.
      { find: /^vitest$/u, replacement: fileURLToPath(import.meta.resolve("vitest")) },
      { find: /^@viz\/kit$/u, replacement: path.join(KIT, "viz.js") },
      { find: /^(?:@viz\/kit|\/_kit)\//u, replacement: KIT + "/" },
    ],
  },
  test: {
    include: ["tests/**/*.{test,probe}.{ts,js,mjs,tsx}"],
    globals: true,
    setupFiles: [path.join(SKILL, "lib/testing/preload.ts")],
    runner: path.join(SKILL, "lib/testing/runner.ts"),
    includeTaskLocation: true,
    pool: "forks",
    fileParallelism: false, // one file, one Chrome, at a time: the concurrency is within a file (it.concurrent)
    // it.concurrent tests mostly WAIT on the page (a film, a debounce, a worker), so one page per core:
    // on the QR generator's style suite 16 at once beat 8 (44 s vs 60 s) with the CPU far from full.
    maxConcurrency: Math.max(2, os.availableParallelism()),
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // A test's screen recording pipes frames into ffmpeg; when ffmpeg has already exited, Node raises an unhandled
    // `write EPIPE` that failed the whole run (seen in several repos). Losing that film is fine; the test's own
    // result stands. Return false to drop only this error.
    onUnhandledError(error) {
      if (/\bwrite EPIPE\b/u.test(error.message)) return false;
      return true;
    },
    reporters: ["default", ["json", { outputFile: path.join(VIZ_OUT, "results.json") }]],
  },
});

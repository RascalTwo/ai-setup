import { defineConfig } from "vitest/config";

// The template/ page and scripts/ run elsewhere; only this skill's own *.test.ts files are the suite.
export default defineConfig({ test: { include: ["*.test.ts"] } });

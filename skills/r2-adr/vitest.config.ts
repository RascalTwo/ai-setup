import { defineConfig } from "vitest/config";

// Only scripts/'s own tests; upstream/ is Vercel's vendored skill.
export default defineConfig({ test: { include: ["scripts/*.test.ts"] } });

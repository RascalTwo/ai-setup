// The behaviour tests run viz-pages/ai-tidemark/api.ts, which imports the viz kit by its alias (`@viz/kit/zod.js`),
// as the viz server that normally loads it allows. Point that alias at the skill's kit.
import path from "node:path";
import { defineConfig } from "vitest/config";

const KIT = path.resolve(import.meta.dirname, "../../skills/viz/kit");

export default defineConfig({
  resolve: { alias: [{ find: /^@viz\/kit\//u, replacement: KIT + "/" }] },
  test: { include: ["*.test.ts"], testTimeout: 30_000 },
});

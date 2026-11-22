import { defineConfig } from "vitest/config";

// One real overlay at a time on the one real screen.
export default defineConfig({ test: { include: ["test/*.test.ts"], fileParallelism: false } });

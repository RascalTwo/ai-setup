// Vite plugin: instruments the ORIGINAL .ts/.tsx with istanbul-lib-instrument before any other transform
// (enforce: "pre"), so counters are in source coordinates and JSX branches (a `&&` arm) are real branches.
// Runs for SSR transforms too, which is how vitest loads modules (vite-plugin-istanbul skips them).
import { createInstrumenter } from "istanbul-lib-instrument";
import { relative } from "node:path";
import { loadConfig } from "./config.mjs";

const make = (parserPlugins) =>
  createInstrumenter({ esModules: true, compact: false, produceSourceMap: true, coverageGlobalScope: "globalThis", coverageGlobalScopeFunc: false, parserPlugins });

/** @param {{ include?: (path: string) => boolean }} [options] path filter, relative to the app root; default from r2-test-kit.config.mjs */
export function istanbul(options = {}) {
  const ts = make(["typescript"]), tsx = make(["typescript", "jsx"]);
  let root, include = options.include;
  return {
    name: "r2-test-kit:istanbul",
    enforce: "pre",
    async configResolved(config) {
      root = config.root;
      include ??= (await loadConfig(root)).include;
    },
    transform(code, id) {
      const file = id.split("?")[0];
      if (!/\.[cm]?[jt]sx?$/.test(file) || file.includes("/node_modules/") || !include(relative(root, file))) return;
      const inst = /x$/.test(file) ? tsx : ts;
      return { code: inst.instrumentSync(code, file), map: inst.lastSourceMap() };
    },
  };
}

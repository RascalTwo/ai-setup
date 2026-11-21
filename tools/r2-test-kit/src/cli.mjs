#!/usr/bin/env node
// r2-test-kit merge | cov-map --build | --test "<substring>" | --line <file:N>
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { buildMap, queryLine, queryTest, readMap, writeMap } from "./cov-map.mjs";
import { KitError, loadInputs, merge } from "./merge.mjs";

const USAGE = 'usage: r2-test-kit merge | cov-map --build | cov-map --test "<substring>" | cov-map --line <file:N>';

export async function main([cmd, flag, value], cwd, log) {
  const config = await loadConfig(cwd);
  try {
    if (cmd === "merge") {
      const { ok, messages } = merge(config, cwd);
      messages.forEach((m) => log(m));
      return ok ? 0 : 1;
    }
    if (cmd === "cov-map" && flag === "--build") {
      writeMap(buildMap(loadInputs(config.inputs, cwd), config.include, cwd), cwd);
      log("cov-map: wrote out/pertest/map.json");
      return 0;
    }
    if (cmd === "cov-map" && flag === "--test" && value) return queryTest(readMap(cwd), value).forEach((l) => log(l)), 0;
    if (cmd === "cov-map" && flag === "--line" && value?.includes(":")) return queryLine(readMap(cwd), value).forEach((l) => log(l)), 0;
  } catch (e) {
    if (!(e instanceof KitError)) throw e;
    log(e.message);
    return 1;
  }
  log(USAGE);
  return 2;
}

/* istanbul ignore next -- the process entry; main() is what the tests run */
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2), process.cwd(), console.log);

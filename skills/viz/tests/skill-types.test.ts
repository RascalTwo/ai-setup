// tests/skill-types.test.ts — the skill's own TypeScript is type-checked (tsconfig.json).
//
// WHY: Bun strips types and never checks them, so without this the skill's own code had 272 type
// errors nobody could see (2026-09-28). tsconfig.json's flags are the STRICT set `viz verify` holds
// vizzes to, so the skill is held to what it asks of everyone else.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseJson } from "./json.ts";
import { STRICT, TSC_PATH } from "../lib/verify/types.ts";

const SKILL = path.dirname(import.meta.dir);

test("Given the skill's own TypeScript, when tsc runs over tsconfig.json, then there are no errors", () => {
  const r = Bun.spawnSync({
    cmd: [process.execPath, TSC_PATH, "-p", "tsconfig.json", "--pretty", "false"],
    cwd: SKILL,
  });
  const errors = (r.stdout.toString() + r.stderr.toString())
    .split("\n")
    .filter((l) => /error TS\d+/u.test(l));
  expect(errors).toEqual([]);
});

test("Given tsconfig.json, when compared with STRICT, then it holds the same flags but for the backend's one deviation", () => {
  const { compilerOptions } = parseJson<{ compilerOptions: Record<string, unknown> }>(
    readFileSync(path.join(SKILL, "tsconfig.json"), "utf8").replace(/^\s*"\/\/".*$/mu, ""),
  );
  for (const [flag, value] of Object.entries(STRICT)) {
    if (flag === "lib") continue; // the skill also runs Bun and drives Chrome: ES2024 + DOM, plus Bun's types
    const want = flag === "noPropertyAccessFromIndexSignature" ? false : value; // `process.env.X`, as for a viz backend
    expect({ flag, value: compilerOptions[flag] }).toEqual({ flag, value: want });
  }
});

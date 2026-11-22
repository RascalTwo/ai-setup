#!/usr/bin/env node
// One round of the loop: the critic judges the screenshots, the round is kept in the run folder,
// and the stop rule says whether to fix and go again.
// Usage: node round.ts <run-dir> [--brief brief.md] [--checks checks.md] [--model sonnet] <shot.png | shots-dir> ...
// The brief and checks are frozen on round 1; later rounds reuse them and refuse different ones.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { critique, type Verdict } from "./critic.ts";

export const CAP = 4; // rounds
export const NOISE = 0.5; // points: the critic's own run-to-run wobble is ~0.2 SD (proof/), so a smaller rise is no rise

type Round = Pick<Verdict, "overall" | "issues" | "checks">;
export type Decision = { stop: boolean; reason: "clean" | "plateau" | "cap" | "continue" };

export function decide(history: Round[]): Decision {
  const n = history.length, last = history[n - 1];
  const serious = last.issues.some((i) => i.severity !== "minor") || last.checks.some((c) => !c.pass);
  if (!serious) return { stop: true, reason: "clean" };
  if (n >= 3 && Math.max(history[n - 1].overall, history[n - 2].overall) - history[n - 3].overall < NOISE) return { stop: true, reason: "plateau" };
  if (n >= CAP) return { stop: true, reason: "cap" };
  return { stop: false, reason: "continue" };
}

// Copies a brief or checks file into the run on round 1; afterwards the frozen copy wins.
function freeze(dir: string, name: string, given?: string): string | undefined {
  const kept = join(dir, name);
  if (existsSync(kept)) {
    if (given && readFileSync(given, "utf8") !== readFileSync(kept, "utf8")) {
      throw new Error(`${name} is frozen for this run (${kept}); the critic's goalposts don't move mid-loop`);
    }
    return readFileSync(kept, "utf8");
  }
  if (!given) return undefined;
  writeFileSync(kept, readFileSync(given, "utf8"));
  return readFileSync(kept, "utf8");
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { brief: { type: "string" }, checks: { type: "string" }, model: { type: "string", default: "sonnet" } },
    allowPositionals: true,
  });
  const [dir, ...args] = positionals;
  // A folder stands for every PNG in it, in name order (what shoot.ts writes).
  const shots = args.flatMap((a) => statSync(a, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(a).filter((f) => f.endsWith(".png")).sort().map((f) => join(a, f)) : [a]);
  if (!dir || !shots.length) {
    console.error("usage: node round.ts <run-dir> [--brief brief.md] [--checks checks.md] [--model sonnet] <shot.png | shots-dir> ...");
    process.exit(2);
  }
  mkdirSync(dir, { recursive: true });
  const past = readdirSync(dir).filter((f) => /^round-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)));
  const history: Round[] = past.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  if (history.length && decide(history).stop) {
    console.error(`this run already stopped (${decide(history).reason}); start a new run folder to go again`);
    process.exit(1);
  }
  const brief = freeze(dir, "brief.md", values.brief);
  const checks = freeze(dir, "checks.md", values.checks);
  const v = await critique(shots, { model: values.model, brief, checks });
  const n = history.length + 1;
  writeFileSync(join(dir, `round-${n}.json`), JSON.stringify({ round: n, shots, ...v }, null, 1));
  history.push(v);
  const d = decide(history);

  const trend = history.map((h) => h.overall).join(" → ");
  console.log(`Round ${n} of at most ${CAP} · overall ${v.overall}/10 (${trend}) · ` +
    Object.entries(v.dims).map(([k, x]) => `${k} ${x}`).join(", "));
  v.issues.forEach((i, k) => console.log(`${k + 1}. [${i.severity.toUpperCase()}] shot ${i.shot} box ${i.box.map(Math.round).join(",")} (${i.dimension}): ${i.what}`));
  v.checks.forEach((c) => console.log(`check ${c.pass ? "PASS" : "FAIL"}: ${c.check}: ${c.note}`));
  const left = v.issues.filter((i) => i.severity !== "minor").length + v.checks.filter((c) => !c.pass).length;
  console.log({
    clean: "STOP clean: no blocker or major issue left, every check passes.",
    plateau: `STOP plateau: the score rose less than ${NOISE} over two rounds; ${left} serious item(s) left for the user.`,
    cap: `STOP cap: ${CAP} rounds done; ${left} serious item(s) left for the user.`,
    continue: "CONTINUE: fix the blocker and major issues above (worst first), re-shoot, run the next round.",
  }[d.reason]);
}

// lib/verify/judge.ts — the jobs that judge the viz's own source after the page is driven: tier, types, lint, format, tests, coverage, spec.
import path from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { vizDirFor } from "../../discovery.ts";
import {
  tierFor,
  runTests,
  measureCoverage,
  ratchet,
  bareIgnores,
  writeReport,
  writeAttribution,
  type TestRun,
  type Coverage,
} from "./tier.ts";
import { writeSpec } from "../testing/spec.ts";
import { stamp, type Capture } from "./capture.ts";
import { checkSource, type StaticChecks } from "./static-checks.ts";
import type { VerifyPart } from "./verify.ts";

/** What the page run learned that decides the testing tier (tier.ts). */
export type JudgeInput = {
  url: string;
  target: string;
  outDir: string;
  parts: ReadonlySet<VerifyPart>;
  live: Set<string>;
  controls: string[];
  updateSnapshots: boolean;
};

/** Every result the report prints; each is null when its job did not run or the viz has nothing for it. */
export type Judgement = StaticChecks & {
  tierDir: string | null;
  tier: ReturnType<typeof tierFor> | null;
  run: TestRun | null;
  coverage: Coverage | null;
};

/** Coverage, only off a green run. */
async function judgeCoverage(tierDir: string, testsOut: string, cap: Capture): Promise<Coverage> {
  const { errors } = cap;
  const unmeasured: string[] = [],
    measured = await measureCoverage(tierDir, testsOut, unmeasured),
    report = path.join(testsOut, "coverage.txt");
  writeReport(tierDir, measured, report);
  writeAttribution(tierDir, measured, report);
  const coverage = ratchet(tierDir, measured, report);
  if (coverage.error) errors.push(`[${stamp()}] COVERAGE: ${coverage.error}`);
  for (const e of bareIgnores(measured)) errors.push(`[${stamp()}] COVERAGE: ${e}`);
  // A silent skip looks exactly like a pass: a script the tests ran but coverage cannot see would leave no floor.
  for (const f of unmeasured)
    errors.push(
      `[${stamp()}] COVERAGE: ${f} ran but cannot be measured: it is TypeScript with no import or export, so it is served as a classic script with no source map. Make it a module — add \`export {};\` and load it with <script type="module">`,
    );
  return coverage;
}

/** Run the viz's own tests and record each failure against the report. */
async function judgeTests(
  tierDir: string,
  files: string[],
  testsOut: string,
  input: JudgeInput,
  cap: Capture,
): Promise<TestRun> {
  mkdirSync(testsOut, { recursive: true });
  const run = await runTests(tierDir, input.url, files, {
    update: input.updateSnapshots,
    out: testsOut,
    target: input.target,
  });
  await Bun.write(path.join(testsOut, "tests.txt"), run.output);
  for (const f of run.failures)
    cap.errors.push(
      `[${stamp()}] TEST FAILED: ${f}  (full output: ${path.join(testsOut, "tests.txt")})`,
    );
  return run;
}

/**
 * The living spec (ADR 0027), beside coverage.html: written from this run's results, or — when the tests did not run
 * this time — from none, so nothing reads green off an earlier run.
 */
function writeLivingSpec(tierDir: string | null, testsRan: boolean, testsOut: string): void {
  if (testsRan) writeSpec(tierDir!, testsOut);
  else if (tierDir && existsSync(path.join(testsOut, "spec.html"))) {
    for (const f of ["junit.xml", "failures.json"]) rmSync(path.join(testsOut, f), { force: true });
    writeSpec(tierDir, testsOut, false);
  }
}

/** Judge the viz's source: the tier, its types, lint and format, its own tests, coverage and the living spec. */
export async function judge(input: JudgeInput, cap: Capture): Promise<Judgement> {
  const { errors } = cap;
  const { url, parts, outDir } = input;
  // Does this viz need its own tests, and has it got them? A remote URL has no folder to look in.
  const tierDir = vizDirFor(url);
  const tier =
    parts.has("test") && tierDir && existsSync(tierDir)
      ? tierFor(tierDir, input.live, input.controls)
      : null;
  if (tier?.error) errors.push(`[${stamp()}] TESTS: ${tier.error}`);
  const checks = checkSource(
    tierDir,
    { types: parts.has("types"), lint: parts.has("lint"), format: parts.has("format") },
    cap,
  );
  // Its own tests, if it has any — whether or not the detector asked for them.
  const testsOut = path.join(outDir, "tests");
  const run = tier?.files.length
    ? await judgeTests(tierDir!, tier.files, testsOut, input, cap)
    : null;
  const coverage =
    run && run.ran && !run.failed ? await judgeCoverage(tierDir!, testsOut, cap) : null;

  writeLivingSpec(tierDir, (tier?.files.length ?? 0) > 0, testsOut);
  return { ...checks, tierDir, tier, run, coverage };
}

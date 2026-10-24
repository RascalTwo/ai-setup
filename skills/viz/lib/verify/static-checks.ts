// lib/verify/static-checks.ts — the viz source's own checks: its types, lint and formatting.
import { existsSync } from "node:fs";
import { typecheck } from "./types.ts";
import { sourceDirFor } from "../copy.ts";
import { format } from "../format/format.ts";
import { lint } from "../lint/lint.ts";
import { stamp, type Capture } from "./capture.ts";

export type StaticChecks = {
  srcDir: string | null;
  types: ReturnType<typeof typecheck>;
  lintRun: ReturnType<typeof lint>;
  formatRun: ReturnType<typeof format>;
};

/** Run the requested checks over the viz's source (a copy is checked at its origin); every finding is an error in the report. */
export function checkSource(
  tierDir: string | null,
  wants: { types: boolean; lint: boolean; format: boolean },
  cap: Capture,
): StaticChecks {
  const { errors } = cap;
  // Its types, if it wrote any (ADR 0023). A type error fails verify like a test does.
  const srcDir = tierDir && existsSync(tierDir) ? sourceDirFor(tierDir) : null; // a copy is checked at its origin (lib/copy.ts)
  const types = wants.types && srcDir ? typecheck(srcDir) : null;
  for (const e of types?.errors ?? []) errors.push(`[${stamp()}] TYPES: ${e}`);
  // Its lint findings. Any finding fails the run.
  const lintRun = wants.lint && srcDir ? lint(srcDir) : null;
  if (lintRun) for (const f of lintRun.findings) errors.push(`[${stamp()}] LINT: ${f}`);
  // Its formatting. An unformatted file fails the run, like a lint finding.
  const formatRun = wants.format && srcDir ? format(srcDir) : null;
  if (formatRun) for (const f of formatRun.findings) errors.push(`[${stamp()}] FORMAT: ${f}`);
  return { srcDir, types, lintRun, formatRun };
}

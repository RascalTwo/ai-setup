// lib/verify/verify.ts — verify's orchestrator: set the run up, drive the page, judge the viz, report.
//
// One run is a linear flow — launch Chrome, load the page, collect console and network, run the layout
// probe, write artifacts, judge — and verifyViz reads as exactly that. Each phase lives in its own file:
// capture.ts (what the page hands back), browse.ts and audit-flow.ts (driving it), audit-page.ts (the
// layout probe), og.ts (--og), judge.ts (tier, types, lint, format, tests, coverage), report.ts and
// commit.ts (the verdict and --commit). It is a function, so it is callable without a subprocess.

import { vizDirFor } from "../../discovery.ts";
import { existsSync } from "node:fs";
import { bool } from "../../cli.ts";
import { PORT, start as startServer } from "../../server-control.ts";
import { browse } from "./browse.ts";
import { prepareOutDir, resolveInteractions } from "./run-dir.ts";
import { errMessage, newCapture, stamp } from "./capture.ts";
import { judge } from "./judge.ts";
import { report } from "./report.ts";
import { commitViz } from "./commit.ts";

/** The jobs `verify` does in one run. `viz audit`, `viz types`, `viz test`, `viz lint` and `viz format` each run one (ADR 0024). */
export type VerifyPart = "audit" | "types" | "test" | "lint" | "format";
const ALL_PARTS: readonly VerifyPart[] = ["audit", "types", "test", "lint", "format"];

export type VerifyOptions = {
  target: string;
  wait?: string;
  full?: boolean;
  og?: boolean;
  size?: string;
  interactions?: string;
  commit?: string;
  json?: boolean;
  /** take each changed screenshot as its new baseline */
  updateSnapshots?: boolean;
  /** which jobs to run; all three by default */
  parts?: readonly VerifyPart[];
};

/** A target is a URL, or a viz id: its path under $HOME, served by the dev server. */
export const targetUrl = (target: string): string =>
  target.includes("://")
    ? target
    : `http://127.0.0.1:${PORT}/${target.replaceAll(/^\/+|\/+$/gu, "")}/`;

/**
 * Why a verb cannot run on this target, or null. A job that cannot find the viz did not pass, and a
 * quiet null result reads as a green line, so the CLI refuses before any job (or any `.verify/`) starts.
 */
export function targetProblem(target: string, parts?: readonly VerifyPart[]): string | null {
  const dir = vizDirFor(targetUrl(target));
  if (dir && !existsSync(dir))
    return `no viz at ${dir}: the target is a viz id (its path under $HOME) or its URL`;
  if (!dir && parts?.some((p) => p !== "audit"))
    return `viz ${parts.join(" ")} needs a viz folder on this machine; ${target} is not one`;
  return null;
}

export async function verifyViz(o: VerifyOptions): Promise<void> {
  const { target, wait, interactions } = o;
  const full = o.full === true;
  const og = o.og === true;
  const parts = new Set<VerifyPart>(o.parts ?? ALL_PARTS);
  const audit = parts.has("audit");
  // The tests need the opening page too: whether a viz needs any is decided by what the page does (tier.ts).
  const browsePage = audit || parts.has("test");
  const flags: Record<string, string | boolean> = o.json ? { json: true } : {};
  const url = targetUrl(target);
  // --og shoots at the 1200x630 card aspect so the auto image needs no cropping.
  const [vw, vh] = (o.size ?? (og ? "1200x630" : "1280x800")).split("x").map(Number);

  const outDir = prepareOutDir(url, audit);
  const interactionsFile = audit ? resolveInteractions(url, interactions) : null;
  const cap = newCapture();

  // A viz id means the local server, so make sure it's up — the same as `viz render`. A URL
  // is taken as given: it may be anywhere. start() is idempotent and accepts any tape mode.
  if (browsePage && !target.includes("://")) {
    await startServer().catch((e: unknown) =>
      cap.errors.push(`[${stamp()}] SERVER: ${errMessage(e)}`),
    );
  }

  let seen = { live: new Set<string>(), controls: [] as string[] };
  if (browsePage) {
    seen = await browse(cap, {
      url,
      outDir,
      interactionsFile,
      full,
      og,
      wait,
      audit,
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- the || is on purpose: a bad --size gives NaN or 0, which ?? would keep
      viewport: { width: vw || 1280, height: vh || 800 },
    });
  }

  const judged = await judge(
    {
      url,
      target,
      outDir,
      parts,
      live: seen.live,
      controls: seen.controls,
      updateSnapshots: o.updateSnapshots === true,
    },
    cap,
  );
  const ok = await report(cap, judged, {
    url,
    outDir,
    parts,
    audit,
    interactionsFile,
    json: bool(flags, "json"),
  });

  if (o.commit !== undefined)
    await commitViz(url, o.commit, cap.errors.length, cap.layout.findings.length);
  // A failing run exits 1, so a script, hook or deploy can stop on it rather than parse the report.
  // oxlint-disable-next-line unicorn/no-process-exit -- the verdict is the exit code (see the comment at the end of verifyViz); this is the CLI entry path
  process.exit(ok ? 0 : 1);
}

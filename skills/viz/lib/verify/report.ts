// lib/verify/report.ts — what verify writes and prints once the run is judged: density, artifacts, the verdict.
import path from "node:path";
import type { Capture } from "./capture.ts";
import type { Judgement } from "./judge.ts";
import { isCopy } from "../copy.ts";
import type { VerifyPart } from "./verify.ts";

/** What the report needs to know about this run besides the capture and the judgement. */
export type ReportContext = {
  url: string;
  outDir: string;
  parts: ReadonlySet<VerifyPart>;
  audit: boolean;
  interactionsFile: string | null;
  json: boolean;
};

/**
 * Visual density — a MEASUREMENT, never a finding. Bars 1 and 5 of the skill's ambition
 * table ask whether meaning lives in space or in sentences; this is the cheapest honest
 * proxy for that (graphical marks per 1k chars of rendered text). It stays out of
 * `layout.findings` on purpose: findings block `--commit`, and a deck and a force graph
 * have legitimately opposite ratios — only the author can see which one this is.
 * The band thresholds are a first calibration guess; the raw inputs are printed next to
 * them so they can be retuned once there are real runs to tune against.
 */
export function densityOf(layout: Capture["layout"]): { band: string; line: string } {
  const perK = layout.words
    ? layout.graphical / (layout.words / 1000)
    : layout.graphical
      ? Infinity
      : 0;
  const band = !layout.graphical
    ? "no graphical marks"
    : perK < 5
      ? "prose-shaped"
      : perK < 20
        ? "mixed"
        : "graphical";
  const line = `visual density: ${layout.graphical} graphical mark(s) · ${layout.words} text chars · ${
    Number.isFinite(perK) ? perK.toFixed(1) : "∞"
  } marks/1k chars → ${band}`;
  return { band, line };
}

/** The audit job's report files: console.txt, network.txt, dom.html. */
async function writeArtifacts(cap: Capture, ctx: ReportContext, density: string): Promise<void> {
  const { errors, lines, network, layout, dom } = cap;
  const { url, outDir } = ctx;
  const header = `verify ${url}  @ ${new Date().toISOString()}\n${errors.length} error(s), ${lines.length} console line(s), ${layout.findings.length} layout finding(s)\n${"=".repeat(60)}\n`;
  const layoutBlock = `LAYOUT (rendered: ${layout.census}):\n${layout.findings.map((f) => "  " + f).join("\n") || "  (clean)"}\n\n${density}\n\n${"-".repeat(60)}\n`;
  const body =
    errors.length > 0
      ? `ERRORS:\n${errors.join("\n")}\n\n${"-".repeat(60)}\n${layoutBlock}FULL CONSOLE:\n${lines.join("\n") || "(none)"}\n`
      : `${layoutBlock}FULL CONSOLE:\n${lines.join("\n") || "(none)"}\n`;
  await Bun.write(path.join(outDir, "console.txt"), header + body);
  await Bun.write(
    path.join(outDir, "network.txt"),
    `network for ${url}\n${network.length} request(s)\n${"=".repeat(60)}\n\n${network.join("\n\n") || "(none)"}\n`,
  );
  await Bun.write(
    path.join(outDir, "dom.html"),
    dom || "<!-- no DOM captured (page failed to load) -->\n",
  );
}

/** The report object `--json` prints; its field order is the contract. */
function buildVerdict(cap: Capture, j: Judgement, ctx: ReportContext, band: string) {
  const { errors, layout, narration, filmSheet } = cap;
  const { url, outDir, parts, audit, interactionsFile } = ctx;
  const { tier, run, coverage, types, lintRun, formatRun } = j;
  return {
    url,
    parts: [...parts],
    ok: errors.length === 0 && layout.findings.length === 0,
    errors,
    layoutFindings: layout.findings,
    rendered: audit ? layout.census : null,
    artifacts: !audit
      ? null
      : {
          dir: outDir,
          console: path.join(outDir, "console.txt"),
          screenshot: path.join(outDir, "latest.png"),
          network: path.join(outDir, "network.txt"),
          dom: path.join(outDir, "dom.html"),
          chapters: filmSheet,
        },
    interactions: interactionsFile ? path.basename(interactionsFile) : null,
    density: audit ? { graphical: layout.graphical, textChars: layout.words, band } : null,
    narration,
    tests: tier && {
      needed: tier.needed,
      why: tier.why,
      optOut: tier.optOut,
      files: tier.files,
      ran: run?.ran ?? 0,
      failed: run?.failed ?? 0,
    },
    coverage,
    // null when the viz has nothing typed; otherwise what the checker saw (errors also appear in `errors`, prefixed TYPES:)
    types: types && { files: types.files, errors: types.errors },
    // null when the viz has nothing to lint; any finding fails the run
    lint: lintRun,
    // null when the viz has nothing to format; any finding fails the run
    format: formatRun,
  };
}

/** The tier line, and the coverage line under it when the tests ran green. */
function printTier(j: Judgement): void {
  const { tier, run, coverage } = j;
  if (!tier) return;
  console.log(
    tier.needed
      ? `${tier.error ? "✗" : "✓"} needs its own tests — ${tier.why.join("; ")}${run ? ` · ${run.ran - run.failed}/${run.ran} test(s) passed` : ""}${run?.baselines.length ? ` · ${run.baselines.length} screenshot baseline(s) saved — look at them, then commit them` : ""}` +
          (coverage
            ? `\n${coverage.error ? "✗" : "✓"} coverage: lines ${coverage.lines}%, branches ${coverage.branches}% (floor ${coverage.floor.lines < 0 ? "none" : `${coverage.floor.lines}% / ${coverage.floor.branches}%`}${coverage.raised ? ", raised" : ""}) · ${
                Object.entries(coverage.files)
                  .map(([f, p]) => `${f} ${p.lines}/${p.branches}`)
                  .join(", ") || "no own scripts measured"
              } · what's missing: ${coverage.report}`
            : "")
      : `✓ smoke run is enough${tier.optOut ? ` (opted out: ${tier.optOut})` : " — nothing on the page is computed from input or live data"}`,
  );
}

/** The types, lint and format lines (and the note for a copy, whose checks ran at its origin). */
function printStaticChecks(j: Judgement): void {
  const { tierDir, srcDir, types, lintRun, formatRun } = j;
  if (tierDir && isCopy(tierDir))
    console.log(
      `◐ a copy of another viz: types, lint, format and tests ${srcDir ? `ran at its origin (${srcDir})` : "belong to its origin, which is not on this machine"}`,
    );
  if (types)
    console.log(
      `${types.errors.length > 0 ? "✗" : "✓"} types: ${types.files.length} file(s) checked, strict${types.errors.length > 0 ? ` — ${types.errors.length} error(s), listed above` : ""}`,
    );
  if (lintRun)
    console.log(
      `${lintRun.findings.length > 0 ? "✗" : "✓"} lint: ${lintRun.files} file(s), ${lintRun.findings.length} finding(s)${lintRun.findings.length > 0 ? ", listed above" : ""}${lintRun.skipped ? ` — ${lintRun.skipped}` : ""}`,
    );
  if (formatRun)
    console.log(
      `${formatRun.findings.length > 0 ? "✗" : "✓"} format: ${formatRun.files} file(s), ${formatRun.findings.length} finding(s)${formatRun.findings.length > 0 ? ", listed above (viz format <viz> --fix)" : ""}${formatRun.skipped ? ` — ${formatRun.skipped}` : ""}`,
    );
}

/** The human-readable report. */
function printReport(
  cap: Capture,
  j: Judgement,
  ctx: ReportContext,
  density: { band: string; line: string },
): void {
  const { errors, layout, narration, filmSheet } = cap;
  const { outDir, audit, interactionsFile } = ctx;
  console.log(
    `${errors.length > 0 ? "✗" : "✓"} ${errors.length} error(s)${interactionsFile ? " (ran " + path.basename(interactionsFile) + ")" : ""}${audit ? ` — ${outDir}/{console.txt, latest.png, network.txt, dom.html}` : ""}`,
  );
  if (errors.length > 0) for (const e of errors.slice(0, 10)) console.log("  " + e);

  // Layout findings go to stdout deliberately: they name the offending selector, so
  // they're actionable WITHOUT opening latest.png. Read the screenshot to judge how
  // it looks, not to hunt for overflow — that's what this is for.
  if (audit) {
    console.log(
      `${layout.findings.length > 0 ? "⚠" : "✓"} ${layout.findings.length} layout finding(s) · rendered: ${layout.census}`,
    );
    for (const f of layout.findings) console.log("  " + f);
  }

  printTier(j);
  printStaticChecks(j);
  if (filmSheet)
    console.log(`🎞 every chapter's last frame, tiled — read it to judge the film: ${filmSheet}`);
  if (narration.length > 0) {
    console.log(`⚠ ${narration.length} narration warning(s)`);
    for (const n of narration) console.log("  " + n);
  }
  if (audit) {
    console.log(`◐ ${density.line}   (informational — never blocks a commit)`);
    if (density.band === "prose-shaped" || density.band === "no graphical marks") {
      console.log(
        "  a page this text-heavy is usually a document with styling on it — check bar 1 of Ambition:",
      );
      console.log(
        "  can you point at a mark and say what its position, size or colour MEANS? If the words genuinely are",
      );
      console.log(
        "  the deliverable (a deck, a written explainer), this line is noise — ignore it and move on.",
      );
    }
  }
}

/** Write the audit artifacts, then print the verdict as JSON or as the human report. Returns whether the run was clean. */
export async function report(cap: Capture, j: Judgement, ctx: ReportContext): Promise<boolean> {
  const density = densityOf(cap.layout);
  if (ctx.audit) await writeArtifacts(cap, ctx, density.line);
  const verdict = buildVerdict(cap, j, ctx, density.band);
  if (ctx.json) console.log(JSON.stringify(verdict, null, 2));
  else printReport(cap, j, ctx, density);
  return verdict.ok;
}

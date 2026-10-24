// lib/verify/audit-flow.ts — the `audit` job's browser work: the narration gate, the opening and after-interaction layout audits, the screenshots.
import path from "node:path";
import type { Page } from "puppeteer-core";
import { vizDirFor } from "../../discovery.ts";
import { compile, readNarration, type Shape } from "../render/narration.ts";
import { listControls } from "./tier.ts";
import { auditPage } from "./audit-page.ts";
import { errMessage, stamp, type Capture } from "./capture.ts";
import { shootOg } from "./og.ts";

/** What the audit job needs to know about this run. */
export type AuditContext = {
  url: string;
  outDir: string;
  /** verify.interactions.{ts,js}: the script that drives the page before the second audit sample */
  interactionsFile: string | null;
  full: boolean;
  og: boolean;
};

/** Narration: compile narration.json here — the authoring gate — so the clips exist for the page to play and an overrunning line is caught while writing, not after a render. */
async function compileNarration(page: Page, cap: Capture, url: string): Promise<void> {
  const { errors, narration } = cap;
  const vizDir = vizDirFor(url);
  const script = vizDir
    ? (() => {
        try {
          return readNarration(vizDir);
        } catch (e) {
          narration.push(errMessage(e));
          return null;
        }
      })()
    : null;
  if (script && !errors.some((e) => e.includes("NAVIGATION FAILED"))) {
    const shape = (await page
      .evaluate(`(() => { const t = window.__viz && window.__viz.timeline;
            return t && { total: t.total, chapters: t.chapters, beats: t.beats }; })()`)
      .catch(() => null)) as Shape | null; // oxlint-disable-line typescript/no-unsafe-type-assertion -- page.evaluate of a string hands back unknown; the shape is what the kit's timeline exposes
    if (!shape?.total)
      narration.push(
        "narration.json needs a timed page — expose window.__viz.timeline (reference/timeline.md)",
      );
    else
      await compile(vizDir!, script, shape).then(
        (p) => narration.push(...p.warnings),
        (e: unknown) => narration.push(errMessage(e)),
      );
  }
}

/** Run the viz's interactions script against the page; a failure is an error in the report, not a crash. */
async function runInteractions(
  page: Page,
  cap: Capture,
  interactionsFile: string,
  outDir: string,
): Promise<void> {
  // shot(name) → an ad-hoc screenshot into .verify/<name>.png, path resolved here so the
  // interactions file never has to know where .verify is (cwd-independent). Returns the path.
  const shot = async (name: string, opts?: { full?: boolean }) => {
    const p = path.join(outDir, `${name.replaceAll(/[^a-z0-9_-]/giu, "_") || "shot"}.png`);
    await page.screenshot({ path: p, fullPage: opts?.full ?? false });
    return p;
  };
  try {
    const mod: unknown = await import(interactionsFile);
    const fn: unknown =
      typeof mod === "object" && mod !== null && "default" in mod ? (mod.default ?? mod) : mod;
    if (typeof fn !== "function")
      throw new Error("must export a default function (page, { shot }) => {...}");
    await Reflect.apply(fn, undefined, [page, { shot, dir: outDir }]); // the user's script: its signature is only this contract
  } catch (e) {
    cap.errors.push(`[${stamp()}] INTERACTIONS FAILED (${interactionsFile}): ${errMessage(e)}`);
  }
}

/** A timed film: shoot the last moment of every chapter and tile them into one sheet — every scene at a glance, which a single opening-frame screenshot can never show. */
async function shootFilmSheet(page: Page, cap: Capture, outDir: string): Promise<void> {
  const chapters = (await page
    .evaluate("window.__viz && window.__viz.timeline && window.__viz.timeline.chapters")
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- page.evaluate of a string hands back unknown; the shape is what the kit's timeline exposes
    .catch(() => null)) as { t0: number; dur: number }[] | null;
  if (!chapters?.length) return;
  await page.setViewport({ width: 1920, height: 1080 });
  await page
    .addStyleTag({
      content: "[data-viz-chrome],#viz-captions,#viz-status,#viz-feedback{display:none!important}",
    })
    .catch(() => {
      /* best-effort */
    });
  for (const [i, c] of chapters.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- chapters are shot in order: seek, then screenshot, one at a time
    await page.evaluate(`window.__viz.timeline.seek(${Math.max(c.t0, c.t0 + c.dur - 0.6)})`);
    // oxlint-disable-next-line no-await-in-loop -- chapters are shot in order: seek, then screenshot, one at a time
    await page.screenshot({
      path: path.join(outDir, `chapter-${String(i + 1).padStart(2, "0")}.png`),
    });
  }
  const cols = Math.min(3, chapters.length);
  const tile = Bun.spawnSync([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-pattern_type",
    "glob",
    "-i",
    path.join(outDir, "chapter-*.png"),
    "-vf",
    `scale=640:-2,tile=${cols}x${Math.ceil(chapters.length / cols)}`,
    "-frames:v",
    "1",
    path.join(outDir, "chapters.png"),
  ]);
  cap.filmSheet = tile.exitCode === 0 ? path.join(outDir, "chapters.png") : null;
  await page.evaluate("window.__viz.timeline.seek(0)");
}

/**
 * The audit job on a loaded page: narration gate, layout audit of the opening frame and (when an
 * interactions script ran) of where it left the page, then the screenshots. Returns the controls
 * of the opening page, which decide the testing tier.
 */
export async function auditLoadedPage(
  page: Page,
  cap: Capture,
  ctx: AuditContext,
): Promise<string[]> {
  const { url, outDir, interactionsFile } = ctx;
  await compileNarration(page, cap, url);

  // Audit the OPENING frame BEFORE the interactions script runs. Until now the only
  // audit ran after it, so adding a verify.interactions.ts silently DELETED opening-frame
  // coverage: a script ending on a modal or a filtered view produced a report describing
  // THAT state, and it is the report that gates --commit. timeline-studio worked around
  // this by hand (its script ended with a setViewport + reload to restore a clean state);
  // nothing told it to, and the workaround died with the file.
  const opening = await auditPage(page);
  const controls = await listControls(page); // the opening page, before an interactions script changes it

  if (interactionsFile) await runInteractions(page, cap, interactionsFile, outDir);

  // Second sample, wherever the interactions left the page. Findings are labelled by
  // state so a fix goes to the right one; the census/density numbers come from the final
  // state so they agree with latest.png, which is also shot from it.
  if (interactionsFile) {
    const after = await auditPage(page);
    const seen = new Set(opening.findings);
    cap.layout = {
      ...after,
      findings: [
        ...opening.findings.map((f) => `[opening] ${f}`),
        ...after.findings.filter((f) => !seen.has(f)).map((f) => `[after interactions] ${f}`),
      ],
    };
  } else {
    cap.layout = opening;
  }

  cap.dom = await page.content();
  await page.screenshot({ path: path.join(outDir, "latest.png"), fullPage: ctx.full });
  await shootFilmSheet(page, cap, outDir);
  if (ctx.og) await shootOg(page, cap, url);
  return controls;
}

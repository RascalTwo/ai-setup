// commands/render.ts — `viz render <start|status|cancel>`: a viz to an mp4.
//
// Every surface starts the same background job and reads the same status (lib/render/jobs.ts);
// `--wait` is a status poll, not a second code path. The mechanism is reference/timeline.md.

import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { cancelJob, jobStatus, startJob, waitJob, type JobStatus } from "../lib/render/jobs.ts";
import { output, fail } from "../lib/output.ts";
import { meta } from "../lib/cli-meta.ts";

function human(s: JobStatus): void {
  const pct = s.frames ? ` ${Math.floor((s.frame / s.frames) * 100)}% (${s.frame}/${s.frames} frames)` : "";
  console.log(`${s.state === "done" ? "✓" : s.state === "running" ? "…" : "✗"} ${s.id} — ${s.state}${pct}`);
  if (s.state === "done") console.log(`  ${s.out}`);
  if (s.error) console.log(`  ${s.error}`);
  for (const w of s.warnings) console.log(`  ⚠️  ${w}`);
  console.log(`  log: ${s.log}`);
}

async function report(s: JobStatus | null, id: string, json: boolean, wait: boolean): Promise<void> {
  if (!s) fail(`no render job ${id}`, 2);
  if (wait && s.state === "running") {
    let last = "";
    s = (await waitJob(s.id, (t) => {
      if (json || !t.frames) return;
      const line = `\r  ${Math.floor((t.frame / t.frames) * 100)}% (${t.frame}/${t.frames})`;
      if (line !== last) process.stderr.write((last = line));
    }))!;
    if (!json && last) process.stderr.write("\n");
  }
  output(json, s, () => human(s!));
  if (["failed", "crashed"].includes(s.state)) process.exit(1);
}

const statusOpts = (c: Command) => c.option("--wait", "block until the job finishes, showing progress").option("--json", "machine-readable output");

export function registerRender(program: Command): void {
  const render = program
    .command("render")
    .description("render a timed viz to an mp4 — a background job you start, then poll");

  statusOpts(render
    .command("start <target>")
    .description("start rendering a viz (id or URL, as for verify); prints the job id at once")
    .option("--fps <n>", "frames per second", "30")
    .option("--size <WxH>", "frame size", "1920x1080")
    .option("--workers <n>", "parallel browsers, each rendering a slice of the frames", String(Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 3)))))
    .option("--duration <seconds>", "length, for a page with no window.__viz.timeline")
    .option("--frozen", "replay the recorded tape instead of the live backend (the server must be in --frozen mode)")
    .option("--out <file.mp4>", "where to write it (default: the job's temp dir)"))
    .action(async (target: string, o: Record<string, string | boolean | undefined>) => {
      const [width, height] = String(o.size).split("x").map(Number);
      const fps = Number(o.fps), workers = Number(o.workers);
      const duration = o.duration === undefined ? undefined : Number(o.duration);
      if (!(width > 0 && height > 0)) fail(`--size wants WxH, got ${o.size}`, 2);
      if (!(fps > 0) || !(workers >= 1) || (duration !== undefined && !(duration > 0))) fail("--fps, --workers and --duration must be positive numbers", 2);
      const s = startJob({
        target, fps, width, height, workers, duration,
        out: o.out ? path.resolve(String(o.out)) : "",
        frozen: o.frozen === true,
      });
      if (!o.wait && !o.json) console.log(`started ${s.id}\n  viz render status ${s.id} [--wait]\n  out: ${s.out}\n  log: ${s.log}`);
      else await report(s, s.id, o.json === true, o.wait === true);
    });

  statusOpts(render
    .command("status <id>")
    .description("progress, output path, warnings and errors of a render job"))
    .action(async (id: string, o: { wait?: boolean; json?: boolean }) => report(jobStatus(id), id, o.json === true, o.wait === true));

  render
    .command("cancel <id>")
    .description("stop a running render job")
    .option("--json", "machine-readable output")
    .action(async (id: string, o: { json?: boolean }) => report(await cancelJob(id), id, o.json === true, false));

  const shape = { mcp: { kind: "tool" as const }, ui: { kind: "drawer" as const } };
  for (const c of render.commands) meta(c, shape);
  meta(render.commands[0], {
    ...shape,
    examples: `
  viz render start my-explainer --wait
      Renders at 1920x1080@30 and blocks with a progress line. Without --wait it
      returns the job id at once; poll it with \`viz render status <id>\`.

  viz render start my-explainer --size 1280x720 --workers 1
      One browser: slower, but no seams — use it if the render warns that seek()
      is not idempotent.

  viz render start css-only-demo --duration 8
      A page with no window.__viz.timeline renders best-effort (CSS/Web Animations
      frozen per frame). An infinitely looping animation needs --duration.`,
  });
}

// lib/render/run.ts — the detached render process. `bun run.ts <job-id>`.
//
// Started only by jobs.ts startJob(). Reads job.json, writes status.json, exits. Its stdout
// and stderr ARE the job log. Everything a caller needs to know goes through status.json.

import { copyFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { jobDir, patchStatus, readStatus, urlFor, type JobStatus, type RenderOptions } from "./jobs.ts";
import { vizDirFor } from "../../discovery.ts";
import { captionsFor, compile, mux, readNarration } from "./narration.ts";
import { concat, launch, open, openPage, probe, renderSegment, onLaunch } from "./capture.ts";
import { start as startServer } from "../../server-control.ts";

const id = process.argv[2]!; // startJob() always passes the job id
const dir = jobDir(id);
const job = (await Bun.file(path.join(dir, "job.json")).json()) as RenderOptions;

// Never overwrite a terminal state: cancel may have landed between two progress ticks.
function update(p: Partial<JobStatus>): void {
  if (readStatus(id)?.state === "running") patchStatus(id, p);
}
// Close every browser (Chrome is in its own process group, nothing else will), then exit —
// which closes ffmpeg's stdin, so it ends too.
async function shutdown(code: number, state?: "cancelled" | "failed", error?: string): Promise<never> {
  if (state) update({ state, ...(error === undefined ? {} : { error }), endedAt: new Date().toISOString() });
  await Promise.allSettled([...open].map((b) => b.close()));
  process.exit(code);
}
process.on("SIGTERM", () => void shutdown(143, "cancelled"));
// Recorded so a reader can still reach them if this process dies without cleaning up.
onLaunch((pid) => update({ browsers: [...(readStatus(id)?.browsers ?? []), pid] }));

const warnings: string[] = [];
function warn(w: string): void {
  if (warnings.includes(w)) return;
  warnings.push(w);
  console.error(`⚠️  ${w}`);
  update({ warnings });
}

try {
  const url = urlFor(job.target);
  // Exactly like viewing (ADR 0003): live unless --frozen, and never a silent fallback.
  // start() refuses rather than pretends if the server is already up in the other mode.
  if (!job.target.includes("://")) await startServer(job.frozen ? "frozen" : undefined);

  const browser = await launch();
  let p;
  try {
    p = await probe(await openPage(browser, url, job.width, job.height), job.duration);
  } finally {
    await browser.close();
  }
  for (const w of p.warnings) warn(w);

  // Narration first: a Kokoro that's down should fail the job before minutes of frames, not after.
  const vizDir = vizDirFor(url);
  const script = vizDir ? readNarration(vizDir) : null;
  const plan = script ? await compile(vizDir!, script, p) : null;
  for (const w of plan?.warnings ?? []) warn(w);

  const frames = Math.round(p.total * job.fps);
  // At least a second of frames per worker: a browser launch costs more than that saves.
  const workers = Math.max(1, Math.min(job.workers, Math.floor(frames / job.fps)));
  update({ frames, frame: 0 });
  console.log(`${p.mode}: ${p.total}s @ ${job.fps}fps = ${frames} frames, ${workers} worker(s) → ${job.out}`);

  let done = 0;
  let lastTick = 0;
  const onFrame = () => {
    done++;
    const now = Date.now();
    if (now - lastTick > 500) { lastTick = now; update({ frame: done }); }
  };
  const per = Math.ceil(frames / workers);
  const slices = Array.from({ length: workers }, (_, k) => ({ from: k * per, to: Math.min(frames, (k + 1) * per), out: path.join(dir, `seg${k}.mp4`) }))
    .filter((s) => s.from < s.to); // ceil() can leave the last worker nothing
  const segments = slices.map((s) => s.out);
  await Promise.all(slices.map((s) =>
    renderSegment({ url, ...s, fps: job.fps, w: job.width, h: job.height, onFrame, warn })));

  const video = path.join(dir, "video.mp4");
  if (segments.length === 1) renameSync(segments[0]!, video);
  else await concat(segments, video, path.join(dir, "segments.txt"));
  if (plan?.cues.length) {
    const captions = await captionsFor(vizDir!, plan, dir);
    await mux({ vizDir: vizDir!, video, plan, captions, total: p.total, out: job.out, tmp: dir });
  } else {
    try { renameSync(video, job.out); } catch { copyFileSync(video, job.out); rmSync(video); } // --out on another volume
  }

  // Chapters: a timed film's chapters become the mp4's own (players list and skip them), plus
  // a "0:00 Title" list beside it — the format YouTube reads from a video's description.
  const chapters = (p as { chapters?: { t0: number; dur: number; title?: string }[] }).chapters;
  if (chapters?.length) {
    const meta = path.join(dir, "chapters.ffmeta");
    const ms = (t: number) => Math.round(Math.min(t, p.total) * 1000);
    await Bun.write(meta, ";FFMETADATA1\n" + chapters.map((c, i) =>
      `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${ms(c.t0)}\nEND=${ms(i < chapters.length - 1 ? chapters[i + 1]!.t0 : p.total)}\ntitle=${(c.title ?? `Chapter ${i + 1}`).replace(/[=;#\\\n]/g, (m) => "\\" + m)}\n`).join(""));
    const tmp = path.join(dir, "chaptered.mp4");
    const chapterArgs = ["ffmpeg", "-y", "-loglevel", "error", "-i", job.out, "-i", meta, "-map", "0", "-map_metadata", "1", "-map_chapters", "1", "-c", "copy"];
    for (const [i, track] of (plan?.tracks ?? []).entries()) chapterArgs.push(`-metadata:s:a:${i}`, `title=${track.label}`);
    chapterArgs.push("-movflags", "+faststart", tmp);
    const ff = Bun.spawn(chapterArgs, { stderr: "inherit" });
    if ((await ff.exited) !== 0) throw new Error("ffmpeg could not add chapters");
    try { renameSync(tmp, job.out); } catch { copyFileSync(tmp, job.out); rmSync(tmp); }
    const stamp = (t: number) => { const s = Math.floor(t); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    await Bun.write(job.out.replace(/\.[^.]+$/, "") + ".chapters.txt", chapters.map((c, i) => `${stamp(i ? c.t0 : 0)} ${c.title ?? `Chapter ${i + 1}`}`).join("\n") + "\n");
  }

  update({ state: "done", frame: frames, endedAt: new Date().toISOString() });
  console.log(`✓ ${job.out}`);
} catch (e) {
  console.error(e);
  await shutdown(1, "failed", (e as Error).message); // one failed worker stops the rest
}

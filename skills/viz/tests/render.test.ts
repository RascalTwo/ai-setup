// tests/render.test.ts — `viz render`, black-box: spawn it, probe the mp4 with ffprobe.
//
// Pages are file:// fixtures, so no server, no library, nothing of the user's is touched.
// Needs Chrome and ffmpeg (as verify does); the narration case also needs Kokoro and
// skips when it isn't running rather than failing a machine that doesn't have it.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJson } from "./json.ts";

const SKILL = path.dirname(import.meta.dir);
const FIX = path.join(SKILL, "tests", "fixtures", "render");
let TMP: string;
type Job = { state: string; warnings: string[]; id: string; pid: number; error: string };
const kokoro = await fetch(
  `${process.env.VIZ_KOKORO_URL ?? "http://127.0.0.1:8880"}/v1/models`,
).then(
  (r) => r.ok,
  () => false,
);

beforeAll(() => {
  TMP = mkdtempSync(path.join(os.tmpdir(), "viz-render-test-"));
});
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function viz(...args: string[]) {
  const p = Bun.spawnSync([process.execPath, path.join(SKILL, "viz.ts"), ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
const render = (url: string, ...flags: string[]) => {
  const r = viz("render", "start", url, "--size", "320x180", "--wait", "--json", ...flags);
  return { ...r, job: parseJson<Job>(r.out) };
};
function probe(file: string, entries: string): string {
  // The chapter track is a stream too, so frame counts are scoped to the video stream.
  const scope = entries.startsWith("stream=nb_read_frames") ? ["-select_streams", "v:0"] : [];
  return Bun.spawnSync(
    [
      "ffprobe",
      "-v",
      "error",
      "-count_frames",
      ...scope,
      "-show_entries",
      entries,
      "-of",
      "csv=p=0",
      file,
    ],
    { stdout: "pipe" },
  )
    .stdout.toString()
    .trim();
}
const frameHash = (file: string, t: number) =>
  Bun.hash(
    Bun.spawnSync(
      [
        "ffmpeg",
        "-v",
        "error",
        "-ss",
        String(t),
        "-i",
        file,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-",
      ],
      { stdout: "pipe" },
    ).stdout,
  ).toString();

describe("viz render", () => {
  test("Given a 3s timeline page, when rendered at 30fps across 3 workers, then the mp4 is exactly 3.000s and 90 frames", () => {
    const out = path.join(TMP, "timeline.mp4");
    const r = render(`file://${FIX}/timeline.html`, "--workers", "3", "--out", out);
    expect(r.job.state).toBe("done");
    expect(r.job.warnings).toEqual([]);
    expect(probe(out, "format=duration")).toBe("3.000000");
    expect(probe(out, "stream=nb_read_frames").replace(/,$/u, "")).toBe("90");
    // the film's chapter becomes the mp4's own, plus a "0:00 Title" list beside it
    expect(probe(out, "chapter=start_time,end_time:chapter_tags=title")).toBe(
      "0.000000,3.000000,only",
    );
    expect(readFileSync(out.replace(/\.mp4$/u, ".chapters.txt"), "utf8")).toBe("0:00 only\n");
  }, 120_000);

  test("Given a seek() that isn't idempotent, when rendered across workers, then it warns about the seams", () => {
    const bad = path.join(TMP, "bad.html");
    writeFileSync(
      bad,
      readFileSync(path.join(FIX, "timeline.html"), "utf8").replace(
        "function seek(t) { cur = t;",
        "let n = 0; function seek(t) { n++; cur = t; box.style.opacity = [1, .6, .3][n % 3];",
      ),
    );
    const r = render(`file://${bad}`, "--workers", "3", "--out", path.join(TMP, "bad.mp4"));
    expect(r.job.warnings.some((w) => w.includes("not idempotent"))).toBe(true);
  }, 120_000);

  test("Given a CSS-only page with no timeline, when rendered, then it takes the animation's length, warns it is best-effort, and the frames move", () => {
    const out = path.join(TMP, "css.mp4");
    const r = render(`file://${FIX}/css-only.html`, "--out", out);
    expect(r.job.state).toBe("done");
    expect(r.job.warnings[0]).toContain("best-effort");
    expect(probe(out, "format=duration")).toBe("2.000000");
    expect(frameHash(out, 0.2)).not.toBe(frameHash(out, 1.8));
  }, 120_000);

  test("Given a running job, when it is cancelled, then status says cancelled and the runner is gone", async () => {
    const started = parseJson<Job>(
      viz(
        "render",
        "start",
        `file://${FIX}/timeline.html`,
        "--fps",
        "60",
        "--workers",
        "1",
        "--json",
      ).out,
    );
    await Bun.sleep(2500);
    expect(parseJson<Job>(viz("render", "cancel", started.id, "--json").out).state).toBe(
      "cancelled",
    );
    await Bun.sleep(1500);
    expect(() => process.kill(started.pid, 0)).toThrow();
  }, 60_000);

  test("Given a cue whose audio points outside the viz folder, when rendered, then the job fails and names the path", () => {
    const dir = path.join(TMP, "escape");
    mkdirSync(dir);
    cpSync(path.join(FIX, "timeline.html"), path.join(dir, "index.html"));
    writeFileSync(
      path.join(dir, "narration.json"),
      JSON.stringify({ cues: [{ at: 0, audio: "../../etc/hosts" }] }),
    );
    const r = render(`file://${dir}/index.html`, "--out", path.join(TMP, "escape.mp4"));
    expect(r.job.state).toBe("failed");
    expect(r.job.error).toContain("outside the viz folder");
  }, 60_000);

  test("Given an unknown job id, when status is asked, then it fails as a usage error", () => {
    expect(viz("render", "status", "nope-123").code).toBe(2);
  });

  test.skipIf(!kokoro)(
    "Given narration.json with an overrunning line, when rendered, then the mp4 has audio + a subtitle track and the overrun is a measured warning",
    () => {
      const dir = path.join(TMP, "narrated");
      mkdirSync(dir);
      cpSync(path.join(FIX, "timeline.html"), path.join(dir, "index.html"));
      writeFileSync(
        path.join(dir, "narration.json"),
        JSON.stringify({
          voices: [{ id: "kokoro" }],
          cues: [
            {
              at: "chapter:1",
              say: "This sentence is far too long to fit inside a three second chapter, so it must overrun.",
            },
          ],
        }),
      );
      const out = path.join(TMP, "narrated.mp4");
      const r = render(`file://${dir}/index.html`, "--out", out);
      expect(r.job.state).toBe("done");
      // video + narration + captions (+ the chapter track, stored as a data stream)
      const streams = probe(out, "stream=codec_type")
        .split("\n")
        .map((l) => l.replace(/,$/u, ""));
      for (const kind of ["video", "audio", "subtitle"]) expect(streams).toContain(kind);
      expect(r.job.warnings.some((w) => /runs [\d.]+s but it has 3\.00s/u.test(w))).toBe(true);
      expect(readFileSync(out.replace(/\.mp4$/u, ".vtt"), "utf8")).toContain("far too long");
    },
    120_000,
  );
});

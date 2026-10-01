import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mux, type Plan } from "../lib/render/narration.ts";

let tmp: string;
beforeAll(() => { tmp = mkdtempSync(path.join(os.tmpdir(), "viz-multitrack-")); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(args: string[]) {
  const p = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
}

describe("multi-voice mux", () => {
  test("Given two synchronized narration plans, when muxed, then each voice is a named audio stream and the first is default", async () => {
    const video = path.join(tmp, "video.mp4");
    const primary = path.join(tmp, "primary.wav");
    const secondary = path.join(tmp, "secondary.wav");
    const out = path.join(tmp, "dual.mp4");
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:a", "pcm_s16le", primary]);
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=0.8", "-c:a", "pcm_s16le", secondary]);
    const plan: Plan = {
      warnings: [],
      cues: [],
      tracks: [
        { id: "kokoro", label: "Kokoro", cues: [{ at: "beat:1", t: 0, dur: 0.5, slotDur: 0.8, src: "primary.wav", gain: 0, text: "Hello" }] },
        { id: "joseph", label: "Joseph", cues: [{ at: "beat:1", t: 0, dur: 0.8, slotDur: 0.8, src: "secondary.wav", gain: 0, text: "Hello" }] },
      ],
    };
    mkdirSync(path.join(tmp, "empty"));
    await mux({ vizDir: tmp, video, plan, captions: [], total: 2, out, tmp: path.join(tmp, "empty") });
    const chapters = path.join(tmp, "chapters.ffmeta");
    const chaptered = path.join(tmp, "chaptered.mp4");
    await Bun.write(chapters, ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2000\ntitle=Overview\n");
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-i", chapters, "-map", "0", "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", "-metadata:s:a:0", "title=Kokoro", "-metadata:s:a:1", "title=Joseph", chaptered]);
    const streams = JSON.parse(run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", chaptered])).streams;
    const audio = streams.filter((s: { codec_type: string }) => s.codec_type === "audio");
    expect(audio.map((s: { tags: { name: string } }) => s.tags.name)).toEqual(["Kokoro", "Joseph"]);
    expect(audio.map((s: { disposition: { default: number } }) => s.disposition.default)).toEqual([1, 0]);
    expect(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", chaptered])).toBe("2.000000");
  });
});

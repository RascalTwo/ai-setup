import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJson } from "./json.ts";
import { compile, mux, type Plan } from "../lib/render/narration.ts";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "viz-multitrack-"));
});
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
    run([
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:r=10:d=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    run([
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-c:a",
      "pcm_s16le",
      primary,
    ]);
    run([
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=0.8",
      "-c:a",
      "pcm_s16le",
      secondary,
    ]);
    const plan: Plan = {
      warnings: [],
      cues: [],
      tracks: [
        {
          id: "harper",
          label: "Harper",
          cues: [
            {
              at: "beat:1",
              t: 0,
              dur: 0.5,
              slotDur: 0.8,
              src: "primary.wav",
              gain: 0,
              text: "Hello",
            },
          ],
        },
        {
          id: "joseph",
          label: "Joseph",
          cues: [
            {
              at: "beat:1",
              t: 0,
              dur: 0.8,
              slotDur: 0.8,
              src: "secondary.wav",
              gain: 0,
              text: "Hello",
            },
          ],
        },
      ],
    };
    mkdirSync(path.join(tmp, "empty"));
    await mux({
      vizDir: tmp,
      video,
      plan,
      captions: [],
      total: 2,
      out,
      tmp: path.join(tmp, "empty"),
    });
    const chapters = path.join(tmp, "chapters.ffmeta");
    const chaptered = path.join(tmp, "chaptered.mp4");
    await Bun.write(
      chapters,
      ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2000\ntitle=Overview\n",
    );
    run([
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-i",
      out,
      "-i",
      chapters,
      "-map",
      "0",
      "-map_metadata",
      "1",
      "-map_chapters",
      "1",
      "-c",
      "copy",
      "-metadata:s:a:0",
      "title=Harper",
      "-metadata:s:a:1",
      "title=Joseph",
      chaptered,
    ]);
    const { streams } = parseJson<{
      streams: { codec_type: string; tags: { name: string }; disposition: { default: number } }[];
    }>(run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", chaptered]));
    const audio = streams.filter((s) => s.codec_type === "audio");
    expect(audio.map((s) => s.tags.name)).toEqual(["Harper", "Joseph"]);
    expect(audio.map((s) => s.disposition.default)).toEqual([1, 0]);
    expect(
      run([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        chaptered,
      ]),
    ).toBe("2.000000");
  });
});

describe("an r2-tts voice", () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });

  test("Given a voices.json profile for others, when a viz compiles, then r2-tts is asked for that audience and its clip becomes the track", async () => {
    const dir = path.join(tmp, "r2tts");
    mkdirSync(dir);
    const argsFile = path.join(dir, "args.json");
    // A stand-in r2_tts.py: records its argv, then writes a half-second tone to --out.
    const fake = path.join(dir, "r2_tts.py");
    writeFileSync(
      fake,
      `import json, subprocess, sys\nopen(${JSON.stringify(argsFile)}, "w").write(json.dumps(sys.argv[1:]))\n` +
        `out = sys.argv[sys.argv.index("--out") + 1]\n` +
        `subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=0.5", out], check=True)\n`,
    );
    writeFileSync(
      path.join(dir, "voices.json"),
      JSON.stringify({
        profiles: [{ id: "me-too", audience: "others", label: "Me too" }],
      }),
    );
    process.env["VIZ_TTS_CONFIG"] = path.join(dir, "voices.json");
    process.env["VIZ_R2TTS"] = fake;
    process.env["VIZ_TRANSCRIBE"] = "/usr/bin/false"; // no word times: the clip still ships
    const plan = await compile(
      dir,
      { voices: [{ id: "me-too" }], cues: [{ at: "beat:1", say: "Hello there", speed: 1.2 }] },
      { total: 3, beats: [{ t0: 0, dur: 3 }] },
    );
    const args = parseJson<string[]>(await Bun.file(argsFile).text());
    expect(args.slice(0, 5)).toEqual(["say", "--audience", "others", "--text", "Hello there"]);
    expect(args).toContain("1.2");
    expect(plan.tracks.map((t) => t.id)).toEqual(["me-too"]);
    expect(plan.tracks[0]?.cues[0]?.src).toEndWith(".mp3");
    expect(plan.tracks[0]?.cues[0]?.dur).toBeCloseTo(0.5, 1);
  });

  test("Given no voices.json, when a viz names no voice or an old phonon one, then each is Harper, the voice for me", async () => {
    const dir = path.join(tmp, "r2tts-builtin");
    mkdirSync(dir);
    const log = path.join(dir, "audiences.txt");
    const fake = path.join(dir, "r2_tts.py");
    writeFileSync(
      fake,
      `import subprocess, sys
a = sys.argv[1:]
open(${JSON.stringify(log)}, "a").write(a[a.index("--audience") + 1] + "\\n")
` +
        `subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=0.3", a[a.index("--out") + 1]], check=True)\n`,
    );
    process.env["VIZ_TTS_CONFIG"] = path.join(dir, "none.json");
    process.env["VIZ_R2TTS"] = fake;
    process.env["VIZ_TRANSCRIBE"] = "/usr/bin/false";
    const shape = { total: 3, beats: [{ t0: 0, dur: 3 }] };
    const plain = await compile(dir, { cues: [{ at: "beat:1", say: "One" }] }, shape);
    const old = await compile(
      dir,
      { voices: [{ id: "phonon" }, { id: "joseph" }], cues: [{ at: "beat:1", say: "Two" }] },
      shape,
    );
    expect(plain.tracks.map((t) => t.label)).toEqual(["Harper"]);
    expect(old.tracks.map((t) => t.label)).toEqual(["Harper", "Joseph"]);
    expect((await Bun.file(log).text()).trim().split("\n")).toEqual(["me", "me", "others"]);
  });
});

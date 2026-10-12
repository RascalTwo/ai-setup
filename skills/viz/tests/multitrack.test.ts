import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
          id: "kokoro",
          label: "Kokoro",
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
      "title=Kokoro",
      "-metadata:s:a:1",
      "title=Joseph",
      chaptered,
    ]);
    const { streams } = parseJson<{
      streams: { codec_type: string; tags: { name: string }; disposition: { default: number } }[];
    }>(run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", chaptered]));
    const audio = streams.filter((s) => s.codec_type === "audio");
    expect(audio.map((s) => s.tags.name)).toEqual(["Kokoro", "Joseph"]);
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

// A stand-in for `python -m mlx_audio.server`: answers /openapi.json and /v1/audio/speech.
const listening = async (port: number) => {
  const up = await fetch(`http://127.0.0.1:${port}/openapi.json`).then(
    (r) => r.ok,
    () => false,
  );
  return up;
};

describe("a Qwen3 voice through the mlx-audio server", () => {
  const narration = { voices: [{ id: "joseph" }], cues: [{ at: "beat:1", say: "Hello there" }] };
  const shape = { total: 3, beats: [{ t0: 0, dur: 3 }] };
  const saved = process.env["VIZ_TTS_CONFIG"];
  let wav: string;
  beforeAll(() => {
    wav = path.join(tmp, "clone.wav");
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
      wav,
    ]);
  });
  afterAll(() => {
    if (saved === undefined) delete process.env["VIZ_TTS_CONFIG"];
    else process.env["VIZ_TTS_CONFIG"] = saved;
  });

  function configure(name: string, url: string, python?: string): string {
    const dir = path.join(tmp, name);
    mkdirSync(dir);
    const profile = {
      id: "joseph",
      engine: "qwen3",
      label: "Joseph",
      url,
      python,
      referenceWav: wav,
      transcript: "the words in the reference",
    };
    writeFileSync(path.join(dir, "voices.json"), JSON.stringify({ profiles: [profile] }));
    process.env["VIZ_TTS_CONFIG"] = path.join(dir, "voices.json");
    return dir;
  }

  test("Given a server already listening, when a viz compiles, then it is sent the reference clone and is left running", async () => {
    const seen: Record<string, unknown>[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        if (new URL(req.url).pathname === "/openapi.json") return Response.json({});
        seen.push(parseJson<Record<string, unknown>>(await req.text()));
        return new Response(Bun.file(wav));
      },
    });
    try {
      const plan = await compile(
        configure("existing", `http://127.0.0.1:${server.port}`),
        narration,
        shape,
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        input: "Hello there",
        ref_audio: wav,
        ref_text: "the words in the reference",
        temperature: 0,
        lang_code: "English",
        response_format: "wav",
      });
      expect(plan.tracks.map((t) => t.id)).toEqual(["joseph"]);
      expect(plan.tracks[0]!.cues[0]!.dur).toBeCloseTo(0.5, 1);
      expect(await listening(server.port!)).toBe(true);
    } finally {
      await server.stop(true);
    }
  });

  test("Given nothing listening, when a viz compiles, then a server is started with the profile's python and stopped afterwards", async () => {
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = probe.port!;
    await probe.stop(true);
    const fake = path.join(tmp, "fake-server.ts");
    writeFileSync(
      fake,
      `Bun.serve({ port: +process.argv[2]!, hostname: "127.0.0.1", fetch: (r) => new URL(r.url).pathname === "/openapi.json" ? Response.json({}) : new Response(Bun.file(${JSON.stringify(wav)})) });\n`,
    );
    const python = path.join(tmp, "fake-python");
    writeFileSync(
      python,
      `#!/bin/sh\n# argv: -m mlx_audio.server --host H --port P\nexec ${process.execPath} ${fake} "$6"\n`,
    );
    chmodSync(python, 0o755);
    const plan = await compile(
      configure("spawned", `http://127.0.0.1:${port}`, python),
      narration,
      shape,
    );
    expect(plan.tracks[0]!.cues[0]!.dur).toBeCloseTo(0.5, 1);
    // oxlint-disable-next-line no-await-in-loop -- polling: each check must wait for the previous sleep
    for (let i = 0; i < 20 && (await listening(port)); i++) await Bun.sleep(100);
    expect(await listening(port)).toBe(false);
  });
});

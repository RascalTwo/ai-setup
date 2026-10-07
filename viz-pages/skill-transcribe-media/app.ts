import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "PROBE FOR AN ENGINE",
    rows: [
      ["parakeet-mlx + arm64", "first choice", "ok"],
      ["mlx_whisper + arm64", "fallback", "ok"],
      ["onnx-asr parakeet / whisper.cpp", "elsewhere", "ok"],
      ["none installed", "TRANSCRIBE_FAILED", "bad"],
    ],
    lede: "<code>select_engine()</code> walks <code>ENGINE_ORDER</code> probing capability, never the platform — so a broken upgrade downgrades the engine instead of killing the skill.",
  },
  {
    t: "MIX AND LEVEL THE AUDIO",
    rows: [
      ["ffprobe -select_streams a", "N tracks", "ok"],
      ["amix=inputs=N", "all of them", "ok"],
      ["loudnorm=I=-16:TP=-1.5:LRA=11", "-36dB → -16 LUFS", "ok"],
      ["-ac 1 -ar 16000", "audio.wav", "ok"],
    ],
    lede: "ffmpeg's default stream pick takes <b>one</b> track, and on a screen recording that may be the silent one. Every track is named explicitly, then levelled — quiet audio is what Whisper hallucinates on.",
  },
  {
    t: "RECOGNISE",
    rows: [
      ["parakeet-mlx", "120 s windows, 15 s overlap", "ok"],
      ["onnx parakeet", "60 s chunks cut at pauses", "ok"],
      ["mlx_whisper --condition-on-previous-text", "False", "ok"],
      ["stdout+stderr", "engine.log", "ok"],
    ],
    lede: "Parakeet was trained to stay silent over silence. When Whisper runs, <code>--condition-on-previous-text False</code> is a <b>default</b>, not a remedy — feeding each window's output back as the next window's prompt is what lets a loop sustain itself.",
  },
  {
    t: "NORMALISE THE SHAPE",
    rows: [
      ["parakeet raw json", "kept as .parakeet.json", "ok"],
      ["parakeet / whisper.cpp tokens", "merged to words", "ok"],
      ["their json layouts", "Whisper's schema", "ok"],
      ["mlx_whisper output", "already that shape", "ok"],
    ],
    lede: "<code>parakeet_to_result()</code> and <code>whisper_cpp_to_result()</code> rewrite the other engines' output into <code>{text, segments, language}</code>, so no caller ever branches on which binary ran.",
  },
  {
    t: "REFUSE A LOOP",
    rows: [
      ["identical lines in a row", "≥ 50", "bad"],
      ["over total lines", "≥ 20", "bad"],
      ["real transcripts peak at", "~36", "ok"],
      ["partial output", "kept", "ok"],
    ],
    lede: "The last defence, and the one that matters: a looped transcript is <b>structurally perfect</b>. <code>check_not_stuck()</code> reads the words, because nothing else would have noticed.",
  },
  {
    t: "PRINT THE PATH",
    rows: [
      ["audio.wav (~100MB/hr)", "unlinked in finally", "ok"],
      ["[transcribe-media OK] …", "stderr", "ok"],
      ["the transcript path", "stdout, last line", "ok"],
      ["on failure", "exit non-zero", "bad"],
    ],
    lede: "The wav goes on <b>every</b> exit path including interrupt. The path alone on stdout is why <code>| tail -1</code> is a contract other skills can build on.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c5);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "pipe" });
$("#next")!.addEventListener("click", () => st.next());
$("#prev")!.addEventListener("click", () => st.prev());
const play = $("#play")!;
let on = false;
play.addEventListener("click", () => {
  on = !on;
  if (on) st.play();
  else st.pause();
  play.textContent = on ? "❚❚ pause" : "▶ play";
});
const stopPlay = (): void => {
  on = false;
  play.textContent = "▶ play";
};
for (const el of [$("#next")!, $("#prev")!]) el.addEventListener("click", stopPlay);

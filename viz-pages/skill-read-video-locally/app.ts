import { stepper, $ } from "@viz/kit";

type Row = [label: string, value: string, status: "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "DECIDE THE MODE",
    rows: [
      ["ffprobe: any audio stream?", "yes / no", "ok"],
      ["ffmpeg -af volumedetect", "mean_volume dB", "ok"],
      ["SILENCE_DB", "-50.0", "ok"],
      ["muted-but-present track", "silent", "bad"],
    ],
    lede: "The mode is <b>measured</b>, never declared. A screen capture recorded with a mic attached has an audio stream and nothing on it — which is why the dB threshold exists and a stream check alone would not do.",
  },
  {
    t: "HEAR IT (NARRATED ONLY)",
    rows: [
      ["../transcribe-media/transcribe.sh", "--format json", "ok"],
      ["segments[].words[]", "{start,end,word}", "ok"],
      ["whisper CLI", "fallback", "ok"],
      ["step throws", "warn, continue silent", "bad"],
    ],
    lede: "The hearing half is a sibling skill, not a reimplementation. And it is <b>best-effort</b>: a Whisper failure downgrades the run to silent mode on stderr rather than ending it.",
  },
  {
    t: "BUILD THE PROMPT",
    rows: [
      ["narrated", "text + [m:ss.t] per word", "ok"],
      ["silent + --question", "enumeration framing", "ok"],
      ["--timeline", "dense captioning", "ok"],
      ["silent, no question", "RVL_FAILED", "bad"],
    ],
    lede: 'The narration is emitted <b>twice</b> — plain for readability, word-stamped so "look at <em>this</em>" can be grounded to a frame. Silent mode\'s per-frame walk is the fix for lazy motion verdicts.',
  },
  {
    t: "PICK FRAMES",
    rows: [
      ["duration ≥ 20s + crv on PATH", "crv", "ok"],
      ["under 20s", "uniform", "ok"],
      ["cache key", "sha1(path:mtime:size)[:16]", "ok"],
      ["CRV_NO_MEMORY", "1 unless --remember", "ok"],
    ],
    lede: "Duration stands in for the question, because sniffing the question is brittle. Output caches under <code>~/.agents/state/read-video-locally/cache/crv/</code>; crv's own corpus at <code>~/.crv/memory.db</code> stays untouched by default.",
  },
  {
    t: "TILE AND READ",
    rows: [
      ["crv path", "numbered contact sheets", "ok"],
      ["tile #n → timestamp", "in the prompt", "ok"],
      ["24 raw stills", "14 repeated captions", "bad"],
      ["mlx_vlm.generate", "temp 0, rep-penalty 1.05", "ok"],
    ],
    lede: "Sheets, not loose stills — measured. And the prefix warns that tiles are <b>not evenly spaced</b>, so any duration must come from subtracting timestamps rather than counting tiles.",
  },
  {
    t: "CHECK FOR A LOOP",
    rows: [
      ["strip index/timestamp/markdown", "then compare", "ok"],
      ["SequenceMatcher ratio", "≥ 0.93", "ok"],
      ["run length", "≥ 4", "bad"],
      ["exact-match check", "misses failure #2", "bad"],
    ],
    lede: "<code>looks_degenerate()</code> compares consecutive line <em>bodies</em> for near-identity. Equality is not enough: the second measured failure only changed an ordinal.",
  },
  {
    t: "RETRY, THEN ANSWER",
    rows: [
      ["order", "[first, the other]", "ok"],
      ["they fail on opposite content", "recovery", "ok"],
      ["[read-video-locally OK] …", "then the text", "ok"],
      ["both exhausted", "RVL_FAILED, exit 3", "bad"],
    ],
    lede: "The retry is the real router. Whichever way the duration proxy guessed wrong, the counterpart sampler is exactly the one that recovers it — so the wrong guess costs time, not the answer.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
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

import { stepper, $ } from "@viz/kit";

type Row = [key: string, value: string, status: "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "PROBE FOR SUBTITLE STREAMS",
    rows: [
      ["-select_streams s", "subtitles only", "ok"],
      ["codec_name", "webvtt / subrip / ass", "ok"],
      ["tags.language, tags.title", "if present", "ok"],
      ["empty array", "no track", "bad"],
    ],
    lede: "Look before you listen. <code>-select_streams s</code> makes an empty result a <b>definite</b> answer rather than something inferred from a wall of container metadata.",
  },
  {
    t: "CHOOSE THE STREAM",
    rows: [
      ["one stream", "used automatically", "ok"],
      ["several", "listed, you pick", "ok"],
      ["default", "0", "ok"],
    ],
    lede: "The codec and language from the probe are printed back, so the choice is informed. This is the only question the skill asks you.",
  },
  {
    t: "EXTRACT — WEBVTT FIRST",
    rows: [
      ["-map 0:s:$N", "Nth subtitle stream", "ok"],
      ["-c:s webvtt", "keeps <v Speaker>", "ok"],
      ["-c:s srt", "fallback, loses speakers", "bad"],
      ["trial target", "pipe:1", "ok"],
    ],
    lede: "WebVTT carries <code>&lt;v Speaker&gt;</code> voice tags and SRT does not — Meet captions are WebVTT internally, so converting down would throw the speaker names away.",
  },
  {
    t: "OR: NO TRACK AT ALL",
    rows: [
      ["file is already local", "so: listen", "ok"],
      ["transcribe-media --format vtt", "same shape out", "ok"],
      ["speaker attribution", "not recoverable", "bad"],
      ["still in the Drive player", "wrong skill", "bad"],
    ],
    lede: "An empty probe is a <b>branch</b>, not a failure. It hands off to a sibling skill rather than growing an ASR engine of its own.",
  },
  {
    t: "SAVE",
    rows: [
      ["recording.mp4", "→ recording.vtt", "ok"],
      ["beside the input", "unless told otherwise", "ok"],
      ["source file", "never modified", "ok"],
      ["anything cached", "no", "ok"],
    ],
    lede: "One file out, where you can see it. Nothing under <code>~/.agents/</code>, nothing remembered — run two does not know run one happened.",
  },
  {
    t: "REPORT WITH A PREVIEW",
    rows: [
      ["path, format, size", "reported", "ok"],
      ["first few cues", "shown", "ok"],
      ["size alone", "proves nothing", "bad"],
      ["garbled track", "-c:s copy to inspect", "ok"],
    ],
    lede: "The only real verification in the sequence. A clean extraction and a mojibake one are <b>indistinguishable</b> by size, exit code or extension — only the cues tell you.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number) => {
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "flow" });
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

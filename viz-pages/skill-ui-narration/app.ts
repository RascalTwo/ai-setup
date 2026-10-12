import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Beat {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Beat[] = [
  {
    t: "0 ms · ENSURE THE OVERLAY",
    rows: [
      ["built lazily, on first use", "not at inject", "ok"],
      ["document.body at document-start", "null", "bad"],
      ["ready() polls every 30ms", "until body exists", "ok"],
      ["cursor restored to (cx, cy)", "no teleport", "ok"],
    ],
    lede: "Laziness is load-bearing. The recorder injects with <code>evaluateOnNewDocument</code>, which runs before <code>body</code> exists — touching it at top level would leave <code>__narrate</code> undefined on <b>every</b> page.",
  },
  {
    t: "0 ms · FRAME THE TARGET",
    rows: [
      ["borderTopLeftRadius", "copied from the element", "ok"],
      ["padding", "8px", "ok"],
      ["a plain rectangle", "reads as a bug on a pill", "bad"],
    ],
    lede: "The frame goes on <b>before</b> the cursor moves, so the viewer knows what is about to happen rather than working it out afterwards. Matching the corner radius is the detail nobody gets first try.",
  },
  {
    t: "0 → 950 ms · GLIDE",
    rows: [
      ["setTimeout(step, 16)", "the tween", "ok"],
      ["requestAnimationFrame", "throttled in background tabs", "bad"],
      ["a CSS transition", "ring drifts off the cursor", "bad"],
      ["easing", "ease-in-out", "ok"],
    ],
    lede: "Both obvious implementations are wrong. rAF <b>silently stalls</b> headless; a CSS transition lags behind what it is chasing, so the cursor and its pulse visibly separate.",
  },
  {
    t: "950 → 1500 ms · HOLD",
    rows: [
      ["CFG.hold", "550ms of nothing", "ok"],
      ["faster", "eye can't track it", "bad"],
      ["slower", "the capture drags", "bad"],
    ],
    lede: "Dead time, on purpose. The eye has to <b>arrive</b> at the target before anything else moves, or the click reads as having happened somewhere the viewer wasn't looking.",
  },
  {
    t: "1500 ms · THE CLICK",
    rows: [
      ["hideBox() first, no fade", "or it ghosts onto the next page", "ok"],
      ["clickPulse", "420ms ring to r=44", "ok"],
      ["cursorPress", "0.7× from origin 4px 2px", "ok"],
      ["el.click()", "hits the wrapper, does nothing", "bad"],
    ],
    lede: "<code>realClick</code> resolves <code>elementFromPoint</code> and fires the whole pointer sequence — because component libraries nest the real node inside the one you matched.",
  },
  {
    t: "1500 → 2800 ms · LET IT ANSWER",
    rows: [
      ["CFG.afterClick", "1300ms", "ok"],
      ["the app's response", "visible to the viewer", "ok"],
      ["next beat's waitFor", "never assume ready", "ok"],
    ],
    lede: "The beat is not over when the click lands. An early next-click is the most common way a take breaks, which is why <code>waitFor</code> exists and why this pause is this long.",
  },
  {
    t: "ALONGSIDE · THE CUE LOG",
    rows: [
      ["say() pushes {t, text}", "even when hidden", "ok"],
      ["captionsT0()", "zeroes the clock", "ok"],
      ["cue ends at the next cue", "capped 6s", "ok"],
      ["900ms minimum on every cue", "made them overlap", "bad"],
    ],
    lede: "One take, two deliverables: burned-in captions <b>or</b> a clean capture plus a complete <code>.vtt</code>. The sidecar is whole either way, because cues log while the band is hidden.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "beat" });
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

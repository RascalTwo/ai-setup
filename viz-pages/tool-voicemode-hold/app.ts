import { stepper, $ } from "/_kit/viz.js";

const SAID = "so the migration runs in two phases, and the first one only writes the shadow table, which means you can roll it back without".split(" ");
const RUNUP_WORDS = 18;   // what an interjection carries back with it
const NOW  = "touch​ing";
const SOON = " the live rows at all — after that the cutover is a single flag, and the old path stays warm for a week.";

// Each step: how much of SAID has been spoken, the pane's label, and the you-panel.
interface Step {
  cut: number;
  bar: [string, string];
  rt: string;
  now: boolean;
  runup?: boolean;
  gap?: [string, string];
  lede: string;
}

const STEPS: Step[] = [
  { cut: 14, bar: ["🔊 SPEAKING", "var(--c5)"], rt: "1:12 LEFT", now: false,
    lede: "The pane highlights each word as it is actually played. Position through the text <b>is</b> elapsed time — nothing here is a progress bar." },
  { cut: SAID.length, bar: ["⏸ HELD MID-WORD", "var(--warn)"], rt: "0:41 LEFT", now: true, runup: true,
    lede: "<b>prefix+j.</b> A pause goes down the control socket, the voice stops mid-word, and the pane freezes on exactly that word. The turn has not ended." },
  { cut: SAID.length, bar: ["🎙 MIC OPEN", "var(--good)"], rt: "HOLDING", now: true, runup: true,
    gap: ["YOU, INTO THE GAP", "“no — roll it back how?”"],
    lede: "The mic is open and recording. The pane stays frozen, so you can read the line you stopped on while you talk." },
  { cut: SAID.length, bar: ["🔊 SPEAKING", "var(--c5)"], rt: "0:41 LEFT", now: true, runup: true,
    gap: ["SENT WITH RUN-UP", "“no — roll it back how?”<br><em>+ the last 18 words actually spoken</em>"],
    lede: "<b>prefix+j again.</b> The mic closes, resume goes down the socket, and the voice carries on <b>from the same word</b>. The karaoke clock is shifted by exactly how long the hold lasted." },
  { cut: SAID.length, bar: ["✓ DELIVERED", "var(--accent)"], rt: "NEXT TURN", now: true, runup: true,
    gap: ["hookSpecificOutput.additionalContext", "the only channel back — you spoke long after<br><em>the tool call went out</em>"],
    lede: "On the next <code>PostToolUse</code>, the interjection drains into <code>additionalContext</code> with its run-up attached. Now “it” has a referent." },
];

const bar = $("#s-bar")!, utt = $("#s-utt")!, gap = $("#s-gap")!,
      gapK = $("#s-gap-k")!, gapV = $("#s-gap-v")!, lede = $("#s-lede")!, pos = $("#s-pos")!;

function render(i: number): void {
  const s = STEPS[i]!;
  bar.innerHTML = `<span style="color:${s.bar[1]}">${s.bar[0]}</span><span style="color:var(--faint);letter-spacing:.08em">${s.rt}</span>`;
  const spoken = SAID.slice(0, s.cut);
  const rest = SAID.slice(s.cut).join(" ");
  // the run-up is the tail of what has ACTUALLY been spoken, so it moves with the cursor
  const head = s.runup ? spoken.slice(0, Math.max(0, spoken.length - RUNUP_WORDS)).join(" ") : spoken.join(" ");
  const tail = s.runup ? spoken.slice(Math.max(0, spoken.length - RUNUP_WORDS)).join(" ") : "";
  utt.innerHTML =
    `<span class="said">${head}</span>` + (tail ? ` <span class="said ru">${tail}</span>` : "") +
    (s.now ? ` <span class="now">${NOW}</span>` : (rest ? ` <span class="now">${SAID[s.cut]}</span>` : "")) +
    `<span class="soon">${s.now ? SOON : " " + SAID.slice(s.cut + 1).join(" ") + SOON}</span>` +
    (s.runup ? `<div class="runup-cap"><span class="dash">▁▁</span> RUN-UP · THE LAST ${RUNUP_WORDS} WORDS ACTUALLY SPOKEN</div>` : "");
  if (s.gap) { gap.style.display = ""; gapK.textContent = s.gap[0]; gapV.innerHTML = s.gap[1]; }
  else gap.style.display = "none";
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${STEPS.length}`;
}

const st = stepper({ n: STEPS.length, onStep: render, autoplayMs: 2600, hashKey: "hold" });
$("#s-next")!.onclick = () => st.next();
$("#s-prev")!.onclick = () => st.prev();
const playBtn = $("#s-play")!;
let playing = false;
playBtn.onclick = () => {
  playing = !playing;
  if (playing) { st.play(); playBtn.textContent = "❚❚ pause"; }
  else { st.pause(); playBtn.textContent = "▶ play"; }
};
// a manual nav pauses autoplay inside stepper() — keep the button honest about it
for (const el of [$("#s-next")!, $("#s-prev")!])
  el.addEventListener("click", () => { playing = false; playBtn.textContent = "▶ play"; });

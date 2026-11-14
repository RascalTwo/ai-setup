import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "WRITE THE STEPS",
    rows: [
      ["{ id, say, target }", "one object per step, as data", "ok"],
      ["done: { sel, value }", "or { sel, text } or { sel }", "ok"],
      ["a done on every step the user acts on", "so the tour follows them", "ok"],
      ["say what is right", "refused: say where to look", "bad"],
    ],
    lede: "Give a step a <b>done</b> whenever the user does something on it. Leave it out only where they just read.",
  },
  {
    t: "WIRE IT IN",
    rows: [
      ["real app", "npm --save-exact driver.js@1.10.2", "ok"],
      ["injected walkthrough", "vendor/ copy, no network", "ok"],
      ["re-theme", "--tour-* variables", "ok"],
      ["a loose version range", "refused: pinned", "bad"],
    ],
    lede: "Both routes use the same <b>tour.js</b> and <b>theme.css</b>. Injected tours report steps to the page with <b>onStep</b> and <b>onDone</b>.",
  },
  {
    t: "THE USER ACTS, THE TOUR MOVES ON",
    rows: [
      ["watcher polls done", "every 300 ms", "ok"],
      ["done holds", "moveNext()", "ok"],
      ["skip ›", "always available", "ok"],
      ["blocking the app behind", "refused: it stays clickable", "bad"],
    ],
    lede: "driver.js only has <b>advanceOnClick</b>. The watcher is what lets picking a select option or typing end a step.",
  },
  {
    t: "PROVE IT IN A BROWSER",
    rows: [
      ["first bubble", "shows on its target", "ok"],
      ["each done action", "moves the tour on by itself", "ok"],
      ["click outside the target", "still reaches the app", "ok"],
      ["pressing Next to get there", "refused: does not count", "bad"],
    ],
    lede: "Done when every step was reached by <b>doing its action</b>, and the last step ends the tour.",
  },
  {
    t: "UPGRADE CHECKS",
    rows: [
      ["bump driver.js", "on purpose, with vendor/ replaced", "ok"],
      ["UPGRADE CHECK rules", "overlay path stroke, pointer-events", "ok"],
      ["amber edge still glides", "re-checked", "ok"],
      ["trusting a release's notes", "refused: they miss these", "bad"],
    ],
    lede: "Two theme rules lean on driver's internals, and a release can change them <b>without saying so</b>. Re-run step 4 after any bump.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "flow" });
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

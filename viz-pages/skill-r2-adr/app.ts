import { stepper, need } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "CONSULT",
    rows: [
      ["ls docs/adr/", "11 files", "ok"],
      ["titles touching this change", "2 read", "ok"],
      ["going against one", "needs a new reason", "bad"],
    ],
    lede: "Before changing how something works, <b>list <code>docs/adr/</code> and read every ADR whose title touches it.</b> Follow them. Going against one is allowed, but the new reason must be recorded in an ADR that supersedes it.",
  },
  {
    t: "DECIDE",
    rows: [
      ["follows an existing pattern or ADR", "no ADR", "ok"],
      ["a dependency, pattern or convention", "ADR", "bad"],
      ["rejected the obvious approach", "ADR", "bad"],
      ["a constraint the code can't show", "ADR", "bad"],
    ],
    lede: "The trigger is <b>would another developer ask “why didn't you just…?”</b> If nothing this change decides qualifies, the flow stops here. No asking the user either way.",
  },
  {
    t: "WRITE",
    rows: [
      ["upstream/assets/templates/adr-simple.md", "filled in", "ok"],
      ["Status: Accepted, 2026-11-13", "added under the H1", "ok"],
      ["2026-11-13-run-builds-in-worktrees.md", "dated today", "ok"],
      ["same commit as the code", "required", "ok"],
    ],
    lede: "Upstream's template supplies the sections. <b>Our rules supply the filename and the Status line</b>, because the record has to carry its own status when nobody merges a pull request to accept it.",
  },
  {
    t: "SUPERSEDE",
    rows: [
      ["new ADR → More Information", "links the old file", "ok"],
      ["old ADR → Status", "Superseded by [new](new)", "ok"],
      ["old decision text", "left as it was", "ok"],
      ["editing the old decision", "not allowed", "bad"],
    ],
    lede: "Only when replacing a decision. <b>Both records link each other</b>, and the old one's body is never rewritten, so history stays readable.",
  },
  {
    t: "LINT",
    rows: [
      ["bun ~/.claude/skills/r2-adr/scripts/adr-lint.ts", "from the repo root", "ok"],
      ["clean run", "prints ok, exit 0", "ok"],
      ["any problem", "one line each, exit 1", "bad"],
    ],
    lede: "Done when it prints <code>ok</code>. A failure names the file and the rule it broke, and the same script runs in pre-commit and CI.",
  },
  {
    t: "HAND OVER",
    rows: [
      ["handover or PR body", "names every ADR added", "ok"],
      ["superseded ADRs", "named too", "ok"],
      ["a wrong ADR", "user deletes it in review", "ok"],
    ],
    lede: "<b>“Recorded <code>docs/adr/2026-11-13-run-builds-in-worktrees.md</code>.”</b> That sentence is the whole approval step: the agent decided, the human can see it, and one deleted file undoes it.",
  },
];

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");
const render = (i: number): void => {
  const s = S[i];
  if (!s) return; // the stepper only asks for 0 … n-1
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--warn)"};text-align:right">${st === "ok" ? "✓" : "→"} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3000, hashKey: "flow" });
need("#next").addEventListener("click", () => st.next());
need("#prev").addEventListener("click", () => st.prev());
const play = need("#play");
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
for (const el of [need("#next"), need("#prev")]) el.addEventListener("click", stopPlay);

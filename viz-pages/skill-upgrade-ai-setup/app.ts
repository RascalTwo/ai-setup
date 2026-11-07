import { stepper, need } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "SET THE WINDOW",
    rows: [
      ["last line of runs.jsonl", "start = its window end", "ok"],
      ["no log yet", "start = 7 days ago", "ok"],
      ["runs.test-*.jsonl", "ignored", "ok"],
    ],
    lede: "The window starts where the last real run ended, so the cadence is whatever the calendar says.",
  },
  {
    t: "CONSUME EVERY SOURCE",
    rows: [
      ["changelogs, releases", "gh api, dated", "ok"],
      ["blogs, news", "RSS / Atom, full posts", "ok"],
      ["YouTube", "uploads feeds → transcript → screen", "ok"],
      ["headline only", "refused", "bad"],
    ],
    lede: "Subagents read every item in the window in full and return only <b>what shipped or became possible</b>.",
  },
  {
    t: "FILTER TO PROPOSALS",
    rows: [
      ["new to the setup", "kept", "ok"],
      ["already in settings, skills, MCP", "dropped", "bad"],
      ["proposed before, nothing new", "dropped", "bad"],
    ],
    lede: "The setup is checked before anything is proposed, and a past <b>no</b> stays declined unless something new changes the case.",
  },
  {
    t: "PROPOSE IN CHAT",
    rows: [
      ["ranked by value for effort", "with source link", "ok"],
      ["partial / failed sources", "named, with what was missed", "ok"],
      ["applying a change", "refused", "bad"],
    ],
    lede: "You get a short list and decide. Nothing in the setup changes during a run.",
  },
  {
    t: "APPEND THE RUN",
    rows: [
      ["window, sources, cursors", "runs.jsonl", "ok"],
      ["your yes / no", "recorded on the proposal", "ok"],
    ],
    lede: "The record is what makes the next run start in the right place and skip what you already answered.",
  },
];

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");
const render = (i: number) => {
  const s = S[i];
  if (!s) return; // the stepper only asks for 0 … n-1
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

import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "LOAD WHAT APPLIES",
    rows: [
      ["runtime file", "claude-code.md or codex.md", "ok"],
      ["guest-OS file", "matches the first screenshot", "ok"],
      ["task file", "only when the task needs it", "ok"],
      ["every other branch", "stays out of context", "ok"],
    ],
    lede: "SKILL.md is a router. One runtime, one guest OS, the task recipes that apply, and nothing else.",
  },
  {
    t: "BRING HORIZON FORWARD",
    rows: [
      ["request_access", "Omnissa Horizon Client Next", "ok"],
      ["open_application before each batch", "keys check the frontmost app", "ok"],
      ["a batch started with the terminal in front", "fails at its first key", "bad"],
      ["screenshot", "the only view inside", "ok"],
    ],
    lede: "Every key and paste checks which app is in front. Coming back to Horizon always starts by bringing it forward.",
  },
  {
    t: "PROBE, QUIETLY",
    rows: [
      ["click deep in the remote content", "buys input capture", "ok"],
      ["a control already in the task", "preferred probe", "ok"],
      ["the guest's fallback probe", "Start → Escape on Windows", "ok"],
      ["an arbitrary test string", "leaves litter", "bad"],
    ],
    lede: "This is somebody's work machine. The probe proves input lands and leaves <b>no evidence a robot was there</b>.",
  },
  {
    t: "PASTE, NEVER TYPE",
    rows: [
      ["write_clipboard", "Horizon in front", "ok"],
      ["wait 1s", "clipboard syncs into the guest", "ok"],
      ["select-all, paste, zoom to read back", "catches a lagged sync", "ok"],
      ["type into Horizon", "arrives as one repeated letter", "bad"],
    ],
    lede: "The read-back is the step that matters: a paste of the <em>previous</em> clipboard looks exactly like success.",
  },
  {
    t: "READ THE DATA, NOT THE PAGE",
    rows: [
      ["the app's JSON API in the guest browser", "already signed in", "ok"],
      ["exact ISO timestamps", "where the UI says '2 weeks ago'", "ok"],
      ["zoom in strips", "beats a fresh full screenshot", "ok"],
      ["scrolling through Horizon", "slow and imprecise", "bad"],
    ],
    lede: "A pasted API URL turns a pile of clicks and guesses into one dense, exact page of text.",
  },
  {
    t: "HOP, READ-ONLY",
    rows: [
      ["name the machine from its window title", "before acting", "ok"],
      ["startup log + artifact date", "which build is running", "ok"],
      ["files open 'Just once'", "no association changes", "ok"],
      ["restart, re-run, delete", "only with a go-ahead", "bad"],
    ],
    lede: "Each hop is more sensitive than the last. Reading is the default; any change waits for the user's yes.",
  },
  {
    t: "HAND BACK",
    rows: [
      ["browser zoom reset", "100%", "ok"],
      ["dialogs", "cancelled, nothing saved", "ok"],
      ["open the user's terminal", "they can see you left", "ok"],
      ["login / MFA / lock screen met on the way", "STOP, ask the human", "bad"],
    ],
    lede: "Leave the desktop as you found it, and return focus so the user knows the agent is done.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "vdi" });
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

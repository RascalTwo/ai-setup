import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "STAND UP THE DISPLAY",
    rows: [
      ["DeskPad running", "launched", "ok"],
      ["system_profiler SPDisplaysDataType", "DeskPad Display listed", "ok"],
      ["Horizon fullscreen", "exit it first", "bad"],
      ["Window > Move to DeskPad Display", "enabled only when windowed", "ok"],
    ],
    lede: "The menu item is greyed out in fullscreen — that is the precondition talking, not a broken menu. Leave Horizon <b>windowed</b> on the virtual display.",
  },
  {
    t: "PICK THE RIGHT SURFACE",
    rows: [
      ["app: 'Omnissa Horizon Client'", "on every call", "ok"],
      ["the macOS app path", "fallback only", "ok"],
      ["the DeskPad mirror window", "input doesn't pass through", "bad"],
      ["Window > Fill / fullscreen", "unreliable after focus change", "bad"],
    ],
    lede: "Two windows show the same picture and only one accepts input. Naming the app on <em>every</em> call is what stops a focus change from silently redirecting a click.",
  },
  {
    t: "CLICK TWICE — THE FIRST ISN'T FOR YOU",
    rows: [
      ["click 1: deep in the content", "buys input capture", "ok"],
      ["away from titlebar + toolbar", "required", "ok"],
      ["500ms between", "focus needs to settle", "ok"],
      ["click 2: a concrete control", "does the work", "ok"],
    ],
    lede: "The first click is not part of the task. It is the price of input capture, and skipping it is the most common reason a perfectly correct second click does nothing at all.",
  },
  {
    t: "PROBE, QUIETLY",
    rows: [
      ["Start button → Escape", "preferred probe", "ok"],
      ["a control already in the task", "next best", "ok"],
      ["the real app name you'd type anyway", "acceptable", "ok"],
      ["an arbitrary test string", "last resort, clear it", "bad"],
    ],
    lede: "This is somebody's work machine. The probe is chosen so that afterwards there is <b>no evidence a robot was there</b> — no stray text, no half-composed anything.",
  },
  {
    t: "THEN WORK — SMALL BATCHES",
    rows: [
      ["accessibility tree", "Mac wrapper only", "bad"],
      ["click/type, then screenshot", "every batch", "ok"],
      ["coordinates", "re-derived, never stale", "ok"],
      ["Ctrl+Esc after a focus change", "sometimes silently fails", "bad"],
    ],
    lede: "There is no element to assert on, so there is no error to catch: a click that lands on nothing succeeds exactly as loudly as one that lands on a button. Screenshots are the only oracle.",
  },
  {
    t: "READ THE SCREEN",
    rows: [
      ["read-image-locally, specific prompt", "~0 vision tokens", "ok"],
      ["magick -crop WxH+X+Y", "narrow it first", "ok"],
      ["dense/small UI text", "fall back to native", "bad"],
      ["layout judgement", "native", "bad"],
    ],
    lede: "And prefer an app's own unread filter over reading a badge — opening a conversation to check may <b>mark it read</b>, destroying the thing you were sent to measure.",
  },
  {
    t: "WHEN IT STOPS LANDING",
    rows: [
      ["snap-layout popup", "intercepts input", "bad"],
      ["re-query, click content, probe", "cheapest rungs", "ok"],
      ["Return to Previous Size", "if still failing", "ok"],
      ["login / MFA / password prompt", "STOP, ask the human", "bad"],
    ],
    lede: "The ladder is ordered by cost. And one rung is not a rung: a credential prompt ends the automation and hands back to the person, every time.",
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

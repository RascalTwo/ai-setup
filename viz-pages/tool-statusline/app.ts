import { stepper, $ } from "@viz/kit";

type Status = "ok" | "bad" | "warn";
interface Step {
  t: string;
  rows: [string, string, Status][];
  lede: string;
}

const S: Step[] = [
  {
    t: "RENDER · t+0ms",
    rows: [
      ["Claude Code", "statusLine → ccstatusline", "ok"],
      ["refreshInterval", "30", "ok"],
      ["stdin JSON", "fanned to every widget", "ok"],
      ["preserveColors", "true", "ok"],
    ],
    lede: "ccstatusline hands the same payload to each <code>custom-command</code> entry. <code>preserveColors: true</code> is what stops it painting its own foreground over the ANSI the scripts emit.",
  },
  {
    t: "THE CHEAP FOUR · t+5ms",
    rows: [
      ["statusline-cost.sh", "cost.total_cost_usd", "ok"],
      ["statusline-duration.sh", "cost.total_duration_ms", "ok"],
      ["statusline-cache.sh", "transcript mtime", "ok"],
      ["statusline-ttyimgspool.sh", "herdr agent_session", "ok"],
    ],
    lede: "Four standalone widgets, sourcing nothing. Each reads a field off stdin and exits — so a bug in the shared library cannot take any of them down, and a missing field prints <b>nothing</b> rather than a zero.",
  },
  {
    t: "THE SHARE IS ASKED FOR · t+8ms",
    rows: [
      ["statusline-5h.sh", "sources statusline-lib.sh", "ok"],
      ["verdict(43, elapsed, 18000)", "⚠out~44m", "bad"],
      ["refresh_share(...)", "returns IMMEDIATELY", "ok"],
      ["statusline-wk.sh", "does NOT call it", "warn"],
    ],
    lede: "<code>verdict()</code> projects utilisation over the window and prints the headroom — or, past 100%, <b>when you hit the cap at this pace</b>. Only the 5h widget kicks off a scan; one scan serves both windows.",
  },
  {
    t: "THE LOCK · t+9ms",
    rows: [
      ["cache age ≥ 60s?", "stale", "warn"],
      ["lock dir older than 300s", "rmdir — abandoned", "bad"],
      ["mkdir usage-share.lock", "one winner", "ok"],
      ["five other sessions", "lose, return, render", "ok"],
    ],
    lede: "macOS has no <code>flock</code>, so <code>mkdir</code> is the atomic test. Without it every stale moment spawns <b>one scan per live session</b> — six pythons computing the same answer over the same 500MB.",
  },
  {
    t: "THE SCAN · DETACHED, ~1.2s",
    rows: [
      ["glob ~/.claude/projects/*/*.jsonl", "read-only", "ok"],
      ["mtime < window start", "skipped", "ok"],
      ["(mtime, size) unchanged", "memo hit, not reparsed", "ok"],
      ["dedupe on message.id", "or overcount 1.8×", "bad"],
      ["write tmp → os.replace()", "atomic", "ok"],
    ],
    lede: "Backgrounded and <code>disown</code>ed — the render never waits on this. Costs land in <b>300-second buckets</b>, so summing either window is a floor comparison and one pass serves both.",
  },
  {
    t: "A LATER RENDER · t+30s",
    rows: [
      ["jq .five_hour.shares[$sid]", "0.4713", "ok"],
      ["× live account %", "0.4713 × 7", "ok"],
      ["adaptive decimals", "3.3 · .02 · 0/", "ok"],
      ["not in the cache yet", "prints nothing extra", "warn"],
    ],
    lede: "The cache holds a <b>fraction</b>, never a percentage, so the live account number scales it on every render. A minute-old cache blurs the attribution and <b>never</b> the headline: <code>3.3/<b>7%</b></code>.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const mark: Record<Status, [string, string]> = {
  ok: ["var(--good)", "✓"],
  bad: ["var(--danger)", "✗"],
  warn: ["var(--warn)", "•"],
};
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${mark[st][0]};white-space:nowrap">${mark[st][1]} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "render" });
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

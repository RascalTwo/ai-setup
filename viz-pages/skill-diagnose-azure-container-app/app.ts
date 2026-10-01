import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "FIND THE APP",
    rows: [["az containerapp list", "name + resourceGroup", "ok"],
           ["az login", "assumed, not performed", "bad"]],
    lede: "Not knowing the app name is step one, not a blocker. Not being logged in <em>is</em> a blocker — the skill authenticates nothing." },
  { t: "SYSTEM EVENTS — THE SHAPE",
    rows: [["--type system --tail 100", "100 events", "ok"],
           ["ReplicaUnhealthy / Startup probe failed", "never bound in time", "bad"],
           ["ContainerBackOff", "crash loop", "bad"],
           ["ImagePullBackOff", "never started at all", "bad"]],
    lede: "These say <b>what kind</b> of failure it is. <code>ImagePullBackOff</code> is the one that ends here — a container that never ran has no console output to go find." },
  { t: "THE OBVIOUS MOVE FAILS",
    rows: [["--type console", "empty for crashed replicas", "bad"],
           ["reads like", "\"no logs exist\"", "bad"],
           ["actually", "they exist, elsewhere", "ok"]],
    lede: "This is the trap the whole skill is written around. An empty result here is not evidence of anything, and everything below is the detour." },
  { t: "HOP 1 — APP → ENVIRONMENT",
    rows: [["properties.managedEnvironmentId", "a full ARM id", "ok"],
           ["| xargs -I{} basename {}", "→ bare name", "ok"],
           ["pass the ARM id straight in", "env show rejects it", "bad"]],
    lede: "The container app does not carry a workspace id. It carries a pointer to the managed environment, as a resource path that the next command will not accept." },
  { t: "HOP 2 — ENVIRONMENT → WORKSPACE",
    rows: [["appLogsConfiguration…customerId", "a workspace GUID", "ok"],
           ["that GUID", "what -w wants", "ok"],
           ["no appLogsConfiguration", "nothing to query", "bad"]],
    lede: "<code>customerId</code> is the Log Analytics workspace GUID, not its ARM id. If nobody wired the environment to a workspace, the detour has no destination." },
  { t: "ONE KQL QUERY",
    rows: [["ContainerAppConsoleLogs_CL", "the table", "ok"],
           ["ago(1h) · take 80", "hardcoded window", "ok"],
           ["project TimeGenerated, Log_s, RevisionName_s", "3 columns", "ok"]],
    lede: "One hour and eighty lines: enough for a deploy that just failed, small enough to actually read. <code>RevisionName_s</code> is projected for the next step, not for decoration." },
  { t: "READ THE NEWEST REVISION",
    rows: [["highest --NNNNNN suffix", "today's crash", "ok"],
           ["stack trace / Application run failed", "the root cause", "ok"],
           ["older revisions", "yesterday's fixed bug", "bad"]],
    lede: "The query is scoped by app name, not revision, so old revisions are in the result set. Reading the wrong one is how you debug a bug you already fixed." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "hop" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

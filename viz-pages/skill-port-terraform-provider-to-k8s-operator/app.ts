import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "0 · RECON, OVER THE API",
    rows: [["contents/docs/resources --jq '.[].name'", "the surface", "ok"],
           ["releases/latest --jq .tag_name", "the version you claim against", "ok"],
           ["count *_test.go", "the behavior denominator", "ok"],
           ["typed SDK in your language?", "hours vs days", "bad"]],
    lede: "Three <code>gh api</code> calls, no clone. The SDK question is the honest headline of any measurement — without one, a client-wrapper layer comes first and the number changes shape." },
  { t: "1 · CHASSIS, INLINE, NEVER DELEGATED",
    rows: [["connectionRef → namespaced Secret", "creds out of CRs and git", "ok"],
           ["additionalConfig as JsonNode", "Map&lt;String,Object&gt; breaks apply", "bad"],
           ["subset-diff → merge-update", "the one reconcile path", "ok"],
           ["maxReconciliationInterval 30s", "IS the drift-heal", "ok"]],
    lede: "One generic lever every resource reuses. Subclasses implement two methods — <code>sync</code> and <code>remove</code> — and inherit finalizers, status and the resync." },
  { t: "1 · ONE EXEMPLAR, END TO END",
    rows: [["build it green against the live target", "before any fan-out", "ok"],
           ["chassis defects found here", "2 of 2", "ok"],
           ["nine parallel agents", "inherited the fixes free", "ok"]],
    lede: "The exemplar exists to eat the chassis bugs once. <code>docs/PATTERN.md</code> — the per-resource contract every wave agent follows — is written as part of this phase, not after it." },
  { t: "2 · E2E HARNESS, NOT AN AFTERTHOUGHT",
    rows: [["verify/verify.sh → verify.d/NN-*.sh", "in order", "ok"],
           ["prerequisites via raw API calls", "never via other CRDs", "ok"],
           ["create → patch → drift-heal → delete", "four beats", "ok"],
           ["mocks", "none, anywhere", "ok"]],
    lede: "Self-contained scripts against the real API. Building prerequisites through other CRDs would turn one broken resource into a cascading suite failure." },
  { t: "3 · PARITY WAVES",
    rows: [["N mapper types → 1 CRD", "families collapse", "ok"],
           ["CRD count at full parity", "≈ ⅓–½ of resources", "ok"],
           ["one agent per resource, own worktree", "compile-only", "ok"],
           ["sorted alphabetically", "sort by business value", "bad"]],
    lede: "Integration e2e runs once after merge, by you — agents compile in isolation. After each wave: merge, rebuild, full suite, update the matrix, commit." },
  { t: "4 · MIRROR THE TEST SUITE",
    rows: [["*_test.go fixtures", "→ CR YAML, ~1:1", "ok"],
           ["check functions", "→ assertion checklists", "ok"],
           ["run them directly", "impossible — needs the terraform binary", "bad"],
           ["docs/TEST-PARITY.md", "file → script → beats", "ok"]],
    lede: "The provider's own tests are the highest-value artifact in its repo. You can read every behavior out of them; you just can't execute a single one." },
  { t: "5 · MEASURE, AND STAY HONEST",
    rows: [["EFFORT.md", "clock starts at recon", "ok"],
           ["docs/CAPABILITY-MATRIX.md", "resource → CRD, ✅⚠️❌", "ok"],
           ["parity claimed without the matrix", "never", "bad"],
           ["webhooks · metrics · HA", "listed as the production tax", "ok"]],
    lede: "The ledger is a deliverable, not overhead. It carries the caveats that must travel with the number — an AI-orchestrated PoC is not production, and ownership is forever." },
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "phase" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

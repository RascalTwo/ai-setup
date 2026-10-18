import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "0 · RECON + SCOPE",
    rows: [
      ["ls provider/resource_*.go | grep -v _test | wc -l", "the surface", "ok"],
      ["the client layer", "worker-app grant AND bearer token", "ok"],
      ["terraform providers schema -json", "→ .schema-dump/schema.json", "ok"],
      ["a remote instance as the target", "never", "bad"],
    ],
    lede: "The schema dump is not documentation — it is the <b>checklist the audit gate runs against</b>, which is why it is produced before any code exists.",
  },
  {
    t: "1 · FRAMEWORK BY HAND",
    rows: [
      ["GetToken() per call", "never cached", "ok"],
      ["ApiGetOrNull", "404 → $null", "ok"],
      ["Get/Test/Set on the base", "written once", "ok"],
      ["~370 lines", "copied 100×", "ok"],
    ],
    lede: "Master-realm admin tokens are short-lived and a long test outlives one, so caching a token is the bug — re-fetching per call is the fix.",
  },
  {
    t: "2 · EXEMPLARS, PROVEN LIVE",
    rows: [
      ["plain CRUD", "group", "ok"],
      ["discriminator", "client: access_type → 2 booleans", "ok"],
      ["relationship", "group↔role, additive", "ok"],
      ["parent name→uuid", "protocol mapper", "ok"],
    ],
    lede: "Four shapes, chosen to span what the fan-out will meet. The exemplars <b>are</b> the spec agents copy — a flaw here is copied a hundred times.",
  },
  {
    t: "3 · FAN OUT TO SCRATCH FILES",
    rows: [
      ["families of ~4–16 resources", "one agent each", "ok"],
      ["write the shared .psm1", "forbidden — they collide", "bad"],
      ["per-family scratch file", "the only write surface", "ok"],
    ],
    lede: "DSC discovery requires every class in one <code>.psm1</code>, and parallel writers to one file collided in a real build. The constraint is the platform's; the workaround is the rule.",
  },
  {
    t: "3 · THE ORCHESTRATOR ASSEMBLES",
    rows: [
      ["splice scratch → the one .psm1", "by you", "ok"],
      ["rebuild factory + manifest + runner", "by you", "ok"],
      ["module load-check", "run it", "ok"],
      ["the agent's word", "not the gate", "bad"],
    ],
    lede: "Assembly is not a chore delegated back out. It is the first point at which anything an agent claimed becomes checkable.",
  },
  {
    t: "4 · GATE ONE — FIELD PARITY",
    rows: [
      ["regex [DscProperty…] $Name", "per class", "ok"],
      ["normalize: strip _, lowercase", "both sides", "ok"],
      ["schema attrs where required|optional", "the denominator", "ok"],
      ["skip id · internal_id · *deletion_protection · import", "TF-only", "ok"],
    ],
    lede: "Deterministic, therefore enforceable. Loop until it prints <b>0 missing</b> — and expect your own hand-built exemplars, the big core resources, to be the guiltiest.",
  },
  {
    t: "5 · GATE TWO — BEHAVIORAL",
    rows: [
      ["create → Test true", "", "ok"],
      ["drift out-of-band → Test false", "", "ok"],
      ["converge → Test true", "", "ok"],
      ["Absent → Test true", "", "ok"],
      ['"I tested it"', "never accepted", "bad"],
    ],
    lede: "Per family, in its own throwaway realm, via a <code>Load-Family.ps1</code> helper — and <b>the workflow runs it</b>. One wave once reported 88/93 green having changed nothing.",
  },
  {
    t: "7 · VERIFY AND SHIP",
    rows: [
      ["module loads · every family green", "sweep", "ok"],
      ["replay a real config through the runner", "round 2 = 0 changed", "ok"],
      ["PARITY.md + EFFORT.md", "the actual deliverable", "ok"],
    ],
    lede: "The claim states how it was proven — surface, field audit, behavioral — alongside the deltas and the permanent state/plan/prune losses. That honesty is the product.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "phase" });
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

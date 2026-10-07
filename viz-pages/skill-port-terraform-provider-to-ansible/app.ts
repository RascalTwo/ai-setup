import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Phase {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Phase[] = [
  {
    t: "0 · RECON AND SCOPE",
    rows: [
      ["ls provider/resource_*.go | grep -v _test | wc -l", "the surface", "ok"],
      ["the client layer (*_client.go)", "grants, 401 retry, id capture", "ok"],
      ["their CI + Makefile", "how they test", "ok"],
      ["a remote instance as the target", "never", "bad"],
    ],
    lede: "Ten minutes, inline. The counts become the denominator of every parity claim, and the provider's own CI is the template for the test harness.",
  },
  {
    t: "1 · FRAMEWORK, BY HAND",
    rows: [
      ["&lt;service&gt;_api.py", "open_url, not requests", "ok"],
      ["resource.py", "present/absent engine", "ok"],
      ["meta/runtime.yml action_groups", "EVERY name, up front", "ok"],
      ["318 lines", "copied 100×", "ok"],
    ],
    lede: "Small, and written by you. Every fan-out agent copies these patterns, so quality here multiplies — and pre-registering names means no agent ever edits a shared file.",
  },
  {
    t: "2 · EXEMPLARS, GREEN FIRST",
    rows: [
      ["one simple CRUD", "e.g. group", "ok"],
      ["one with sub-resource sync", "role + composites", "ok"],
      ["one big-schema core resource", "partial is fine", "ok"],
      ["scripts/run-tests.sh", "green before fan-out", "ok"],
    ],
    lede: "The exemplars <b>are</b> the spec for the fan-out. Agents copy them, so a flaw here is copied a hundred times — which is the whole reason they go first.",
  },
  {
    t: "3 · FAN OUT BY FAMILY",
    rows: [
      ["families of ~4–13 resources", "one agent each", "ok"],
      ["protocol mappers after clients", "dependency-chained", "ok"],
      ["LDAP mappers after federation", "dependency-chained", "ok"],
      ["independent families", "start immediately", "ok"],
    ],
    lede: "Launched through the Workflow tool with the chain declared up front. Each agent returns a structured result including its <b>quirks harvest</b> — the evidence behind the effort ledger.",
  },
  {
    t: "4 · DATA SOURCES → *_info",
    rows: [
      ["changed=False", "always", "ok"],
      ["supports_check_mode=True", "always", "ok"],
      ["404 → empty state, or hard error?", "read the Go, per resource", "bad"],
      ["Sensitive attributes", "stripped anyway", "ok"],
    ],
    lede: "Miss semantics are the trap: some data sources return empty state on a 404 and some hard-error with a specific message. There is no convention to guess.",
  },
  {
    t: "5 · PROVE PARITY",
    rows: [
      ["terraform providers schema -json", "composed schemas", "ok"],
      ["field-parity-audit.py --schema-json", "ast vs schema", "ok"],
      ["Computed-only fields", "outputs, excluded", "ok"],
      ["registry lags your HEAD", "--provider-src → NEEDS-MANUAL", "bad"],
    ],
    lede: "The oracle is Terraform, not the Go — it dumps the <em>composed</em> schema. Expect your hand-built exemplars to be the guilty ones; they predate the patterns.",
  },
  {
    t: "6 · MIRROR THEIR TESTS",
    rows: [
      ["resource_*_test.go", "the real behavior spec", "ok"],
      ["config A → apply → assert → config B", "per scenario", "ok"],
      ["cost", "≈ the module port itself", "bad"],
      ["measured-PoC", "lifecycle only, say so", "ok"],
    ],
    lede: "Years of per-field update permutations live in those files. Porting them is the difference between lifecycle coverage and real behavior parity — and it is not free.",
  },
  {
    t: "7 · VERIFY AND SHIP",
    rows: [
      ["sequential sweep, every family", "exit 0", "ok"],
      ["replay a real end-to-end scenario", "round-2 fully idempotent", "ok"],
      ["EFFORT.md + PARITY.md", "the actual deliverable", "ok"],
    ],
    lede: "The docs are usually the point. They carry what the numbers can't: AI-minutes are not human-months, and ownership is the recurring cost nothing here reduces.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
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

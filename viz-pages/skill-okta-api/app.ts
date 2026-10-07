import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "THE ASK",
    rows: [
      ['"add an OIDC identity provider"', "path unknown", "bad"],
      ["body schema", "unknown", "bad"],
      ["management-minimal.yaml", "~80,000 lines", "bad"],
    ],
    lede: "Reading the spec to find out would spend the context window that was supposed to hold the work. So the spec is never read — it is grepped.",
  },
  {
    t: "GREP THE CACHE",
    rows: [
      ['okta-lookup.sh "/api/v1/idps"', "grep -n", "ok"],
      ["spec-cache/management-minimal.yaml", "&lt; 7 days old", "ok"],
      ["missing or -mtime +7", "curl -sf, re-cache", "ok"],
    ],
    lede: "Cached under <code>~/.agents/state/okta-api/spec-cache/</code>. The age check is the entire invalidation mechanism — no ETag, no force flag, <code>rm</code> is the refresh command.",
  },
  {
    t: "READ THE WINDOW",
    rows: [
      ["hits come back as line numbers", "12904: /api/v1/idps:", "ok"],
      ["Read offset=12890 limit=60", "just that block", "ok"],
      ["whole spec in context", "never", "ok"],
    ],
    lede: "Grep locates, an offset read explains. Half a tool is only useful if you know which half you are holding, so the skill spells out the second step too.",
  },
  {
    t: "BUILD THE HEADER",
    rows: [
      ["~/.okta/okta.yaml", "grep orgUrl: | awk '{print $2}'", "ok"],
      ["same for token:", "→ $TOKEN", "ok"],
      ["file missing", "exit 1 → okta login", "bad"],
    ],
    lede: "That file is the <b>Okta CLI's</b> config, not this skill's. It is read and never written — which is why it stays in <code>~/.okta/</code> and not under the skill's state directory.",
  },
  {
    t: "ONE CURL",
    rows: [
      ['-H "Authorization: SSWS $TOKEN"', "expanded inside the script", "ok"],
      ["${ORG_URL}/api/v1${API_PATH}", "the whole URL rule", "ok"],
      ['-d "$BODY"', "only if non-empty", "ok"],
    ],
    lede: "The token reaches a subprocess argument array. It never reaches a string the agent composed, which is the only place a leak could come from.",
  },
  {
    t: "WHAT THE TRANSCRIPT KEEPS",
    rows: [
      ["scripts/okta-api.sh POST /idps '{…}'", "a method and a path", "ok"],
      ["the SSWS token", "absent", "ok"],
      ["response body", "raw, pipe it to jq", "ok"],
    ],
    lede: "Nothing to rotate afterwards. The permanent artifact of a one-off question is the question, not the credential that answered it.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "call" });
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

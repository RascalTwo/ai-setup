import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "READ THE CONFIG",
    rows: [["~/.ping/ping.yaml", "grep + awk, 4 keys", "ok"],
           ["environment_id · client_id · client_secret", "required", "ok"],
           ["region:", "defaults to NA", "ok"]],
    lede: "That file is <b>PingOne tooling's</b>, not this skill's — read, never written. Missing it is a hard exit pointing at <code>setup.md</code>, not a prompt." },
  { t: "MAP THE REGION",
    rows: [["EU → pingone.eu", "auth + api", "ok"], ["AP → pingone.asia", "auth + api", "ok"],
           ["anything unrecognised", "*) → pingone.com", "bad"]],
    lede: "One <code>case</code> builds both hosts: <code>auth.${DOMAIN}/${ENV_ID}/as/token</code> and <code>api.${DOMAIN}/v1</code>. A typo in <code>region:</code> does not error — it quietly means NA." },
  { t: "CHECK THE TOKEN CACHE",
    rows: [["~/.agents/state/ping-api/token-cache.json", "jq -r .expires_at", "ok"],
           ["date +%s &lt; expires_at", "reuse it", "ok"],
           ["no file, or expired", "fall through to mint", "bad"]],
    lede: "Time is the only invalidation. There is no refresh command — <code>rm</code> on this file <em>is</em> the refresh command, and the skill says so." },
  { t: "MINT (ONLY IF IT MISSED)",
    rows: [["POST as/token -u id:secret", "client_credentials", "ok"],
           ["expires_at = now + expires_in − 60", "60s buffer", "ok"],
           ["no access_token in the reply", "raw body to stderr, exit 1", "bad"]],
    lede: "<code>-u</code> lets curl build the Basic header, so the secret never becomes a string anyone assembled. The buffer is what stops a token expiring between the check and the request." },
  { t: "BUILD THE URL",
    rows: [["default", "${API_BASE}/environments/${ENV_ID}${PATH}", "ok"],
           ["--raw", "${API_BASE}${PATH}", "ok"],
           ["path validation", "none — your suffix, your problem", "bad"]],
    lede: "The two modes are the whole interface. <code>GET /environments</code> without <code>--raw</code> is a valid request for the environments inside an environment, and the script will happily send it." },
  { t: "ONE CURL",
    rows: [["-H \"Authorization: Bearer $TOKEN\"", "expanded in-script", "ok"],
           ["response", "raw body to stdout", "ok"],
           ["what the transcript keeps", "ping-api.sh GET /users", "ok"]],
    lede: "A method and a path. Nothing to rotate afterwards, which was the entire point of putting a script between the agent and curl." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number): void => {
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "call" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

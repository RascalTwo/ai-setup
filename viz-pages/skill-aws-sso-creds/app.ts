import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "LOAD THE CHROME TOOLS",
    rows: [["tabs_context_mcp · navigate", "loaded", "ok"], ["find · javascript_tool", "loaded", "ok"],
           ["computer", "loaded", "ok"]],
    lede: "One batched <code>ToolSearch</code>. There is no <code>aws sso login</code> anywhere in this skill — the portal is a website and gets driven as one." },
  { t: "REACH THE PORTAL",
    rows: [["https://&lt;alias&gt;.awsapps.com/start", "navigate", "ok"], ["login.microsoftonline.com / Okta", "SSO redirect, continue", "ok"],
           ["password field", "stop, hand back", "bad"]],
    lede: "A screenshot decides which of those three you landed on. Completing an <b>SSO redirect</b> is in scope; typing a <b>password</b> never is — that means the browser session died and it is the human's job." },
  { t: "OPEN THE ACCOUNT",
    rows: [["click the account <i>name</i>", "row expands", "ok"], ["the expand chevron", "too small a target", "bad"],
           ["find \"Access keys\"", "in that row", "ok"]],
    lede: "Rows are collapsed by default. Clicking the name is measurably more reliable than the arrow, so that is what the skill tells it to click." },
  { t: "VERIFY THE MODAL",
    rows: [["[role=\"dialog\"] scan", "account=… id=…", "ok"], ["/…account\\s+(.+?)\\s*\\((\\d+)\\)/", "multi-word names ok", "ok"],
           ["NO_CRED_DIALOG", "no modal — never a pass", "bad"]],
    lede: "Checked <b>before</b> anything is copied. The old <code>\\S+?</code> pattern failed on every account name with a space in it and reported no-dialog against a valid modal." },
  { t: "COPY, DON'T READ",
    rows: [["\"Option 1: Set AWS environment variables\"", "click copy", "ok"], ["3 export lines", "→ clipboard", "ok"],
           ["read values via javascript_tool", "forbidden", "bad"]],
    lede: "The secrets ride the system clipboard from the browser to disk. Pulling them out with JavaScript would round-trip live credentials through the transcript." },
  { t: "WRITE THE DOTENV",
    rows: [["tr -d '\\r'", "kills the CRLF", "ok"], ["bare echo", "supplies the missing newline", "ok"],
           ["~/.agents/state/aws-sso-creds/", "dir 700 · file 600", "ok"]],
    lede: "Two bugs handled in one pipeline: a stray <code>\\r</code> yields <em>Invalid header value</em>, and a missing trailing newline welds <code>AWS_REGION</code> onto the end of the session token." },
  { t: "PROVE THE ACCOUNT",
    rows: [["source + sts get-caller-identity", "returns an account id", "ok"], ["== the id in portals.md", "ok", "ok"],
           ["!= the id in portals.md", "WRONG ACCOUNT, exit 1", "bad"]],
    lede: "The tile it clicked is a guess; the caller identity is not. Success prints the <b>path, the account and the expiry</b> — never the secrets." },
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "run" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

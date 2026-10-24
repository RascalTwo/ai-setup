import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "RESOLVE THE PORTAL",
    rows: [
      ["a per-org wrapper skill", "hands the facts down", "ok"],
      ["portals.md (template)", "start URL · IdP · account IDs", "ok"],
      ["ambiguous or unlisted account", "ask, never guess", "bad"],
    ],
    lede: 'Nothing portal-specific lives in <code>SKILL.md</code>. "dev" is mapped to a portal and an account from one of two places, and the account ID it lands on is what the run is verified against at the very end.',
  },
  {
    t: "LOOK FOR A PROFILE",
    rows: [
      ["~/.aws/config", "sso_session / sso_start_url", "ok"],
      ["+ sso_account_id + sso_role_name", "pins one profile", "ok"],
      ["no match", "go to the browser route", "bad"],
    ],
    lede: "Line 63: <b>try this first</b>. A profile means the CLI resolves credentials itself, so nothing is materialized into a file or the transcript.",
  },
  {
    t: "TEST THE PROFILE",
    rows: [
      ["sts get-caller-identity --profile p", "--query Account", "ok"],
      ["== the expected account ID", "done: return profile + ID", "ok"],
      ["SSO token expired", "re-login, step 4", "bad"],
      ["aws configure export-credentials", "forbidden", "bad"],
    ],
    lede: "A match ends the run with <b>no file written</b>. The one command the skill bans by name is the one that would write the credentials out anyway.",
  },
  {
    t: "RE-LOGIN BY DEVICE CODE",
    rows: [
      ["aws sso login --use-device-code --no-browser", "background, output to a file", "ok"],
      ["printed URL + code", "open in Chrome, match the code", "ok"],
      ["Confirm and continue → Allow access", "botocore-client-&lt;session&gt;", "ok"],
      ["a password prompt", "stop, ask the user", "bad"],
    ],
    lede: "Output goes to a file, never through <code>head</code>: a reader that closes early kills the producer with SIGPIPE. Then the identity test from step 3 runs again.",
  },
  {
    t: "NO PROFILE: LOAD CHROME",
    rows: [
      ["ToolSearch select: six Chrome tools", "one batched call", "ok"],
      ["navigate → the start URL", "screenshot to see where", "ok"],
      ["IdP redirect (Entra, Okta)", "complete it, in scope", "ok"],
      ["password field", "stop, hand back", "bad"],
    ],
    lede: "The portal is a website and gets driven as one. A screenshot decides which of those you landed on: an <b>SSO redirect</b> is fine, a <b>password</b> is the human's job.",
  },
  {
    t: "VERIFY THE MODAL",
    rows: [
      ["click the account name, not the chevron", "row expands", "ok"],
      ['[role="dialog"] scan', "account=… id=…", "ok"],
      ["/…account\\s+(.+?)\\s*\\((\\d+)\\)/", "multi-word names ok", "ok"],
      ["NO_CRED_DIALOG", "no modal, never a pass", "bad"],
    ],
    lede: "Checked <b>before</b> anything is copied. The old <code>\\S+?</code> failed on every account name containing a space and reported no-dialog against a valid modal.",
  },
  {
    t: "COPY, DON'T READ",
    rows: [
      ['"Option 1: Set AWS environment variables"', "click copy", "ok"],
      ["3 export lines", "→ system clipboard", "ok"],
      ["read the values via javascript_tool", "forbidden", "bad"],
    ],
    lede: "The secrets ride the clipboard from the browser straight to disk. Pulling them out with JavaScript would round-trip live credentials through the transcript.",
  },
  {
    t: "WRITE THE DOTENV",
    rows: [
      ["pbpaste | tr -d '\\r'", "kills the CRLF", "ok"],
      ["bare echo", "supplies the missing newline", "ok"],
      ["dir 700 · umask 077 · file 600", "~/.agents/state/aws-creds/", "ok"],
    ],
    lede: "Two bugs in one pipeline: a stray <code>\\r</code> yields <em>Invalid header value</em>, and the missing trailing newline welds <code>AWS_REGION</code> onto the session token.",
  },
  {
    t: "PROVE THE ACCOUNT",
    rows: [
      ["source + sts get-caller-identity", "returns an account ID", "ok"],
      ["== the ID in portals.md", "ok: path · ID · expiry", "ok"],
      ["!= the ID in portals.md", "WRONG ACCOUNT, exit 1", "bad"],
    ],
    lede: "The tile it clicked is a guess; the caller identity is not. Success prints the <b>path, the account and the expiry</b>, never the secrets.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3000, hashKey: "route" });
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

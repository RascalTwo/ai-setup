import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "READ THE ACCOUNT MAP",
    rows: [
      ["accounts.json", "alias → email, spoken names, notes", "ok"],
      ["file missing", "copy accounts.example.json", "ok"],
      ["guessing accounts from memory", "refused", "bad"],
    ],
    lede: "Every task starts at <code>accounts.json</code>, the gitignored map of alias, email and the words you say for each account.",
  },
  {
    t: "PICK THE ACCOUNT",
    rows: [
      ["named", "that account", "ok"],
      ["unnamed read", "all accounts, labeled", "ok"],
      ["unnamed write", "ask first", "ok"],
      ["guessing on a write", "refused", "bad"],
    ],
    lede: "Reads are safe to fan out; writes are not. <b>Sending from the wrong account</b> cannot be undone, so an unnamed write becomes a question.",
  },
  {
    t: "SET BOTH VARIABLES",
    rows: [
      ["GOOGLE_WORKSPACE_CLI_CONFIG_DIR", "~/.config/gws-<alias>", "ok"],
      ["GOOGLE_APPLICATION_CREDENTIALS", "/dev/null/none", "ok"],
      ["omitting either", "refused", "bad"],
    ],
    lede: "The first selects the account. The second stops gws borrowing a quota project from <b>gcloud's ADC file</b>, which 403s for accounts outside that project.",
  },
  {
    t: "RUN GWS",
    rows: [
      ["helpers first", "+triage · +read · +send · +reply", "ok"],
      ["raw API params", "--params JSON, body via --json", "ok"],
      ["positional path params", "refused", "bad"],
    ],
    lede: "Commands are learned from <code>gws &lt;service&gt; --help</code>, not remembered; the <code>+</code> helpers come first.",
  },
  {
    t: "REPAIR OR FAN OUT",
    rows: [
      ["invalid_grant / 401", "gws auth login, full-URL scopes", "ok"],
      ["unnamed read", "repeat per account, label by alias", "ok"],
      ["mixing accounts in one call", "refused", "bad"],
    ],
    lede: "A dead token means a login in the background and an approval from you. Cross-account reads are just <b>separate calls</b>, one process per account.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "flow" });
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

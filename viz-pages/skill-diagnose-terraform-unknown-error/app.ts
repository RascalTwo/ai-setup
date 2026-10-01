import { stepper, $ } from "/_kit/viz.js";

type Step = { t: string; rows: [string, string, "ok" | "bad"][]; lede: string };

const S: Step[] = [
  { t: "INSTRUMENT THE STEP",
    rows: [["env: TF_LOG: DEBUG", "on that step only", "ok"],
           ["2&gt;&amp;1 | tee /tmp/tf-debug.log", "stderr is where TF_LOG goes", "ok"],
           ["RESULT=${PIPESTATUS[0]}", "exit code preserved", "ok"],
           ["| grep at apply time", "masks the failure", "bad"]],
    lede: "A pipeline's status is the <em>last</em> command's. Without <code>PIPESTATUS</code>, a failing apply piped into <code>tee</code> reports success and CI carries on." },
  { t: "COMMIT AND PUSH",
    rows: [["\"Temporarily add TF_LOG=DEBUG…\"", "one commit", "ok"],
           ["push to the remote", "starts the run", "ok"],
           ["the repo", "now dirty on purpose", "bad"]],
    lede: "This is the skill that writes. The message says <b>temporarily</b> because the revert is part of the method, not a follow-up ticket." },
  { t: "RUN AND WAIT",
    rows: [["trigger-github-deploy", "kicks it off", "ok"],
           ["wait-for-github-workflow", "blocks until done", "ok"],
           ["the run", "fails again, on purpose", "ok"]],
    lede: "Neither half belongs to this skill. It owns the middle — instrument and extract — and hands the CI mechanics to its neighbours." },
  { t: "PULL THE ZIP",
    rows: [["gh api …/actions/runs/&lt;id&gt;/logs", "&gt; /tmp/run-logs.zip", "ok"],
           ["unzip -p", "streamed, never extracted", "ok"],
           ["grep -a", "or it is 'binary', silently", "ok"]],
    lede: "A DEBUG-level Terraform run is enormous and full of control bytes. <code>-a</code> is on every probe because without it grep matches and prints nothing." },
  { t: "GREP WHAT YOU SENT",
    rows: [["\"performing request.*&lt;endpoint&gt;\"", "the SDK's own log line", "ok"],
           ["-A 40", "the request body", "ok"],
           ["| head -60", "bounded", "ok"]],
    lede: "The endpoint is matched as a suffix of the SDK's outbound-call line, so you get the body it actually sent rather than every mention of that path." },
  { t: "GREP WHAT CAME BACK",
    rows: [["\"HTTP/[0-9].[0-9] [4-5][0-9][0-9]\"", "status line", "ok"],
           ["-A 15", "response headers", "ok"],
           ["-v azure|microsoft|storage", "platform chatter out", "ok"],
           ["403 → Www-Authenticate", "names the missing scope", "ok"]],
    lede: "The fix for a 403 is usually sitting in a header nobody reads. For a 500 the answer is more often in the <em>request</em> — a field you didn't send." },
  { t: "REVERT + FIX, ONE COMMIT",
    rows: [["TF_LOG: DEBUG", "removed", "ok"], ["the real fix", "same commit", "ok"],
           ["re-run to verify", "green", "ok"],
           ["leave DEBUG in", "secrets in a permanent log", "bad"]],
    lede: "At DEBUG, Terraform prints API keys and client secrets in plain text into a build log that outlives the run. Closing the loop is the only thing that puts that out." },
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "trip" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "RESOLVE THE RUN",
    rows: [
      ["an explicit run id", "use it", "ok"],
      ['"latest" → gh run list --limit 1', '+ select(.conclusion=="failure")', "ok"],
      ["latest run went green", "empty string, not an older failure", "bad"],
    ],
    lede: '"Latest" is <b>the latest run, if it failed</b> — a one-element list filtered after the fact, not a search for the most recent failure.',
  },
  {
    t: "PASS ONE — LET GITHUB FILTER",
    rows: [
      ["gh run view &lt;id&gt; --log-failed", "failed steps only", "ok"],
      ["the zip", "not downloaded", "ok"],
      ["cost", "kilobytes, not megabytes", "ok"],
    ],
    lede: "The cheap pass exists because the expensive one is almost never needed. Most runs are diagnosed and finished at this step.",
  },
  {
    t: "SCAN FOR FOUR THINGS",
    rows: [
      ["job + step name", "found", "ok"],
      ["error / exit code / exception", "found", "ok"],
      ["HTTP 4xx–5xx", "found", "ok"],
      ["provider error summary", "found", "ok"],
    ],
    lede: "A fixed checklist, not free reading. Those four carry the answer in the overwhelming majority of red runs.",
  },
  {
    t: "ESCALATE?",
    rows: [
      ["output truncated", "escalate", "bad"],
      ["error unclear", "escalate", "bad"],
      ["more context needed", "escalate", "bad"],
      ["none of the three", "report and stop", "ok"],
    ],
    lede: 'Three named conditions, all properties of the <b>pass-one output</b> rather than of the failure. "Be thorough anyway" is not one of them.',
  },
  {
    t: "PULL THE ZIP",
    rows: [
      ["gh api …/actions/runs/&lt;id&gt;/logs", "&gt; /tmp/run-logs.zip", "ok"],
      ["unzip -p", "streamed, never extracted", "ok"],
      ["read the whole thing", "still no", "bad"],
    ],
    lede: "Paying for the archive does not mean reading it. <code>unzip -p</code> concatenates the members to stdout so the next stage can be a single grep.",
  },
  {
    t: "PICK ONE PROBE",
    rows: [
      ["terraform", 'grep -a "│" minus ─ ╷ ╵', "ok"],
      ["provider crash", "panic|goroutine|SIGSEGV", "ok"],
      ["http", "HTTP/1.1 [4-5]xx · Www-Authenticate", "ok"],
      ["unknown", "catch-all + denylist | head -40", "bad"],
    ],
    lede: "Probe chosen by what the error <em>looks</em> like. <code>-a</code> on every one, because the stream carries control bytes and grep would otherwise call it binary and go quiet.",
  },
  {
    t: "REPORT, THEN STOP",
    rows: [
      ["which job and step", "named", "ok"],
      ["the exact error", "quoted", "ok"],
      ["likely root cause", "stated", "ok"],
      ["the fix", "suggested, never applied", "bad"],
    ],
    lede: "Same four-part shape from either pass. Nothing is patched, re-run or pushed — applying the fix is a decision that stays with you.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "pass" });
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

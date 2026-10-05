import { stepper, $ } from "@viz/kit";

type Row = [k: string, v: string, st: "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "RESOLVE THE RUN",
    rows: [
      ["an explicit run id", "used as-is", "ok"],
      ["latest + deploy_bravo.yml", "newest of that workflow", "ok"],
      ["latest, bare", "newest in the repo, any workflow", "bad"],
      ["nothing found", "ERROR, exit 1", "bad"],
    ],
    lede: "It echoes <code>Resolved latest run ID: …</code> before it starts waiting, so a wrong guess shows up in the first line rather than nine minutes later.",
  },
  {
    t: "THE TICK",
    rows: [
      ["gh run view --json status,conclusion", "one string", "ok"],
      ['-q \'.status + ":" + (.conclusion // "")\'', "in_progress:", "ok"],
      ["[[ $STATUS == completed:* ]]", "not yet", "bad"],
      ["sleep 20", "not configurable", "ok"],
    ],
    lede: "Two fields glued into one string, so a single prefix test ends the loop and <code>${STATUS#completed:}</code> yields the conclusion without a second API call.",
  },
  {
    t: "WITH --job: MATCH IT",
    rows: [
      ["ascii_downcase | endswith(target)", "tried first", "ok"],
      ["ascii_downcase | contains(target)", "fallback", "ok"],
      ["| first // empty", "several match → take one", "ok"],
      ["--job ldap", "→ bravo / Deploy LDAP", "ok"],
    ],
    lede: "Suffix before substring is what makes a short name land on the job you meant, instead of on whichever job happens to mention it.",
  },
  {
    t: "THE AMBIGUOUS TICK",
    rows: [
      ["job hasn't started", "not started yet", "bad"],
      ["job name is a typo", "not started yet", "bad"],
      ["distinguishable now?", "no", "bad"],
    ],
    lede: "Identical output for two very different problems. The script can only tell them apart once the run itself completes — which is exactly when it stops being useful to know.",
  },
  {
    t: "FOUR WAYS OUT",
    rows: [
      ["completed:success", "exit 0, prints conclusion + URL", "ok"],
      ["completed:anything else", "exit 1", "bad"],
      ["--job completed", "returns early, either way", "ok"],
      ["run ended, job never seen", "lists every job name, exit 1", "bad"],
    ],
    lede: "A non-success conclusion is a non-zero exit, not a note in the output — the wait <b>inherits</b> the failure so a caller's <code>&amp;&amp;</code> chain stops.",
  },
  {
    t: "THE WALL",
    rows: [
      ["internal deadline", "none", "bad"],
      ["Bash tool timeout", "600000 ms", "ok"],
      ["failure → next step", "/analyze-github-workflow-failure", "ok"],
    ],
    lede: "The loop is unbounded on purpose; the harness supplies the only limit. That is why the skill specifies the timeout rather than leaving it to the default.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "loop" });
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

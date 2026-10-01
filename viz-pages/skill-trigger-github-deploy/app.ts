import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "PICK THE WORKFLOW",
    rows: [["ls .github/workflows/", "the candidates", "ok"],
           ["clear from context", "use it", "ok"],
           ["not clear", "ask — never guess", "bad"]],
    lede: "The only question it will ask you. Guessing here means deploying the wrong thing, which is not a mistake a retry fixes." },
  { t: "ASK GIT, NOT THE USER",
    rows: [["git branch --show-current", "the branch to deploy", "ok"],
           ["a --branch argument", "there isn't one", "bad"]],
    lede: "It deploys the branch you are standing on, always. That is why the skill is named for the current branch rather than for an environment." },
  { t: "READ on.push.branches",
    rows: [["grep -A 20 '^on:'", "20 lines, no more", "ok"],
           ["sed -n '/push:/,/^  [a-z]/p'", "the push block", "ok"],
           ["on: [push] inline form", "yields nothing", "bad"]],
    lede: "A text heuristic, not a YAML parse. When it comes back empty it reads as \"no push trigger\" — so the failure mode leans toward dispatching." },
  { t: "DOES THIS BRANCH MATCH?",
    rows: [["literal: main, fix-bravo", "match", "ok"],
           ["glob: feature/* vs feature/foo", "match", "ok"],
           ["'**'", "every branch", "ok"],
           ["missing the glob case", "dispatch a run push would make", "bad"]],
    lede: "Three rules, because one is not enough. Checking only for literal names is how you end up with two runs of the same deploy." },
  { t: "ANYTHING UNPUSHED?",
    rows: [["git log @{u}.. --oneline", "commits waiting", "ok"],
           ["none — branch up to date", "push cannot fire", "bad"],
           ["no upstream at all", "2&gt;/dev/null → reads as none", "bad"]],
    lede: "A push trigger that has nothing to push is not a route. Both empty cases fall through to manual dispatch, which is why two of the three exits land in the same box." },
  { t: "RUN EXACTLY ONE",
    rows: [["unpushed + push trigger", "git push, and only that", "ok"],
           ["otherwise", "gh workflow run &lt;file&gt; --ref &lt;branch&gt;", "ok"],
           ["both", "the failure this skill exists to stop", "bad"]],
    lede: "The whole decision tree collapses to one command. The skill's words for the other case are blunt: <em>do NOT also run <code>gh workflow run</code></em>." },
  { t: "CATCH THE RUN ID",
    rows: [["sleep 15", "a run is not instantly queryable", "ok"],
           ["gh run list --limit 1 --workflow", "newest of that workflow", "ok"],
           ["a teammate pushed too", "you may catch theirs", "bad"],
           ["→ wait-for-github-workflow", "hand off", "ok"]],
    lede: "It reports the id and stops. Triggering and watching are two skills, so the watching half works against any run id you already hold." },
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "route" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

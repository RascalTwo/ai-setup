import { stepper, $ } from "@viz/kit";

type Mark = "ok" | "bad" | "warn";
interface Step {
  t: string;
  rows: [string, string, Mark][];
  lede: string;
}

const S: Step[] = [
  {
    t: "GATE + LOCK",
    rows: [
      ["launchd 03:17", "StartCalendarInterval", "ok"],
      ["pmset -g ps", "'AC Power'", "ok"],
      ["mkdir $STATE/dream.lock", "atomic", "ok"],
      ["set -e", "deliberately absent", "warn"],
    ],
    lede: "launchd coalesces every missed interval into <b>one</b> catch-up on wake, so a sleeping machine gets a late dream, not a backlog. On battery it declines outright.",
  },
  {
    t: "SCAN — STAGE 1",
    rows: [
      ["scan.py → prefilter.py", "no model at all", "ok"],
      ["every substantive human turn", "admitted", "ok"],
      ["subagent user-role moments", "suppressed", "bad"],
      ["processed.tsv", "dedupes hook + nightly", "ok"],
    ],
    lede: "Deterministic and deliberately <b>over-collecting</b>. The old keyword filter measured 20–64% recall and captured zero assistant turns — so stage 1 stopped trying to be clever and hands the judgement downstream.",
  },
  {
    t: "SCORE — STAGE 2",
    rows: [
      ["score.py", "one claude -p per batch", "ok"],
      ["→ state/candidates/", "written", "ok"],
      ["score-cache.jsonl", "resumable", "ok"],
      ["egress", "1 of 2", "warn"],
    ],
    lede: "The judge. About <b>60 of 91 misses</b> in the recall audit were unreachable by any pattern list, which is the whole argument for paying for a model here. Re-runs are free — the cache makes them idempotent.",
  },
  {
    t: "CLUSTER",
    rows: [
      ["ollama preflight", "nomic-embed-text", "ok"],
      ["cluster.py", "math, not an LLM call", "ok"],
      ["embeddings.jsonl → clusters.json", "grouped by root cause", "ok"],
      ["egress", "none", "ok"],
    ],
    lede: "Grouping candidates across sessions is arithmetic over embeddings. Local, because it is cheap and instant — <b>not</b> because it saves egress. The hybrid was measured and saves zero bytes.",
  },
  {
    t: "SYNTHESIZE",
    rows: [
      ["synthesize.py", "one claude -p per cluster", "ok"],
      ["blast radius", "distinct sessions reached", "ok"],
      ["propose-branch.sh", "a branch per proposal", "ok"],
      ["egress", "2 of 2", "warn"],
    ],
    lede: "One cluster becomes one proposal: an envelope in <code>state/proposals/</code> plus a real git branch carrying the change. Colliding proposals are merged <b>here</b>, upstream, so git rarely sees a conflict at all.",
  },
  {
    t: "CONFLICTS + HEARTBEAT",
    rows: [
      ["detect-conflicts.sh", "git merge-tree --write-tree", "ok"],
      ["against", "private/trunk", "ok"],
      ["last-dream.json", "written ALWAYS", "ok"],
      ["even on failure", "yes", "ok"],
    ],
    lede: "The heartbeat is the one thing that must never fail to write — hand-rolled JSON, no python3, no jq. A missing heartbeat is how the predecessor died silently for 3.5 months.",
  },
  {
    t: "REVIEW + APPLY",
    rows: [
      ["dream-queue viz", "ranked, diffed, badged", "ok"],
      ["last dream: N days ago", "turns alarming when stale", "warn"],
      ["merge-approved.sh", "squash, serial, approval order", "ok"],
      ["target", "private/trunk — never main", "ok"],
    ],
    lede: "The only human touchpoint. Nothing reaches <code>private/trunk</code> without a thumbs-up, which is exactly why there is no self-modification fence: a proposal that rewrites dream is just another branch you read.",
  },
];

/** A DOM lookup the page can't work without: fail loudly instead of a null later. */
const need = (sel: string): HTMLElement => {
  const el = $(sel);
  if (!(el instanceof HTMLElement)) throw new Error(`missing ${sel}`);
  return el;
};

const stage = need("#stage");
const lede = need("#lede");
const pos = need("#pos");
const mark: Record<Mark, [string, string]> = {
  ok: ["var(--good)", "✓"],
  bad: ["var(--danger)", "✗"],
  warn: ["var(--warn)", "•"],
};
const render = (i: number): void => {
  const s = S[i];
  if (!s) return;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
        <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                    padding:7px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--text)">${k}</span>
          <span style="color:${mark[st][0]};white-space:nowrap">${mark[st][1]} ${v}</span>
        </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "night" });
const play = need("#play");
let on = false;
const stop = (): void => {
  on = false;
  play.textContent = "▶ play";
};
need("#next").addEventListener("click", () => {
  stop();
  st.next();
});
need("#prev").addEventListener("click", () => {
  stop();
  st.prev();
});
play.addEventListener("click", () => {
  on = !on;
  if (on) st.play();
  else st.pause();
  play.textContent = on ? "❚❚ pause" : "▶ play";
});

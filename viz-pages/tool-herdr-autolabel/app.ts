import { stepper, $ } from "/_kit/viz.js";

type Status = "ok" | "bad";
interface Step { t: string; rows: [string, string, Status][]; lede: string }

const S: Step[] = [
  { t: "STOP FIRES",
    rows: [["$HERDR_TAB_ID", "set", "ok"], ["command -v herdr", "found", "ok"],
           ["command -v ollama", "found", "ok"], ["any missing", "exit 0, model never woken", "bad"]],
    lede: "Three checks before anything expensive. Outside herdr there is no tab to rename, so the cheapest correct answer is to do nothing — and to work that out without starting a subshell." },
  { t: "DETACH",
    rows: [["jq -r .transcript_path (stdin)", "~/.claude/projects/…jsonl", "ok"],
           ["{ … } >/dev/null 2>&1 &", "backgrounded", "ok"], ["hook returns", "exit 0", "ok"]],
    lede: "Everything past this point is a model call, and <b>a <code>Stop</code> hook that blocks is one you feel on every single turn.</b> Claude Code gets its zero immediately; ollama finishes unobserved." },
  { t: "CHECK THE LABEL",
    rows: [["herdr tab list → .label", "\"7\"", "ok"], ["all digits → herdr's own numbering", "fair game", "ok"],
           ["state file ~/.agents/state/herdr-autolabel/…", "css-bug", "ok"],
           ["\"prod-deploy\" ≠ ours", "back off, permanently", "bad"]],
    lede: "The one rule that makes it livable. A purely numeric label falls through the <code>case</code>; anything else must be byte-for-byte the slug this hook set last time. <b>A name you typed is a permanent opt-out.</b>" },
  { t: "BUILD THE PROMPT",
    rows: [["select(.type==\"user\")", "user turns only", "ok"],
           ["drop ^< · ^[Image · ^Caveat:", "tool results, images, notices", "ok"],
           ["head -1 | cut -c1-300", "the topic anchor", "ok"], ["tail -3 | cut -c1-300", "the recency", "ok"],
           ["Current slug: css-bug", "keep it if nothing changed", "ok"]],
    lede: "Both ends of the transcript matter: the first message is what the session <b>is</b>, the last three are what it has <b>become</b>. Hysteresis is asked for in words, not computed." },
  { t: "ASK THE MODEL",
    rows: [["ollama run qwen2.5-coder:7b", "local", "ok"], ["--keepalive 2m", "resident through a burst", "ok"],
           ["raw reply", "\"Css-Bug-Fixing.\"", "bad"]],
    lede: "7B was chosen by bake-off, not vibes — 0.5b echoed the instructions back as the answer. The reply still arrives padded, quoted and capitalised, which the next step assumes." },
  { t: "SANITIZE & RENAME",
    rows: [["head -1 · lowercase · tr -cs 'a-z0-9' '-'", "css-bug-fixing", "ok"],
           ["cut -c 1-12", "css-bug-fixi", "bad"], ["char 13 ≠ '-' → ${slug%-*}", "css-bug", "ok"],
           ["herdr tab rename", "7 → css-bug", "ok"], ["remember, only on success", "state written", "ok"]],
    lede: "The slug is only written to the state file <b>after</b> the rename succeeds. A failed rename that still recorded a name would make the next turn mistake herdr's real label for a human's." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const esc = (s: string) => s.replace(/&(?!\w+;|#)/g, "&amp;").replace(/<(?![\/a-z])/g, "&lt;");
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c5);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${esc(k)}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${esc(v)}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "label" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

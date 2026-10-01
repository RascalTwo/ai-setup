import { stepper, $ } from "/_kit/viz.js";

type Status = "ok" | "bad";
interface Step { t: string; rows: [string, string, Status][]; lede: string }

const S: Step[] = [
  { t: "ENCODE",
    rows: [["open(image, 'rb')", "bytes", "ok"], ["base64.b64encode", "+33% in memory", "ok"],
           ["unreadable file", "exit 2", "bad"]],
    lede: "No upload endpoint, no multipart. Ollama takes images inline, so the whole file rides in the JSON body as one base64 string." },
  { t: "BUILD THE BODY",
    rows: [["stream", "false", "ok"], ["keep_alive", "30m", "ok"], ["options.temperature", "0", "ok"],
           ["format (with --json)", "json", "ok"]],
    lede: "<code>keep_alive: 30m</code> is the one you feel — the model stays resident, so the second screenshot in a debugging loop answers immediately instead of paying the load again." },
  { t: "THE QWEN BRANCH",
    rows: [["\"qwen\" in model.lower()", "think: false", "ok"], ["format", "removed", "ok"],
           ["under format:json", "answer hides in `thinking`", "bad"]],
    lede: "A reasoning model under <code>format:json</code> puts its answer in <code>thinking</code> and leaves <code>response</code> empty — a run that succeeds and returns nothing. The branch puts it back." },
  { t: "POST TO OLLAMA",
    rows: [["localhost:11434/api/generate", "one POST", "ok"], ["timeout", "300s", "ok"],
           ["urllib.request", "stdlib only", "ok"]],
    lede: "Standard library the whole way — no Ollama SDK, no HTTP client dependency. If the daemon is up, the skill works." },
  { t: "VALIDATE, SHALLOWLY",
    rows: [["response or thinking", "non-empty", "ok"], ["empty", "ValueError", "bad"],
           ["--json → json.loads(txt)", "parses", "ok"], ["is the answer true?", "not checked", "bad"]],
    lede: "The engine asserts a <b>shape</b>, never a fact. A confidently wrong reading passes — which is why the extraction prompt is specific and the boundary above is drawn where it is." },
  { t: "TIER, OR HAND BACK",
    rows: [["gemma4:e4b", "tier 1", "ok"], ["gemma4:12b", "tier 2", "ok"],
           ["each failure", "stderr, not stdout", "ok"], ["all exhausted", "exit 3", "bad"]],
    lede: "Refusal, 404, timeout, empty, unparseable — one event to the caller: <em>try the next rung</em>. The last rung is native Claude, reached by an agent reading <code>LOCAL_VISION_FAILED</code>." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "tier" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

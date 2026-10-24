import { stepper, $ } from "@viz/kit";

/* ════════ Progress demo: a bar that fills by stage, holds at 90% until the next stage, then goes green or red ════════ */

const STAGES: { name: string; ms: number }[] = [
  { name: "lint", ms: 2000 },
  { name: "test", ms: 5000 },
  { name: "ship", ms: 2000 },
];
const demo = $("#demo")!;
const fill = $("#d-fill")!;
const stg = $("#d-stg")!;
const what = $("#d-what")!;
const when = $("#d-when")!;
let timer = 0;

const run = (fail: boolean): void => {
  clearInterval(timer);
  demo.className = "demo";
  const total = STAGES.reduce((n, s) => n + s.ms, 0);
  const t0 = performance.now();
  const tick = (): void => {
    const el = performance.now() - t0;
    let acc = 0;
    let i = 0;
    while (i < STAGES.length - 1 && el >= acc + STAGES[i]!.ms) acc += STAGES[i++]!.ms;
    if (fail && i === 1 && el - acc > 2500) {
      clearInterval(timer);
      demo.className = "demo failed";
      stg.textContent = "test failed: exit 1";
      what.textContent = "failed";
      when.textContent = `after ${Math.round(el / 1000)}s`;
      return;
    }
    if (el >= total) {
      clearInterval(timer);
      demo.className = "demo done";
      fill.style.width = "100%";
      stg.textContent = "done";
      what.textContent = "all 3 stages";
      when.textContent = `in ${Math.round(total / 1000)}s`;
      return;
    }
    const part = Math.min(0.9, (el - acc) / STAGES[i]!.ms);
    fill.style.width = `${Math.round(((i + part) / STAGES.length) * 100)}%`;
    stg.textContent = `stage ${i + 1} of ${STAGES.length}: ${STAGES[i]!.name}`;
    what.textContent = `${Math.round(((i + part) / STAGES.length) * 100)}%`;
    when.textContent = `about ${Math.max(1, Math.round((total - el) / 1000))}s left`;
  };
  tick();
  timer = window.setInterval(tick, 100);
};
$("#run-ok")!.addEventListener("click", () => run(false));
$("#run-bad")!.addEventListener("click", () => run(true));

/* ════════ Beat 5: one view, end to end ════════ */

type Row = [string, string, "ok" | "bad" | "mid"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}
const S: Step[] = [
  {
    t: "THE CALL",
    rows: [
      ["show { html | url }", "own tool", "ok"],
      ["progress { title, stage… }", "own tool", "ok"],
      ["app-panel-progress -- cmd", "same function", "mid"],
    ],
    lede: "A view starts one of three ways: the agent calls <code>show</code> or <code>progress</code>, or a shell runs <code>app-panel-progress</code>, which finds the host through <code>~/.agents/state/app-panel/sessions/&lt;pane&gt;.json</code> and posts to it. Outside herdr there is no session file; the command still runs, without a bar.",
  },
  {
    t: "PROXY",
    rows: [
      ["~/.config/app-panel/servers.json", "read at start", "ok"],
      ["qr__generate_qr", "<server>__<tool>", "ok"],
      ["claude mcp add (the server)", "loses its views", "bad"],
    ],
    lede: "The host connects to each server in <code>servers.json</code> (Claude Code's own <code>mcpServers</code> shape) and offers its tools as <code>&lt;server&gt;__&lt;tool&gt;</code>. A tool that carries a <code>ui://</code> view has it opened in the panel when called. A server name may not contain <code>__</code>.",
  },
  {
    t: "THE PANEL",
    rows: [
      ["helper/app-panel", "floating window", "ok"],
      ["Ghostty frontmost + pane focused", "shown", "ok"],
      ["no helper built", "browser tab instead", "mid"],
    ],
    lede: "Every view goes in the one panel for this session, newest on top, earlier ones in its list. The Swift helper sits at the Ghostty window corner and hides while another herdr pane is focused. Without the helper, the view opens in a browser tab.",
  },
  {
    t: "BRIDGE",
    rows: [
      ["view ⇄ sandbox ⇄ page ⇄ WebSocket", "a relay", "ok"],
      ["AppBridge in host.ts", "official ext-apps", "ok"],
      ["view's own tool calls", "reach the real server", "ok"],
    ],
    lede: "The view runs in a sandbox frame with a CSP sent as a header, so it cannot loosen it. The official <code>AppBridge</code> runs in the host against the real server, so a button inside the view can call that server&rsquo;s tools.",
  },
  {
    t: "YOU PRESS SOMETHING",
    rows: [
      ["button, or panel.send(text)", "ui/message", "ok"],
      ["latest model context", "attached", "ok"],
      ["show by URL", "no panel.send", "bad"],
    ],
    lede: "What the view sends the model is a <code>ui/message</code>, carrying the view&rsquo;s latest model context. A <code>show</code> by URL is another origin, so it has no <code>panel.send</code>.",
  },
  {
    t: "DELIVER",
    rows: [
      ["herdr agent prompt <pane> <text>", "typed into the pane", "ok"],
      ["[app-panel · title] text", "what the agent reads", "ok"],
      ["permission prompt open", "retry every 2s, 10 min", "mid"],
    ],
    lede: "The host types <code>[app-panel · &lt;title&gt;] &lt;text&gt;</code> into the session&rsquo;s herdr pane, as if you had. The agent weighs it as page content, not as an instruction from you. No herdr pane means the message has nowhere to go and the view gets an error back.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const color = { ok: "var(--good)", bad: "var(--danger)", mid: "var(--warn)" };
const mark = { ok: "✓", bad: "✗", mid: "…" };
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k.replaceAll("<", "&lt;")}</span>
        <span style="color:${color[st]};white-space:nowrap">${mark[st]} ${v.replaceAll("<", "&lt;")}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};
const st = stepper({ n: S.length, onStep: render, autoplayMs: 3200, hashKey: "view" });
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

import { stepper, $, $$ } from "@viz/kit";
import { cardBox, summarize } from "./vendor/panel.js";
import type { Card, PanelSpec } from "./vendor/panel.js";

/* ════════ Gallery: the REAL components (panel.ts, symlinked from skills/genui-viz/page/) ════════
   Each demo is a spec object. The JSON shown beside it is JSON.stringify of that same object, and
   cardBox() draws it, so the spec, the UI and the receipt cannot drift apart. */

const diffPatch = `diff --git a/src/fetch.ts b/src/fetch.ts
--- a/src/fetch.ts
+++ b/src/fetch.ts
@@ -1,4 +1,5 @@
 export async function get(url: string) {
-  const r = await fetch(url);
+  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
+  if (!r.ok) throw new Error(r.statusText);
   return r.json();
 }
diff --git a/tools/retry.py b/tools/retry.py
--- a/tools/retry.py
+++ b/tools/retry.py
@@ -2,3 +2,3 @@
 def retry(fn, n=3):
-    for _ in range(n): fn()
+    return next(r for r in map(lambda _: fn(), range(n)) if r)
`;

const htmlJs = `const out = document.getElementById("v");
const r = document.getElementById("r");
r.oninput = () => (out.textContent = r.value + "%");
document.getElementById("go").onclick = () => genui.answer({ opacity: Number(r.value) });`;

const DEMOS: { id: string; label: string; note: string; spec: PanelSpec }[] = [
  {
    id: "confirm",
    label: "confirm",
    note: "danger: true makes the yes button red; plain Enter will not press it, Cmd+Enter does.",
    spec: {
      type: "confirm",
      title: "Delete build/?",
      body: "212 MB, **untracked**. Nothing in `git` can bring it back.",
      facts: [
        ["Files", "1,204"],
        ["Last built", "3 days ago"],
      ],
      yes: "Delete",
      no: "Keep",
      danger: true,
    },
  },
  {
    id: "diff",
    label: "diff",
    note: "Highlighted per file by highlight.js (from a CDN), with line numbers and a +/- stat.",
    spec: { type: "diff", title: "Apply two fixes?", patch: diffPatch, yes: "Apply", no: "Reject" },
  },
  {
    id: "form",
    label: "form",
    note: "The schema is an MCP elicitation requestedSchema, verbatim. Invalid input blocks Send.",
    spec: {
      type: "form",
      title: "Deploy",
      schema: {
        required: ["env"],
        properties: {
          env: { type: "string", title: "Environment", enum: ["stg", "prod"] },
          replicas: { type: "integer", title: "Replicas", minimum: 1, maximum: 10, default: 2 },
          tags: { type: "array", title: "Tags", items: { enum: ["canary", "hotfix"] } },
          dryRun: { type: "boolean", title: "Dry run", default: true },
        },
      },
    },
  },
  {
    id: "choice",
    label: "choice",
    note: "One pick: press a row or its number. The answer is the row index.",
    spec: {
      type: "choice",
      title: "Which branch?",
      columns: ["Branch", "Ahead", "Author"],
      rows: [
        ["feature/viz-panels", "12", "jm"],
        ["fix/hook-escape", "3", "jm"],
        ["main", "0", "ci"],
      ],
    },
  },
  {
    id: "multi",
    label: "choice multi",
    note: "multi: true ticks any number of rows and sends them together as indexes.",
    spec: {
      type: "choice",
      title: "Which files to stage?",
      multi: true,
      columns: ["File", "Change"],
      rows: [
        ["src/fetch.ts", "+2 -1"],
        ["tools/retry.py", "+1 -1"],
        ["README.md", "+14"],
      ],
      submit: "Stage",
    },
  },
  {
    id: "notice",
    label: "notice",
    note: "Display only: a status badge, markdown and facts. show returns at once (unless wait: true).",
    spec: {
      type: "notice",
      title: "Build finished",
      status: "success",
      body: "All **412** tests passed. Coverage held at `91%`.",
      facts: [
        ["Duration", "2m 14s"],
        ["Commit", "f91bcda"],
      ],
    },
  },
  {
    id: "table",
    label: "table",
    note: "Display only: columns and rows, an optional markdown body above them.",
    spec: {
      type: "table",
      title: "Slowest tests",
      body: "Top three from the last run.",
      columns: ["Test", "Time"],
      rows: [
        ["genui.test.ts", "1.9s"],
        ["lib.test.ts", "0.8s"],
        ["panel.test.ts", "0.4s"],
      ],
    },
  },
  {
    id: "code",
    label: "code",
    note: "Display only: highlighted text in lang (else the title's extension).",
    spec: {
      type: "code",
      title: "retry.py",
      lang: "python",
      text: "def retry(fn, n=3):\n    for i in range(n):\n        try:\n            return fn()\n        except OSError:\n            if i == n - 1:\n                raise\n",
    },
  },
  {
    id: "html",
    label: "html",
    note: "The escape hatch: your own HTML/CSS/JS in a sandboxed iframe. genui.answer({...}) sends.",
    spec: {
      type: "html",
      title: "Overlay opacity",
      wait: true,
      html: '<p style="margin:0 0 10px">Opacity: <b id="v">50%</b></p><input id="r" type="range" min="0" max="100" value="50" style="width:100%"><p><button id="go">Use this</button></p>',
      css: "button{background:#3987e5;color:#fff;border:0;border-radius:8px;padding:7px 14px;font:600 14px system-ui;cursor:pointer}",
      js: htmlJs,
    },
  },
  {
    id: "stack",
    label: "stacked card",
    note: "Three components in one card. The pressed button answers for all: { form, confirm }.",
    spec: {
      title: "Ship v2.3?",
      components: [
        { type: "notice", status: "info", body: "CI green, 3 commits since v2.2." },
        {
          type: "form",
          title: "Options",
          schema: {
            properties: { canary: { type: "boolean", title: "Canary first", default: true } },
          },
        },
        { type: "confirm", yes: "Ship", no: "Hold" },
      ],
    },
  },
];

/* panel.css is written for a whole page (:root, body). Inside a shadow root those become :host and
   a shell div, so it cannot touch the poster, and the poster cannot touch it. */
const css = await (await fetch("./vendor/panel.css")).text();
const HLJS_CSS =
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css";
const sheet = css.replaceAll(/^:root\b/gmu, ":host").replaceAll(/^body\b/gmu, ".shell");

const host = $("#live")!;
const root = host.attachShadow({ mode: "open" });
const specEl = $("#spec")!;
const noteEl = $("#note")!;
const wire = $("#wire")!;
const tabs = $("#tabs")!;

let current = DEMOS[0]!;
const show = (id: string): void => {
  current = DEMOS.find((d) => d.id === id) ?? current;
  const card: Card = { id: "c-demo", spec: current.spec };
  specEl.textContent = JSON.stringify(current.spec, null, 2);
  noteEl.textContent = current.note;
  wire.className = "wire";
  wire.innerHTML =
    '<span class="d">waiting for the user</span> <span class="k">genui.ts show</span> is blocked on fs.watch of _log/answers';
  // replaceChildren detaches the old card, which is what stops its Escape handler firing
  root.replaceChildren();
  const style = document.createElement("style");
  style.textContent = `${sheet}:host{display:block}.shell{padding:22px 24px;border-radius:12px}`;
  const hl = document.createElement("link");
  hl.rel = "stylesheet";
  hl.href = HLJS_CSS;
  root.append(style, hl);
  const shell = document.createElement("div");
  shell.className = "shell";
  root.append(shell);
  const post = (a: Parameters<typeof summarize>[1] & object): void => {
    wire.className = "wire got";
    wire.innerHTML = `<span class="k">✓ c-demo: ${summarize(card, a).replaceAll(/[&<>]/gu, (c) => `&#${c.codePointAt(0)};`)}</span>`;
    wire.dataset["raw"] = JSON.stringify(a.cancelled ? { cancelled: true } : a.value);
    $("#raw")!.textContent = `answer line in _log/answers: ${wire.dataset["raw"]}`;
  };
  shell.append(cardBox(card, undefined, true, post));
  for (const b of $$("button", tabs)) b.classList.toggle("on", b.dataset["id"] === current.id);
  $("#raw")!.textContent = "";
  host.dataset["demo"] = current.id;
};

for (const d of DEMOS) {
  const b = document.createElement("button");
  b.textContent = d.label;
  b.dataset["id"] = d.id;
  b.dataset["vizId"] = `tab-${d.id}`;
  b.dataset["label"] = `show the ${d.label} component`;
  b.addEventListener("click", () => show(d.id));
  tabs.append(b);
}
$("#reset")!.addEventListener("click", () => show(current.id));
show("confirm");

/* ════════ Beat 5: one card, end to end ════════ */

type Row = [string, string, "ok" | "bad" | "mid"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}
const S: Step[] = [
  {
    t: "WRITE THE SPEC",
    rows: [
      ['{"type":"confirm","title":"Delete build/?"}', "~300 bytes", "ok"],
      ["bun genui.ts show spec.json", "blocks", "mid"],
    ],
    lede: "The agent writes JSON, nothing else. <code>parseSpec</code> in <code>lib.ts</code> rejects a bad shape before anything opens, so a typo costs one error line instead of a blank panel.",
  },
  {
    t: "ENSURE THE PAGE",
    rows: [
      ["~/.agents/state/genui-viz.json", "dir + URL cached", "ok"],
      ["panel.ts, panel.css", "re-copied if changed", "ok"],
      ["warm run", "~56 ms", "ok"],
    ],
    lede: "<code>ensurePage()</code> asks <code>viz</code> for the <code>genui</code> viz only on a cold cache; otherwise it trusts the cache and pings the URL. It copies the components in on <b>every</b> show, so an improved component redraws every old card.",
  },
  {
    t: "APPEND THE CARD",
    rows: [
      ["_log/cards", "+1 line", "ok"],
      ["id", "c-<time><rand>", "ok"],
      ["card = { id, pane, spec }", "viz page-data route", "ok"],
    ],
    lede: "<code>addCard()</code> appends one JSON line to the viz's page-data log (<code>.viz-data/cards.jsonl</code>). The card is data; nothing is rendered yet.",
  },
  {
    t: "OPEN THE PANEL",
    rows: [
      ["helper/genui-panel <url> 760 <pane>", "spawned", "ok"],
      ["WKWebView at ?card=c-…", "drawn by panel.ts", "ok"],
      ["no helper built", "browser tab instead", "mid"],
    ],
    lede: "<code>openCard()</code> runs the Swift helper built from <code>Panel.swift</code>. It sits at the Ghostty window corner, polls <code>herdr pane get</code> to hide while another pane is focused, remembers your drag in <code>UserDefaults</code>, and collapses to a pill on the – button.",
  },
  {
    t: "THE USER ANSWERS",
    rows: [
      ["button, number key, or Cmd+Enter", "cardBox post()", "ok"],
      ["POST _log/answers", "{card, value}", "ok"],
      ["window.close()", "helper exits", "ok"],
    ],
    lede: "<code>cardBox</code> hands the answer to <code>post</code>. On the real page that POSTs to <code>_log/answers</code> and closes the window. On this poster, <code>post</code> prints the receipt instead, which is the only thing that differs.",
  },
  {
    t: "THE WAIT RESOLVES",
    rows: [
      ["fs.watch(_log/)", "fires on the write", "ok"],
      ["✓ c-k3f2: Delete", "printed on stdout", "ok"],
      ["polling", "none", "bad"],
    ],
    lede: "<code>waitAnswer()</code> watches the folder (the first answer creates the file), so it resolves the instant the page POSTs. The CLI prints <code>✓ c-&lt;id&gt;: &lt;summary&gt;</code>.",
  },
  {
    t: "THE RECEIPT",
    rows: [
      ["PostToolUse hook", "matches ^✓ c-…", "ok"],
      ["system message", "✓ genui answer: …", "ok"],
      ["agent repeats it?", "no need", "bad"],
    ],
    lede: "A <code>PostToolUse</code> hook in <code>settings/claude-code/settings.json</code> turns that line into a <code>✓ genui answer: …</code> system message, so the user sees the receipt in the terminal without the agent echoing it.",
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
const st = stepper({ n: S.length, onStep: render, autoplayMs: 3200, hashKey: "card" });
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

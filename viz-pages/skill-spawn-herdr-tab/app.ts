import { $, $$, esc, arrowMarkers, labelBox, connect } from "@viz/kit";

/* ── figure 1: five hops, and what the prompt is at each ─────────────────────────
   Every box is defined once; arrows and the bracket are derived from the same nodes. */

interface Hop {
  id: string;
  name: string;
  sub: string;
  /** what the prompt is at this hop */
  is: string;
  /** the text itself is here (solid) or only a path to it (faint) */
  text: boolean;
}
const HOPS: Hop[] = [
  {
    id: "session",
    name: "the session",
    sub: "writes the prompt file",
    is: "the whole text, in a file on disk",
    text: true,
  },
  {
    id: "script",
    name: "spawn.sh",
    sub: "bash, jq",
    is: "<code>--prompt-file</code> a path, made absolute",
    text: false,
  },
  {
    id: "herdr",
    name: "herdr",
    sub: "tab create · pane run",
    is: "a path, inside the command string",
    text: false,
  },
  {
    id: "shell",
    name: "the tab's shell",
    sub: "runs the typed line",
    is: "<code>$(cat path)</code> expands here, once",
    text: true,
  },
  {
    id: "agent",
    name: "claude / codex",
    sub: "a fresh session",
    is: "one argument, intact",
    text: true,
  },
];
const NW = 140;
const STEP = 165;
const node = (i: number) => ({ x: i * STEP, y: 22, w: NW, h: 58 });
const strip = (i: number) => ({ x: i * STEP, y: 122, w: NW, h: 66 });

const sub = (s: string) => `<span style="font:11px var(--mono);color:var(--muted)">${s}</span>`;
const pipe = $("#pipe")!;
pipe.setAttribute("viewBox", "0 0 800 256");
pipe.innerHTML =
  arrowMarkers({ "ap-a": "var(--muted)", "ap-p": "var(--c4)" }) +
  HOPS.map((h, i) => {
    const n = node(i),
      s = strip(i);
    return (
      `<g data-viz-id="hop-${h.id}" data-label="${esc(h.name)}: the prompt is ${esc(h.is.replaceAll(/<[^>]+>/gu, ""))}">` +
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="var(--panel-2)" stroke="var(--border)"/>` +
      labelBox(n, `<div><b style="color:#fff">${esc(h.name)}</b><br>${sub(esc(h.sub))}</div>`) +
      `<line x1="${n.x + n.w / 2}" y1="${n.y + n.h}" x2="${s.x + s.w / 2}" y2="${s.y}" stroke="var(--border)" stroke-dasharray="3 4"/>` +
      `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="9" ` +
      (h.text
        ? `fill="color-mix(in srgb, var(--c4) 34%, transparent)" stroke="var(--c4)" stroke-width="1.6"`
        : `fill="color-mix(in srgb, var(--c4) 8%, transparent)" stroke="var(--c4)" stroke-opacity="0.45" stroke-dasharray="4 4"`) +
      `/>` +
      labelBox(
        s,
        `<div style="color:${h.text ? "#fff" : "var(--muted)"};font-size:12.5px">${h.is}</div>`,
      ) +
      `</g>`
    );
  }).join("") +
  HOPS.slice(1)
    .map(
      (_, i) =>
        `<path d="${connect(node(i), node(i + 1))}" fill="none" stroke="var(--muted)" stroke-width="2" marker-end="url(#ap-a)"/>`,
    )
    .join("") +
  // the bracket under the two hops where only a path exists
  (() => {
    const a = strip(1),
      b = strip(2),
      y = a.y + a.h + 16;
    return (
      `<g data-viz-id="bracket-path-only" data-label="bracket: only a path exists across these two hops">` +
      `<path d="M ${a.x} ${y - 6} L ${a.x} ${y} L ${b.x + b.w} ${y} L ${b.x + b.w} ${y - 6}" fill="none" stroke="var(--c4)" stroke-opacity="0.6" stroke-width="1.5"/>` +
      `<text x="${(a.x + b.x + b.w) / 2}" y="${y + 20}" text-anchor="middle" font-family="var(--mono)" font-size="12" fill="var(--c4)">only a path crosses here: nothing to quote</text>` +
      `</g>`
    );
  })();

/* ── figure 2: the command builder — the same assembly as spawn.sh lines 16-21 ─── */

type Agent = "claude" | "codex";
const PROMPTS: Record<string, string> = {
  none: "",
  handoff: "read /tmp/handoff-docs.md and continue",
  gnarly: 'Fix the "retry" bug.\nDon\'t touch $HOME/.config; `rm -rf` is off the table.',
};
const PROMPT_PATH = "/tmp/prompt-docs.md";

/** printf '%q' for the tokens this builder can produce: safe characters pass, the rest get a backslash. */
const q = (s: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/u.test(s)
    ? s
    : s.replaceAll(/[^A-Za-z0-9_@%+=:,./-]/gu, (c) => `\\${c}`);
/** how a person would type a value into the spawn.sh call: single quotes only when needed. */
const sq = (s: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(s) ? s : `'${s}'`);

const st = { agent: "claude" as Agent, model: "opus", effort: "high", prompt: "handoff" };

const mark = (cls: string, s: string) => `<span class="${cls}">${esc(s)}</span>`;
/** a quoted value, with printf %q's backslashes picked out in red */
const quoted = (s: string) => esc(q(s)).replaceAll("\\", `<span class="esc">\\</span>`);

const render = (): void => {
  const { agent, model, effort, prompt } = st;
  const withPrompt = prompt !== "none";

  // 1. what the skill runs
  const call =
    `<span class="h">WHAT THE SKILL RUNS</span>` +
    [
      `bash spawn.sh --label docs-sweep`,
      `--agent ${agent}`,
      model && `--model ${esc(sq(model))}`,
      effort && `--effort ${esc(sq(effort))}`,
      withPrompt && `--prompt-file ${PROMPT_PATH}`,
    ]
      .filter(Boolean)
      .join(" ");
  $("#p-call")!.innerHTML = call;

  // 2. the line typed into the new pane: lines 16-21
  const parts: string[] = [];
  if (agent === "claude") {
    parts.push(`<span class="ag">claude</span>`, mark("fl", "--dangerously-skip-permissions"));
    if (model) parts.push(mark("fl", "--model"), `<span class="va">${quoted(model)}</span>`);
    if (effort) parts.push(mark("fl", "--effort"), `<span class="va">${quoted(effort)}</span>`);
  } else {
    parts.push(`<span class="ag">codex</span>`);
    if (model) parts.push(mark("fl", "-m"), `<span class="va">${quoted(model)}</span>`);
    if (effort)
      parts.push(
        mark("fl", "-c"),
        `<span class="fl">model_reasoning_effort=</span><span class="va">${quoted(effort)}</span>`,
      );
  }
  if (withPrompt) parts.push(`<span class="pr">"$(cat ${PROMPT_PATH})"</span>`);
  $("#p-typed")!.innerHTML =
    `<span class="h">TYPED INTO THE NEW PANE BY <b style="font-weight:400;color:var(--muted)">herdr pane run</b></span>` +
    parts.join(" ");

  // 3. what the agent receives as its first message
  const text = PROMPTS[prompt]!;
  $("#p-arrives")!.innerHTML =
    `<span class="h">THE AGENT'S FIRST MESSAGE, AFTER THE TAB'S SHELL EXPANDS IT</span>` +
    (withPrompt
      ? text
          .split("\n")
          .map((l) => `<span class="pr">${esc(l)}</span>`)
          .join(`<span class="nl"> ⏎</span><br>`)
      : `<span class="nl">(none: the tab opens at an empty prompt)</span>`);

  // the point of the exercise, said once for whichever state is on screen
  const notes: string[] = [];
  if (prompt === "gnarly")
    notes.push(
      `<b>Quotes, <code>$HOME</code> and a backtick, and the typed line did not change.</b> The shell expands <code>$(cat …)</code> once and does not re-parse what comes back, so they reach the agent as written.`,
    );
  if (q(model) !== model)
    notes.push(
      `<b><code>printf %q</code> backslashed ${esc(model)}.</b> The pane's shell reads one word, not a glob or two arguments.`,
    );
  if (agent === "codex")
    notes.push(
      `<b>Codex takes different flags:</b> <code>-m</code> for the model and <code>-c model_reasoning_effort=</code> for effort, and no permissions flag.`,
    );
  if (!model && !effort && agent === "claude")
    notes.push(
      `<b>No model, no effort:</b> neither flag is added, so the agent's own defaults apply.`,
    );
  if (notes.length === 0)
    notes.push(
      `Only what you gave becomes a flag. Switch the prompt to the third option, or the model to <code>opus[1m]</code>, and read the boxes again.`,
    );
  $("#note")!.innerHTML = notes.join(" ");
};

const press = (group: Element, v: string) => {
  for (const b of $$("button", group)) b.setAttribute("aria-pressed", String(b.dataset["v"] === v));
};
const agentSeg = $("#agent")!;
for (const b of $$("button", agentSeg))
  b.addEventListener("click", () => {
    st.agent = b.dataset["v"] === "codex" ? "codex" : "claude";
    press(agentSeg, st.agent);
    render();
  });
const promptSeg = $("#prompt")!;
for (const b of $$("button", promptSeg))
  b.addEventListener("click", () => {
    st.prompt = b.dataset["v"] ?? "none";
    press(promptSeg, st.prompt);
    render();
  });
const modelIn = document.querySelector<HTMLInputElement>("#model")!;
modelIn.addEventListener("input", () => {
  st.model = modelIn.value.trim();
  render();
});
const effortSel = document.querySelector<HTMLSelectElement>("#effort")!;
effortSel.addEventListener("change", () => {
  st.effort = effortSel.value;
  render();
});
for (const b of $$(".quick button")) {
  b.addEventListener("click", () => {
    st.model = b.dataset["model"] ?? "";
    modelIn.value = st.model;
    render();
  });
}
render();

// A guided walkthrough of finished work: the real build, a guide that leads the human through it,
// reactions filed under the step they were on, one decision at the end, then the agent's own notes.
import { esc, saveHash } from "@viz/kit";
import { api } from "@viz/kit/api.js";
import type { Entry } from "@viz/kit/feedback-text.js";
import type { Routes } from "./contract.js";
import { WalkSchema, type Step } from "./walk.schema.js";
import { highlight, sendBlocked, sendWords, type Decision } from "./words.js";

type Feedback = { settle?(): Promise<void> };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kit declares window.vizFeedback in full; this page types only what it uses
const feedback = (): Feedback | undefined => (window as { vizFeedback?: Feedback }).vizFeedback;
function need<T extends HTMLElement>(sel: string, type: new () => T): T {
  const el = document.querySelector(sel);
  if (!(el instanceof type)) throw new Error(`index.html has no ${sel}`);
  return el;
}
const el = (sel: string) => need(sel, HTMLElement);
const warn = (e: unknown) => {
  console.error(e);
};

const walk = WalkSchema.parse(await (await fetch("walk.json", { cache: "no-store" })).json());
const vizId = location.pathname.replaceAll(/^\/|\/$/gu, "");
const { get, post } = api<Routes>();
const reached = new Set<string>();
let current = walk.steps[0]?.id ?? "";
let decision: Decision | null = null;
let showBefore = false;
let sending = false;
let approved = false; // an approved task has nothing more to Send

document.body.classList.add(walk.kind);
el("#title").textContent = walk.title;
el("#yes-text").textContent = walk.yes;
el("#change").innerHTML =
  `<code>${esc(walk.change.repo)} ${esc(walk.change.commit)}</code> “${esc(walk.change.subject)}”. ${esc(walk.source)}`;

function onStep(id: string) {
  const s = walk.steps.find((x) => x.id === id);
  if (!s) return;
  current = id;
  reached.add(id);
  if (s.before) showBefore = true;
  saveHash({ step: id }); // anything said or pinned now is filed under this step
  clip(s);
  render();
}

// A step that can't run live shows the agent's own recorded run, and says why.
function clip(s: Step) {
  const c = s.clip;
  el("#clip").hidden = !c;
  if (!c) return;
  el("#clip-why").textContent = c.why;
  const body = el("#clip-body");
  if (/\.(?:webm|mp4|mov)$/u.test(c.src))
    body.innerHTML = `<video src="${esc(c.src)}" controls preload="metadata"></video>`;
  else
    fetch(c.src)
      .then(async (r) => {
        body.innerHTML = `<pre>${highlight(await r.text(), s.look ?? [])}</pre>`;
      })
      .catch(warn);
}

function render() {
  el("#pips").innerHTML = walk.steps
    .map((s) => {
      const cls = s.id === current ? "cur" : reached.has(s.id) ? "seen" : "";
      return `<span class="pip ${cls}" data-viz-id="pip-${s.id}" data-label="${s.id}${reached.has(s.id) ? " seen" : ""}">${s.id}</span>`;
    })
    .join("");
  el("#stage").classList.toggle("split", showBefore);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-decide]"))
    b.classList.toggle("on", b.dataset["decide"] === decision);
  const why = sendBlocked(decision);
  el("#why").textContent = why ?? "";
  need("#send", HTMLButtonElement).disabled = !!why || sending || approved;
  el("#account").classList.toggle("open", !!decision);
  // The notes stay out of the page until the decision, not just out of sight.
  el("#notes").innerHTML = decision ? walk.notes.map((n) => `<li>${esc(n)}</li>`).join("") : "";
}

// ── web: the guide lives inside the app and reports each step here ──────────────────────────────
async function loadStage() {
  const s = await get("/stage");
  need("#now", HTMLIFrameElement).src = s.now;
  if (s.before) need("#before", HTMLIFrameElement).src = s.before;
}
addEventListener("message", (ev: MessageEvent<unknown>) => {
  if (ev.source !== need("#now", HTMLIFrameElement).contentWindow) return;
  const d: unknown = ev.data;
  if (!d || typeof d !== "object" || !("tour" in d)) return;
  const m: unknown = d.tour;
  if (!m || typeof m !== "object") return;
  if ("id" in m && typeof m.id === "string") onStep(m.id);
  if ("done" in m) el("#decide").scrollIntoView({ behavior: "smooth" });
});

// ── cli: the guide is a bubble over a real terminal; the human presses each command ─────────────
let at = 0;
const label = (run: string[]) => `$ ${run.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
function guide() {
  const s: Step | undefined = walk.steps[at];
  const g = el("#guide");
  if (!s) {
    g.innerHTML = `<div class="n">Walkthrough done</div><div>Run anything again with Start over. Your decision is below.</div>`;
    el("#decide").scrollIntoView({ behavior: "smooth" });
    return;
  }
  onStep(s.id);
  const cmd = s.run ? label(s.run) : "";
  const say = s.clip ? `${s.say}<br><small>The recording is below the terminals.</small>` : s.say;
  g.innerHTML = `<div class="n">Step ${at + 1} of ${walk.steps.length}</div><div>${say}</div>
    <div class="row">${at > 0 ? `<button data-g="back">‹ Back</button>` : ""}
    ${s.run ? `<button class="go" data-g="run" data-label="Run ${esc(cmd)}">▶ ${esc(cmd)}</button>` : `<button class="go" data-g="next">${at === walk.steps.length - 1 ? "Done" : "Next ›"}</button>`}</div>`;
}
async function runOn(side: "now" | "before", s: Step & { run: string[] }) {
  const term = el(side === "now" ? "#term-now" : "#term-before");
  const r = await post("/cmd", { body: { side, args: s.run } });
  term.innerHTML += `<span class="cmd">${esc(label(s.run))}</span>\n${highlight(r.output, s.look ?? [])}\n\n`;
  term.querySelector("mark:last-of-type")?.scrollIntoView({ block: "center", behavior: "smooth" });
}
async function runStep() {
  const s = walk.steps[at];
  if (!s?.run) return;
  const run = { ...s, run: s.run };
  await Promise.all([runOn("now", run), ...(s.before ? [runOn("before", run)] : [])]);
  at += 1;
  guide();
}
el("#guide").addEventListener("click", (ev) => {
  if (!(ev.target instanceof Element)) return;
  const a = ev.target.closest<HTMLElement>("[data-g]")?.dataset["g"];
  if (a === "run") runStep().catch(warn);
  if (a === "next") {
    at += 1;
    guide();
  }
  if (a === "back" && at > 0) {
    at -= 1;
    guide();
  }
});

async function restart() {
  el("#reset").textContent = "↺ resetting…";
  const r = await post("/reset");
  el("#reset").textContent = r.ok ? "↺ Start over" : `↺ failed: ${r.message}`;
  reached.clear();
  showBefore = false;
  if (walk.kind === "web") await loadStage();
  else {
    at = 0;
    el("#term-now").textContent = "";
    el("#term-before").textContent = "";
    guide();
  }
  render();
}
el("#reset").addEventListener("click", () => {
  restart().catch(warn);
});

// ── the decision, then the agent's notes, then Send ──────────────────────────────────────────────
el("#decide").addEventListener("click", (ev) => {
  if (!(ev.target instanceof Element)) return;
  const d = ev.target.closest<HTMLElement>("[data-decide]")?.dataset["decide"];
  if (d === "Accepted" || d === "Changes") decision = d;
  render();
});

function result(ok: boolean | null, line: string, words: string) {
  const box = el("#result");
  box.hidden = false;
  box.className = ok === null ? "" : ok ? "ok" : "fail";
  el("#result-line").textContent = line;
  need("#words", HTMLTextAreaElement).value = words;
}
// The relay doesn't wait on the feedback widget's own Send (which also tries to close the tab): the
// page says what happened to the words, and only a delivered Send marks them sent in the log.
async function sendAll() {
  if (!decision) return;
  await feedback()?.settle?.(); // words still being spoken or transcribed belong to this Send
  const r0 = await fetch("_log/feedback");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the widget's own log lines
  const log = r0.ok ? ((await r0.json()) as Entry[]) : [];
  const words = sendWords(walk, decision, reached, log, vizId);
  sending = true;
  render();
  result(null, "Sending…", words);
  try {
    const r = await post("/sent", { body: { words, decision } });
    if (r.ok && r.outcome === "approved") {
      approved = true;
      result(true, `Approved. ${r.message.replace(/^Approved\.\s*/u, "")}`, words);
      await fetch("_log/feedback", { method: "POST", body: JSON.stringify({ type: "send" }) });
    } else if (r.ok) {
      // saved: on the task, but the pane was closed; r.message is the kit's wording for that, on every page
      const line =
        r.outcome === "delivered"
          ? `Delivered: in the build agent's pane and on the task. ${r.message}`
          : r.message;
      result(true, line, words);
      await fetch("_log/feedback", { method: "POST", body: JSON.stringify({ type: "send" }) });
    } else
      result(
        false,
        `Not delivered: ${r.message.replace(/\.?$/u, ".")} Your words are below; Send again when it's fixed.`,
        words,
      );
  } catch (e) {
    result(
      false,
      `Not delivered: ${e instanceof Error ? e.message : String(e)}. Your words are below; Send again.`,
      words,
    );
  } finally {
    sending = false;
    need("#send", HTMLButtonElement).textContent = el("#result").classList.contains("ok")
      ? "Send to the build agent"
      : "Send again";
    render();
  }
}
el("#send").addEventListener("click", () => {
  sendAll().catch(warn);
});
el("#copy").addEventListener("click", () => {
  navigator.clipboard
    .writeText(need("#words", HTMLTextAreaElement).value)
    .then(() => {
      el("#copy").textContent = "Copied";
    })
    .catch(() => {
      need("#words", HTMLTextAreaElement).select(); // no clipboard permission: leave it selected to copy by hand
    });
});

render();
if (walk.kind === "web") await loadStage();
else guide();

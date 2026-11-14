// A demo of a change by persona: before beside after, a guide that leads the human through it (or ▶ Play
// doing it for them), reactions filed under the step they were on, and, live only, one decision at the
// end, then the agent's own notes.
import { esc, loadHash, saveHash, stepper } from "@viz/kit";
import { api } from "@viz/kit/api.js";
import type { Entry } from "@viz/kit/feedback-text.js";
import type { Routes } from "./contract.js";
import { movesOf, player } from "./play.js";
import { WalkSchema, type Step } from "./walk.schema.js";
import {
  barWidths,
  highlight,
  sendBlocked,
  sendWords,
  transcript,
  type Decision,
} from "./words.js";

// ui-narration's cursor (api/narrate); a build carries its own copy beside its guide.
type Narrate = {
  CFG: Record<string, number>;
  focusAndClick(el: Element): Promise<void>;
  hideBox(): void;
};
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the script defines window.__narrate; this page types only what it uses
const narrate = (): Narrate | undefined => (window as { __narrate?: Narrate }).__narrate;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduced) Object.assign(narrate()?.CFG ?? {}, { glide: 1, hold: 150, afterClick: 300 });
const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((r) => {
    setTimeout(r, ms);
  });
};

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
const web = walk.kind === "web";
const promisedMode = walk.mode === "promised";
const n = walk.steps.length;
const reached = new Set<string>();
let current = walk.steps[0]?.id ?? "";
let decision: Decision | null = null;
let hasBefore = false; // web: the previous build is running beside this one
let sending = false;
let approved = false; // an approved task has nothing more to Send

document.body.classList.add(walk.kind, walk.mode);
if (window !== window.parent) document.body.classList.add("embedded"); // the spec page frames the promised demo
el("#title").textContent = walk.title;
el("#yes-text").textContent = walk.yes ?? "";
el("#change").innerHTML =
  `<code>${esc(walk.change.repo)} ${esc(walk.change.commit)}</code> “${esc(walk.change.subject)}”. ${esc(walk.source)}`;
const impact = walk.impact ? `<p class="impact"><b>What changes for people.</b> ${esc(walk.impact)}</p>` : "";
el("#what").innerHTML = impact + (promisedMode
  ? `<b>The promised demo.</b> A throwaway mock with made-up data: what you would do after this change, per persona, beside what you do today. Click through it yourself, or press ▶ Play and watch. You judge it on the spec page.`
  : `<b>How this works.</b> Pick a persona and follow the guide through the real build, or press ▶ Play and watch it done for you (✋ takes the controls back). Say anything the moment it strikes you (🎙 bottom right, or 💬 to type): it's filed under the persona and step you're on. The strip at the bottom shows the steps you've been through. At the end, decide once.`);

const indexOf = (id: string) => walk.steps.findIndex((x) => x.id === id);
const scroll = (sel: string) => {
  el(sel).scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
};

function onStep(id: string) {
  const s = walk.steps.find((x) => x.id === id);
  if (!s) return;
  current = id;
  reached.add(id);
  saveHash({ step: id }); // anything said or pinned now is filed under this step
  clip(s);
  capture(s).catch(warn);
  render();
}

// A step that can't run live shows the agent's own recorded run, and says why.
function clip(s: Step) {
  const c = s.clip;
  el("#clip").hidden = !c;
  if (!c) return;
  el("#clip-why").textContent = c.why;
  const body = el("#clip-body");
  if (walk.kind === "agent") body.textContent = ""; // the two transcripts above are the recording
  else if (/\.(?:webm|mp4|mov)$/u.test(c.src))
    body.innerHTML = `<video src="${esc(c.src)}" controls preload="metadata"></video>`;
  else
    fetch(c.src)
      .then(async (r) => {
        body.innerHTML = `<pre>${highlight(await r.text(), s.look ?? [])}</pre>`;
      })
      .catch(warn);
}

// A capture stands for the before when it can't run: an image, or text such as terminal output.
async function capture(s: Step) {
  el("#stage").classList.toggle("has-cap", !!s.capture);
  if (!s.capture) return;
  const body = el("#cap-body");
  if (/\.(?:png|jpe?g|gif|webp|svg)$/iu.test(s.capture))
    body.innerHTML = `<img src="${esc(s.capture)}" alt="The before, captured" />`;
  else
    body.innerHTML = `<pre>${highlight(await (await fetch(s.capture)).text(), s.look ?? [])}</pre>`;
  render(); // the split follows the capture
}

function render() {
  const i = indexOf(current);
  const s = walk.steps[i];
  let last = "";
  el("#pips").innerHTML = walk.steps
    .map((x) => {
      const cls = [
        x.id === current ? "cur" : reached.has(x.id) ? "seen" : "",
        x.differs ? "differs" : "",
      ].join(" ");
      const group =
        x.persona === last
          ? ""
          : `<span class="pgroup" data-label="Persona ${esc(x.persona)}">${esc(x.persona)}</span>`;
      last = x.persona;
      return `${group}<span class="pip ${cls}" data-viz-id="pip-${x.id}" data-label="${x.id}${reached.has(x.id) ? " seen" : ""}${x.differs ? ", differs from the promise" : ""}">${x.id}</span>`;
    })
    .join("");
  el("#personas").innerHTML = walk.personas
    .map((p) => {
      const mine = walk.steps.filter((x) => x.persona === p.id);
      return `<button class="persona${s?.persona === p.id ? " on" : ""}" data-persona="${esc(p.id)}" data-label="${esc(p.id)}: ${esc(p.who)}"${mine.length === 0 ? " disabled" : ""}><b>${esc(p.id)}</b> ${esc(p.who)} <small>${mine.length} step${mine.length === 1 ? "" : "s"}${mine.some((x) => x.differs) ? " · ≠" : ""}</small></button>`;
    })
    .join("");
  const stage = el("#stage");
  const flagged = walk.steps.slice(0, i + 1).some((x) => x.before);
  const split = walk.kind === "agent" || (flagged && (!web || hasBefore)); // an agent demo is always two transcripts
  stage.classList.toggle("split", split || stage.classList.contains("has-cap"));
  // The step's marks: how it differs from the promise, the promise itself, the measured pairs.
  el("#differs").hidden = !s?.differs;
  el("#differs").innerHTML = s?.differs
    ? `<b>≠ Differs from the promise.</b> ${esc(s.differs)}`
    : "";
  const promise = promisedMode ? undefined : s?.promised;
  el("#promised").hidden = !promise;
  el("#promised-body").innerHTML = promise ?? "";
  el("#measure").hidden = !s?.measure?.length;
  el("#measure-rows").innerHTML = (s?.measure ?? [])
    .map((m) => {
      const w = barWidths(m);
      return `<div class="mrow"><span class="mlabel">${esc(m.label)}</span><div class="mbars"><div class="mb before" style="width:${w.before}%"><span>before ${m.before} ${esc(m.unit)}</span></div><div class="mb after" style="width:${w.after}%"><span>after ${m.after} ${esc(m.unit)}</span></div></div></div>`;
    })
    .join("");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-decide]"))
    b.classList.toggle("on", b.dataset["decide"] === decision);
  const why = sendBlocked(decision);
  el("#why").textContent = why ?? "";
  need("#send", HTMLButtonElement).disabled = !!why || sending || approved;
  el("#account").classList.toggle("open", !!decision);
  // The notes stay out of the page until the decision, not just out of sight.
  el("#notes").innerHTML = decision ? walk.notes.map((x) => `<li>${esc(x)}</li>`).join("") : "";
}

// ── web: the guide lives inside the app and reports each step here ──────────────────────────────
let tourAt = 0; // the step the guide inside the app is on
const nowWin = () => need("#now", HTMLIFrameElement).contentWindow;
async function loadStage() {
  const s = await get("/stage");
  need("#now", HTMLIFrameElement).src = s.now;
  hasBefore = !!s.before;
  if (s.before) need("#before", HTMLIFrameElement).src = s.before;
}
const waiting = new Map<string, () => void>(); // Play, waiting for the app's cursor to finish a step's moves
addEventListener("message", (ev: MessageEvent<unknown>) => {
  if (ev.source !== nowWin()) return;
  const d: unknown = ev.data;
  if (!d || typeof d !== "object" || !("tour" in d)) return;
  const m: unknown = d.tour;
  if (!m || typeof m !== "object") return;
  if ("id" in m && typeof m.id === "string") {
    tourAt = indexOf(m.id);
    shown = tourAt; // the guide is already there: show() has nothing to tell it
    onStep(m.id);
    pos.follow(tourAt);
  }
  if ("played" in m && typeof m.played === "string") waiting.get(m.played)?.();
  if ("done" in m && !promisedMode) scroll("#decide");
});
async function playWeb(i: number) {
  const s = walk.steps[i];
  if (!s) return;
  if (tourAt !== i) {
    nowWin()?.postMessage({ play: { goto: i } }, "*");
    await sleep(700); // the guide's own glide to the step
  }
  const moves = movesOf(s);
  if (moves.length === 0) return;
  await new Promise<void>((res) => {
    const t = setTimeout(res, 20_000);
    waiting.set(s.id, () => {
      clearTimeout(t);
      waiting.delete(s.id);
      res();
    });
    nowWin()?.postMessage({ play: { id: s.id, moves } }, "*");
  });
}

// ── cli, agent, dev: the guide is a bubble over the terminals; the human presses each button ─────
let at = 0;
let cursorOwned = false; // a fake cursor (Play) may press the guide's button; a stray untrusted click may not
let pending: Promise<void> = Promise.resolve();
const texts = new Map<string, string>(); // agent kind: each step's two recordings
const label = (run: string[]) => `$ ${run.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
function transcripts() {
  if (walk.kind !== "agent") return;
  const marks = walk.steps.slice(0, at + 1).flatMap((x) => x.look ?? []);
  for (const side of ["now", "before"] as const)
    el(side === "now" ? "#term-now" : "#term-before").innerHTML = highlight(
      transcript(walk.steps, at, side, (src) => texts.get(src) ?? ""),
      marks,
    );
}
function guide() {
  const s: Step | undefined = walk.steps[at];
  const g = el("#guide");
  if (!s) {
    g.innerHTML = `<div class="n">Demo done</div><div>Run anything again with Start over.${promisedMode ? "" : " Your decision is below."}</div>`;
    if (!promisedMode) scroll("#decide");
    return;
  }
  onStep(s.id);
  pos.follow(at);
  transcripts();
  const run = s.run && walk.cmd ? s.run : null;
  const cmd = run ? label(run) : "";
  const say =
    s.clip && walk.kind !== "agent"
      ? `${s.say}<br><small>The recording is below the terminals.</small>`
      : s.say;
  g.innerHTML = `<div class="n">Step ${at + 1} of ${n} · ${esc(s.persona)}</div><div>${say}</div>
    <div class="row">${at > 0 ? `<button data-g="back">‹ Back</button>` : ""}
    ${run ? `<button class="go" data-g="run" data-label="Run ${esc(cmd)}">▶ ${esc(cmd)}</button>` : `<button class="go" data-g="next">${at === n - 1 ? "Done" : "Next ›"}</button>`}</div>`;
}
async function runOn(side: "now" | "before", s: Step, run: string[]) {
  const term = el(side === "now" ? "#term-now" : "#term-before");
  const r = await post("/cmd", { body: { side, args: run } });
  term.innerHTML += `<span class="cmd">${esc(label(run))}</span>\n${highlight(r.output, s.look ?? [])}\n\n`;
  term
    .querySelector("mark:last-of-type")
    ?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}
/** The guide's main button for the step in hand: run its command (both sides), or just move on. */
async function advance() {
  const s = walk.steps[at];
  if (!s) return;
  if (s.run && walk.cmd)
    await Promise.all([runOn("now", s, s.run), ...(s.before ? [runOn("before", s, s.run)] : [])]);
  at += 1;
  guide();
}
el("#guide").addEventListener("click", (ev) => {
  if (!(ev.target instanceof Element)) return;
  const a = ev.target.closest<HTMLElement>("[data-g]")?.dataset["g"];
  if (!ev.isTrusted && !cursorOwned) return;
  if (a === "run" || a === "next") pending = advance().catch(warn);
  if (a === "back" && at > 0) nav?.go(at - 1);
});
async function playGuide(i: number) {
  if (at !== i) {
    at = i;
    guide();
  }
  const btn = document.querySelector<HTMLElement>('#guide [data-g="run"], #guide [data-g="next"]');
  if (!btn) return;
  cursorOwned = true;
  try {
    const nar = narrate();
    if (nar) await nar.focusAndClick(btn);
    else btn.click();
    await pending;
  } finally {
    cursorOwned = false;
    narrate()?.hideBox();
  }
}
async function loadTexts() {
  const srcs = walk.steps
    .flatMap((s) => [s.clip?.src, s.clip?.before])
    .filter((x): x is string => !!x);
  await Promise.all(
    srcs.map(async (src) => {
      texts.set(src, await (await fetch(src)).text());
    }),
  );
}

// ── ▶ Play, the position, the arrow keys, and "Do it myself" ─────────────────────────────────────
let shown = 0;
function show(i: number) {
  nav?.go(i, false); // the stepper's own position follows (an equal one is ignored)
  if (i === shown) return;
  shown = i;
  if (web) {
    if (tourAt !== i) {
      tourAt = i;
      nowWin()?.postMessage({ play: { goto: i } }, "*");
    }
  } else if (at !== i) {
    at = i;
    guide();
  }
}
const pos = player(n, {
  play: async (i) => {
    await (web ? playWeb(i) : playGuide(i));
  },
  hold: async () => {
    await sleep(reduced ? 300 : 900);
  },
  abort: () => {
    for (const done of waiting.values()) done();
    nowWin()?.postMessage({ play: { stop: true } }, "*");
    cursorOwned = false;
    narrate()?.hideBox();
  },
  onChange: (st) => {
    el("#play-go").textContent = st.playing ? "❚❚ Pause" : "▶ Play";
    el("#play-pos").textContent = `${st.at + 1} / ${n}`;
    show(st.at);
    render();
  },
});
saveHash({ ...loadHash(), pos: 0 }); // a reload starts at step 1, as the guide does
let nav: ReturnType<typeof stepper> | undefined;
nav = stepper({
  n,
  hashKey: "pos",
  onStep: (i) => {
    if (i !== pos.state.at) pos.go(i);
  },
});
el("#play-pos").textContent = `1 / ${n}`;
el("#play-go").addEventListener("click", () => {
  if (pos.state.playing) pos.pause();
  else pos.start();
});
el("#play-mine").addEventListener("click", () => {
  pos.stop();
});
el("#play-back").addEventListener("click", () => {
  nav?.go(pos.state.at - 1);
});
el("#play-fwd").addEventListener("click", () => {
  nav?.go(pos.state.at + 1);
});
el("#personas").addEventListener("click", (ev) => {
  if (!(ev.target instanceof Element)) return;
  const p = ev.target.closest<HTMLElement>("[data-persona]")?.dataset["persona"];
  const first = walk.steps.findIndex((x) => x.persona === p);
  if (first >= 0) nav?.go(first);
});

async function restart() {
  el("#reset").textContent = "↺ resetting…";
  pos.stop();
  const r = await post("/reset");
  el("#reset").textContent = r.ok ? "↺ Start over" : `↺ failed: ${r.message}`;
  reached.clear();
  at = 0;
  tourAt = 0;
  shown = 0;
  pos.go(0);
  if (web) await loadStage();
  else {
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
if (web) await loadStage();
else {
  if (walk.kind === "agent") await loadTexts();
  guide();
}

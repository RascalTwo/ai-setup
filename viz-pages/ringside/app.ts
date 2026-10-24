// app.ts — polls the transcript through api.ts and redraws: the "right now" card, the round
// summary, the swimlane timeline (one extra row per subagent), and the play-by-play feed.
import { $, esc } from "@viz/kit";
import {
  get,
  post,
  state,
  persist,
  dur,
  clock,
  ago,
  colorOf,
  laneName,
  laneInfo,
  labels,
  outcomes,
  lanes,
  AI_MARK,
  labelOf,
  labelHtml,
  outcomeOf,
  SLOTS,
  WinSchema,
  type Win,
  type Job,
  roundStart,
  lastEvent,
  isLive,
  tNow,
  isSub,
  finishedTurn,
  running,
  targetEl,
} from "./store.js";
import { viewRange, shownRound, renderTimeline, renderOverview, wireTimeline } from "./timeline.js";
export { dur } from "./store.js";
export { tickStep } from "./timeline.js";
import {
  LANES,
  agentId,
  agentName,
  clip,
  helperTree,
  renderMarkdown,
  splitReplies,
  shellSteps,
  stepLane,
  stripMarkdown,
  summariseRound,
  type Call,
  type Lane,
  type Result,
  type Say,
} from "./model.js";

const sessionSel = $<HTMLSelectElement>("#session")!;

// ── data ──────────────────────────────────────────────────────────────────────
function reset(id: string): void {
  Object.assign(state, {
    id,
    offset: 0,
    prompts: [],
    says: [],
    order: [],
    subs: {},
    // A custom range belongs to the session it was set in; the very first pick keeps one from the link.
    view: state.id ? null : state.view,
    round: state.id ? null : state.round,
    lastGrowth: Date.now(),
  });
  state.agents.clear();
  state.calls.clear();
  state.orphans.clear();
  state.previews.clear();
  persist();
}

function apply(r: Result): void {
  const c = state.calls.get(r.id);
  if (!c) {
    state.orphans.set(r.id, r);
    return;
  }
  c.end = r.end;
  c.error = r.error;
  state.previews.set(r.id, r.preview);
}

async function pull(): Promise<void> {
  if (!state.id) return;
  for (let i = 0; i < 20; i++) {
    const query = { id: state.id, from: String(state.offset), subs: JSON.stringify(state.subs) };
    // oxlint-disable-next-line no-await-in-loop -- each chunk starts at the offset the previous one returned
    const chunk = await get("/events", { query });
    const moved = chunk.offset !== state.offset || JSON.stringify(chunk.subs) !== query.subs;
    if (moved) state.lastGrowth = Date.now();
    for (const info of chunk.agents) state.agents.set(info.id, info);
    for (const c of chunk.calls) {
      if (state.calls.has(c.id)) continue;
      state.calls.set(c.id, c);
      state.order.push(c);
      const o = state.orphans.get(c.id);
      if (o) {
        state.orphans.delete(c.id);
        apply(o);
      }
    }
    chunk.results.forEach(apply);
    state.prompts.push(...chunk.prompts);
    state.says.push(...chunk.says);
    state.offset = chunk.offset;
    state.subs = chunk.subs;
    if (!(chunk.more && moved)) break;
  }
}

async function pullSessions(): Promise<void> {
  const { sessions } = await get("/sessions");
  state.sessions = sessions;
  const newest = sessions[0];
  if (newest && (state.follow || !state.id) && newest.id !== state.id) reset(newest.id);
  const opts = sessions.map(
    (s) =>
      `<option value="${esc(s.id)}">${esc(ago(s.mtime))} · ${esc(s.project.replace(/^.*\//u, ""))} · ${esc(s.title.slice(0, 60))}</option>`,
  );
  if (state.id && !sessions.some((s) => s.id === state.id))
    opts.push(`<option value="${esc(state.id)}">${esc(state.id)}</option>`);
  sessionSel.innerHTML = opts.join("");
  sessionSel.value = state.id;
}

// ── beats: one model-written line per conversation strip, from its labels, outcomes and notes ──
const beats = {
  store: new Map<string, string>(),
  asked: new Set<string>(),
  pending: new Set<string>(),
};
let beatsInflight = 0;
/** A strip's beat is asked again only if it gains steps, so its key carries its counts. */
const beatKey = (key: string, run: Run): string =>
  `${state.id} ${key} ${run.calls.length} ${run.notes.length}`;

const stepLine = (c: Call): string => {
  const out = outcomeOf(c);
  return (
    labelOf(c) +
    (out ? ` → ${out}` : "") +
    (c.error ? " (failed)" : "") +
    (isSub(c) ? ` [helper: ${agentName(c.agent)}]` : "")
  );
};

/** Strips worth a line: two or more steps, and over (a message follows, or the turn is done). Newest first. */
function beatAsks(): { key: string; before: string; steps: string[]; after: string }[] {
  const ts = turns();
  const working = isLive() && !finishedTurn();
  return [...stripsOf(ts)]
    .flatMap(([k, run]) => {
      const over = k < ts.length || !working;
      if (!over || run.calls.length + run.notes.length < 2) return [];
      const steps: [number, string][] = [
        ...run.calls.map((c): [number, string] => [c.start, stepLine(c)]),
        ...run.notes.map((s): [number, string] => [
          s.at,
          `Claude said: ${clip(stripMarkdown(s.text), 200)}`,
        ]),
      ];
      return [
        {
          key: beatKey(stripKey(ts, k), run),
          before: ts[k - 1]?.text ?? "(start of the session)",
          steps: steps.toSorted(([a], [b]) => a - b).map(([, s]) => s),
          after: ts[k]?.text ?? "",
        },
      ];
    })
    .toReversed();
}

async function askBeat(ask: ReturnType<typeof beatAsks>[number]): Promise<void> {
  beats.asked.add(ask.key);
  beatsInflight++;
  beats.pending.add(ask.key);
  try {
    const { beat } = await post("/beat", { body: ask });
    if (beat) beats.store.set(ask.key, beat);
  } catch {
    // the strip keeps its counts
  }
  beats.pending.delete(ask.key);
  beatsInflight--;
  renderConversation();
  pumpBeats();
}

/**
 * Asks for the strips that have no line yet, newest first, two at a time, once the labels and
 * outcomes in view are in, so a line is written from them rather than from fallback labels.
 */
// ponytail: strips out of view are summed up from what is known (labels, notes, the reply), not
// from outcomes; asking outcomes for a whole session first would take minutes on the local model.
function pumpBeats(): void {
  const { done, total } = inView();
  if (done < total) return;
  for (const ask of beatAsks()
    .filter((a) => !beats.asked.has(a.key))
    .slice(0, SLOTS - beatsInflight))
    askBeat(ask).catch(console.error);
}

// ── the story: the whole session retold from its prompts, strip summaries and replies ──
const story = { key: "", pending: false, texts: new Map<string, string>() };

/** The session in order, as the story is told from it: a strip's summary where there is one, else its steps. */
function storyLines(): string[] {
  const ts = turns();
  const buckets = stripsOf(ts);
  const out: string[] = [];
  const strip = (k: number): void => {
    const run = buckets.get(k);
    if (!run) return;
    const said = beats.store.get(beatKey(stripKey(ts, k), run));
    const steps = [
      ...run.calls.map((c) => labelOf(c)),
      ...run.notes.map((s) => clip(stripMarkdown(s.text), 150)),
    ];
    out.push(
      said
        ? `What the agent did:\n${said}`
        : `What the agent did (not summed up yet): ${clip(steps.join("; "), 600)}`,
    );
  };
  strip(0);
  for (const [i, t] of ts.entries()) {
    out.push(
      t.kind === "user"
        ? `P${t.n}: ${clip(t.text, 400)}`
        : `Agent replied: ${clip(stripMarkdown(t.text), 400)}`,
    );
    strip(i + 1);
  }
  return out;
}

async function askStory(key: string): Promise<void> {
  const id = state.id;
  story.key = key;
  story.pending = true;
  renderStory();
  try {
    const { story: told } = await post("/story", { body: { key, lines: storyLines() } });
    if (told) story.texts.set(id, told);
  } catch {
    // the last story stays
  }
  story.pending = false;
  renderStory();
}

/**
 * Retells the session once every finished strip has its summary, and again only when another
 * strip is summed up, so a story is never written from half the summaries.
 */
function pumpStory(): void {
  const asks = beatAsks();
  if (story.pending || beatsInflight > 0 || asks.some((a) => !beats.asked.has(a.key))) return;
  const key = `${state.id} ${asks.length} ${beats.store.size}`;
  if (key !== story.key && turns().length > 0) askStory(key).catch(console.error);
}

function renderStory(): void {
  const told = story.texts.get(state.id);
  $("#story")!.innerHTML = told
    ? `${renderMarkdown(told)}${AI_MARK("story")}`
    : `<div class="empty">The story is written once the conversation's strips are summed up.</div>`;
  $("#story-state")!.textContent = story.pending ? "✦ writing…" : "";
}

async function runJob(job: Job, c: Call): Promise<void> {
  job.inflight++;
  job.pending.add(c.id);
  renderConversation();
  try {
    const answer = await job.ask(c);
    if (answer) job.store.set(c.id, answer);
  } catch {
    // the page keeps what it has
  }
  job.pending.delete(c.id);
  job.settled.add(c.id);
  job.inflight--;
  pump(job);
  renderAll();
}

/** The calls the reader can see: inside the timeline's range, or in an expanded conversation strip. Newest first. */
function visibleCalls(): Call[] {
  const { t0, t1 } = viewRange();
  const now = tNow();
  const ts = turns();
  const inOpenStrip = new Set(
    [...stripsOf(ts)]
      .filter(([k]) => state.strips.has(stripKey(ts, k)))
      .flatMap(([, run]) => run.calls.map((c) => c.id)),
  );
  return state.order
    .filter((c) => inOpenStrip.has(c.id) || ((c.end ?? now) >= t0 && c.start <= t1))
    .toSorted((x, y) => y.start - x.start);
}

/** Asks for the visible calls that have no answer yet, newest first, two at a time. */
function pump(job: Job): void {
  for (const c of job.everywhere ? state.order.toReversed() : visibleCalls()) {
    if (job.inflight >= SLOTS) return;
    if (!job.want(c) || job.asked.has(c.id)) continue;
    job.asked.add(c.id);
    runJob(job, c).catch(console.error);
  }
}

let pumpTimer: ReturnType<typeof setTimeout> | undefined;
/** Re-prioritises after the view or the open strips change; what left the view and was not sent is dropped. */
function pumpSoon(): void {
  clearTimeout(pumpTimer);
  pumpTimer = setTimeout(() => {
    pump(labels);
    pump(outcomes);
    pump(lanes);
    renderNote();
  }, 150);
}

/** "✦ labelling 34 of 120 in view" while the model is still writing for what the reader can see. */
/** How many of the labels and outcomes wanted for the calls in view have come back. */
function inView(): { done: number; total: number } {
  let total = 0;
  let done = 0;
  const vis = visibleCalls();
  for (const job of [labels, outcomes])
    for (const c of vis.filter(job.want)) {
      total++;
      if (job.settled.has(c.id)) done++;
    }
  return { done, total };
}

function renderNote(): void {
  const { done, total } = inView();
  $("#ai-note")!.textContent = done < total ? `✦ labelling ${done} of ${total} in view` : "";
}

// ── render: now card ──
/** "Round took 29s · Run 63% · Change 25%" and the slowest action, for a finished round. */
function roundSummaryText(from: number, to: number): string {
  const s = summariseRound(
    state.order
      .filter((c) => !isSub(c))
      .map((c) => ({ lane: c.lane, label: labelOf(c), start: c.start, end: c.end })),
    from,
    to,
  );
  /* c8 ignore next -- every Lane is in LANES, so the name is always found */
  const split = s.lanes.map((l) => `${laneInfo.get(l.lane)?.name ?? ""} ${l.pct}%`);
  const head = ["Round took " + dur(s.totalMs), ...split].join(" · ");
  return s.slowest ? `${head}\nSlowest: ${s.slowest.label} (${dur(s.slowest.ms)})` : head;
}

function renderNow(): void {
  const run = running();
  const card = $("#now")!;
  const from = roundStart();
  const said = state.says.findLast((s) => s.at >= from);
  const saidEl = $("#now-said")!;
  saidEl.hidden = !said;
  saidEl.textContent = said ? `“${clip(stripMarkdown(said.text), 240)}”` : "";
  card.classList.toggle("running", run.length > 0);
  const done = finishedTurn();
  $("#now-summary")!.textContent = "";
  const lastDone = state.order
    .filter((c) => c.end !== null)
    .toSorted((x, y) => Number(y.end) - Number(x.end))[0];
  const lastOutcome = lastDone && outcomeOf(lastDone);
  $("#now-last")!.innerHTML =
    lastDone && lastOutcome
      ? `Last: ${esc(labelOf(lastDone))} → ${esc(lastOutcome)}${AI_MARK("outcome")}`
      : "";
  const mainRun = run.filter((c) => !isSub(c));
  const latest = mainRun.at(-1) ?? run.at(-1);
  const byHelper = new Map<string, Call>();
  for (const c of run.filter(isSub)) byHelper.set(agentId(c.agent), c);
  $("#now-helpers")!.textContent = [...byHelper.values()]
    .filter((c) => c !== latest)
    .map((c) => `+ helper '${agentName(c.agent)}': ${labelOf(c)}`)
    .join("\n");
  if (latest) {
    /* c8 ignore next -- every Lane is in LANES, so the name is always found */
    const name = laneInfo.get(latest.lane)?.name ?? "";
    const more = mainRun.length > 1 ? ` · +${mainRun.length - 1} more in parallel` : "";
    $("#now-h")!.textContent = `Right now · ${name}${more}`;
    $("#now-verb")!.innerHTML = labelHtml(latest);
    $("#now-detail")!.textContent = latest.detail;
    $("#now-clock")!.textContent = dur(Date.now() - latest.start);
    $("#now-stripe")!.style.background = colorOf(latest.lane);
    return;
  }
  $("#now-stripe")!.style.background = "var(--border)";
  $("#now-detail")!.textContent = "";
  const t = lastEvent();
  if (!isLive()) {
    $("#now-h")!.textContent = "Session idle";
    $("#now-verb")!.textContent = state.id ? `Nothing new since ${clock(t)}` : "No session yet";
    $("#now-clock")!.textContent = "";
  } else if (done) {
    $("#now-h")!.textContent = "Turn finished";
    $("#now-summary")!.textContent = roundSummaryText(from, t);
    $("#now-verb")!.textContent = "Waiting for the room — your move";
    $("#now-clock")!.textContent = dur(Date.now() - done.at);
  } else {
    $("#now-h")!.textContent = "Right now";
    $("#now-verb")!.textContent = "Thinking…";
    $("#now-clock")!.textContent = dur(Date.now() - t);
  }
}

// ── render: round summary ─────────────────────────────────────────────────────

function pickRound(n: number | null): void {
  state.round = n === null || n >= state.prompts.length ? null : Math.max(1, n);
  state.win = "round";
  state.view = null;
  persist();
  renderAll();
}

function renderRound(): void {
  const { n, from, to } = shownRound();
  const now = tNow();
  const calls = state.order.filter((c) => c.start >= from && c.start < (to ?? Infinity));
  // A past round lasted until its last action or words, not until the next prompt.
  const said = state.says.filter((s) => s.at >= from && s.at < (to ?? Infinity)).map((s) => s.at);
  const until = to === null ? now : Math.max(from, ...calls.map((c) => c.end ?? now), ...said);
  const time = new Map<Lane, number>();
  const count = new Map<Lane, number>();
  for (const c of calls) {
    time.set(c.lane, (time.get(c.lane) ?? 0) + Math.max(0, (c.end ?? now) - c.start));
    count.set(c.lane, (count.get(c.lane) ?? 0) + 1);
  }
  const max = Math.max(1, ...time.values());
  $("#round-bars")!.innerHTML = LANES.map((l) => {
    const t = time.get(l.id) ?? 0;
    return `<span title="${esc(l.hint)}">${esc(l.name)}</span>
      <div class="track" data-viz-id="round-${l.id}" data-label="${esc(l.name)}: ${esc(dur(t))}"><div class="fill" style="width:${((t / max) * 100).toFixed(1)}%;background:${l.color}"></div></div>
      <span class="n" title="actions">${count.get(l.id) ?? 0}</span>`;
  }).join("");
  const total = state.prompts.length;
  const p = state.prompts[n - 1];
  $("#round-h")!.textContent = p ? `Round ${n} of ${total} · ${p.text.slice(0, 70)}` : "This round";
  $<HTMLButtonElement>("#round-prev")!.disabled = n <= 1;
  $<HTMLButtonElement>("#round-next")!.disabled = to === null;
  $<HTMLButtonElement>("#round-latest")!.disabled = to === null;
  $("#round-h")!.title = p?.text ?? "";
  const errs = calls.filter((c) => c.error).length;
  $("#round-meta")!.innerHTML =
    `<span>${to === null ? "elapsed" : "took"} <b>${esc(dur(until - from))}</b></span><span>actions <b>${calls.length}</b></span>` +
    `<span>errors <b style="color:${errs ? "var(--danger)" : "inherit"}">${errs}</b></span><span>bar = time spent · number = actions</span>`;
  const files = new Map<string, { plus: number; minus: number }>();
  for (const c of calls) {
    if (c.lane !== "change" || !c.file) continue;
    const f = files.get(c.file) ?? { plus: 0, minus: 0 };
    f.plus += c.plus;
    f.minus += c.minus;
    files.set(c.file, f);
  }
  $("#round-files")!.innerHTML = [...files]
    .map(
      ([f, d]) =>
        `<span class="chip" title="${esc(f)}">${esc(f.replace(/^.*\//u, ""))} <span class="p">+${d.plus}</span> <span class="m">−${d.minus}</span></span>`,
    )
    .join("");
}

function renderViewCtl(): void {
  $("#viewctl")!.hidden = !state.view;
  $("#jump-now")!.hidden = !state.view || state.view.end === null;
}

/** Redraws everything that depends on the visible range. */
function renderView(): void {
  renderTimeline();
  renderOverview();
  renderViewCtl();
  markRange();
  pumpSoon();
}

/** A chain's steps grouped by the lane each would get alone, so the reader sees why the bar sits where it does. */
function stepsHtml(c: Call): string {
  const steps = c.tool === "Bash" ? shellSteps(c.detail) : [];
  if (steps.length < 2) return "";
  const groups = new Map<string, string[]>();
  for (const s of steps) {
    const kind = stepLane(s);
    const name = kind === "ask" ? "Script" : laneName(kind);
    groups.set(name, [...(groups.get(name) ?? []), clip(s, 60)]);
  }
  const parts = [...groups].map(([name, ss]) => `<b>${esc(name)}</b> ${esc(ss.join("; "))}`);
  return `<div class="pl whole steps">${parts.join(" · ")}</div>`;
}

/** Which call the box shows, and why: hovered for now, pinned by a click, or just the newest. */
type Shown = "hover" | "pinned" | "latest";
const SHOWN_TAG: Record<Shown, string> = {
  hover: "",
  pinned: `<button class="tag unpin" type="button" title="Unpin and follow the latest action (Esc)">pinned ×</button> `,
  latest: `<span class="tag" title="Click a bar to pin it">latest</span> `,
};

function showCall(id: string, shown: Shown = "hover"): void {
  const c = state.calls.get(id);
  const el = $("#picked")!;
  /* c8 ignore next -- every data-id on the page, and every pinned id, is a call that was read */
  if (!c) return;
  el.classList.remove("empty");
  const prev = state.previews.get(id);
  const out = outcomeOf(c);
  // Every line is one clipped row (full text in its tooltip), so the box never changes height.
  const line = (html: string, full = ""): string =>
    `<div class="pl" data-verify-clip-ok${full ? ` title="${esc(full)}"` : ""}>${html}</div>`;
  el.innerHTML =
    line(
      `${SHOWN_TAG[shown]}<b>${labelHtml(c)}</b> · ${esc(c.tool)} · ${esc(laneName(c.lane))}${lanes.store.has(c.id) ? AI_MARK("lane") : ""} · ${esc(c.end === null ? "still running, " + dur(Date.now() - c.start) : dur(c.end - c.start))}` +
        (isSub(c) ? ` · helper “${esc(agentName(c.agent))}”` : "") +
        (c.error ? ` · <span style="color:var(--danger)">error</span>` : ""),
    ) +
    (c.detail ? line(`<code>${esc(c.detail)}</code>`, c.detail) : "") +
    stepsHtml(c) +
    (prev ? line(`<code>→ ${esc(prev)}</code>`, prev) : "") +
    (out ? `<div class="pl whole">→ ${esc(out)}${AI_MARK("outcome")}</div>` : "");
}

// ── render: conversation ──────────────────────────────────────────────────────────────
let convoDrawn = false;
let firstInRange: number | undefined;
let lastUserScroll = 0;
/** After the reader last scrolled the conversation, how long a change of range leaves it alone. */
const QUIET_MS = 10_000;

/**
 * The conversation always lists every turn. Those inside the timeline's range get an accent bar;
 * when the first of them changes, it is scrolled into view unless the reader scrolled lately.
 */
function markRange(): void {
  const { t0, t1 } = viewRange();
  let first = -1;
  for (const el of document.querySelectorAll<HTMLElement>("#convo .turn")) {
    const at = Number(el.dataset["at"]);
    const inside = at >= t0 && at <= t1;
    el.classList.toggle("inrange", inside);
    if (inside && first < 0) first = Number(el.dataset["ti"]);
  }
  const moved = convoDrawn && first >= 0 && first !== firstInRange;
  firstInRange = first;
  if (moved && Date.now() - lastUserScroll > QUIET_MS) {
    const convo = $("#convo")!;
    convo.scrollTo({ top: $(`#convo [data-ti="${first}"]`)!.offsetTop - 8 });
  }
}

interface Turn {
  kind: "user" | "claude";
  at: number;
  text: string;
  n: number;
}

const turns = (): Turn[] =>
  [
    ...state.prompts.map((p, i): Turn => ({ kind: "user", at: p.at, text: p.text, n: i + 1 })),
    ...splitReplies(state.prompts, state.says).replies.map((s): Turn => ({
      kind: "claude",
      at: s.at,
      text: s.text,
      n: 0,
    })),
  ].toSorted((x, y) => x.at - y.at);

function turnHtml(t: Turn, i: number, working = false): string {
  const when = esc(clock(t.at));
  if (t.kind === "user")
    return `<div class="turn user" id="turn-${t.n}" data-ti="${i}" data-at="${t.at}" data-viz-id="turn-${t.n}" data-label="Prompt ${t.n}"><div class="bubble"><div class="meta">P${t.n} · ${when}</div><div class="text">${esc(t.text)}</div></div></div>`;
  return `<div class="turn claude" data-ti="${i}" data-at="${t.at}" data-viz-id="reply-${i}" data-label="${working ? "Claude, still working" : "Claude replied"}"><div class="bubble"><div class="meta">Claude · ${when}${working ? ` · <span class="working">still working</span>` : ""}</div><div class="md">${renderMarkdown(t.text)}</div></div></div>`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** While the model is still writing an outcome, "✦ …" follows the label on its own line, so nothing moves. */
const pendingHtml = (c: Call): string =>
  outcomes.pending.has(c.id) ? ` <span class="out pending">✦ …</span>` : "";

function outcomeHtml(c: Call): string {
  const o = outcomeOf(c);
  return o ? `<span class="out">→ ${esc(o)}${AI_MARK("outcome")}</span>` : "";
}

function actionRow(c: Call, depth: number): string {
  const d = c.end === null ? "…" : dur(c.end - c.start);
  const indent = depth > 0 ? ` style="margin-left:${depth * 16}px"` : "";
  return `<li class="act${c.error ? " err" : ""}"${indent} data-id="${esc(c.id)}" data-viz-id="act-${esc(c.id)}" data-label="${esc(labelOf(c))}"><span class="sw" style="background:${colorOf(c.lane)}"></span><span class="what"><span class="lbl">${labelHtml(c)}${pendingHtml(c)}</span>${outcomeHtml(c)}</span><span class="d">${c.error ? "failed · " : ""}${esc(d)}</span></li>`;
}

const noteRow = (s: Say): string =>
  `<li class="note" data-viz-id="note-${s.at}" data-label="Claude said on the way"><span class="d">${esc(clock(s.at))}</span><div class="md">${renderMarkdown(s.text)}</div></li>`;

/** One strip's actions and notes, oldest first; a helper's actions are grouped, indented, under its name. */
function actionList({ calls, notes }: Run): string {
  const tree = helperTree([...state.agents.values()], state.order);
  const sorted = calls.toSorted((x, y) => x.start - y.start);
  const done = new Set<string>();
  const rows: string[] = [];
  const left = notes.toSorted((x, y) => x.at - y.at);
  for (const c of sorted) {
    while (left[0] && left[0].at <= c.start) rows.push(noteRow(left.shift()!));
    if (!isSub(c)) {
      rows.push(actionRow(c, 0));
      continue;
    }
    const id = agentId(c.agent);
    if (done.has(id)) continue;
    done.add(id);
    /* c8 ignore next -- the tree holds every helper that has made a call */
    const depth = tree.find((n) => n.id === id)?.depth ?? 1;
    rows.push(
      `<li class="helper-h" style="margin-left:${depth * 16}px">↳ ${esc(agentName(c.agent))}</li>`,
      ...sorted.filter((k) => isSub(k) && agentId(k.agent) === id).map((k) => actionRow(k, depth)),
    );
  }
  rows.push(...left.map(noteRow));
  return `<ul class="acts">${rows.join("")}</ul>`;
}

/** The collapsed "between the scenes" strip: what happened, and what Claude said on the way, between two messages. */
function stripHtml(key: string, run: Run): string {
  const { calls, notes } = run;
  const now = tNow();
  const open = state.strips.has(key);
  const span =
    Math.max(...calls.map((c) => c.end ?? now), ...notes.map((s) => s.at)) -
    Math.min(...calls.map((c) => c.start), ...notes.map((s) => s.at));
  const helpers = new Set(calls.filter(isSub).map((c) => agentId(c.agent))).size;
  const failed = calls.filter((c) => c.error).length;
  const facts = [
    ...(calls.length > 0 ? [plural(calls.length, "action")] : []),
    ...(notes.length > 0 ? [plural(notes.length, "note")] : []),
    dur(span),
    ...(helpers ? [plural(helpers, "helper")] : []),
    ...(failed ? [`${failed} failed`] : []),
  ].join(" · ");
  const ticks = calls
    .slice(0, 80)
    .map((c) => `<i style="background:${colorOf(c.lane)}"></i>`)
    .join("");
  const bk = beatKey(key, run);
  const said = beats.store.get(bk);
  const beat = said
    ? `<div class="beat">${renderMarkdown(said)}${AI_MARK("summary")}</div>`
    : beats.pending.has(bk)
      ? `<div class="beat pending">✦ …</div>`
      : "";
  return `<div class="strip" data-viz-id="strip-${esc(key)}"><div class="strip-h" data-strip="${esc(key)}" role="button" aria-expanded="${open}" data-label="${esc(facts)}"><span>${open ? "▾" : "▸"} ${esc(facts)}</span><span class="ticks">${ticks}</span></div>${beat}${open ? actionList(run) : ""}</div>`;
}

/** What I said, what it said, and between them what happened. Sticks to the bottom only if you are there. */
interface Run {
  calls: Call[];
  notes: Say[];
}

/** The calls and notes between each pair of turns: bucket k holds those after the k-th turn (0 = before the first). */
function stripsOf(ts: Turn[]): Map<number, Run> {
  const ats = ts.map((t) => t.at);
  const buckets = new Map<number, Run>();
  const run = (at: number): Run => {
    const k = ats.filter((t) => t <= at).length;
    if (!buckets.has(k)) buckets.set(k, { calls: [], notes: [] });
    return buckets.get(k)!;
  };
  for (const c of state.order) run(c.start).calls.push(c);
  for (const s of splitReplies(state.prompts, state.says).notes) run(s.at).notes.push(s);
  return new Map([...buckets].toSorted(([a], [b]) => a - b));
}
const stripKey = (ts: Turn[], k: number): string => (k === 0 ? "start" : String(ts[k - 1]?.at));

function renderConversation(): void {
  const el = $("#convo")!;
  const stick = !convoDrawn || el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  const ts = turns();
  const buckets = stripsOf(ts);
  const parts: string[] = [];
  const strip = (k: number): void => {
    const run = buckets.get(k);
    if (run) parts.push(stripHtml(stripKey(ts, k), run));
  };
  strip(0);
  // Live, its newest words stay at the bottom even when they are only a note on the way.
  const working = isLive() && !finishedTurn();
  for (const [i, t] of ts.entries()) {
    parts.push(turnHtml(t, i, working && i === ts.length - 1));
    strip(i + 1);
  }
  el.innerHTML = parts.join("") || `<div class="empty">Nothing yet.</div>`;
  if (stick) el.scrollTop = el.scrollHeight;
  markRange();
  convoDrawn = true;
}

function renderLegend(): void {
  $("#legend")!.innerHTML =
    LANES.map(
      (l) =>
        `<span title="${esc(l.hint)}"><i style="background:${l.color}"></i>${esc(l.name)}</span>`,
    ).join("") +
    `<span><i style="background:transparent;border:2px solid var(--danger)"></i>failed</span><span title="Claude finished and was waiting on you"><i style="background:var(--muted)"></i>You</span><span><i style="background:repeating-linear-gradient(45deg,var(--c5) 0 3px,var(--text) 3px 5px)"></i>still running</span><span title="A prompt from the room">┆ P#</span><span style="color:var(--good)">│ now</span>`;
}

function renderStatus(): void {
  $("#status")!.classList.toggle("bad", state.error !== "");
  $("#status")!.textContent = statusText(isLive());
}

function statusText(live: boolean): string {
  if (state.error) return `backend error: ${state.error}, retrying`;
  if (!state.id) return "no sessions found";
  const done = finishedTurn();
  if (done) return `waiting on you · ${dur(Date.now() - done.at)}`;
  return live ? "live" : `idle since ${clock(lastEvent())}`;
}

function renderAll(): void {
  renderNow();
  renderRound();
  renderView();
  renderConversation();
  pumpBeats();
  pumpStory();
  renderStory();
  renderNote();
  const live = isLive();
  $("#live")!.classList.toggle("live", live);
  renderStatus();
  // While the pointer is on the timeline, the box keeps what it hovers.
  if (!hovering) showPicked();
}

let hovering = false;
/** The box shows the pinned call, or else follows the newest one. */
function showPicked(): void {
  const pinned = state.calls.has(state.sel);
  const id = pinned ? state.sel : state.order.at(-1)?.id;
  if (id) showCall(id, pinned ? "pinned" : "latest");
}

function pin(id: string): void {
  state.sel = id;
  persist();
  renderTimeline();
  showPicked();
}

// ── wiring ────────────────────────────────────────────────────────────────────
const followBox = $<HTMLInputElement>("#follow")!;
const isWin = (w: string | undefined): w is Win => WinSchema.safeParse(w).success;

sessionSel.addEventListener("change", () => {
  state.follow = false;
  followBox.checked = false;
  reset(sessionSel.value);
  tick().catch(console.error);
});
followBox.checked = state.follow;
followBox.addEventListener("change", () => {
  state.follow = followBox.checked;
  persist();
  pullSessions().then(tick).catch(console.error);
});
$("#round-nav")!.addEventListener("click", (e) => {
  const b = targetEl(e)?.closest("button")?.id;
  const { n } = shownRound();
  if (b === "round-prev") pickRound(n - 1);
  if (b === "round-next") pickRound(n + 1);
  if (b === "round-latest") pickRound(null);
});
$("#window")!.addEventListener("click", (e) => {
  const w = targetEl(e)?.closest("button")?.dataset["w"];
  if (!isWin(w)) return;
  state.win = w;
  state.view = null;
  persist();
  renderView();
});
const minsBox = $<HTMLInputElement>("#mins")!;
minsBox.value = String(state.mins);
minsBox.addEventListener("input", () => {
  const n = Math.round(Number(minsBox.value));
  if (!(n >= 1)) return;
  state.mins = n;
  state.win = "last";
  state.view = null;
  persist();
  renderView();
});
// Anything that scrolls the conversation by hand holds off range-driven scrolling for a while.
const noteScroll = (): void => {
  lastUserScroll = Date.now();
};
for (const type of ["wheel", "pointerdown", "keydown", "touchmove"])
  $("#convo")!.addEventListener(type, noteScroll, { passive: true });

const toggle = (set: Set<string>, id: string): void => {
  if (set.has(id)) set.delete(id);
  else set.add(id);
  persist();
};
const scrollToTurn = (n: string): void => {
  $("#convo")!.scrollTo({ top: $(`#turn-${n}`)!.offsetTop - 8 });
};
/** A click on a strip, a P# marker, a helper's row, or the Agent call that launched a helper. */
function clicked(el: Element | null, id: string | undefined): void {
  const strip = el?.closest<HTMLElement>("[data-strip]")?.dataset["strip"];
  const turn = el?.closest<SVGElement>("[data-turn]")?.dataset["turn"];
  const helper =
    el?.closest<SVGElement>("[data-agent]")?.dataset["agent"] ??
    [...state.agents.values()].find((h) => h.toolUseId === id)?.id;
  if (strip) {
    toggle(state.strips, strip);
    renderConversation();
    pumpSoon();
  }
  if (turn) scrollToTurn(turn);
  if (helper) {
    toggle(state.open, helper);
    renderTimeline();
  }
}
const pick = (e: Event): void => {
  const el = targetEl(e);
  const id = el?.closest<HTMLElement>("[data-id]")?.dataset["id"];
  if (e.type === "click") clicked(el, id);
  if (!id) return;
  // Clicking the pinned bar again lets go of it.
  if (e.type === "click") pin(id === state.sel ? "" : id);
  else showCall(id);
};
$("#timeline")!.addEventListener("mouseover", (e) => {
  hovering = true;
  pick(e);
});
$("#timeline")!.addEventListener("mouseleave", () => {
  hovering = false;
  showPicked();
});
$("#picked")!.addEventListener("click", (e) => {
  if (targetEl(e)?.closest(".unpin")) pin("");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.sel) pin("");
});
$("#timeline")!.addEventListener("click", pick);
// The conversation previews on click only: hovering it must never move the page.
$("#convo")!.addEventListener("click", pick);
window.addEventListener("resize", renderTimeline);

let n = 0;
async function tick(): Promise<void> {
  try {
    if (n % 7 === 0) await pullSessions();
    await pull();
    state.error = "";
  } catch (err) {
    state.error = String(err);
  }
  pump(labels);
  pump(outcomes);
  pump(lanes);
  n++;
  renderAll();
}

wireTimeline(renderView);
renderLegend();
await tick();
setInterval(() => {
  tick().catch(console.error);
}, 1500);
setInterval(() => {
  renderNow();
  renderStatus();
  if (running().length > 0) renderView();
}, 500);

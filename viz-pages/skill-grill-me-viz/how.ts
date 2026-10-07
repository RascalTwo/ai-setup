// Beat five. Part one: a stepper over a sequence diagram of one round, every arrow naming the real
// call or record from skills/grill-me-viz (grill.ts, SKILL.md). Part two: a live replica of the page
// mechanics (pick, fold, log line, Send, the agent's rewrite) with invented questions.
import { stepper, arrowMarkers, labelBox, esc } from "@viz/kit";
import { at, q } from "./util.js";

// ───────────────────────── part one: the sequence ─────────────────────────
type Lane = "you" | "page" | "log" | "agent";
const LX: Record<Lane, number> = { you: 92, page: 300, log: 520, agent: 730 };
const HEAD: Record<Lane, [string, string]> = {
  you: ["You", "browser tab, mic"],
  page: ["The page", "grill.js + viz widget"],
  log: ["feedback.jsonl", "<viz>/.viz-data/"],
  agent: ["The agent", "Claude Code"],
};
interface Step {
  from: Lane;
  to: Lane;
  label: string;
  title: string;
  lede: string;
}
const STEPS: Step[] = [
  {
    from: "agent",
    to: "page",
    label: '+ <section class="round" data-round="N">',
    title: "WRITE A ROUND",
    lede: 'SKILL.md step 3: a <code>&lt;section class="round" data-round="N"&gt;</code> appended to <code>index.html</code>. Each question is a <code>div.q</code> with an <code>h3</code>; options are <code>button data-pick="Q3:B"</code> (one carries <code>data-rec</code>); it ends with <code>button data-send="N"</code>. viz hot-reloads the tab. <code>grill.ts</code> scrolls to the newest round once (a <code>sessionStorage</code> key per page) and, if the tab is unfocused, turns the favicon orange "?" and prefixes the title "● Your turn". Before handing over, the agent runs <code>grill.tinyText()</code> in the tab until it returns <code>[]</code>.',
  },
  {
    from: "you",
    to: "page",
    label: 'click  button[data-pick="Q3:B"]',
    title: "PICK",
    lede: 'One delegated click handler on <code>document</code>. <code>mark()</code> sets <code>.picked</code> among every <code>[data-pick^="Q3:"]</code> and writes the answer into the card\'s header; <code>fold()</code> adds <code>.collapsed</code> <b>450 ms</b> later, so you see the highlight first. A folded card reopens on click. Alt-click belongs to the feedback widget, and an archived <code>.original</code> card never answers.',
  },
  {
    from: "page",
    to: "log",
    label: 'log({type:"pick", q:"Q3", opt:"B", round:N})',
    title: "LOG THE PICK",
    lede: "The handler calls <code>feedback.log(…)</code> on <code>window.vizFeedback</code>, the widget the viz server injects into every live page. It appends one JSON line to <code>&lt;viz&gt;/.viz-data/feedback.jsonl</code> (git-ignored, never published). Opened from a file there is no widget and no route: the buttons still highlight, and save nothing.",
  },
  {
    from: "you",
    to: "log",
    label: 'speech {text, anchor:"Q3", where, secs}',
    title: "SAY SOMETHING",
    lede: 'The widget\'s mic transcribes in the browser (Parakeet, on WebGPU) and writes <code>{"type":"speech", "text":…}</code> beside the picks. Its <code>anchor</code> is the nearest <code>[data-viz-id]</code> above the pointer when you stopped talking. <code>grill.ts</code> stamps every question card\'s <code>data-viz-id</code> from its <code>h3 .n</code>, so a line said over a card reads <code>[Q3]</code>.',
  },
  {
    from: "page",
    to: "log",
    label: 'send({round:N}) → {"type":"send","round":N}',
    title: "SEND",
    lede: 'A round\'s <code>data-send</code> button and the pill\'s Send call the same <code>feedback.send</code>: it waits for speech still being transcribed, then appends the send line. The page answers with a <code>viz-feedback:sent</code> event: the button reads "Sent ✓" and the favicon goes grey "…" (the agent\'s turn).',
  },
  {
    from: "log",
    to: "agent",
    label: 'until grep -q \'…"send","round":N}\' feedback.jsonl',
    title: "WAKE AND READ",
    lede: 'SKILL.md steps 4 and 5. A background <code>until grep -q \'"type":"send","round":N}\' &lt;viz-dir&gt;/.viz-data/feedback.jsonl; do sleep 1; done</code> (so a terminal reply can still interrupt). Then <code>viz feedback &lt;viz-dir&gt;</code> folds the log: the <b>latest pick per question wins</b>, and every spoken or typed line is grouped by its anchor. A terminal answer overrides the page for the same question. Last, <code>--clear</code> drops the round\'s pins from the page; the log keeps everything.',
  },
  {
    from: "agent",
    to: "page",
    label: 'rewrite → <details class="decided">',
    title: "BECOME THE RECORD",
    lede: 'SKILL.md step 6. Each answered question is rewritten in place as <code>&lt;details class="decided"&gt;&lt;summary&gt;&lt;span class="n"&gt;Q3&lt;/span&gt;decision&lt;span class="pick"&gt;B&lt;/span&gt;…</code>, the original kept inside a nested <code>&lt;details class="original"&gt;</code>. On load, <code>grill.ts</code> fetches <code>_log/feedback</code> and replays picks oldest-first, so a hot reload never loses an answer. Then the agent recomputes the frontier and goes back to step 3: round N+1.',
  },
];

const ROW0 = 108;
const ROWH = 48;
const rowY = (i: number): number => ROW0 + i * ROWH;

function sequenceSvg(active: number): string {
  const lanes: Lane[] = ["you", "page", "log", "agent"];
  let s = arrowMarkers();
  for (const l of lanes) {
    const [h1, h2] = HEAD[l];
    const x = LX[l];
    s += `<line x1="${x}" y1="58" x2="${x}" y2="${rowY(STEPS.length - 1) + 24}" stroke="var(--border)" stroke-dasharray="3 5"/>`;
    s += `<g data-viz-id="lane-${l}" data-label="${esc(h1)}"><rect x="${x - 88}" y="6" width="176" height="48" rx="10" fill="var(--panel)" stroke="${l === "log" ? "var(--warn)" : "var(--border)"}" stroke-width="1.5"/>`;
    s += labelBox(
      { x: x - 84, y: 8, w: 168, h: 44 },
      `<div style="text-align:center;line-height:1.25"><b style="font-size:14px">${esc(h1)}</b><br><span style="font-size:12px;color:var(--muted)">${esc(h2)}</span></div>`,
    );
    s += `</g>`;
  }
  STEPS.forEach((st, i) => {
    const y = rowY(i);
    const x1 = LX[st.from];
    const x2 = LX[st.to];
    const dir = x2 > x1 ? 1 : -1;
    const state = i === active ? "on" : i < active ? "done" : "todo";
    const col =
      state === "on" ? "var(--accent)" : state === "done" ? "var(--muted)" : "var(--faint)";
    const op = state === "todo" ? 0.45 : 1;
    const mid = (x1 + x2) / 2;
    const anchor = st.from === "log" && st.to === "agent" ? "end" : "middle";
    const lx = anchor === "end" ? x2 - 8 : mid;
    s += `<g opacity="${op}" data-viz-id="step-${i + 1}" data-label="step ${i + 1}: ${esc(st.title)}">`;
    s += `<circle cx="22" cy="${y}" r="12" fill="${state === "on" ? "var(--accent)" : "var(--panel-2)"}" stroke="${col}"/><text x="22" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${state === "on" ? "#0d1117" : "var(--text)"}">${i + 1}</text>`;
    s += `<line x1="${x1}" y1="${y}" x2="${x2 - dir * 2}" y2="${y}" stroke="${col}" stroke-width="${state === "on" ? 3 : 1.8}" marker-end="url(#${state === "on" ? "ah-accent" : "ah"})"/>`;
    s += `<text x="${lx}" y="${y - 9}" text-anchor="${anchor}" font-size="12.5" fill="${state === "on" ? "#fff" : "var(--muted)"}" font-family="var(--mono)" style="paint-order:stroke;stroke:#0b0f16;stroke-width:5px;stroke-linejoin:round">${esc(st.label)}</text>`;
    s += `</g>`;
  });
  return s;
}

function initSequence(): void {
  const stage = q<HTMLElement>(document, "#stage");
  const lede = q<HTMLElement>(document, "#lede");
  const pos = q<HTMLElement>(document, "#pos");
  const fig = q<HTMLElement>(document, "#stage").closest<HTMLElement>(".fig");
  const render = (i: number): void => {
    stage.innerHTML = `<svg viewBox="0 0 820 ${rowY(STEPS.length - 1) + 40}" role="img" aria-label="Sequence diagram of one grill round">${sequenceSvg(i)}</svg>`;
    const s = at(STEPS, i);
    lede.innerHTML = `<b>${i + 1} · ${s.title}.</b> ${s.lede}`;
    pos.textContent = `${i + 1} / ${STEPS.length}`;
  };
  // Scope the arrow keys to this figure, so Space and arrows elsewhere on the page keep scrolling and
  // playing the exhibits.
  fig?.setAttribute("tabindex", "0");
  fig?.addEventListener("pointerdown", () => fig.focus());
  const st = stepper({
    n: STEPS.length,
    onStep: render,
    autoplayMs: 4800,
    hashKey: "flow",
    target: fig ?? document,
  });
  q<HTMLElement>(document, "#next").addEventListener("click", () => st.next());
  q<HTMLElement>(document, "#prev").addEventListener("click", () => st.prev());
  const play = q<HTMLElement>(document, "#play");
  let on = false;
  play.addEventListener("click", () => {
    on = !on;
    if (on) st.play();
    else st.pause();
    play.textContent = on ? "❚❚ pause" : "▶ play";
  });
  const stopPlay = (): void => {
    on = false;
    play.textContent = "▶ play";
  };
  q<HTMLElement>(document, "#next").addEventListener("click", stopPlay);
  q<HTMLElement>(document, "#prev").addEventListener("click", stopPlay);
}

// ───────────────────────── part two: the replica ─────────────────────────
interface RQ {
  n: string;
  title: string;
  body: string;
  opts: string[];
  rec: string;
}
const RQS: RQ[] = [
  {
    n: "Q1",
    title: "Where does the Send button live?",
    body: "Each round needs one explicit end. Where should it go?",
    opts: ["Top right, always", "End of each round", "Floating, follows you"],
    rec: "B",
  },
  {
    n: "Q2",
    title: "What does a decided question look like?",
    body: "Once you've picked, the page should become a record.",
    opts: ["Hidden entirely", "One line, original behind a click", "Shrunk card"],
    rec: "B",
  },
];
const LETTERS = ["A", "B", "C"];

function initReplica(): void {
  const root = q<HTMLElement>(document, "#replica");
  root.innerHTML = `<div id="r-left"></div><div class="jsonl" id="r-log" data-viz-id="replica-log" data-label="the feedback log, in memory"><span class="path">&lt;viz&gt;/.viz-data/feedback.jsonl  (in memory here)</span></div>`;
  const left = q<HTMLElement>(root, "#r-left");
  const log = q<HTMLElement>(root, "#r-log");
  const send = q<HTMLButtonElement>(document, "#r-send");
  const rewrite = q<HTMLButtonElement>(document, "#r-rewrite");
  const reset = q<HTMLButtonElement>(document, "#r-reset");
  const picks = new Map<string, string>();
  let sent = false;
  let rewritten = false;

  const line = (cls: string, obj: Record<string, unknown>): void => {
    log.insertAdjacentHTML(
      "beforeend",
      `<span class="ln ${cls} fresh">${esc(JSON.stringify(obj))}</span>`,
    );
  };

  function sync(): void {
    send.disabled = sent;
    send.textContent = sent ? "Sent ✓" : "Send round 1";
    rewrite.disabled = !(sent && picks.size > 0) || rewritten;
  }

  function cards(): void {
    left.innerHTML = RQS.map((rq) => {
      const pick = picks.get(rq.n);
      if (rewritten && pick) {
        const k = LETTERS.indexOf(pick);
        return `<details class="rdec" data-viz-id="dec-${rq.n}" data-label="${rq.n} decided"><summary><span class="n">${rq.n}</span>${esc(at(rq.opts, k))}<span class="pick">${pick}</span></summary><details class="orig"><summary>Show what you were asked</summary><p><b>${esc(rq.title)}</b> ${esc(rq.body)} Options: ${rq.opts.map((o, i) => `${LETTERS[i]} ${esc(o)}`).join(" · ")}</p></details></details>`;
      }
      return `<div class="rq${pick ? " collapsed" : ""}" data-q="${rq.n}" data-viz-id="${rq.n}" data-label="${rq.n}: ${esc(rq.title)}">
        <h4><span class="n">${rq.n}</span>${esc(rq.title)}<span class="ans">${pick ? esc(at(rq.opts, LETTERS.indexOf(pick))) : ""}<span class="k">${pick ?? ""}</span></span></h4>
        <div class="rbody"><div><p>${esc(rq.body)}</p><div class="ropts">${rq.opts
          .map(
            (o, i) =>
              `<button class="ropt${LETTERS[i] === rq.rec ? " rec" : ""}${pick === LETTERS[i] ? " picked" : ""}" data-pick="${rq.n}:${LETTERS[i]}" data-viz-id="${rq.n}-${LETTERS[i]}" data-label="${rq.n} option ${LETTERS[i]}: ${esc(o)}"><span class="k">${LETTERS[i]}</span>${esc(o)}</button>`,
          )
          .join("")}</div></div></div></div>`;
    }).join("");
    sync();
  }

  left.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const pick = t.closest<HTMLElement>("[data-pick]");
    const folded = t.closest<HTMLElement>(".rq.collapsed");
    if (pick) {
      const [qn = "", opt = ""] = (pick.dataset["pick"] ?? "").split(":");
      const card = pick.closest<HTMLElement>(".rq");
      if (picks.get(qn) === opt) {
        card?.classList.add("collapsed");
        return;
      }
      picks.set(qn, opt);
      for (const b of left.querySelectorAll<HTMLElement>(`[data-pick^="${qn}:"]`))
        b.classList.toggle("picked", b === pick);
      line("pick", { type: "pick", q: qn, opt, round: 1 });
      log.scrollTop = log.scrollHeight;
      window.setTimeout(() => card?.classList.add("collapsed"), 450);
      sync();
      const ans = card?.querySelector<HTMLElement>(".ans");
      if (ans)
        ans.innerHTML = `${esc(pick.textContent?.slice(1) ?? "")}<span class="k">${opt}</span>`;
    } else if (folded) {
      folded.classList.remove("collapsed");
    }
  });
  send.addEventListener("click", () => {
    if (sent) return;
    sent = true;
    line("send", { type: "send", round: 1 });
    cards();
  });
  rewrite.addEventListener("click", () => {
    rewritten = true;
    line("send", { type: "clear" });
    cards();
  });
  reset.addEventListener("click", () => {
    picks.clear();
    sent = false;
    rewritten = false;
    log.innerHTML = `<span class="path">&lt;viz&gt;/.viz-data/feedback.jsonl  (in memory here)</span>`;
    cards();
  });
  cards();
}

export function initHow(): void {
  initSequence();
  initReplica();
}

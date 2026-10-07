// Beat five. Part one: a stepper over a sequence diagram of one round, every arrow naming the real
// call or record from skills/grill-me-viz (grill.ts, SKILL.md). Part two: a real round to answer,
// with drawn options and viz's real feedback widget (talk while pointing, or Alt-click to type).
import { stepper, arrowMarkers, labelBox, esc } from "@viz/kit";
import { at, clamp, q } from "./util.js";

// ───────────────────────── part one: the sequence ─────────────────────────
type Lane = "you" | "page" | "log" | "agent";
const LX: Record<Lane, number> = { you: 92, page: 300, log: 520, agent: 730 };
const HEAD: Record<Lane, [string, string]> = {
  you: ["You", "click, talk, point"],
  page: ["The page", "the live grill"],
  log: ["The log", "a file beside the page"],
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
    label: "adds a round of questions",
    title: "WRITE A ROUND",
    lede: "The agent writes the next round straight into the page: each question has its explanation, a prototype or diagram where one helps, and a row of options with its recommendation marked. The open tab reloads by itself and scrolls to the new round; if you're in another window, its icon turns orange so you know it's your turn.",
  },
  {
    from: "you",
    to: "page",
    label: "you click an option",
    title: "PICK",
    lede: "You click the option you want. It lights up, then the whole question folds down to one line showing your answer, so the page stays short. Click the line and it opens again if you change your mind.",
  },
  {
    from: "page",
    to: "log",
    label: "pick written to the log",
    title: "LOG THE PICK",
    lede: "Every pick is written as one line in a small log file kept next to the page: which question, which option, which round. It is what lets the agent see your answer without you typing it into the terminal, and it survives a page reload.",
  },
  {
    from: "you",
    to: "log",
    label: "what you say, tagged to the question",
    title: "SAY SOMETHING",
    lede: "If you talk while you point, the page turns your speech into text right in the browser and writes it to the same log. Each sentence is tagged with whatever you were pointing at when you stopped, so a reaction made over Question 3 arrives marked as Question 3.",
  },
  {
    from: "page",
    to: "log",
    label: "Send closes the round",
    title: "SEND",
    lede: 'At the bottom of each round is a Send button. It waits for any speech still being turned into text, then writes a final "send" line to the log. The button flips to "Sent" and the page icon goes grey: it\'s the agent\'s turn.',
  },
  {
    from: "log",
    to: "agent",
    label: "the agent notices the Send",
    title: "WAKE AND READ",
    lede: "The agent has been waiting in the background for that send line. When it appears it reads the log: your latest pick for each question, plus everything you said, grouped by the question it was about. If you answered in the terminal instead, that wins. Then it clears the round's pins from the page; the log itself keeps everything.",
  },
  {
    from: "agent",
    to: "page",
    label: "answers become one-line decisions",
    title: "BECOME THE RECORD",
    lede: "The agent rewrites every answered question as a single decided line, with the original question tucked behind a click. Whatever the page ends up as, it is the record of the decisions. Then the agent works out what to ask next and writes the next round: back to step one.",
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
// A real round of a visual grill, running viz's real feedback widget (kit/feedback.js) hosted by
// this page: no server, so every line it would log comes here instead (window.vizFeedbackHost),
// and its "screenshots" are drawn from the page rather than captured (no share-this-tab prompt).

/** One line of the feedback log, as the widget writes it (kit/src/feedback.ts). */
interface Entry {
  type: string;
  id?: string;
  q?: string;
  opt?: string;
  round?: number;
  text?: string;
  anchor?: { selector: string; label?: string } | null;
  shots?: { start?: string; end?: string };
}
interface Widget {
  log(e: Entry): Promise<void>;
  send(extra?: { round?: number }): Promise<void>;
}
type Win = Window & {
  vizFeedbackHost?: {
    root: Element;
    log(e: Entry): void;
    shoot(
      b: { left: number; top: number; width: number; height: number },
      x: number,
      y: number,
    ): string;
  };
  vizFeedback?: Widget;
};

interface RQ {
  n: string;
  title: string;
  body: string;
  opts: { label: string; svg: string }[];
  rec: string;
}

// Sketches drawn to be pointed at. Q2's data is invented; the marks are to scale.
const frame = (inner: string): string =>
  `<svg viewBox="0 0 120 84" aria-hidden="true"><rect x="1" y="1" width="118" height="82" rx="5" fill="#0d1117" stroke="#30363d"/>${inner}</svg>`;
const rows = (y0: number): string =>
  [0, 1, 2]
    .map((i) => `<rect x="12" y="${y0 + i * 18}" width="96" height="12" rx="2" fill="#30363d"/>`)
    .join("");
const SPEND: [string, number][] = [
  ["Rent", 1450],
  ["Food", 520],
  ["Travel", 310],
  ["Fun", 180],
];
const TOTAL = SPEND.reduce((a, [, v]) => a + v, 0);
const HUES = ["#58a6ff", "#d29922", "#3fb950", "#bc8cff"];
function pie(): string {
  let a0 = -Math.PI / 2;
  return SPEND.map(([, v], i) => {
    const a1 = a0 + (v / TOTAL) * 2 * Math.PI;
    const p = (a: number): string => `${60 + 32 * Math.cos(a)},${42 + 32 * Math.sin(a)}`;
    const d = `M60,42 L${p(a0)} A32,32 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${HUES[i]}"/>`;
  }).join("");
}
function bars(): string {
  return SPEND.map(
    ([k, v], i) =>
      `<text x="8" y="${20 + i * 17}" font-size="11" fill="#c9d1d9">${k}</text><rect x="46" y="${11 + i * 17}" width="${(v / SPEND[0]![1]) * 64}" height="11" fill="#58a6ff"/>`,
  ).join("");
}
function treemap(): string {
  // one split: the biggest on the left, the rest stacked on the right, areas to scale
  const W = 104,
    H = 68,
    big = SPEND[0]![1] / TOTAL,
    rest = SPEND.slice(1);
  const restSum = rest.reduce((a, [, v]) => a + v, 0);
  let y = 8;
  return (
    `<rect x="8" y="8" width="${W * big}" height="${H}" fill="${HUES[0]}"/>` +
    rest
      .map(([, v], i) => {
        const h = (v / restSum) * H;
        const s = `<rect x="${8 + W * big}" y="${y}" width="${W * (1 - big)}" height="${h}" fill="${HUES[i + 1]}" stroke="#0d1117"/>`;
        y += h;
        return s;
      })
      .join("")
  );
}
const RQS: RQ[] = [
  {
    n: "Q1",
    title: "Where does the Send button live?",
    body: "Each round needs one explicit end. Point at the page that feels right and say why.",
    opts: [
      {
        label: "Top right, always",
        svg: frame(rows(24) + `<rect x="78" y="7" width="32" height="10" rx="2" fill="#58a6ff"/>`),
      },
      {
        label: "End of each round",
        svg: frame(rows(10) + `<rect x="12" y="64" width="40" height="11" rx="2" fill="#58a6ff"/>`),
      },
      {
        label: "Floating, follows you",
        svg: frame(rows(10) + `<circle cx="104" cy="70" r="8" fill="#58a6ff"/>`),
      },
    ],
    rec: "B",
  },
  {
    n: "Q2",
    title: "Which chart for monthly spending?",
    body: `Rent $1,450, food $520, travel $310, fun $180. Which one makes the comparison easiest?`,
    opts: [
      { label: "Pie", svg: frame(pie()) },
      { label: "Sorted bars", svg: frame(bars()) },
      { label: "Treemap", svg: frame(treemap()) },
    ],
    rec: "B",
  },
];
const LETTERS = ["A", "B", "C"];

function initReplica(): void {
  const w = window as Win;
  const fig = q<HTMLElement>(document, '[data-viz-id="replica"]');
  const root = q<HTMLElement>(fig, "#replica");
  root.innerHTML = `<div id="r-left"></div><div class="jsonl" id="r-log" data-viz-id="replica-log" data-label="the black box: what the agent reads"></div>`;
  const left = q<HTMLElement>(root, "#r-left");
  const box = q<HTMLElement>(root, "#r-log");
  const send = q<HTMLButtonElement>(fig, "#r-send");
  const rewrite = q<HTMLButtonElement>(fig, "#r-rewrite");
  const reset = q<HTMLButtonElement>(fig, "#r-reset");
  let entries: Entry[] = [];
  let raw = false;
  let sent = false;
  let rewritten = false;
  const crops = new Map<string, { el: HTMLElement; w: number; h: number }>(); // crop id → a drawn copy of the demo at that moment

  // ---- the widget's host: lines land in the black box, crops are drawn from the page ----
  w.vizFeedbackHost = {
    root: fig,
    log: (e) => {
      entries = [...entries, e]; // a clear only takes the pins off the page; the log keeps everything
      const id = "id" in e && typeof e.id === "string" ? e.id : "";
      if (id && !lineQ.has(id)) lineQ.set(id, findQ(e)); // now, while its anchor still exists
      if (e.type === "send") {
        sent = true;
        sync();
      }
      paint();
    },
    shoot: crop, // synchronous: the crop must match the box the widget just measured
  };
  function crop(
    b: { left: number; top: number; width: number; height: number },
    x: number,
    y: number,
  ): string {
    const fr = fig.getBoundingClientRect();
    const wd = Math.min(b.width, fr.width);
    const ht = Math.min(b.height, fr.height);
    const l = clamp(b.left - fr.left, 0, fr.width - wd);
    const t = clamp(b.top - fr.top, 0, fr.height - ht);
    const c = fig.cloneNode(true);
    if (!(c instanceof HTMLElement)) return "";
    for (const n of c.querySelectorAll("#r-log, .ctrl")) n.remove();
    for (const n of [c, ...c.querySelectorAll<HTMLElement>("[id], [data-viz-id]")]) {
      n.removeAttribute("id");
      delete n.dataset["vizId"];
    }
    c.style.cssText = `position:absolute;left:${-l}px;top:${-t}px;width:${fr.width}px;margin:0`;
    const cut = document.createElement("div");
    cut.className = "crop-in";
    cut.style.cssText = `width:${wd}px;height:${ht}px`;
    const ptr = document.createElement("span");
    ptr.className = "v-ptr";
    ptr.style.cssText = `left:${x - fr.left - l}px;top:${y - fr.top - t}px`;
    cut.append(c, ptr);
    const id = `crop-${crops.size + 1}`;
    crops.set(id, { el: cut, w: wd, h: ht });
    return id;
  }

  const widget = (): Widget | undefined => w.vizFeedback;
  const logPick = (e: Entry): void => {
    const wd = widget();
    if (wd) wd.log(e).catch((err: unknown) => console.warn(err));
    else w.vizFeedbackHost?.log(e);
  };

  // which demo question a line is about: the card its anchor sat in when it landed
  const lineQ = new Map<string, string>();
  const qOf = (e: Entry): string => lineQ.get(e.id ?? "") ?? findQ(e);
  function findQ(e: Entry): string {
    let n: Element | null = null;
    try {
      n = e.anchor ? document.querySelector(e.anchor.selector) : null;
    } catch {
      n = null;
    }
    return n?.closest<HTMLElement>("[data-q]")?.dataset["q"] ?? "the demo";
  }
  // the latest text of each spoken/typed line (edits win, retracts remove)
  function said(): Entry[] {
    const m = new Map<string, Entry>();
    for (const e of entries) {
      if ((e.type === "speech" || e.type === "comment") && e.id) m.set(e.id, { ...e });
      else if (e.type === "edit" && e.id && m.has(e.id)) m.get(e.id)!.text = e.text ?? "";
      else if (e.type === "retract" && e.id) m.delete(e.id);
    }
    return [...m.values()];
  }
  function picks(): Map<string, string> {
    const m = new Map<string, string>();
    for (const e of entries) if (e.type === "pick" && e.q && e.opt) m.set(e.q, e.opt);
    return m;
  }

  function thumb(id: string | undefined, cap: string): HTMLElement | null {
    const c = id ? crops.get(id) : undefined;
    if (!c) return null;
    const W = 180;
    const k = W / c.w;
    const f = document.createElement("figure");
    f.className = "crop";
    f.style.cssText = `width:${W}px;height:${c.h * k}px`;
    const inner = c.el.cloneNode(true);
    if (!(inner instanceof HTMLElement)) return null;
    inner.style.transform = `scale(${k})`;
    inner.inert = true; // a picture of the demo, not more of it
    inner.setAttribute("aria-hidden", "true");
    f.append(inner);
    const fc = document.createElement("figcaption");
    fc.textContent = cap;
    f.append(fc);
    return f;
  }

  function paint(): void {
    box.replaceChildren();
    const head = document.createElement("div");
    head.className = "path";
    head.innerHTML = `${raw ? "the log, line by line" : "what the agent reads"} · <button type="button" class="rawbtn">${raw ? "grouped ▸" : "raw log ▸"}</button>`;
    q<HTMLElement>(head, ".rawbtn").addEventListener("click", () => {
      raw = !raw;
      paint();
    });
    box.append(head);
    if (entries.length === 0) {
      box.insertAdjacentHTML(
        "beforeend",
        `<span class="empty">Empty. Pick an option, or click 🎙 in this demo's corner and talk while pointing at one. Alt/Option-click anything to type instead.</span>`,
      );
      return;
    }
    if (raw) {
      for (const e of entries)
        box.insertAdjacentHTML(
          "beforeend",
          `<span class="ln ${esc(e.type)}">${esc(JSON.stringify(e))}</span>`,
        );
      return;
    }
    grouped();
    if (sent)
      box.insertAdjacentHTML(
        "beforeend",
        `<span class="ln send">— Send: round 1 is the agent's —</span>`,
      );
    if (entries.some((e) => e.type === "clear"))
      box.insertAdjacentHTML(
        "beforeend",
        `<span class="ln">— the agent read it and cleared the pins; the log keeps every line —</span>`,
      );
    box.scrollTop = box.scrollHeight;
  }
  /** The black box's default view: per question, the pick, then each line with its two crops. */
  function grouped(): void {
    const p = picks();
    const lines = said();
    const groups = [...new Set([...RQS.map((r) => r.n), ...lines.map(qOf)])];
    for (const g of groups) {
      const mine = lines.filter((l) => qOf(l) === g);
      if (!p.has(g) && mine.length === 0) continue;
      const sec = document.createElement("div");
      sec.className = "grp";
      sec.innerHTML = `<b>[${esc(g)}]</b>${p.has(g) ? ` picked <b class="pk">${esc(p.get(g) ?? "")}</b>` : ""}`;
      for (const l of mine) {
        const row = document.createElement("div");
        row.className = "said";
        row.innerHTML = `${l.type === "speech" ? "🎙" : "⌨"} <span class="s">"${esc(l.text ?? "")}"</span>${l.anchor?.label ? ` <span class="on">on ${esc(l.anchor.label)}</span>` : ""}`;
        sec.append(row);
        const a = thumb(l.shots?.start, "as you began"),
          b = thumb(l.shots?.end, "as you stopped");
        if (a || b) {
          const t = document.createElement("div");
          t.className = "thumbs";
          t.append(...[a, b].filter((x): x is HTMLElement => !!x));
          sec.append(t);
        }
      }
      box.append(sec);
    }
  }

  function sync(): void {
    send.disabled = sent;
    send.textContent = sent ? "Sent ✓" : "Send round 1";
    rewrite.disabled = !(sent && picks().size > 0) || rewritten;
  }

  function cards(): void {
    const p = picks();
    const lines = said();
    left.innerHTML = RQS.map((rq) => {
      const pick = p.get(rq.n);
      const k = pick ? LETTERS.indexOf(pick) : -1;
      if (rewritten && pick) {
        const quotes = lines
          .filter((l) => qOf(l) === rq.n)
          .map(
            (l) =>
              `<div class="quote">↳ you ${l.type === "speech" ? "said" : "typed"}: “${esc(l.text ?? "")}”</div>`,
          )
          .join("");
        return `<details class="rdec" data-viz-id="dec-${rq.n}" data-label="${rq.n} decided"><summary><span class="n">${rq.n}</span>${esc(at(rq.opts, k).label)}<span class="pick">${pick}</span></summary><details class="orig"><summary>Show what you were asked</summary><p><b>${esc(rq.title)}</b> ${esc(rq.body)}</p></details></details>${quotes}`;
      }
      return `<div class="rq${pick ? " collapsed" : ""}" data-q="${rq.n}" data-viz-id="${rq.n}" data-label="${rq.n}: ${esc(rq.title)}">
        <h4><span class="n">${rq.n}</span>${esc(rq.title)}<span class="ans">${pick ? esc(at(rq.opts, k).label) : ""}<span class="k">${pick ?? ""}</span></span></h4>
        <div class="rbody"><div><p>${esc(rq.body)}</p><div class="ropts">${rq.opts
          .map(
            (o, i) =>
              `<button class="ropt${LETTERS[i] === rq.rec ? " rec" : ""}${pick === LETTERS[i] ? " picked" : ""}" data-pick="${rq.n}:${LETTERS[i]}" data-viz-id="${rq.n}-${LETTERS[i]}" data-label="${rq.n} option ${LETTERS[i]}: ${esc(o.label)}">${o.svg}<span><span class="k">${LETTERS[i]}</span>${esc(o.label)}</span></button>`,
          )
          .join("")}</div></div></div></div>`;
    }).join("");
    sync();
  }

  left.addEventListener("click", (e) => {
    if (e.altKey) return; // Alt-click is the widget's: type a comment
    const t = e.target instanceof Element ? e.target : null;
    const pick = t?.closest<HTMLElement>("[data-pick]");
    const folded = t?.closest<HTMLElement>(".rq.collapsed");
    if (pick) {
      const [qn = "", opt = ""] = (pick.dataset["pick"] ?? "").split(":");
      const card = pick.closest<HTMLElement>(".rq");
      if (picks().get(qn) !== opt) {
        for (const b of left.querySelectorAll<HTMLElement>(`[data-pick^="${qn}:"]`))
          b.classList.toggle("picked", b === pick);
        logPick({ type: "pick", q: qn, opt, round: 1 });
        const ans = card?.querySelector<HTMLElement>(".ans");
        if (ans)
          ans.innerHTML = `${esc(
            at(
              RQS,
              RQS.findIndex((r) => r.n === qn),
            ).opts[LETTERS.indexOf(opt)]?.label ?? "",
          )}<span class="k">${opt}</span>`;
        sync();
      }
      window.setTimeout(() => card?.classList.add("collapsed"), 450);
    } else if (folded) folded.classList.remove("collapsed");
  });
  send.addEventListener("click", () => {
    if (sent) return;
    const wd = widget();
    if (wd) wd.send({ round: 1 }).catch((err: unknown) => console.warn(err));
    else w.vizFeedbackHost?.log({ type: "send" });
  });
  addEventListener("viz-feedback:sent", () => {
    sent = true;
    sync();
    paint();
  });
  rewrite.addEventListener("click", () => {
    rewritten = true;
    logPick({ type: "clear" }); // what the agent does once it has read a round
    cards();
  });
  reset.addEventListener("click", () => {
    logPick({ type: "clear" });
    entries = [];
    lineQ.clear();
    crops.clear();
    sent = false;
    rewritten = false;
    cards();
    paint();
  });
  cards();
  paint();
}

export function initHow(): void {
  initSequence();
  initReplica();
}

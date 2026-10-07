// Exhibit 0: "when A, B, C and D aren't enough, say so". A scripted talk-while-you-point stretch on an
// invented question, and the record the agent gets for it. The record's shape is the real one the
// feedback widget writes (kit/src/feedback.ts); every value in it is invented, and the "screenshots"
// are live clones of the mock page cropped the way the widget crops (anchored element + 24 px).
import { esc } from "@viz/kit";
import { at, clamp, ease, lerp, q, reduced } from "./util.js";

// seconds on the script's clock
const LEAD = 1.0; // voice.mp3 starts here: the mic click and the pointer's walk to B come first
const T_MIC = 0; // click the mic
const T_START = LEAD; // speech begins, start crop taken
const T_MOVE = 4.3; // pointer leaves option B, on "but I want…"
const T_ARRIVE = 5.2; // and reaches the search box, on "…search box"
const T_STOP = 7.0; // silence: the stretch ends, end crop taken
const T_TEXT = 7.7; // transcribed; the line is written
const T_END = 8.6;
const WIN = { w: 1280, h: 720 }; // the invented browser window the fractions map onto
const SAID =
  "None of these quite work. I like how big B's tabs are, but I want a search box up here, like in A.";
// when each word starts in voice.mp3 (seconds into the clip): local Parakeet word timestamps of the
// Qwen3-TTS render, so the text, the pointer and the voice line up
const WORD_AT = [
  0, 0.32, 0.48, 0.64, 0.96, 1.36, 1.52, 1.76, 1.92, 2.32, 2.72, 3.04, 3.28, 3.44, 3.52, 3.68, 3.84,
  4.24, 4.48, 4.72, 4.96, 5.2, 5.52,
];
const WORDS = SAID.split(" ");

// where the pointer is (fraction of the page) at each time; eased between neighbours
const PATH: [number, number, number][] = [
  [T_MIC, 0.9, 0.92],
  [T_START - 0.1, 0.36, 0.4],
  [T_MOVE, 0.4, 0.43],
  [T_ARRIVE, 0.82, 0.1],
  [T_STOP, 0.84, 0.11],
];
function pointer(t: number): { x: number; y: number } {
  const i = Math.max(
    0,
    PATH.findLastIndex((k) => k[0] <= t),
  );
  const a = at(PATH, i);
  const b = PATH[i + 1];
  if (!b) return { x: a[1], y: a[2] };
  const k = ease(clamp((t - a[0]) / (b[0] - a[0]), 0, 1));
  return { x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k) };
}

const STEPS: { t: number; chip: string; says: string }[] = [
  {
    t: T_MIC,
    chip: "click the mic",
    says: "The pill in the corner starts listening. Nothing is saved yet.",
  },
  {
    t: T_START,
    chip: "start talking",
    says: "Speech begins with the pointer on option B. The widget takes a screenshot crop around it and remembers where the pointer is.",
  },
  {
    t: T_MOVE,
    chip: "point somewhere else",
    says: "Still talking, the pointer moves to the search box. Only the start and the end of the stretch are recorded, not the path between.",
  },
  {
    t: T_STOP,
    chip: "stop talking",
    says: "A pause ends the stretch. A second crop is taken where the pointer is now, and the audio is handed to the on-page speech model.",
  },
  {
    t: T_TEXT,
    chip: "text lands",
    says: "The words come back, the caption on the search box turns into your sentence, and one line is appended to feedback.jsonl.",
  },
];

const AUDIO_LEN = 6.16; // seconds in voice.mp3
const px = (f: number, of: number): number => Math.round(f * of);

export function initVoice(): void {
  const root = q<HTMLElement>(document, "#exv-stage");
  const id = "k7f2x9ab";
  const A = { start: pointer(T_START), end: pointer(T_STOP) };
  const xy = (p: { x: number; y: number }, exact?: string): string =>
    `{ "x": ${px(p.x, WIN.w)}, "y": ${px(p.y, WIN.h)}, "w": ${WIN.w}, "h": ${WIN.h}, "sx": 0, "sy": 0, "hash": ""${exact ? `, "exact": ${s(exact)}` : ""} }`;
  const anc = (sel: string, label: string, text: string): string =>
    `{ "selector": ${s(sel)}, "label": ${s(label)}, "text": ${s(text)} }`;
  const B = ['div[data-viz-id="v-opt-B"]', "option B: top tabs", "B Top tabs"] as const;
  const S = ['div[data-viz-id="v-search"]', "search box", "Search settings…"] as const;

  // the record, a line at a time; `t` is when that line's value becomes known
  const REC: [number, string][] = [
    [T_START, `  "type": ${s("speech")},`],
    [T_START, `  "id": ${s(id)},`],
    [T_START, '  "text": TEXT,'],
    [T_STOP, `  "anchor": ${anc(...S)},`],
    [T_STOP, `  "where": ${xy(A.end)},`],
    [T_START, `  "from": {`],
    [T_START, `    "anchor": ${anc(...B)},`],
    [T_START, `    "where": ${xy(A.start, 'div[data-viz-id="v-opt-B"] > i:nth-of-type(1)')}`],
    [T_START, "  },"],
    [T_START, `  "shots": {`],
    [T_START, `    "start": ${s(`fb-${id}-start.png`)},`],
    [T_STOP, `    "end": ${s(`fb-${id}-end.png`)}`],
    [T_START, "  },"],
    [T_STOP, `  "secs": ${(T_STOP - T_START).toFixed(1)}`],
  ];

  const OPTS: [string, string, string][] = [
    ["A", "Sidebar", "wf-a"],
    ["B", "Top tabs", "wf-b"],
    ["C", "One scroll", "wf-c"],
    ["D", "Cards", "wf-d"],
  ];
  root.innerHTML = `
    <div class="two v-two">
      <div>
        <div class="sub-h">the page, as you see it</div>
        <div class="v-page" id="v-page" data-viz-id="v-page" data-label="a mock grill question">
          <div class="v-head">
            <span class="v-q"><b>Q5</b> Where does settings live?</span>
            <div class="v-search" id="v-search" data-viz-id="v-search" data-label="search box">Search settings…</div>
          </div>
          <div class="v-opts">
            ${OPTS.map(([k, name, wf]) => `<div class="v-opt ${wf}" data-viz-id="v-opt-${k}" data-label="option ${k}: ${name.toLowerCase()}"><i></i><i></i><i></i><span><b>${k}</b> ${name}</span></div>`).join("")}
          </div>
          <div class="v-pill" id="v-pill"><span class="mic">●</span><span class="wave"><u></u><u></u><u></u><u></u><u></u></span></div>
          <div class="v-cap" id="v-cap"></div>
          <svg class="v-cur" id="v-cur" viewBox="0 0 16 22" aria-hidden="true"><path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill="#fff" stroke="#0d1117" stroke-width="1.2"/></svg>
        </div>
        <div class="row v-ctrl">
          <button class="btn" id="v-play" data-viz-id="v-play" data-label="play or pause the talk-and-point script">▶ play</button>
          <input type="range" id="v-scrub" min="0" max="${Math.round(T_END * 10)}" value="${Math.round(T_END * 10)}" data-viz-id="v-scrub" data-label="scrub the script's clock" aria-label="scrub the clock" />
          <span class="lbl" id="v-clock"></span>
        </div>
        <div class="read" id="v-says"></div>
      </div>
      <div>
        <div class="sub-h">what the agent reads <b>(one line of feedback.jsonl)</b></div>
        <div class="v-shots">
          <figure><div class="v-shot" data-verify-clip-ok id="v-shot-start" data-viz-id="v-shot-start" data-label="start screenshot"></div><figcaption>shots.start · where it began</figcaption></figure>
          <figure><div class="v-shot" data-verify-clip-ok id="v-shot-end" data-viz-id="v-shot-end" data-label="end screenshot"></div><figcaption>shots.end · where it ended</figcaption></figure>
        </div>
        <pre class="v-rec" id="v-rec" data-viz-id="v-rec" data-label="the feedback record"></pre>
        <div class="read">
          <b>The agent sees</b> the words, <b>what you were pointing at</b> when you began and when you finished (a name, not just a pixel), the exact coordinates and window, and a picture of each moment. Screenshots need a one-time "share this tab" prompt; without it the line simply has no pictures. The audio is never saved. Here the words appear in the record as you hear them, to follow along; the real widget writes the line once, after you stop.
        </div>
      </div>
    </div>`;

  const page = q<HTMLElement>(root, "#v-page");
  const cur = q<SVGElement>(root, "#v-cur");
  const cap = q<HTMLElement>(root, "#v-cap");
  const pill = q<HTMLElement>(root, "#v-pill");
  const rec = q<HTMLElement>(root, "#v-rec");
  const scrub = q<HTMLInputElement>(root, "#v-scrub");
  const clock = q<HTMLElement>(root, "#v-clock");
  const says = q<HTMLElement>(root, "#v-says");
  const play = q<HTMLButtonElement>(root, "#v-play");
  const optB = q<HTMLElement>(page, '[data-viz-id="v-opt-B"]');
  const search = q<HTMLElement>(page, "#v-search");
  const shotStart = q<HTMLElement>(root, "#v-shot-start");
  const shotEnd = q<HTMLElement>(root, "#v-shot-end");

  rec.innerHTML = `<span class="p">{</span>\n${REC.map(([t0, line]) => `<span class="rl${line.includes("TEXT") ? " live" : ""}" data-t="${t0}">${line.includes("TEXT") ? "" : hl(line)}</span>`).join("\n")}\n<span class="p">}</span>`;
  const recLines = [...rec.querySelectorAll<HTMLElement>(".rl")];
  const liveText = q<HTMLElement>(rec, ".rl.live");

  // the text line fills in word by word as the clip says them, with a caret until the stretch ends
  function textLine(now: number): void {
    const n = now >= T_STOP ? WORDS.length : WORD_AT.filter((w) => LEAD + w <= now).length;
    const said = WORDS.slice(0, n).join(" ");
    liveText.innerHTML = `${hl('  "text": ')}<span class="s">"${esc(said)}</span>${now < T_STOP ? '<span class="caret"></span>' : ""}<span class="s">"</span><span class="p">,</span>`;
  }

  // a "screenshot": the page cloned without the pointer, cropped to the anchor + 24 px, pointer drawn on
  function shoot(target: HTMLElement, p: { x: number; y: number }, frame: HTMLElement): void {
    const pr = page.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const w = Math.min(r.width + 48, pr.width);
    const h = Math.min(r.height + 48, pr.height);
    const left = clamp(r.left - pr.left - 24, 0, pr.width - w);
    const top = clamp(r.top - pr.top - 24, 0, pr.height - h);
    const c = page.cloneNode(true);
    if (!(c instanceof HTMLElement)) return;
    for (const n of c.querySelectorAll(".v-cur, .v-cap, .v-pill")) n.remove();
    for (const n of [c, ...c.querySelectorAll<HTMLElement>("[id], [data-viz-id]")]) {
      n.removeAttribute("id");
      delete n.dataset["vizId"];
    }
    c.style.cssText = `position:absolute;left:${-left}px;top:${-top}px;width:${pr.width}px;height:${pr.height}px`;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    frame.replaceChildren(c);
    const dot = document.createElement("span");
    dot.className = "v-ptr";
    dot.style.left = `${p.x * pr.width - left}px`;
    dot.style.top = `${p.y * pr.height - top}px`;
    frame.append(dot);
  }

  // the caption follows the widget: "…" while you talk, your words once they're transcribed
  function caption(now: number): void {
    const talking = now >= T_START && now < T_STOP;
    const landed = now >= T_TEXT;
    cap.style.display = talking || landed ? "block" : "none";
    cap.textContent = landed ? SAID : "…";
    cap.classList.toggle("landed", landed);
    const over = now >= T_ARRIVE ? search : optB;
    const r = over.getBoundingClientRect();
    const pr = page.getBoundingClientRect();
    const right = over === search;
    cap.style.left = right ? "auto" : `${clamp(r.left - pr.left, 0, pr.width - 90)}px`;
    cap.style.right = right ? "2%" : "auto";
    cap.style.top = `${right ? r.bottom - pr.top + 6 : r.top - pr.top - 30}px`;
  }

  let t = T_END;
  function render(now: number, quiet = false): void {
    t = clamp(now, 0, T_END);
    const p = pointer(t);
    const live = t >= T_MIC && t < T_STOP;
    cur.style.left = `${p.x * 100}%`;
    cur.style.top = `${p.y * 100}%`;
    cur.style.opacity = t >= T_STOP + 0.9 ? "0.35" : "1";
    optB.classList.toggle("hot", t >= T_START - 0.1 && t < T_MOVE + 0.6);
    search.classList.toggle("hot", t >= T_ARRIVE && t < T_TEXT + 0.9);
    pill.classList.toggle("on", live);
    pill.classList.toggle("talking", t >= T_START && t < T_STOP);
    caption(t);
    textLine(t);
    for (const l of recLines) l.classList.toggle("on", Number(l.dataset["t"]) <= t);
    shotStart.parentElement?.classList.toggle("on", t >= T_START);
    shotEnd.parentElement?.classList.toggle("on", t >= T_STOP);
    const si = STEPS.findLastIndex((st) => st.t <= t);
    says.innerHTML = `<b>${esc(at(STEPS, si).chip)}.</b> ${esc(at(STEPS, si).says)}`;
    clock.textContent = `${t.toFixed(1)} s`;
    if (!quiet) scrub.value = String(Math.round(t * 10));
  }

  // take both crops once, with the page as it was at each moment, then return to the end state
  render(T_START + 0.05, true);
  shoot(optB, A.start, shotStart);
  render(T_STOP + 0.05, true);
  shoot(search, A.end, shotEnd);
  render(T_END);

  // playback: the clip's own clock drives the script while it plays, so voice, pointer and text can't drift
  const audio = new Audio();
  let raf = 0;
  let silent = false; // the clip is missing or the browser refused it: stop asking, keep the script running
  // fetched, not linked: a published page is one file, and viz:bundle answers this fetch from inside it
  const load = async (): Promise<void> => {
    audio.src = URL.createObjectURL(await (await fetch("voice.mp3")).blob());
  };
  load().catch(() => {
    silent = true;
  });
  const pause = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
    audio.pause();
    play.textContent = "▶ play";
  };
  play.addEventListener("click", () => {
    if (raf) return pause();
    if (reduced()) return render(T_END);
    if (t >= T_END - 0.05) {
      render(0);
      audio.currentTime = 0; // a finished clip stays "ended" until it is moved
    }
    play.textContent = "❚❚ pause";
    let last = performance.now();
    let clipSeen = audio.currentTime;
    const tick = (ts: number): void => {
      const clipAt = t - LEAD;
      if (
        !silent &&
        audio.src &&
        audio.paused &&
        !audio.ended &&
        clipAt >= 0 &&
        clipAt < AUDIO_LEN
      ) {
        audio.currentTime = clipAt;
        audio.play().catch((e: unknown) => {
          silent = true;
          console.warn("voice.mp3 not played", e);
        });
      }
      // the script's own clock runs; while the clip is audibly moving it wins any disagreement
      let next = t + (ts - last) / 1000;
      last = ts;
      const moving = audio.currentTime !== clipSeen;
      clipSeen = audio.currentTime;
      if (moving && !audio.paused && !audio.ended && Math.abs(LEAD + clipSeen - next) > 0.1)
        next = LEAD + clipSeen;
      render(next);
      if (t < T_END) raf = requestAnimationFrame(tick);
      else pause();
    };
    raf = requestAnimationFrame(tick);
  });
  scrub.addEventListener("input", () => {
    pause();
    render(Number(scrub.value) / 10);
    audio.currentTime = clamp(t - LEAD, 0, AUDIO_LEN);
  });
}

/** A JSON string literal. */
function s(v: string): string {
  return JSON.stringify(v);
}

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|([{}[\],])/gu;
/** One line of JSON as highlighted HTML: keys, strings, numbers, punctuation. */
function hl(line: string): string {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    out += esc(line.slice(last, m.index));
    const [all, str, colon, num] = m;
    const cls = str ? (colon ? "k" : "s") : num ? "n" : "p";
    out += `<span class="${cls}">${esc(str ?? num ?? all)}</span>${colon ? `<span class="p">${esc(colon)}</span>` : ""}`;
    last = m.index + all.length;
  }
  return out + esc(line.slice(last));
}

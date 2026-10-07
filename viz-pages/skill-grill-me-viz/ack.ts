// Exhibit 1: "How does it tell you it heard you?" Four acknowledgement styles that really play:
// WebAudio tones for the chimes, speechSynthesis for the voice, and a timeline that shows the
// silence before the first sign of life.
import { esc } from "@viz/kit";
import { at, attrs, pressOne, q, SVGNS } from "./util.js";

type Kind = "chime" | "done" | "voice" | "screen";
interface Ev {
  t: number;
  kind: Kind;
  text: string;
}
interface Style {
  id: string;
  label: string;
  evs: Ev[];
}

const SAID = "you finish: “Hey assistant, run the tests.”";
const STYLES: Style[] = [
  {
    id: "A",
    label: "A · chime only",
    evs: [
      { t: 0.4, kind: "chime", text: "chime: I heard you" },
      { t: 3.0, kind: "done", text: "done chime" },
    ],
  },
  {
    id: "B",
    label: "B · says “on it”",
    evs: [
      { t: 0.6, kind: "voice", text: "On it." },
      { t: 3.4, kind: "voice", text: "Done." },
    ],
  },
  {
    id: "D",
    label: "D · chime + what it heard",
    evs: [
      { t: 0.4, kind: "chime", text: "chime: I heard you" },
      { t: 0.4, kind: "screen", text: "Heard: “run the tests”" },
      { t: 3.0, kind: "done", text: "done chime" },
      { t: 3.0, kind: "screen", text: "Done: tests passed" },
    ],
  },
  {
    id: "E",
    label: "E · chime + speaks it back",
    evs: [
      { t: 0.4, kind: "chime", text: "chime: I heard you" },
      { t: 0.9, kind: "voice", text: "Running the tests." },
      { t: 3.6, kind: "done", text: "done chime" },
    ],
  },
];

const END = 4.2;
const LANES: Record<"sound" | "voice" | "screen", number> = { sound: 56, voice: 104, screen: 152 };
const laneOf = (k: Kind): "sound" | "voice" | "screen" =>
  k === "chime" || k === "done" ? "sound" : k;
const X0 = 84;
const X1 = 462;
const X = (t: number): number => X0 + (t / END) * (X1 - X0);

let audio: AudioContext | undefined;
function tone(freq: number, start: number, dur: number): void {
  audio ??= new AudioContext();
  const ctx = audio;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime + start;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}
function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

export function initAck(): void {
  const root = q<HTMLElement>(document, "#ex1-stage");
  root.innerHTML = `
    <div class="two">
      <div>
        <div class="row" id="ack-btns">
          ${STYLES.map((s) => `<button class="btn" data-style="${s.id}" data-viz-id="play-${s.id}" data-label="Play style ${esc(s.label)}">▶ ${esc(s.label)}</button>`).join("")}
        </div>
        <div class="toast" id="ack-toast" data-viz-id="ack-screen" data-label="the on-screen notification">on screen: nothing yet</div>
        <div class="acklog" id="ack-log" aria-live="polite"><div>Press a style. Each line shows what would happen, and when. (Tones and voice come from your own browser, so this sketches the timing, not the final sound.)</div></div>
      </div>
      <div>
        <div class="sub-h">TIMELINE · <b>the red bar is the silence</b> before you know it heard</div>
        <svg id="ack-svg" viewBox="0 0 480 196" role="img" aria-label="Timeline of sound, voice and screen events after you finish speaking"></svg>
      </div>
    </div>`;
  const svg = q<SVGSVGElement>(root, "#ack-svg");
  const log = q<HTMLElement>(root, "#ack-log");
  const toast = q<HTMLElement>(root, "#ack-toast");
  const btns = [...root.querySelectorAll<HTMLElement>("#ack-btns .btn")];

  const mk = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    a: Record<string, string | number>,
    text?: string,
  ) => {
    const el = attrs(document.createElementNS(SVGNS, tag), a);
    if (text !== undefined) el.textContent = text;
    svg.append(el);
    return el;
  };

  const timers: number[] = [];
  let raf = 0;

  function frame(style: Style | undefined, fired: Set<number>): void {
    svg.replaceChildren();
    for (const [name, y] of Object.entries(LANES))
      mk("text", { x: 8, y: y + 4, fill: "var(--muted)", "font-size": 12 }, name);
    for (const y of Object.values(LANES))
      mk("line", {
        x1: X0,
        x2: X1,
        y1: y,
        y2: y,
        stroke: "var(--border)",
        "stroke-dasharray": "2 4",
      });
    for (let s = 0; s <= 4; s++) {
      mk("line", { x1: X(s), x2: X(s), y1: 170, y2: 175, stroke: "var(--faint)" });
      mk(
        "text",
        { x: X(s), y: 190, "text-anchor": "middle", fill: "var(--faint)", "font-size": 11.5 },
        `${s}s`,
      );
    }
    mk("line", { x1: X(0), x2: X(0), y1: 28, y2: 172, stroke: "var(--text)", "stroke-width": 1.5 });
    mk("text", { x: X(0) + 5, y: 24, fill: "var(--text)", "font-size": 12 }, "you stop talking");
    if (!style) return;
    const first = Math.min(...style.evs.map((e) => e.t));
    mk("rect", {
      x: X(0),
      y: 30,
      width: X(first) - X(0),
      height: 8,
      rx: 3,
      fill: "var(--danger)",
      "data-viz-id": "silence",
      "data-label": `silence: ${first} s`,
    });
    mk(
      "text",
      { x: X(first) + 6, y: 38, fill: "var(--danger)", "font-size": 12 },
      `${first} s of silence`,
    );
    style.evs.forEach((e, i) => {
      const on = fired.has(i);
      const lane = laneOf(e.kind);
      const y = LANES[lane];
      mk("circle", {
        cx: X(e.t),
        cy: y,
        r: 8,
        fill: on ? (lane === "screen" ? "var(--good)" : "var(--accent)") : "none",
        stroke: lane === "screen" ? "var(--good)" : "var(--accent)",
        "stroke-width": 2,
        "stroke-dasharray": on ? "0" : "3 3",
        "data-viz-id": `ev-${i}`,
        "data-label": e.text,
      });
      const anchor = e.t > 3.2 ? "end" : "start";
      mk(
        "text",
        {
          x: X(e.t) + (anchor === "end" ? 2 : -2),
          y: y + 24,
          "text-anchor": anchor,
          fill: on ? "var(--text)" : "var(--faint)",
          "font-size": 11.5,
        },
        e.text,
      );
    });
  }

  function play(id: string): void {
    const style = STYLES.find((s) => s.id === id);
    if (!style) return;
    for (const t of timers.splice(0)) clearTimeout(t);
    cancelAnimationFrame(raf);
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    pressOne(btns, btns.find((b) => b.dataset["style"] === id) ?? null);
    toast.textContent = "on screen: nothing yet";
    toast.classList.remove("on");
    log.innerHTML = "";
    const fired = new Set<number>();
    frame(style, fired);
    const head = mk("line", {
      x1: X(0),
      x2: X(0),
      y1: 28,
      y2: 172,
      stroke: "var(--warn)",
      "stroke-width": 2,
    });
    const t0 = performance.now();
    const line = (cls: string, text: string): void => {
      const s = ((performance.now() - t0) / 1000).toFixed(1);
      log.insertAdjacentHTML(
        "beforeend",
        `<div><span class="t">${s}s</span><span class="${cls}">${esc(text)}</span></div>`,
      );
    };
    line("you", SAID);
    const tick = (now: number): void => {
      const t = Math.min((now - t0) / 1000, END);
      attrs(head, { x1: X(t), x2: X(t) });
      if (t < END) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    style.evs.forEach((e, i) => {
      timers.push(
        window.setTimeout(() => {
          fired.add(i);
          if (e.kind === "chime") {
            tone(660, 0, 0.12);
            tone(880, 0.12, 0.16);
          } else if (e.kind === "done") {
            tone(880, 0, 0.1);
            tone(1175, 0.11, 0.2);
          } else if (e.kind === "voice") speak(e.text);
          else {
            toast.textContent = `on screen: ${e.text}`;
            toast.classList.add("on");
          }
          line(
            e.kind === "screen" ? "scr" : "snd",
            `${e.kind === "screen" ? "screen" : e.kind === "voice" ? "voice" : "♪"}: ${e.text}`,
          );
          frame(style, fired);
          svg.append(head);
        }, e.t * 1000),
      );
    });
  }

  frame(undefined, new Set());
  root.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-style]") : null;
    if (b) play(b.dataset["style"] ?? "");
  });
  // an idle sketch of the winner so the timeline is never empty
  frame(at(STYLES, 2), new Set());
}

// Exhibit 2: "the pin that lies" and what you see while you talk.
// Left: the same four feedback lines on one bar, drawn three ways. Right: hold a thought, move the
// mouse, and watch the three-phase sequence the feedback widget uses (dot at the cursor, "…" on
// the element, then the text).
import { esc } from "@viz/kit";
import { initVoice } from "./voice.js";
import { at, optLabel, pressOne, q, reduced } from "./util.js";

const YEARS = ["2019", "2020", "2021", "2022", "2023"];
const HEIGHTS = [44, 62, 78, 56, 68];
const LINES = [
  "make this bar green",
  "the label is cut off",
  "why is 2021 the tallest?",
  "add the source",
];
type Mode = "per" | "count" | "stack" | "fan" | "bubble";
const READ: Record<Mode, string> = {
  per: "<b>A pin per line.</b> Unambiguous, but ten lines about one bar is a pile of ten pins covering the chart.",
  count:
    "<b>One pin with a count.</b> Is that <b>pin number 4</b>, or <b>four pins</b>? A numeral reads as an ordinal. Click it to see the lines; that is the only way to find out.",
  stack:
    "<b>A deck with ×4.</b> A multiplication sign can't be mistaken for a position. Nothing needs a number: you click it and it opens the four lines.",
  fan: "<b>A stack that fans out.</b> Looks like the deck at rest; point at it and it spreads into one pin per line. The most to build.",
  bubble:
    "<b>A speech bubble, no number.</b> Easy to read, but it covers the chart once many elements have feedback.",
};
const BTNS: { mode: Mode; group: string; letter: string; text: string }[] = [
  { mode: "per", group: "Q2", letter: "A", text: "pin per line" },
  { mode: "count", group: "Q2", letter: "B", text: "one pin + count" },
  { mode: "stack", group: "Q8", letter: "A", text: "stacked ×4" },
  { mode: "fan", group: "Q8", letter: "B", text: "fans on hover" },
  { mode: "bubble", group: "Q8", letter: "C", text: "text bubble" },
];

function bars(hit: number, inner: (i: number) => string): string {
  return YEARS.map(
    (y, i) =>
      `<div class="bar${i === hit ? " hit" : ""}" data-bar="${y}" data-viz-id="bar-${y}" data-label="the ${y} bar" style="height:${at(HEIGHTS, i)}%">${inner(i)}<span class="yr">${y}</span></div>`,
  ).join("");
}

export function initPin(): void {
  const root = q<HTMLElement>(document, "#ex2-stage");
  root.innerHTML = `
    <div class="two">
      <div>
        <div class="sub-h">four lines said about the 2021 bar: <b>how should the pin look?</b></div>
        <div class="row" id="pin-modes">
          ${BTNS.map((b, i) => `${i === 0 || at(BTNS, i - 1).group !== b.group ? `<span class="lbl">${b.group}${b.group === "Q2" ? " (first try)" : " (re-asked)"}</span>` : ""}<button class="btn" data-mode="${b.mode}" data-viz-id="mode-${b.mode}" data-label="${b.group} option ${b.letter}: ${b.text}">${optLabel(b.letter, b.text)}</button>`).join("")}
        </div>
        <div class="chartbox" id="pin-chart" data-viz-id="pin-chart" data-label="bar chart with feedback pins"></div>
        <div class="read" id="pin-read"></div>
      </div>
      <div>
        <div class="sub-h">while you talk: <b>what should you see?</b></div>
        <div class="row"><span class="lbl">Q9</span><span class="btn" style="cursor:default">${optLabel("A", "element only")}</span><span class="btn" style="cursor:default">${optLabel("B", "dot at the cursor")}</span><span class="btn" style="cursor:default">${optLabel("C", "text flies")}</span></div>
        <div class="row"><button class="btn" id="talk" data-viz-id="talk-btn" data-label="start a three second thought">● try B, then A (3 s)</button><span class="lbl">move the mouse over the bars</span></div>
        <div class="chartbox" id="talk-chart" data-viz-id="talk-chart" data-label="bar chart you point at while talking"><div class="listen-dot" id="dot"></div></div>
        <div class="phase" id="phase"><span>① dot follows cursor</span><span>② “…” locks on</span><span>③ text lands</span></div>
        <div class="read" id="talk-read">Press the button, talk (pretend), and aim: the text anchors to where the mouse is when you <b>stop</b>.</div>
      </div>
    </div>`;

  // ── left: three pin designs ──────────────────────────────────────────────
  const chart = q<HTMLElement>(root, "#pin-chart");
  const read = q<HTMLElement>(root, "#pin-read");
  const modeBtns = [...root.querySelectorAll<HTMLElement>("#pin-modes .btn")];
  let mode: Mode = "count";
  let open = false;
  const draw = (): void => {
    pressOne(modeBtns, modeBtns.find((b) => b.dataset["mode"] === mode) ?? null);
    chart.innerHTML = bars(2, (i) => {
      if (i !== 2) return "";
      if (mode === "per")
        return `<div class="pins" data-pins>${LINES.map((_, k) => `<span class="pn" data-viz-id="pin-${k + 1}" data-label="pin for line ${k + 1}">${k + 1}</span>`).join("")}</div>`;
      if (mode === "count")
        return `<div class="pins" data-pins><span class="pn" data-viz-id="pin-count" data-label="one pin reading 4">4</span></div>`;
      if (mode === "bubble")
        return `<div class="pins" data-pins><span class="pn" data-viz-id="pin-bubble" data-label="a pin with a speech bubble">1</span><span class="cap-bubble" style="top:-40px">add the source…</span></div>`;
      if (mode === "fan")
        return `<div class="pins fan" data-pins>${LINES.map((_, k) => `<span class="pn" style="--k:${k}" data-viz-id="pin-fan-${k + 1}" data-label="fanned pin ${k + 1}">${k + 1}</span>`).join("")}</div>`;
      return `<div class="pins stack" data-pins><span class="pn" style="left:14px;top:-8px;opacity:.35"></span><span class="pn" style="left:7px;top:-4px;opacity:.65"></span><span class="pn" data-viz-id="pin-stack" data-label="a deck of pins reading times four">×4</span></div>`;
    });
    const lines = open
      ? `<div style="margin-top:6px;color:var(--text)">${LINES.map((l, k) => `${k + 1}. “${esc(l)}”`).join("<br>")}</div>`
      : "";
    read.innerHTML = READ[mode] + lines;
  };
  root.querySelector("#pin-modes")?.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-mode]") : null;
    if (!b) return;
    const m = b.dataset["mode"];
    mode = m === "per" || m === "stack" || m === "fan" || m === "bubble" ? m : "count";
    open = false;
    draw();
  });
  chart.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest(".pn")) {
      open = !open;
      draw();
    }
  });
  draw();

  // ── right: dot → "…" → text ────────────────────────────────────────────
  const talk = q<HTMLElement>(root, "#talk-chart");
  const dot = q<HTMLElement>(root, "#dot");
  const talkRead = q<HTMLElement>(root, "#talk-read");
  const phases = [...root.querySelectorAll<HTMLElement>("#phase span")];
  const baseBars = bars(-1, () => "");
  talk.insertAdjacentHTML("beforeend", baseBars);
  const talkBtn = q<HTMLButtonElement>(root, "#talk");
  let last = { x: 0, y: 0, ok: false };
  talk.addEventListener("pointermove", (e) => {
    const r = talk.getBoundingClientRect();
    last = { x: e.clientX, y: e.clientY, ok: true };
    dot.style.left = `${e.clientX - r.left}px`;
    dot.style.top = `${e.clientY - r.top}px`;
  });
  const setPhase = (n: number): void => {
    phases.forEach((p, i) => {
      p.classList.toggle("on", i === n);
    });
  };
  const clear = (): void => {
    for (const el of talk.querySelectorAll(".cap-bubble, .cap-pin")) el.remove();
  };
  talkBtn.addEventListener("click", () => {
    clear();
    last = { x: 0, y: 0, ok: false };
    talkBtn.disabled = true;
    dot.classList.add("on");
    setPhase(0);
    talkRead.innerHTML =
      "<b>Listening.</b> A small dot follows your cursor so you know it heard you, without looking at the corner. Aim at a bar.";
    const wait = reduced() ? 1200 : 3200;
    window.setTimeout(() => {
      dot.classList.remove("on");
      const under = last.ok
        ? document.elementFromPoint(last.x, last.y)?.closest<HTMLElement>(".bar")
        : null;
      const bar =
        under && talk.contains(under)
          ? under
          : (talk.querySelectorAll<HTMLElement>(".bar")[2] ?? null);
      if (!bar) return;
      const name = bar.dataset["bar"] ?? "";
      const cap = document.createElement("span");
      cap.className = "cap-bubble";
      cap.textContent = "…";
      bar.append(cap);
      setPhase(1);
      talkRead.innerHTML = `<b>You stopped.</b> “…” locks onto the <b>${esc(name)}</b> bar, because that is where the mouse was.`;
      window.setTimeout(() => {
        cap.textContent = `make ${name} green`;
        cap.style.background = "var(--warn)";
        cap.style.color = "#0d1117";
        setPhase(2);
        talkRead.innerHTML = `<b>The text replaces the dots</b> and is now a pin on the ${esc(name)} bar. Dot first, then the caption on the element.`;
        talkBtn.disabled = false;
      }, 900);
    }, wait);
  });
  initVoice(); // the talk-while-you-point record, one step on from the dot and the caption above
}

// Exhibit 9: the squint test. One invented day of a calendar, drawn four ways. The task: tell the
// promised blocks from the computed (forecast) ones. Drag the squint slider; reveal who is who.
// Round one's version is here too, because it failed, and the grill had to ask again.
import { esc } from "@viz/kit";
import { q } from "./util.js";

type Kind = "session" | "promised" | "computed";
interface Blk {
  kind: Kind;
  proj: 0 | 1 | 2;
  from: number;
  to: number;
  label: string;
}
const PROJ = ["#5aa9f0", "#e09a5a", "#6ad0c8"];
const DAY: Blk[] = [
  { kind: "promised", proj: 0, from: 9, to: 9.5, label: "Standup" },
  { kind: "session", proj: 1, from: 9.5, to: 11, label: "Draft the spec" },
  { kind: "computed", proj: 1, from: 11, to: 12.5, label: "Draft the spec" },
  { kind: "promised", proj: 2, from: 13, to: 14, label: "Design review" },
  { kind: "computed", proj: 0, from: 14, to: 15.5, label: "Fix the import" },
  { kind: "computed", proj: 2, from: 15.5, to: 15.58, label: "Reply" },
  { kind: "promised", proj: 1, from: 16, to: 16.75, label: "Retro" },
];
const H0 = 8.75;
const PX = 42;

interface Look {
  id: string;
  title: string;
  cls: string;
  verdict: string;
  css(b: Blk): string;
  icon(b: Blk): string;
}
const tint = (p: number, pct: number): string => `color-mix(in srgb, ${PROJ[p]} ${pct}%, #080b10)`;
const LOOKS: Look[] = [
  {
    id: "r1",
    title: "ROUND 1 · 35% tint vs 14% tint",
    cls: "bad",
    verdict: "failed: “reads the same in the dark”",
    css: (b) =>
      `background:${tint(b.proj, b.kind === "session" ? 85 : b.kind === "promised" ? 35 : 14)}`,
    icon: () => "",
  },
  {
    id: "a",
    title: "A · filled vs empty",
    cls: "",
    verdict: "a close second",
    css: (b) =>
      b.kind === "computed"
        ? `background:transparent;border:1.5px dashed ${PROJ[b.proj]};color:#8b949e;font-style:italic`
        : `background:${tint(b.proj, b.kind === "session" ? 85 : 45)};border:2px solid ${PROJ[b.proj]}`,
    icon: () => "",
  },
  {
    id: "b",
    title: "B · A + icons",
    cls: "",
    verdict: "“kind of cheating”: the icons carry it",
    css: (b) =>
      b.kind === "computed"
        ? `background:transparent;border:1.5px dashed ${PROJ[b.proj]};color:#8b949e;font-style:italic`
        : `background:${tint(b.proj, b.kind === "session" ? 85 : 45)};border:2px solid ${PROJ[b.proj]}`,
    icon: (b) => (b.kind === "computed" ? "⚙ " : b.kind === "promised" ? "📌 " : "✓ "),
  },
  {
    id: "c",
    title: "C · computed goes grey",
    cls: "win",
    verdict: "picked: colour means “really happening”",
    css: (b) =>
      b.kind === "computed"
        ? `background:#2d333b;border-left:5px solid ${PROJ[b.proj]};color:#b6bec8`
        : `background:${tint(b.proj, b.kind === "session" ? 85 : 55)};border:2px solid ${PROJ[b.proj]}`,
    icon: () => "",
  },
];

export function initSquint(): void {
  const root = q<HTMLElement>(document, "#ex9-stage");
  root.innerHTML = `
    <div class="sliderrow">
      <label for="sq">Squint</label>
      <input type="range" id="sq" min="0" max="5" step="0.25" value="0" data-viz-id="squint-slider" data-label="squint amount" />
      <output id="sqv">0</output>
      <button class="btn" id="reveal" aria-pressed="false" data-viz-id="reveal" data-label="reveal the computed blocks">reveal the computed ones</button>
      <span class="hint" style="font-size:12.5px;color:var(--muted)">Which blocks are the scheduler's guess? Squint until it stops being obvious.</span>
    </div>
    <div class="squint">
      ${LOOKS.map(
        (
          l,
        ) => `<div class="style-col ${l.cls}" data-viz-id="look-${l.id}" data-label="${esc(l.title)}">
          <h5>${esc(l.title)}</h5>
          <div class="cal" data-cal>
            ${[9, 10, 11, 12, 13, 14, 15, 16].map((h) => `<div class="hr" style="top:${(h - H0) * PX}px"></div>`).join("")}
            ${DAY.map((b, i) => `<div class="blk" data-kind="${b.kind}" data-viz-id="blk-${l.id}-${i}" data-label="${esc(b.label)}: ${b.kind}" title="${esc(b.label)} (${b.kind})" style="top:${(b.from - H0) * PX}px;height:${Math.max(4, (b.to - b.from) * PX - 2)}px;left:6px;right:6px;${l.css(b)}">${b.to - b.from > 0.2 ? l.icon(b) + esc(b.label) : ""}</div>`).join("")}
          </div>
          <div class="sub-h" style="margin:6px 0 0">${esc(l.verdict)}</div>
        </div>`,
      ).join("")}
    </div>
    <p class="out m">Invented day. Three kinds of time: <b style="color:#fff">session</b> (what happened), <b style="color:#fff">promised</b> (a meeting or a plan), <b style="color:#fff">computed</b> (the scheduler's forecast). The 5-minute “Reply” at 3:30 is the cruel one.</p>`;
  const sq = q<HTMLInputElement>(root, "#sq");
  const sqv = q<HTMLElement>(root, "#sqv");
  const reveal = q<HTMLElement>(root, "#reveal");
  const apply = (): void => {
    sqv.textContent = `${sq.value} px`;
    for (const c of root.querySelectorAll<HTMLElement>("[data-cal]"))
      c.style.filter = Number(sq.value) > 0 ? `blur(${sq.value}px)` : "";
  };
  sq.addEventListener("input", apply);
  reveal.addEventListener("click", () => {
    const on = reveal.getAttribute("aria-pressed") !== "true";
    reveal.setAttribute("aria-pressed", String(on));
    reveal.classList.toggle("on", on);
    for (const b of root.querySelectorAll<HTMLElement>('.blk[data-kind="computed"]'))
      b.classList.toggle("revealed", on);
  });
  apply();
}

// Exhibit 8: "How far should the splitting skill go?" An invented pull request (a report exporter with
// five modules) drawn as tiles: green is production code, blue is tests, dashed is fixtures. Click a
// seam to cut or join, or take a preset. Joining is a click; cutting is the hard part, which is the
// whole argument for starting from the finest cut.
import { optLabel, pressOne, q } from "./util.js";

interface Atom {
  name: string;
  tiles: { kind: "prod" | "test" | "cfg"; label: string; lines: number }[];
}
const ATOMS: Atom[] = [
  {
    name: "csv",
    tiles: [
      { kind: "prod", label: "csv.ts", lines: 84 },
      { kind: "test", label: "csv.test.ts", lines: 140 },
    ],
  },
  {
    name: "json",
    tiles: [
      { kind: "prod", label: "json.ts", lines: 62 },
      { kind: "test", label: "json.test.ts", lines: 118 },
    ],
  },
  {
    name: "xml",
    tiles: [
      { kind: "prod", label: "xml.ts", lines: 96 },
      { kind: "test", label: "xml.test.ts", lines: 152 },
    ],
  },
  {
    name: "pdf",
    tiles: [
      { kind: "prod", label: "pdf.ts", lines: 210 },
      { kind: "test", label: "pdf.test.ts", lines: 190 },
      { kind: "cfg", label: "6 fixtures", lines: 40 },
    ],
  },
  {
    name: "xlsx",
    tiles: [
      { kind: "prod", label: "xlsx.ts", lines: 150 },
      { kind: "test", label: "xlsx.test.ts", lines: 120 },
      { kind: "cfg", label: "3 fixtures", lines: 30 },
    ],
  },
];
const lines = (a: Atom): number => a.tiles.reduce((s, t) => s + t.lines, 0);
const TOTAL = ATOMS.reduce((s, a) => s + lines(a), 0);
const PRESETS: Record<string, boolean[]> = {
  "1": [false, false, false, false],
  "2": [false, false, true, false], // text formats | binary formats
  "5": [true, true, true, true],
};

export function initCut(): void {
  const root = q<HTMLElement>(document, "#ex8-stage");
  root.innerHTML = `
    <div class="row">
      <span class="lbl">one PR, ${TOTAL} lines: how far to cut it?</span>
      <button class="btn" data-p="1" aria-pressed="false" data-viz-id="cut-1" data-label="one PR">${optLabel("A", "1 PR (as is)")}</button>
      <button class="btn" data-p="2" aria-pressed="false" data-viz-id="cut-2" data-label="two PRs">${optLabel("B", "2 PRs (text / binary formats)")}</button>
      <button class="btn" data-p="5" aria-pressed="false" data-viz-id="cut-5" data-label="five PRs">${optLabel("C", "5 PRs (one per module)")}</button>
    </div>
    <div class="prs" id="prs" data-viz-id="prs" data-label="the PR cut into pieces"></div>
    <div class="legend"><span><i style="background:color-mix(in srgb, var(--good) 75%, #fff)"></i>production code</span><span><i style="background:color-mix(in srgb, var(--accent) 75%, #fff)"></i>tests</span><span><i style="background:none;border-top:2px dashed var(--muted);height:0"></i>fixtures</span><span>tile height = lines changed · click a ✂ / ⋯ seam</span></div>
    <p class="out" id="cut-out" aria-live="polite"></p>`;
  const prs = q<HTMLElement>(root, "#prs");
  const out = q<HTMLElement>(root, "#cut-out");
  const btns = [...root.querySelectorAll<HTMLElement>("[data-p]")];
  let cuts = [...PRESETS["5"]!];
  const PX = 0.3;

  function draw(): void {
    // group consecutive atoms between cuts
    const groups: number[][] = [[0]];
    cuts.forEach((c, i) => {
      if (c) groups.push([i + 1]);
      else groups.at(-1)?.push(i + 1);
    });
    const html: string[] = [];
    const seam = (i: number, isCut: boolean): string =>
      `<button class="seam${isCut ? " cut" : ""}" data-seam="${i}" aria-label="${isCut ? "join" : "cut"} here: after ${ATOMS[i]!.name}" data-viz-id="seam-${i}" data-label="seam after ${ATOMS[i]!.name}: ${isCut ? "cut" : "joined"}"><span class="gl"><span class="ic">${isCut ? "✂" : "⋯"}</span></span></button>`;
    groups.forEach((g, gi) => {
      const total = g.reduce((s, i) => s + lines(ATOMS[i]!), 0);
      const inner = g
        .map((i, k) => {
          const col = `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">${ATOMS[i]!.tiles.map((t) => `<div class="tile ${t.kind}" style="height:${Math.max(24, t.lines * PX)}px" title="${t.label}: ${t.lines} lines">${t.label} · ${t.lines}</div>`).join("")}</div>`;
          return k < g.length - 1 ? col + seam(i, false) : col;
        })
        .join("");
      html.push(
        `<div class="pr" style="flex:${g.length};min-width:${g.length * 150}px" data-viz-id="pr-${gi + 1}" data-label="PR ${gi + 1}: ${total} lines"><h5>PR ${gi + 1} · ${g.map((i) => ATOMS[i]!.name).join(" + ")} · ${total}</h5><div style="display:flex;align-items:stretch;flex:1">${inner}</div></div>`,
      );
      const last = g.at(-1) ?? 0;
      if (last < ATOMS.length - 1) html.push(seam(last, true));
    });
    prs.innerHTML = html.join("");
    const biggest = Math.max(...groups.map((g) => g.reduce((s, i) => s + lines(ATOMS[i]!), 0)));
    const n = groups.length;
    out.innerHTML = `<b>${n} PR${n === 1 ? "" : "s"}</b>, the biggest is <b>${biggest}</b> lines (${Math.round((biggest / TOTAL) * 100)}% of the change). ${
      n === 5
        ? "This is the finest cut, and the skill's default. Getting from here to two is three clicks on the ✂ seams. Try it."
        : n === 1
          ? "This is the PR as written. Getting from here to five means finding four seams in the diff, by hand, without losing a line."
          : "Somewhere between. Splitting this by hand is the mentally expensive direction; joining is a click."
    }`;
    const key = Object.entries(PRESETS).find(([, v]) => v.every((x, i) => x === cuts[i]))?.[0];
    pressOne(btns, btns.find((b) => b.dataset["p"] === key) ?? null);
  }
  root.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const p = t?.closest<HTMLElement>("[data-p]");
    const s = t?.closest<HTMLElement>("[data-seam]");
    if (p) cuts = [...(PRESETS[p.dataset["p"] ?? "5"] ?? [])];
    else if (s) {
      const i = Number(s.dataset["seam"]);
      cuts[i] = !cuts[i];
    } else return;
    draw();
  });
  draw();
}

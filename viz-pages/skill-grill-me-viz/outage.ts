// Exhibit 9: the outage simulator. Three boxes, two outage toggles and the three answers on the
// table. Flip an outage and the topology redraws and says what stops working.
// (Invented components: a laptop, a memory server, a GPU box.)
import { arrowMarkers } from "@viz/kit";
import { optLabel, pressOne, q } from "./util.js";

type Opt = "A" | "B" | "C";
interface Cap {
  name: string;
  what: string;
  state: "ok" | "no" | "part";
  note: string;
}
interface State {
  server: boolean; // unreachable?
  gpu: boolean; // off?
  opt: Opt; // which answer is in place
}
interface Node {
  x: number;
  y: number;
  w: number;
  h: number;
}

const Y = 24;
const H = 128;
const LAP: Node = { x: 3, y: Y, w: 190, h: H };
const SRV: Node = { x: 297, y: Y, w: 190, h: H };
const GPU: Node = { x: 591, y: Y, w: 190, h: H };

export function capabilities(s: State): Cap[] {
  const fallback = s.opt !== "A";
  const recall: Cap = !s.server
    ? { name: "RECALL", what: "reads past memory", state: "ok", note: "works" }
    : fallback
      ? {
          name: "RECALL",
          what: "reads past memory",
          state: "part",
          note:
            s.opt === "B"
              ? "from the cache: as old as the last nightly export"
              : "from the old notes: nothing newer than the switch",
        }
      : {
          name: "RECALL",
          what: "reads past memory",
          state: "no",
          note: "gone: the only copy is on the server",
        };
  const capture: Cap = s.server
    ? {
        name: "CAPTURE",
        what: "saves new memory",
        state: "no",
        note: fallback ? "not saved: the fallback is read-only" : "not saved: nowhere to send it",
      }
    : s.gpu
      ? {
          name: "CAPTURE",
          what: "saves new memory",
          state: "part",
          note: "stored raw; nothing is distilled until the GPU box returns",
        }
      : { name: "CAPTURE", what: "saves new memory", state: "ok", note: "works" };
  const extract: Cap = s.gpu
    ? {
        name: "EXTRACTION",
        what: "turns notes into facts",
        state: "no",
        note: "stopped: it needs the GPU box",
      }
    : s.server
      ? {
          name: "EXTRACTION",
          what: "turns notes into facts",
          state: "no",
          note: "idle: nothing to extract from",
        }
      : { name: "EXTRACTION", what: "turns notes into facts", state: "ok", note: "works" };
  return [recall, capture, extract];
}

export function initOutage(): void {
  const root = q<HTMLElement>(document, "#ex3-stage");
  const st: State = { server: false, gpu: false, opt: "A" };
  root.innerHTML = `
    <div class="row" id="sim-controls" data-viz-id="sim-controls" data-label="outage toggles">
      <span class="lbl">break something:</span>
      <button class="btn" data-t="server" aria-pressed="false" data-viz-id="t-server" data-label="memory server unreachable">Memory server unreachable</button>
      <button class="btn" data-t="gpu" aria-pressed="false" data-viz-id="t-gpu" data-label="GPU box off">GPU box off</button>
    </div>
    <div class="row" id="sim-opts" data-viz-id="sim-opts" data-label="the three answers">
      <span class="lbl">the answer in place:</span>
      <button class="btn" data-o="A" aria-pressed="false" data-viz-id="o-A" data-label="option A: accept it">${optLabel("A", "accept it for the trial")}</button>
      <button class="btn" data-o="B" aria-pressed="false" data-viz-id="o-B" data-label="option B: read-only local cache">${optLabel("B", "read-only local cache")}</button>
      <button class="btn" data-o="C" aria-pressed="false" data-viz-id="o-C" data-label="option C: old notes as fallback">${optLabel("C", "old notes as a read-only fallback")}</button>
    </div>
    <svg id="topo" viewBox="0 0 786 200" role="img" aria-label="Laptop, memory server and GPU box with the links between them" data-viz-id="topology" data-label="laptop, memory server and GPU box"></svg>
    <div class="caps" id="caps"></div>
    <p class="out m" id="sim-out" aria-live="polite"></p>`;
  const svg = q<SVGSVGElement>(root, "#topo");
  const caps = q<HTMLElement>(root, "#caps");
  const out = q<HTMLElement>(root, "#sim-out");
  const optBtns = [...root.querySelectorAll<HTMLElement>("[data-o]")];

  const text = (
    x: number,
    y: number,
    s: string,
    size: number,
    fill: string,
    weight = 400,
  ): string =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${s}</text>`;
  const node = (b: Node, title: string, sub: string[], bad: boolean, id: string): string =>
    `<g data-viz-id="${id}" data-label="${title}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" style="fill:${bad ? "color-mix(in srgb, var(--danger) 14%, #0b0f16)" : "var(--panel)"};stroke:${bad ? "var(--danger)" : "var(--border)"};stroke-width:2"/>` +
    text(b.x + b.w / 2, b.y + 32, title, 16, "#fff", 700) +
    sub.map((l, i) => text(b.x + b.w / 2, b.y + 56 + i * 18, l, 13, "var(--muted)")).join("") +
    `</g>`;
  const link = (a: Node, b: Node, dead: boolean, l1: string, l2: string): string => {
    const x1 = a.x + a.w;
    const x2 = b.x;
    const y = a.y + a.h / 2;
    const mx = (x1 + x2) / 2;
    const col = dead ? "var(--danger)" : "var(--good)";
    return (
      `<line x1="${x1 + 4}" y1="${y}" x2="${x2 - 4}" y2="${y}" stroke="${col}" stroke-width="2.5" ${dead ? 'stroke-dasharray="6 5"' : ""} marker-end="url(#${dead ? "ah-danger" : "ah-good"})"/>` +
      text(mx, y - 24, l1, 12.5, "var(--muted)") +
      text(mx, y - 9, l2, 12.5, "var(--muted)") +
      (dead ? text(mx, y + 8, "✕", 22, "var(--danger)", 700) : "")
    );
  };

  const draw = (): void => {
    const fallback = st.opt !== "A";
    const lapSub = ["Claude Code", "+ hooks"];
    const cache = fallback
      ? `<g data-viz-id="cache" data-label="read-only fallback on the laptop"><rect x="${LAP.x + 14}" y="${LAP.y + 96}" width="${LAP.w - 28}" height="24" rx="6" fill="color-mix(in srgb, var(--warn) 22%, #0b0f16)" stroke="var(--warn)"/>${text(LAP.x + LAP.w / 2, LAP.y + 112, st.opt === "B" ? "read-only cache" : "old notes, read-only", 12.5, "var(--warn)")}</g>`
      : "";
    svg.innerHTML =
      arrowMarkers() +
      node(LAP, "Laptop", lapSub, false, "node-laptop") +
      node(SRV, "Memory server", ["holds all", "the memory"], st.server, "node-server") +
      node(GPU, "GPU box", ["runs the extraction", "model"], st.gpu, "node-gpu") +
      link(LAP, SRV, st.server, "reads,", "writes") +
      link(SRV, GPU, st.gpu || st.server, "LLM", "calls") +
      cache +
      (st.server
        ? text(SRV.x + SRV.w / 2, SRV.y + SRV.h + 24, "unreachable", 13, "var(--danger)")
        : "") +
      (st.gpu
        ? text(GPU.x + GPU.w / 2, GPU.y + GPU.h + 24, "powered off", 13, "var(--danger)")
        : "");
    const cs = capabilities(st);
    caps.innerHTML = cs
      .map(
        (c) =>
          `<div class="capchip ${c.state}" data-viz-id="cap-${c.name.toLowerCase()}" data-label="${c.name}: ${c.state}"><b>${c.state === "ok" ? "✓" : c.state === "no" ? "✕" : "~"} ${c.name}</b>${c.what}<br><span style="color:var(--text)">${c.note}</span></div>`,
      )
      .join("");
    const dead = cs.filter((c) => c.state === "no").map((c) => c.name.toLowerCase());
    out.textContent =
      !st.server && !st.gpu
        ? "Everything is up. Break something: a sketch with invented components, but the trade-off is the real one."
        : `${dead.length > 0 ? "What dies: " + dead.join(" and ") + "." : "Nothing dies outright."} ${fallback && st.server ? "The fallback keeps reads alive, at the price of something to build and a copy that is always a little stale." : "Sessions still run; they just run without it."}`;
    for (const b of root.querySelectorAll<HTMLElement>("[data-t]")) {
      const on = st[b.dataset["t"] === "server" ? "server" : "gpu"];
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    pressOne(optBtns, optBtns.find((b) => b.dataset["o"] === st.opt) ?? null);
  };
  q<HTMLElement>(root, "#sim-controls").addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-t]") : null;
    if (!b) return;
    const k = b.dataset["t"] === "server" ? "server" : "gpu";
    st[k] = !st[k];
    draw();
  });
  q<HTMLElement>(root, "#sim-opts").addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-o]") : null;
    if (!b) return;
    const o = b.dataset["o"];
    st.opt = o === "B" || o === "C" ? o : "A";
    draw();
  });
  draw();
}

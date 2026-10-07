// Exhibit 3: the outage simulator. Three boxes, three toggles. Flip an outage and the topology
// redraws and says what stops working. (Invented components: a laptop, a memory server, a GPU box.)
import { arrowMarkers, connect, labelBox, side } from "@viz/kit";
import type { Box } from "@viz/kit";
import { q } from "./util.js";

interface Cap {
  name: string;
  what: string;
  state: "ok" | "no" | "part";
  note: string;
}
interface State {
  server: boolean; // unreachable?
  gpu: boolean; // off?
  cache: boolean; // read-only local cache built?
}

const LAP: Box = { x: 20, y: 46, w: 200, h: 100 };
const SRV: Box = { x: 290, y: 46, w: 200, h: 100 };
const GPU: Box = { x: 560, y: 46, w: 200, h: 100 };

export function capabilities(s: State): Cap[] {
  const recall: Cap = !s.server
    ? { name: "RECALL", what: "reads past memory", state: "ok", note: "works" }
    : s.cache
      ? {
          name: "RECALL",
          what: "reads past memory",
          state: "part",
          note: "from the cache: as old as the last nightly export",
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
        note: s.cache ? "not saved: the cache is read-only" : "not saved: nowhere to send it",
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
  const st: State = { server: false, gpu: false, cache: false };
  root.innerHTML = `
    <div class="row" id="sim-controls" data-viz-id="sim-controls" data-label="outage toggles">
      <span class="lbl">break something:</span>
      <button class="btn" data-t="server" aria-pressed="false" data-viz-id="t-server" data-label="memory server unreachable">Memory server unreachable</button>
      <button class="btn" data-t="gpu" aria-pressed="false" data-viz-id="t-gpu" data-label="GPU box off">GPU box off</button>
      <span class="lbl" style="margin-left:10px">the answer that won:</span>
      <button class="btn" data-t="cache" aria-pressed="false" data-viz-id="t-cache" data-label="build a read-only local cache">+ read-only local cache</button>
    </div>
    <svg id="topo" viewBox="0 28 780 160" role="img" aria-label="Laptop, memory server and GPU box with the links between them" data-viz-id="topology" data-label="laptop, memory server and GPU box"></svg>
    <div class="caps" id="caps"></div>
    <p class="out m" id="sim-out" aria-live="polite"></p>`;
  const svg = q<SVGSVGElement>(root, "#topo");
  const caps = q<HTMLElement>(root, "#caps");
  const out = q<HTMLElement>(root, "#sim-out");

  const node = (b: Box, title: string, sub: string, style: string, id: string): string =>
    `<g data-viz-id="${id}" data-label="${title}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" style="${style}"/>` +
    labelBox({ x: b.x + 8, y: b.y + 8, w: b.w - 16, h: 40 }, `<b>${title}</b>`) +
    labelBox({ x: b.x + 8, y: b.y + 40, w: b.w - 16, h: 40 }, sub, "muted") +
    `</g>`;

  const draw = (): void => {
    const srvBad = st.server;
    const gpuBad = st.gpu;
    const fill = (bad: boolean): string =>
      bad ? "color-mix(in srgb, var(--danger) 14%, #0b0f16)" : "var(--panel)";
    const stroke = (bad: boolean): string => (bad ? "var(--danger)" : "var(--border)");
    const link = (a: Box, b: Box, dead: boolean, label: string): string => {
      const mid = { x: (side(a, "right").x + side(b, "left").x) / 2, y: side(a, "right").y };
      return (
        `<path d="${connect(a, b)}" stroke="${dead ? "var(--danger)" : "var(--good)"}" stroke-width="3" ${dead ? 'stroke-dasharray="6 6"' : ""} marker-end="url(#${dead ? "ah-danger" : "ah-good"})"/>` +
        `<text x="${mid.x}" y="${mid.y - 12}" text-anchor="middle" font-size="12" fill="var(--muted)">${label}</text>` +
        (dead
          ? `<text x="${mid.x}" y="${mid.y + 7}" text-anchor="middle" font-size="22" font-weight="700" fill="var(--danger)">✕</text>`
          : "")
      );
    };
    const cache = st.cache
      ? `<g data-viz-id="cache" data-label="read-only local cache"><rect x="${LAP.x + 14}" y="${LAP.y + 70}" width="${LAP.w - 28}" height="22" rx="6" fill="color-mix(in srgb, var(--warn) 22%, #0b0f16)" stroke="var(--warn)"/><text x="${LAP.x + LAP.w / 2}" y="${LAP.y + 86}" text-anchor="middle" font-size="12" fill="var(--warn)">read-only cache (nightly)</text></g>`
      : "";
    svg.innerHTML =
      arrowMarkers() +
      node(
        LAP,
        "Laptop",
        "Claude Code + hooks",
        "fill:var(--panel);stroke:var(--border);stroke-width:2",
        "node-laptop",
      ) +
      node(
        SRV,
        "Memory server",
        "holds all the memory",
        `fill:${fill(srvBad)};stroke:${stroke(srvBad)};stroke-width:2`,
        "node-server",
      ) +
      node(
        GPU,
        "GPU box",
        "runs the fact-extraction model",
        `fill:${fill(gpuBad)};stroke:${stroke(gpuBad)};stroke-width:2`,
        "node-gpu",
      ) +
      link(LAP, SRV, srvBad, "recall / capture") +
      link(SRV, GPU, gpuBad || srvBad, "LLM calls") +
      cache +
      (srvBad
        ? `<text x="${SRV.x + SRV.w / 2}" y="${SRV.y + SRV.h + 24}" text-anchor="middle" font-size="12.5" fill="var(--danger)">unreachable</text>`
        : "") +
      (gpuBad
        ? `<text x="${GPU.x + GPU.w / 2}" y="${GPU.y + GPU.h + 24}" text-anchor="middle" font-size="12.5" fill="var(--danger)">powered off</text>`
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
        : `${dead.length > 0 ? "What dies: " + dead.join(" and ") + "." : "Nothing dies outright."} ${st.cache && st.server ? "The cache keeps reads alive, at the price of a nightly export to build and a copy that is always a little stale." : "Sessions still run; they just run without it."}`;
    for (const b of root.querySelectorAll<HTMLElement>("[data-t]")) {
      const on =
        st[b.dataset["t"] === "server" ? "server" : b.dataset["t"] === "gpu" ? "gpu" : "cache"];
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
  };
  q<HTMLElement>(root, "#sim-controls").addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-t]") : null;
    if (!b) return;
    const k = b.dataset["t"] === "server" ? "server" : b.dataset["t"] === "gpu" ? "gpu" : "cache";
    st[k] = !st[k];
    draw();
  });
  draw();
}

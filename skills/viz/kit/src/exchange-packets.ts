// exchange-packets.ts — the labelled packets that ride a wire.
//
// A packet rides in to the MIDPOINT of its wire and waits, so its label stays
// readable while the step is on screen; leaving sends it the rest of the way.
// Tracked as a list: stepping faster than the animation used to strand a chip
// on screen for every skipped step.

import { SVGNS, type Flag } from "@viz/kit/exchange-shared.js";

type Flying = {
  g: SVGGElement;
  path: SVGPathElement;
  reverse: boolean;
  w: number;
  parked: boolean;
  killed: boolean;
};

const place = (g: SVGGElement, path: SVGPathElement, rev: boolean, w: number, f: number): void => {
  const pt = path.getPointAtLength((rev ? 1 - f : f) * path.getTotalLength());
  g.setAttribute("transform", `translate(${pt.x - w / 2},${pt.y - 11})`);
};

function sendOut(it: Flying): void {
  const { g, path, reverse, w } = it,
    dur = 560,
    t0 = performance.now();
  (function frame(now: number) {
    const k = Math.min(1, (now - t0) / dur),
      e = 1 - Math.pow(1 - k, 3);
    place(g, path, reverse, w, 0.5 + 0.5 * e);
    g.style.opacity = String(1 - e);
    if (k < 1) requestAnimationFrame(frame);
    else g.remove();
  })(t0);
}

/** The packet pill: a rounded rect and its label, as wide as the label needs. */
function pill(label: string, ret?: Flag): { g: SVGGElement; w: number } {
  const g = document.createElementNS(SVGNS, "g");
  const w = Math.max(44, label.length * 6.4 + 16);
  const r = document.createElementNS(SVGNS, "rect");
  r.setAttribute("width", String(w));
  r.setAttribute("height", "21");
  r.setAttribute("rx", "10.5");
  r.setAttribute("class", "pkt" + (ret ? " ret" : ""));
  const t = document.createElementNS(SVGNS, "text");
  t.setAttribute("class", "pktlabel");
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("dy", "14.5");
  t.setAttribute("x", String(w / 2));
  t.textContent = label;
  g.append(r, t);
  return { g, w };
}

export type Packets = {
  flyPacket: (from: string, to: string, label: string, ret?: Flag, green?: Flag) => void;
  clearLive: () => void;
};

export function createPackets(
  pktLayer: SVGSVGElement,
  wirePaths: Record<string, SVGPathElement>,
): Packets {
  let live: (Flying | { path: SVGPathElement; g?: undefined })[] = [];
  function clearLive(): void {
    for (const it of live) {
      it.path.classList.remove("hot", "hotback");
      // A labelless packet registers ONLY so its wire gets un-lit here — see the
      // note in flyPacket. There is no <g> to fly out or remove.
      if (!it.g) continue;
      if (it.parked) sendOut(it);
      else {
        it.killed = true;
        it.g.remove();
      }
    }
    live = [];
  }
  // NOTE: this does NOT clear previous packets — render() does that once, so a
  // step can fly several packets at the same time (see `also` below). Calling it
  // directly without clearing first will stack packets, which is the point.
  function flyPacket(from: string, to: string, label: string, ret?: Flag, green?: Flag): void {
    const fwd = wirePaths[from + ">" + to],
      rev = wirePaths[to + ">" + from];
    const path = fwd ?? rev,
      reverse = !fwd && !!rev;
    if (!path) return;
    path.classList.add(green ? "hotback" : "hot");
    // A step may light a wire without flying a pill along it (`pkt: ''`), which is
    // what a hand-off between one phase's result and the next phase's client wants:
    // the wire is the whole message, so a label on it would just be furniture.
    //
    // IT STILL HAS TO BE REGISTERED. This used to `return` here, before the push
    // below — so the wire got `hot` and nothing ever took it off again, because
    // clearLive() only walks `live`. The wire stayed accent-blue for the rest of
    // the session, on every subsequent step, and a page whose palette means
    // something by blue was quietly telling the reader the wrong thing. Found
    // 2026-08-31 in member-api-poc-network-story, where the two hand-off wires
    // turned blue at step 10 and never went back; five pages in two repos use
    // `pkt: ''` and all of them had it.
    if (!label) {
      live.push({ path });
      return;
    }
    const { g, w } = pill(label, ret);
    pktLayer.append(g);
    place(g, path, reverse, w, 0);
    const it: Flying = { g, path, reverse, w, parked: false, killed: false };
    live.push(it);
    const dur = 900,
      t0 = performance.now();
    (function frame(now: number) {
      if (it.killed) return;
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      place(g, path, reverse, w, e * 0.5);
      if (k < 1) requestAnimationFrame(frame);
      else it.parked = true;
    })(t0);
  }
  return { flyPacket, clearLive };
}

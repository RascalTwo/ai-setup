// GENERATED from kit/src/exchange-wires.ts by `bun run sync:kit` — edit that file, not this one.
// exchange-wires.ts — geometry and wires. Every endpoint is derived from node/box geometry, never
// typed as a literal, so moving a box can never strand its arrows.
import { SVGNS } from "@viz/kit/exchange-shared.js";
export const cx = (n) => n.x + n.w / 2;
export const cy = (n) => n.y + n.h / 2;
/** Looks a node or box up by id for its geometry; an unknown id is the variant's typo, said plainly. */
export function geometry(exchange) {
    const N = exchange.nodes, B = exchange.boxes ?? {};
    return (id) => {
        const g = N[id] ?? B[id];
        if (!g)
            throw new Error(`exchange: "${id}" is not a node or box`);
        return g;
    };
}
function pathFor(G, a, b, o) {
    const A = G(a), B_ = G(b);
    if (o.up) {
        const x1 = cx(A), y1 = A.y, x2 = cx(B_), y2 = B_.y + B_.h;
        return `M ${x1} ${y1} C ${x1} ${y1 - 90}, ${x2} ${y2 + 90}, ${x2} ${y2}`;
    }
    if (o.dip) {
        const x1 = cx(A), y1 = A.y + A.h, x2 = B_.x, y2 = cy(B_);
        return `M ${x1} ${y1} C ${x1} ${y1 + 70}, ${x2 - 200} ${y2 + 80}, ${x2} ${y2}`;
    }
    if (o.back) {
        const x1 = cx(A), y1 = A.y + A.h, ry = cy(B_), x2 = B_.x + B_.w;
        return `M ${x1} ${y1} C ${x1} ${y1 + 60}, ${x1 - 200} ${ry}, ${x1 - 300} ${ry} L ${x2} ${ry}`;
    }
    if (o.hand) {
        const x1 = cx(A), y1 = A.y + A.h, x2 = cx(B_), y2 = B_.y;
        return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    const x1 = A.x + A.w, y1 = cy(A), x2 = B_.x, y2 = cy(B_), m = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${m} ${y1}, ${m} ${y2}, ${x2} ${y2}`;
}
/** Draws the arrowheads and every declared wire into `svg`; returns the paths, keyed "from>to". */
export function drawWires(exchange, svg, G) {
    const defs = document.createElementNS(SVGNS, "defs");
    defs.innerHTML = ["#54688c", "var(--accent)", "var(--warn)", "#3f7f66", "var(--good)"]
        .map((c, i) => `<marker id="ah${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4.2" markerHeight="4.2"
      orient="auto-start-reverse"><path d="M0,1.4 L10,5 L0,8.6 z" fill="${c}"/></marker>`)
        .join("");
    svg.append(defs);
    const wirePaths = {};
    for (const [a, b, o = {}] of exchange.wires) {
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("d", pathFor(G, a, b, o));
        // `o.cls` is a pass-through for variant-local wire styling, added 2026-08-06.
        // Purely additive: a wire without it renders exactly as before, so no existing
        // variant changes. It exists because shape opts (up/dip/back/hand) are the only
        // thing that reached the class list, and a variant had no way to say "this wire
        // is different in KIND" — e.g. proposed-vs-existing — as opposed to different in
        // route. Style it in the variant's index.html, never here.
        p.setAttribute("class", "wire" +
            (o.up || o.dip ? " dash" : "") +
            (o.back ? " back" : "") +
            (o.hand ? " hand" : "") +
            (o.cls ? " " + o.cls : ""));
        p.setAttribute("marker-end", "url(#" + (o.back ? "ah3" : o.hand ? "ah4" : "ah0") + ")");
        svg.append(p);
        wirePaths[a + ">" + b] = p;
    }
    return wirePaths;
}

// GENERATED from kit/src/presence-ink.ts by `bun run sync:kit` — edit that file, not this one.
// presence-ink.ts — hold Ctrl and move: a stroke that fades, drawn here and on every screen.
import { toPage } from "@viz/kit/presence-shared.js";
export function drawInk(ctx, pts, color) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", pts
        .map((pt) => {
        const { left, top } = toPage(pt);
        return `${left},${top}`;
    })
        .join(" "));
    line.setAttribute("stroke", color);
    ctx.inkSvg.append(line);
    setTimeout(() => line.remove(), 4000);
}
// ---- Ink: hold Ctrl and move; every stroke fades ------------------------------------------------
export function startInk(ctx) {
    const { s, peers } = ctx;
    addEventListener("keydown", (e) => {
        if (e.key === "Control")
            s.inking = ctx.anyone() && s.joined;
    });
    addEventListener("keyup", (e) => {
        if (e.key === "Control") {
            s.inking = false;
            s.stroke = [];
        }
    });
    addEventListener("blur", () => {
        s.inking = false;
        s.stroke = [];
    });
    ctx.net.ink.onMessage = (pts, { peerId }) => {
        const p = peers.get(peerId);
        if (p && !p.muted)
            drawInk(ctx, pts, p.color);
    };
}

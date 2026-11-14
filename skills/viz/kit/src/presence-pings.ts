// presence-pings.ts — click pings: what you clicked, wherever it sits on their screen.

import { uniqueSelector } from "@viz/kit/anchor.js";
import {
  el,
  find,
  fire,
  fromEvent,
  mine,
  toPage,
  type Ctx,
  type Ping,
} from "@viz/kit/presence-shared.js";

function showPing(ctx: Ctx, p: Ping, color: string) {
  const node = find(p.sel);
  const dot = el("div", { class: "vp-dot" });
  dot.style.borderColor = color;
  if (node) {
    const r = node.getBoundingClientRect();
    const ring = el("div", { class: "vp-ring" });
    Object.assign(ring.style, {
      left: `${r.left + scrollX - 3}px`,
      top: `${r.top + scrollY - 3}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      borderColor: color,
    });
    ctx.layer.append(ring);
    setTimeout(() => ring.remove(), 3000);
    Object.assign(dot.style, {
      left: `${r.left + scrollX + p.fx * r.width}px`,
      top: `${r.top + scrollY + p.fy * r.height}px`,
    });
  } else {
    const { left, top } = toPage([p.x, p.y]);
    Object.assign(dot.style, { left: `${left}px`, top: `${top}px` });
  }
  ctx.layer.append(dot);
  setTimeout(() => dot.remove(), 3000);
}

// ---- Pings: what you clicked, wherever it sits on their screen --------------------------------
export function startPings(ctx: Ctx): void {
  const { net, peers, s, me } = ctx;
  addEventListener(
    "click",
    (e) => {
      if (!ctx.anyone() || !s.joined || mine(e.target) || !(e.target instanceof Element)) return;
      const node = e.target.closest("[data-viz-id]") ?? e.target;
      const r = node.getBoundingClientRect();
      const [x, y] = fromEvent(e);
      const p: Ping = {
        sel: uniqueSelector(node),
        fx: (e.clientX - r.left) / (r.width || 1),
        fy: (e.clientY - r.top) / (r.height || 1),
        x,
        y,
      };
      fire(net.ping.send(p));
      showPing(ctx, p, me.color);
    },
    true,
  );
  net.ping.onMessage = (p, { peerId }) => {
    const peer = peers.get(peerId);
    if (peer && !peer.muted) showPing(ctx, p, peer.color);
  };
}

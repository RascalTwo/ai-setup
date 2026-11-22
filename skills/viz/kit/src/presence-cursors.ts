// presence-cursors.ts — peers' cursors: who is here, where their pointer is, and mine going out.

import {
  el,
  fire,
  fromEvent,
  toPage,
  type Ctx,
  type Hi,
  type Peer,
  type Pt,
} from "@viz/kit/presence-shared.js";
import { drawInk } from "@viz/kit/presence-ink.js";

/** Shows or hides a peer's cursor where they are (or say where they are, if on another step). */
export function place(p: Peer): void {
  const show = !!p.at && p.joined && !p.away && !p.muted;
  p.el.style.display = show ? "" : "none";
  if (!show || !p.at) return;
  const { left, top } = toPage(p.at);
  p.el.style.left = `${left}px`;
  p.el.style.top = `${top}px`;
  const elsewhere = p.hash !== location.hash; // on another step: what's under my cursor isn't on their screen
  p.el.classList.toggle("elsewhere", elsewhere);
  const name = p.el.querySelector<HTMLElement>(".vp-name");
  if (!name) return;
  name.textContent = elsewhere ? `${p.name} · elsewhere ↗` : p.name;
  name.title = elsewhere ? "On another step of this viz. Click to go there." : "";
}

/** A peer's cursor node: an arrow and a name, whose click follows them to another step. */
function newCursor(ctx: Ctx, d: Hi): Peer {
  const node = el("div", { class: "vp-cur" });
  node.innerHTML = `<svg width="18" height="20" viewBox="0 0 18 20"><path d="M1 1l6 17 2.5-7L17 8z" stroke="#0d1117" stroke-width="1.5"/></svg>`;
  const label = el("span", { class: "vp-name" });
  node.append(label);
  ctx.layer.append(node);
  const p: Peer = { ...d, el: node, at: null, muted: false };
  label.addEventListener("click", () => {
    if (p.hash === location.hash) return; // only a cursor "elsewhere" is a link
    location.hash = p.hash;
    location.reload();
  });
  return p;
}

// ---- Peers' cursors ---------------------------------------------------------------------------
export function startCursors(ctx: Ctx): void {
  const { peers, s, net, me } = ctx;
  net.hi.onMessage = (d, { peerId }) => {
    let p = peers.get(peerId);
    if (p) Object.assign(p, d);
    else {
      p = newCursor(ctx, d);
      peers.set(peerId, p);
    }
    const name = p.el.querySelector<HTMLElement>(".vp-name");
    const arrow = p.el.querySelector("path");
    if (name) name.style.background = p.color;
    arrow?.setAttribute("fill", p.color);
    place(p);
    ctx.render();
  };
  net.cur.onMessage = (at, { peerId }) => {
    const p = peers.get(peerId);
    if (p) {
      p.at = at;
      place(p);
    }
  };

  // My cursor: sent on a timer, not rAF, so it keeps flowing while the page is busy.
  let sent: Pt | null = null;
  addEventListener("pointermove", (e) => {
    s.last = fromEvent(e);
    if (s.inking) s.stroke.push(s.last);
  });
  setInterval(() => {
    if (!ctx.anyone() || !s.joined) return;
    if (s.last && s.last !== sent) {
      sent = s.last;
      fire(net.cur.send(sent));
    }
    if (s.stroke.length > 1) {
      fire(net.ink.send(s.stroke));
      drawInk(ctx, s.stroke, me.color);
      s.stroke = [s.stroke.at(-1) ?? [0, 0]];
    }
  }, 50);
}

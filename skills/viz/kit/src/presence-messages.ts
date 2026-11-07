// presence-messages.ts — "/" types a message, the 🎙 says one: a bubble at the cursor, then the log.

import { el, fire, toPage, typing, type Ctx, type Pt } from "@viz/kit/presence-shared.js";

export type Said = { name: string; color: string; text: string };

/** The ones said this session (the last 50), for the people panel. */
export const history: Said[] = [];

function bubble(ctx: Ctx, text: string, name: string, color: string, at: HTMLElement | Pt | null) {
  history.push({ name, color, text });
  if (history.length > 50) history.shift();
  const b = el("div", { class: "vp-bubble" }, text);
  b.style.background = color;
  if (at instanceof HTMLElement) at.append(b);
  else if (at) {
    const holder = el("div", { class: "vp-cur" });
    const { left, top } = toPage(at);
    Object.assign(holder.style, { left: `${left}px`, top: `${top}px` });
    holder.append(b);
    ctx.layer.append(holder);
    setTimeout(() => holder.remove(), 6000);
  }
  setTimeout(() => b.remove(), 6000);
  ctx.render();
}

/** The "/" box at my cursor: Enter says it, Escape or blur drops it. */
function openSayBox(ctx: Ctx, speak: (text: string) => void) {
  const input = el("input", { class: "vp-say", placeholder: "Say something · Enter" });
  const { left, top } = toPage(ctx.s.last ?? [0.5, scrollY + innerHeight / 2]);
  Object.assign(input.style, {
    left: `${left + 14}px`,
    top: `${top + 30}px`,
    borderColor: ctx.me.color,
  });
  ctx.layer.append(input);
  input.focus();
  input.addEventListener("keydown", (k) => {
    k.stopPropagation();
    if (k.key === "Enter") speak(input.value);
    if (k.key === "Enter" || k.key === "Escape") input.remove();
  });
  input.addEventListener("blur", () => input.remove());
}

// ---- Messages: "/" types one, the 🎙 says one; a bubble at the cursor, then the log -------------
/** Wires messages both ways; returns the one that says a line from here. */
export function startMessages(ctx: Ctx): { speak: (text: string) => void } {
  const { net, peers, s, me } = ctx;
  const speak = (text: string) => {
    if (!ctx.anyone() || !s.joined || !text.trim()) return;
    fire(net.say.send(text));
    bubble(ctx, text, me.name, me.color, s.last);
  };
  net.say.onMessage = (text: unknown, { peerId }) => {
    const p = peers.get(peerId);
    if (p && !p.muted) bubble(ctx, String(text).slice(0, 500), p.name, p.color, p.el);
  };
  addEventListener("viz:said", (e) => {
    if (e instanceof CustomEvent) speak(String(e.detail));
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "/" || typing(e.target) || !ctx.anyone() || !s.joined) return;
    e.preventDefault();
    openSayBox(ctx, speak);
  });
  return { speak };
}

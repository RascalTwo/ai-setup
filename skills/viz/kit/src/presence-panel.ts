// presence-panel.ts — the people button and panel: who is here, join/leave, rename, messages, invite.

import { history } from "@viz/kit/presence-messages.js";
import { place } from "@viz/kit/presence-cursors.js";
import { ADJ, ANIMAL, THING, any, el, type Ctx, type Peer } from "@viz/kit/presence-shared.js";

const words = () => `${any(ADJ)}-${any(ANIMAL)}-${any(THING)}`;

/** One person in the panel: colour dot, name (jumps to their cursor), hide/show. */
function peerRow(ctx: Ctx, peer: Peer) {
  const row = el("div", { class: "vp-row" + (peer.away ? " away" : "") });
  const dot = el("span", { class: "vp-sw" });
  dot.style.background = peer.color;
  const who = el(
    "span",
    { class: "vp-who", title: "Jump to their cursor" },
    peer.name + (peer.away ? " · away" : ""),
  );
  who.addEventListener("click", () =>
    peer.el.scrollIntoView({ block: "center", behavior: "smooth" }),
  );
  const hide = el(
    "button",
    { type: "button", title: peer.muted ? "Show this person" : "Hide this person" },
    peer.muted ? "show" : "hide",
  );
  hide.addEventListener("click", () => {
    peer.muted = !peer.muted;
    place(peer);
    ctx.render();
  });
  row.append(dot, who, hide);
  return row;
}

/** My own row: the colour picker and the rename button. */
function selfRow(ctx: Ctx) {
  const { me } = ctx;
  const self = el("div", { class: "vp-row" });
  const color = el("input", { type: "color", value: me.color, title: "Your colour" });
  color.addEventListener("change", () => {
    me.color = color.value;
    ctx.keepMe();
    ctx.announce();
  });
  const rename = el("button", { type: "button", title: "Rename yourself" }, `${me.name} (you)`);
  rename.addEventListener("click", () => {
    // oxlint-disable-next-line no-alert -- the kit has no dialog of its own; a native prompt asks for one short name
    const n = prompt("Your name", me.name)?.trim();
    if (n) {
      me.name = n.slice(0, 40);
      ctx.keepMe();
      ctx.announce();
      ctx.render();
    }
  });
  self.append(color, rename);
  return self;
}

/** The session's messages and the box to send one. Returns the log, to scroll it into view. */
function messages(ctx: Ctx, speak: (text: string) => void) {
  const log = el("div", { class: "vp-log" });
  for (const h of history) {
    const line = el("div", {}, `${h.name}: ${h.text}`);
    line.style.borderLeft = `3px solid ${h.color}`;
    line.style.paddingLeft = "6px";
    log.append(line);
  }
  const chat = el("input", {
    type: "text",
    placeholder: ctx.s.joined ? "Message everyone · Enter" : "Join to message everyone",
  });
  chat.disabled = !ctx.s.joined;
  chat.addEventListener("keydown", (k) => {
    k.stopPropagation();
    if (k.key === "Enter") {
      speak(chat.value);
      chat.value = "";
    }
  });
  return { log, chat };
}

/** Invite (copy a link to this room, or start a private one) and, in a room, Leave. */
function footer(ctx: Ctx, invite: () => void) {
  const foot = el("div", { class: "vp-row" });
  const ib = el(
    "button",
    { type: "button" },
    ctx.code ? "🔗 Copy invite link" : "🔗 Invite to a private room",
  );
  ib.addEventListener("click", invite);
  foot.append(ib);
  if (ctx.code) {
    const leave = el("button", { type: "button" }, "Leave room");
    leave.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.delete("room");
      location.href = url.href;
    });
    foot.append(leave);
  }
  return foot;
}

/** Wires the people button and panel; returns the redraw (a `ctx.render`). */
export function startPanel(ctx: Ctx, speak: (text: string) => void): () => void {
  const { me, s, code, peers } = ctx;
  function invite() {
    const url = new URL(location.href);
    url.searchParams.set("room", code ?? words());
    navigator.clipboard?.writeText(url.href).catch(() => {
      // no clipboard (insecure page, or refused): the new address is still in the bar
    });
    if (code) return flash("Link copied");
    location.href = url.href; // join the new room; the link is on the clipboard
  }
  const toast = el("div", { class: "vp-solo" });
  function flash(text: string) {
    toast.textContent = text;
    toast.style.padding = "6px 12px";
    toast.style.bottom = "60px";
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2000);
  }
  addEventListener("viz:panel", (e) => {
    const head: unknown = e instanceof CustomEvent ? e.detail : null;
    if (!(head instanceof HTMLElement)) return;
    const b = el(
      "button",
      { class: "vf-mini", type: "button", title: "Start a private room and copy its link" },
      "🔗 Invite",
    );
    b.addEventListener("click", invite);
    head.append(b);
  });

  const btn = el("button", { class: "vp-btn", type: "button", title: "Who's here" });
  let open = false;
  let panel: HTMLElement | null = null;
  btn.addEventListener("click", () => {
    open = !open;
    ctx.render();
  });
  function join(on: boolean) {
    sessionStorage.setItem(ctx.joinedKey, on ? "1" : "0");
    if (on && ctx.live().length > 0) return location.reload(); // catch up with them, like any newcomer
    s.joined = on;
    if (on) s.waiting = null; // nobody joined to catch up with: whoever joins next starts from this page
    ctx.announce();
    ctx.render();
  }
  /** The button: in the feedback pill when there is one, else alone in the corner. */
  function placeButton(shownCount: number) {
    btn.textContent = `👥 ${peers.size + 1}`;
    btn.title = `${peers.size + 1} here · ${shownCount + (s.joined ? 1 : 0)} joined`;
    btn.style.color = s.joined ? me.color : ""; // at a glance: am I sharing?
    const pill = document.querySelector("#viz-feedback .vf-pill");
    if (pill) pill.prepend(btn);
    else {
      const solo =
        document.querySelector(".vp-solo:not(:empty)") ?? el("div", { class: "vp-solo" });
      if (!solo.isConnected) document.body.append(solo);
      solo.append(btn);
    }
  }
  function buildPanel(shown: Peer[]) {
    const quiet = peers.size - shown.length;
    const p = el("div", { class: "vp-panel", "data-viz-chrome": "" });
    p.append(el("h4", {}, code ? `Room ${code}` : "Here now"));
    const sw = el("button", {
      class: "vp-switch",
      type: "button",
      role: "switch",
      "aria-checked": String(s.joined),
    });
    sw.addEventListener("click", () => join(!s.joined));
    const toggle = el("label", { class: "vp-row" });
    toggle.append(
      sw,
      s.joined ? "Joined: your cursor and clicks are shared" : "Join: share your cursor and clicks",
    );
    p.append(toggle, selfRow(ctx));
    for (const peer of shown) p.append(peerRow(ctx, peer));
    if (quiet) p.append(el("div", { class: "vp-row" }, `+${quiet} browsing privately`));
    p.append(el("h4", {}, "Messages"));
    const { log, chat } = messages(ctx, speak);
    p.append(log, chat, footer(ctx, invite));
    return { p, log };
  }
  return function render() {
    const shown = ctx.live();
    const want = ctx.anyone() || !!code; // alone in the lobby: nothing on screen
    if (want) placeButton(shown.length);
    else btn.remove();
    panel?.remove();
    panel = null;
    if (!open || !want) return;
    const built = buildPanel(shown);
    document.body.append(built.p);
    panel = built.p;
    built.log.scrollTop = built.log.scrollHeight;
  };
}

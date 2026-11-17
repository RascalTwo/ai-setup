// presence.js — everyone on the same viz, live: cursors, click pings, messages and ink. No server.
//
// On every page the feedback widget is on (lib/server/feedback-page.ts), unless the page opts out
// with <meta name="viz:presence" content="off">. Browsers find each other through public Nostr
// relays (kit/trystero.js) and then talk directly over WebRTC; nothing is stored anywhere.
//   lobby : everyone reading the same viz (its viz:uid, else its path), joined quietly on load
//   room  : ?room=three-word-code, made by Invite (in the feedback panel, or the people panel)
// Nothing shows while you're alone in the lobby; when someone is here, a people button joins the
// feedback pill. You start private: you see whoever has joined, nobody sees you, and your page is
// your own. Join (in the people panel) shares your cursor, your clicks and the page itself.
// A ?room= link starts you joined. Gestures: move = cursor · click or tap = a ping on the element you hit · "/" = a
// message at your cursor · hold Ctrl and move = ink · the widget's 🎙 lines go out as messages.
// Ink and bubbles fade; the session's messages are listed in the people panel.
// When a direct connection fails, TURN relays help: <meta name="viz:turn" content='[{"urls":…}]'>.

// oxlint-disable-next-line import/no-absolute-path -- the build inlines a kit module's own /_kit/ imports as data: URLs (inline.ts), so the library travels inside presence.js with no fetch
import { joinRoom, selfId } from "/_kit/trystero.js";
import {
  ADJ,
  ANIMAL,
  COLORS,
  any,
  cap,
  fire,
  makeActions,
  type Ctx,
  type Hi,
  type Peer,
} from "@viz/kit/presence-shared.js";
import { mountLayer } from "@viz/kit/presence-style.js";
import { place, startCursors } from "@viz/kit/presence-cursors.js";
import { startPings } from "@viz/kit/presence-pings.js";
import { startSync } from "@viz/kit/presence-sync.js";
import { startMessages } from "@viz/kit/presence-messages.js";
import { startInk } from "@viz/kit/presence-ink.js";
import { startPanel } from "@viz/kit/presence-panel.js";

declare global {
  interface Window {
    vizPresence?: { me: { name: string; color: string }; replaying: boolean };
  }
}

const off =
  document.querySelector('meta[name="viz:presence"][content="off"]') ?? navigator.webdriver; // renders and verify runs stay out
if (!off) start();

/** Who I am, kept for every viz on this site. */
function identity() {
  const KEY = "viz-presence-me";
  const saved = ((): Partial<Hi> => {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: whatever an earlier visit saved
      return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Hi>;
    } catch {
      return {};
    }
  })();
  const me = {
    name: saved.name ?? `${cap(any(ADJ))} ${cap(any(ANIMAL))}`,
    color: saved.color ?? any(COLORS),
  };
  const keepMe = () => localStorage.setItem(KEY, JSON.stringify(me));
  keepMe();
  return { me, keepMe };
}

/** TURN relays from <meta name="viz:turn">, for when a direct connection fails. */
function turnServers() {
  try {
    const raw = document.querySelector<HTMLMetaElement>('meta[name="viz:turn"]')?.content;
    return raw
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: the page author's own meta tag
        (JSON.parse(raw) as { urls: string | string[]; username?: string; credential?: string }[])
      : null;
  } catch {
    return null;
  }
}

function start() {
  // ---- Who I am (kept for every viz on this site) ----------------------------------------
  const { me, keepMe } = identity();
  const shared = { me, replaying: false }; // the feedback widget signs each line with me, and logs nothing a replay did
  window.vizPresence = shared;

  // ---- The room ----------------------------------------------------------------------------
  const code = new URLSearchParams(location.search).get("room");
  const uid = document.querySelector<HTMLMetaElement>('meta[name="viz:uid"]')?.content;
  const where = code ? `room:${code}` : `lobby:${uid ?? location.pathname}`;
  const joinedKey = `viz-presence-joined:${where}`; // this tab, this viz: survives a reload
  const turn = turnServers();
  const room = joinRoom(
    {
      appId: "rascaltwo-viz",
      ...(code ? { password: code } : {}),
      ...(turn ? { turnConfig: turn } : {}),
    },
    where,
  );
  addEventListener("pagehide", () => fire(room.leave()));
  const net = makeActions(room);

  // ---- The layer: absolute in page coordinates, so it scrolls with the page ----------------
  // ponytail: a viz that scrolls an inner element rather than the page gets cursors that drift; anchor to that scroller if one ever matters.
  const { layer, inkSvg } = mountLayer();

  const peers = new Map<string, Peer>();
  const ctx: Ctx = {
    me,
    keepMe,
    shared,
    code,
    joinedKey,
    room,
    net,
    peers,
    layer,
    inkSvg,
    s: {
      joined: (sessionStorage.getItem(joinedKey) ?? (code ? "1" : "0")) === "1",
      last: null,
      inking: false,
      stroke: [],
      since: Date.now(),
      clock: 0,
      waiting: [],
    },
    live: () => [...peers.values()].filter((p) => p.joined),
    anyone: () => peers.size > 0,
    announce: () => fire(net.hi.send(hiNow())),
    render: () => {
      // replaced by the panel's redraw once startPanel has built it
    },
  };
  const hiNow = (): Hi => ({
    ...me,
    joined: ctx.s.joined,
    away: document.hidden,
    hash: location.hash,
  });

  startCursors(ctx);
  startPings(ctx);
  const sync = startSync(ctx, selfId);
  const { speak } = startMessages(ctx);
  startInk(ctx);
  ctx.render = startPanel(ctx, speak);

  room.onPeerJoin = (id) => {
    fire(net.hi.send(hiNow(), { target: id }));
    if (!ctx.s.joined) return; // a private page is nobody else's to copy
    sync.catchUp(id);
  };
  room.onPeerLeave = (id) => {
    peers.get(id)?.el.remove();
    peers.delete(id);
    ctx.render();
  };
  addEventListener("visibilitychange", ctx.announce);
  addEventListener("hashchange", () => {
    ctx.announce();
    peers.forEach(place);
  });
  ctx.render();
}

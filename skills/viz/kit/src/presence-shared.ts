// presence-shared.ts — what presence.js's parts (cursors, pings, sync, messages, ink, panel) share:
// the types, the one Ctx record they all take, and the small DOM helpers.

import type { MessageAction, Room } from "@viz/kit/trystero.js";

export type Hi = { name: string; color: string; joined: boolean; away: boolean; hash: string };
export type Ping = { sel: string; fx: number; fy: number; x: number; y: number };
export type Pt = [number, number]; // [fraction of page width, page y in px]: widths differ, heights scroll
export type Peer = Hi & { el: HTMLElement; at: Pt | null; muted: boolean };
export type Act = {
  sel: string;
  k: "click" | "key" | "input" | "change" | "down" | "move" | "up";
  fx?: number;
  fy?: number;
  key?: string;
  code?: string;
  v?: string | boolean;
};
export type St = [sel: string, attr: string, v: string | null, t: number, by: string];

export const ADJ =
  "teal amber coral indigo olive plum rust sage slate ivory ochre cobalt crimson jade lilac maroon mint navy peach pearl ruby sand scarlet silver smoky sunny tawny violet wheat azure bronze copper".split(
    " ",
  );
export const ANIMAL =
  "otter heron lynx badger finch koala marten newt puffin quokka raven tapir bison crane dingo egret ferret gecko ibis jackal lemur moose narwhal ocelot panda quail robin seal toucan walrus yak zebra".split(
    " ",
  );
export const THING =
  "lamp kite anchor lantern compass harbor meadow pebble ribbon summit tundra willow canyon delta ember fjord glacier hollow island jetty lagoon mesa orchard prairie quarry reef spire thicket valley wharf beacon cove".split(
    " ",
  );
export const COLORS = [
  "#4cc9f0",
  "#f72585",
  "#ffb703",
  "#80ed99",
  "#c77dff",
  "#ff7b54",
  "#2ec4b6",
  "#e9ff70",
];
export const any = (a: string[]): string => a[Math.floor(Math.random() * a.length)] ?? "";
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Everything the room sends and receives, by name. */
export type Net = {
  hi: MessageAction<Hi>;
  cur: MessageAction<Pt>;
  ping: MessageAction<Ping>;
  say: MessageAction<string>;
  ink: MessageAction<Pt[]>;
  act: MessageAction<Act>;
  st: MessageAction<St[]>;
  hist: MessageAction<{ since: number; acts: Act[] }>;
};

export function makeActions(room: Room): Net {
  return {
    hi: room.makeAction<Hi>("hi"),
    cur: room.makeAction<Pt>("cur"),
    ping: room.makeAction<Ping>("ping"),
    say: room.makeAction<string>("say"),
    ink: room.makeAction<Pt[]>("ink"),
    act: room.makeAction<Act>("act"),
    st: room.makeAction<St[]>("st"),
    hist: room.makeAction<{ since: number; acts: Act[] }>("hist"),
  };
}

/** What changes while the page lives, shared by the parts. */
export type State = {
  joined: boolean;
  last: Pt | null; // my cursor, as last seen
  inking: boolean;
  stroke: Pt[];
  since: number; // when this page's history began: its load, or the log it adopted
  clock: number;
  waiting: (() => void)[] | null; // what peers sent before the first log arrived
};

/** The one record every part of presence takes: who I am, the room, the peers, the layer, the state. */
export type Ctx = {
  me: { name: string; color: string };
  keepMe: () => void;
  shared: { me: { name: string; color: string }; replaying: boolean };
  code: string | null; // the ?room= code, if any
  joinedKey: string; // this tab, this viz: survives a reload
  room: Room;
  net: Net;
  peers: Map<string, Peer>;
  layer: HTMLElement;
  inkSvg: SVGSVGElement;
  s: State;
  live: () => Peer[];
  anyone: () => boolean;
  announce: () => void;
  render: () => void; // redraws the people button and panel
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A send nobody waits for: a failed one is the peer's loss, never the page's. */
export function fire(sent: Promise<unknown>): void {
  sent.catch(() => {
    // peers come and go; there is nothing to retry or report
  });
}

export const toPage = ([fx, y]: Pt): { left: number; top: number } => ({
  left: fx * document.documentElement.scrollWidth,
  top: y,
});
export const fromEvent = (e: MouseEvent): Pt => [
  e.pageX / document.documentElement.scrollWidth,
  e.pageY,
];
export const mine = (t: EventTarget | null): boolean =>
  t instanceof Element && !!t.closest("#viz-presence,.vp-panel,#viz-feedback,.vp-solo");
export const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(t.tagName));
export const find = (sel: string): Element | null => {
  try {
    return document.querySelector(sel);
  } catch {
    return null;
  }
};

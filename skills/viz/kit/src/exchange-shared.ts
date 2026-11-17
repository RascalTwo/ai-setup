// exchange-shared.ts — what the exchange runtime's parts share: the shape of the data a variant's
// content.js exports (EXCHANGE.md), and the two DOM helpers every part builds with.

export const SVGNS = "http://www.w3.org/2000/svg";

// ---- the data a variant's content.js exports (EXCHANGE.md) ------------------
export type LaneId = number | string;
/** EXCHANGE.md writes flags as `{hand:1}`; `true` works the same. */
export type Flag = boolean | 0 | 1;
/** An actor box. Geometry is stage px; everything wires and packets do is derived from it. */
export interface ExchangeNode {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  cls?: string;
  tag?: string;
  role?: string;
  spec?: string;
  /** Which lane the box sits in. For the author: the runtime places boxes by y alone. */ lane?: LaneId;
}
/** A wire's route: straight across by default, or one of these shapes; `cls` adds a class. */
export interface WireOpts {
  up?: Flag;
  dip?: Flag;
  back?: Flag;
  hand?: Flag;
  cls?: string;
}
export interface BrowserState {
  at: string;
  url: string;
  body: string;
}
export interface ParallelHop {
  from: string;
  to: string;
  pkt?: string;
  ret?: Flag;
  green?: Flag;
}
export interface ExchangeStep {
  /** The narration line. */ t: string;
  /** The lane (phase band) this step belongs to. */ p: LaneId;
  from?: string;
  to?: string;
  pkt?: string;
  ret?: Flag;
  back?: Flag;
  hand?: Flag;
  lit?: string[];
  also?: ParallelHop[];
  set?: Record<string, string>;
  browser?: BrowserState;
}
export interface Exchange {
  title: string;
  subtitle?: string;
  stage?: { w?: number; h?: number };
  theme?: Record<string, string>;
  zones?: {
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    sub?: string;
    cls?: string;
  }[];
  firewalls?: { x: number; y: number; h: number; label: string; labelAt?: number }[];
  lanes: { id: LaneId; y: number; h: number; tag: string; name: string; tagX?: number }[];
  nodes: Record<string, ExchangeNode>;
  boxes?: Record<string, { x: number; y: number; w: number; h: number }>;
  panels?: {
    id: string;
    x: number;
    y: number;
    w: number;
    title: string;
    body?: string;
    cls?: string;
    bodyCls?: string;
  }[];
  labels?: { id: string; text: string; x: number; y: number }[];
  wires: [from: string, to: string, opts?: WireOpts][];
  browser?: BrowserState;
  browserPhase?: LaneId;
  steps: ExchangeStep[];
  autoscroll?: boolean;
  stepMs?: number;
}
export type Geo = { x: number; y: number; w: number; h: number };
/** `v`, or `d` when `v` is missing or falsy: 0 and "" count as missing (a plain `??` would keep them). */
// oxlint-disable-next-line typescript/prefer-nullish-coalescing -- the point of this helper: 0 and "" fall back too
export const orElse = <T>(v: T | undefined, d: T): T => v || d;

export const el = (t: string, c?: string | null, h?: string | null): HTMLElement => {
  const d = document.createElement(t);
  if (c) d.className = c;
  if (h !== undefined && h !== null) d.innerHTML = h;
  return d;
};

/** Every id queried is created by mount(); missing one is a broken runtime, said plainly. */
export const $ = (s: string): HTMLElement => {
  const e = document.querySelector<HTMLElement>(s);
  if (!e) throw new Error(`exchange: no ${s}`);
  return e;
};

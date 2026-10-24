// feedback-types.js — the shapes the feedback widget's modules share (feedback.js builds the widget
// from them): what a line is attached to, the log's store, the speech engine, and the Widget record
// that holds the state every feature reads. Types only, so a build carries nothing of it.

import type { Entry, Line, foldFeedback } from "@viz/kit/feedback-text.js";

/** What a line is attached to: a selector that survives reloads, plus how to name it to a person. */
export interface Anchor {
  selector: string;
  label?: string;
  text?: string;
}
/** Where the pointer and the page were when a line was made. `exact` is the element under the pointer when the anchor climbed. */
export interface Where {
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  hash: string;
  exact?: string;
}
export type Box = { left: number; top: number; width: number; height: number };

/** A page that runs the widget itself (the grill-me-viz poster's demo). */
export interface FeedbackHost {
  /** Only this element counts: the pill docks in its corner, pointing elsewhere anchors to it, Alt-click works only inside it. */
  root: Element;
  /** Every log line goes here instead of the server. */
  log(e: Entry): void;
  /** A crop of `box` (viewport px) with the pointer at (x, y), as an image URL; replaces page drawing. */
  shoot?(box: Box, x: number, y: number): string | null | Promise<string | null>;
}
/** Where the log and its crops live: the viz server, this browser, or a hosting page. */
export interface Store {
  load(): Promise<Entry[]>;
  append(e: Entry): Promise<void>;
  /** Save a crop; resolves to the name it's logged under, or null. */
  put(name: string, png: Blob): Promise<string | null>;
  /** A saved crop, for the panel and for Copy. */
  get(name: string): Promise<Blob | null>;
}
/** The parts of on-device SpeechRecognition used here; lib.dom does not have them all yet. */
export interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener(type: "start" | "end", listener: () => void): void;
  addEventListener(type: "error", listener: (e: { error: string }) => void): void;
  addEventListener(
    type: "result",
    listener: (e: {
      resultIndex: number;
      results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
    }) => void,
  ): void;
}
export interface RecognizerClass {
  new (): Recognizer;
  available?(o: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(o: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}

declare global {
  interface Window {
    vizFeedbackHost?: FeedbackHost;
    /** Set by the presence layer (presence.js): who this browser is, so a line can say who said it. */
    vizPresence?: { me: { name: string; color: string }; replaying: boolean };
    /** `log` for pages that add their own lines (grill-me-viz picks); `ready` resolves to the log once loaded; `say` is a test hook. */
    vizFeedback?: {
      log(e: Entry): Promise<void>;
      send(extra?: { round?: number }): Promise<void>;
      ready: Promise<Entry[]>;
      say(
        pcm: Float32Array | string,
        x?: number,
        y?: number,
        from?: [number, number],
      ): Promise<void>;
    };
    /** A page that animates can hold still while someone types feedback on it. */
    __vizPause?: () => void;
    __vizResume?: () => void;
  }
  interface WindowEventMap {
    "viz-feedback:ready": CustomEvent<{ entries: Entry[] }>;
  }
}

/** Which speech engine the mic button runs. */
export type Engine = "parakeet" | "browser" | "offer" | "none";
/** A crop in flight: a PNG, a host's image URL, or none. */
export type Shot = Promise<Blob | string | null>;
/** What the pointer was over: its anchor (or none) and where it was. */
export interface Pointed {
  anchor: Anchor | null;
  where: Where;
}
/** The pointer as a stretch of speech began, with the crop drawn then. */
export type Began = Pointed & { shot: Shot };
/** A caption over the anchor: "…", then the text, then gone. */
export interface Caption {
  remove(): void;
  live(t: string): void;
  set(t: string): void;
}
/** The crop open at full size, and where it sits in its line's crops. */
export interface View {
  node: HTMLElement;
  shots: [string, string][];
  i: number;
}

/**
 * What the modules ask of each other, filled in by feedback.js. Modules import only the shared
 * helpers, not each other: a build nests an imported kit module inside its importer, so a web of
 * imports would be copied into every module that touched it.
 */
export interface Actions {
  fold(): ReturnType<typeof foldFeedback>;
  log(entry: Entry): Promise<void>;
  renderPill(): void;
  sync(): void;
  cut(): Promise<void>;
  frame(f: Float32Array): void;
  shoot(anchor: Anchor | null, x: number, y: number): Shot;
  captureAnchor(node: Element): Anchor;
  whereAt(x: number, y: number): Where;
  pointAt(x: number, y: number): Pointed;
  begin(x: number, y: number): Began;
  caption(anchor: Anchor | null, where: Where, text: string): Caption;
  land(
    text: string,
    start: Began,
    anchor: Anchor | null,
    where: Where,
    endShot: Shot,
    cap: Caption,
    secs: number | null,
  ): Promise<void>;
  notice(text: string, hint: string, go?: () => void): void;
  flash(text: string): void;
  offerParakeet(): void;
  openView(shots: [string, string][], i: number): void;
  lineEl(l: Line): HTMLElement;
  groups(lines: Line[]): Map<string, Line[]>;
  send(extra?: { round?: number }): Promise<void>;
  copy(withImages: boolean): Promise<void>;
}

/** One widget's state: its parts, its log, the speech engine, and what is open. */
export interface Widget {
  host: FeedbackHost | undefined;
  /** The host's root: the widget only counts what happens inside it. */
  root: Element | undefined;
  vizId: string | undefined;
  /** The page stamp: local mode keeps its answers per stamp. */
  stamp: string;
  store: Store;
  layer: HTMLElement;
  pill: HTMLElement;
  dot: HTMLElement;
  micBtn: HTMLElement;
  countBtn: HTMLElement;
  // The log
  entries: Entry[];
  /** Something changed since the last send. */
  dirty: boolean;
  // Speech
  engine: Engine | null;
  worker: Worker | null;
  modelReady: boolean;
  loadPct: number | null;
  micErr: string;
  seq: number;
  /** Worker job id -> handler for its transcript. */
  waiting: Map<number, (text: string) => void>;
  /** Stretches not yet logged; Send waits on these. */
  inflight: Set<Promise<void>>;
  ctx: AudioContext | undefined;
  rec: Recognizer | null;
  onEnd: (() => void) | null;
  started: boolean;
  paused: boolean;
  listening: boolean;
  mx: number;
  my: number;
  floor: number;
  speaking: boolean;
  quietMs: number;
  /** The pointer as this stretch began. */
  began: Began | undefined;
  buf: Float32Array[];
  pre: Float32Array[];
  // What is open
  bubble: HTMLElement | null;
  card: HTMLElement | null;
  cardKey: string | null;
  panel: HTMLElement | null;
  view: View | null;
  /** Anchor selector -> pin element. */
  pins: Map<string, HTMLElement>;
  /** Panel groups the user unfolded (or folded: see `folded`). */
  opened: Set<string>;
  folded: Set<string>;
  /** Crop name -> displayable URL. */
  thumbs: Map<string, Promise<string | null>>;
  /** kit/screenshot.js (modern-screenshot) and the page's fonts, fetched once, on first use. */
  drawer(): Promise<[typeof import("@viz/kit/screenshot.js"), string]>;
  act: Actions;
}

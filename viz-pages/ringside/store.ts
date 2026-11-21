// store.ts — the page's shared state and the small helpers every part of it reads: the backend calls, the
// session state, time formatting, and the jobs that fetch the words the local model writes.
import { esc, saveHash, loadHash } from "@viz/kit";
import { api } from "@viz/kit/api.js";
import { z } from "@viz/kit/zod.js";
import type { AgentInfo, Routes, SessionInfo } from "./contract.js";
import { LANES, MAIN, type Call, type Lane, type Prompt, type Result, type Say } from "./model.js";

export const { get, post } = api<Routes>();
export const IDLE_MS = 10 * 60 * 1000;
export const laneInfo = new Map(LANES.map((l) => [l.id, l]));
/* c8 ignore next 2 -- every Lane is in LANES, so the fallback colour is defensive only */
export const colorOf = (l: Lane): string => laneInfo.get(l)?.color ?? "var(--muted)";
/* c8 ignore next -- every Lane is in LANES, so the name is always found */
export const laneName = (l: Lane): string => laneInfo.get(l)?.name ?? l;

export const WinSchema = z.enum(["round", "last", "all"]);
export type Win = z.infer<typeof WinSchema>;
export const hash = loadHash<{
  w: Win;
  mins: number;
  r: number | null;
  sel: string;
  id: string;
  follow: boolean;
  open: string[];
  strips: string[];
  view: { span: number; end: number | null };
}>();
export const state = {
  id: hash.id ?? "",
  follow: hash.follow ?? !hash.id,
  win: hash.w ?? "round",
  /** How far back "Last N min" reaches. */
  mins: hash.mins ?? 10,
  /** The round the round panel and "This round" show, from 1; null follows the latest. */
  round: hash.r ?? null,
  sel: hash.sel ?? "",
  /** Ids of the helpers whose rows are expanded; the rest show one summary row. */
  open: new Set(hash.open ?? []),
  /** Keys of the "between the scenes" strips that are expanded in the conversation. */
  strips: new Set(hash.strips ?? []),
  /** A zoomed or panned timeline range: its length, and its end (null = pinned to now); null = a preset. */
  view: hash.view ?? null,
  offset: 0,
  calls: new Map<string, Call>(),
  order: [] as Call[],
  orphans: new Map<string, Result>(),
  previews: new Map<string, string>(),
  prompts: [] as Prompt[],
  says: [] as Say[],
  lastGrowth: Date.now(),
  sessions: [] as SessionInfo[],
  subs: {} as Record<string, number>,
  agents: new Map<string, AgentInfo>(),
  /** The last backend failure, shown until the next poll succeeds. */
  error: "",
};
export const persist = (): void =>
  saveHash({
    w: state.win,
    mins: state.mins,
    r: state.round,
    sel: state.sel,
    id: state.id,
    follow: state.follow,
    open: [...state.open],
    strips: [...state.strips],
    view: state.view,
  });

// ── formatting ────────────────────────────────────────────────────────────────
export function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
export const clock = (t: number): string =>
  new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const ago = (t: number): string => dur(Date.now() - t) + " ago";

// ── words written by the local model ─────────────────────────────────────────
export const SLOTS = 2;
/** A kind of model-written text (labels, outcomes) fetched for calls, a couple at a time. */
export interface Job {
  /** The answers so far, by call id. */
  store: Map<string, string>;
  asked: Set<string>;
  /** Asked and finished, whether or not it was answered. */
  settled: Set<string>;
  /** Asked and not yet answered. */
  pending: Set<string>;
  inflight: number;
  want: (c: Call) => boolean;
  ask: (c: Call) => Promise<string | null>;
  /** Asked for every call, not only those in view: a lane moves the bar, the overview and the round's split. */
  everywhere?: boolean;
}
export const labels: Job = {
  store: new Map(),
  asked: new Set(),
  settled: new Set(),
  pending: new Set(),
  inflight: 0,
  want: (c) => c.needsLabel,
  ask: async (c) => {
    const { label } = await post("/label", { body: { id: c.id, tool: c.tool, input: c.summary } });
    return label;
  },
};
export const outcomes: Job = {
  store: new Map(),
  asked: new Set(),
  settled: new Set(),
  pending: new Set(),
  inflight: 0,
  want: (c) => c.end !== null,
  ask: async (c) => {
    const body = { session: state.id, id: c.id, agent: c.agent, pos: c.pos, intent: labelOf(c) };
    const { outcome } = await post("/outcome", { body });
    return outcome;
  },
};

export const lanes: Job = {
  store: new Map(),
  asked: new Set(),
  settled: new Set(),
  pending: new Set(),
  inflight: 0,
  everywhere: true,
  want: (c) => c.needsLane,
  ask: async (c) => {
    const { lane } = await post("/lane", { body: { id: c.id, input: c.summary } });
    if (lane) c.lane = lane;
    return lane;
  },
};

export const AI_MARK = (what: string): string =>
  ` <span class="ai" title="${what} written by local model">✦</span>`;
export const labelOf = (c: Call): string => labels.store.get(c.id) ?? c.label;
export const labelHtml = (c: Call): string =>
  esc(labelOf(c)) + (labels.store.has(c.id) ? AI_MARK("label") : "");
export const outcomeOf = (c: Call): string | undefined => outcomes.store.get(c.id);

// ── derived ───────────────────────────────────────────────────────────────────
export const lastPrompt = (): Prompt | undefined => state.prompts.at(-1);
export const roundStart = (): number => lastPrompt()?.at ?? state.order[0]?.start ?? Date.now();
export function lastEvent(): number {
  let t = lastPrompt()?.at ?? 0;
  for (const c of state.order.slice(-30)) t = Math.max(t, c.end ?? c.start);
  const s = state.says.at(-1);
  return Math.max(t, s?.at ?? 0);
}
export const isLive = (): boolean =>
  Date.now() - lastEvent() < IDLE_MS && Date.now() - state.lastGrowth < IDLE_MS;
export const tNow = (): number => (isLive() ? Date.now() : lastEvent() + 5000);
export const isSub = (c: Call): boolean => c.agent !== MAIN;
/** The last reply, if the turn is over: nothing is running and Claude spoke last. */
export const finishedTurn = (): Say | undefined => {
  const said = state.says.findLast((s) => s.at >= roundStart());
  return said && running().length === 0 && said.at >= lastEvent() - 1000 ? said : undefined;
};
export const running = (): Call[] => {
  const from = roundStart();
  return isLive() ? state.order.filter((c) => c.end === null && c.start >= from) : [];
};

/** The element an event came from; listeners here are only ever on elements. */
/* c8 ignore start -- a DOM listener's target is always an Element, so the null side never runs */
export const targetEl = (e: Event): Element | null =>
  e.target instanceof Element ? e.target : null;
/* c8 ignore stop */

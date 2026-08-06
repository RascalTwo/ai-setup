// Tape recorder for api.ts responses. Lets an API-backed viz render
// from a frozen capture when no live backend is available. One tape per viz —
// `recordings.json` beside its index.html, committed so it travels with the repo.
//
// Two server modes drive this (process flags, see server.ts):
//   --record   live api runs; every response is teed into the tape
//   --frozen   the tape is served for every api call; the live backend is untouched
// Playback is server-side only: there is exactly one playback path.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { keyFor, sortedQuery } from "./tape-key.js";

export const TAPE_FILE = "recordings.json";

export type Envelope = { status: number; contentType: string; body: string };
// A single Envelope is last-write-wins. An array is reserved for a future
// ordered-cassette upgrade — replay already tolerates it.
export type Entry = Envelope | Envelope[];
export type Tape = { version: number; recordedAt: string | null; entries: Record<string, Entry> };

function tapePath(dir: string): string {
  return path.join(dir, TAPE_FILE);
}

// Canonical key for a live request. The actual key *shape* lives in tape-key.js
// (shared verbatim with the browser shim so server-taped keys and client-replayed
// keys can never drift); here we only extract method/query/body off the Bun
// Request and hand them to keyFor(). `route` is the api-relative path (e.g.
// "meta", "failover/break") so keys are portable across viz ids / modes.
export async function recordKey(req: Request, route: string): Promise<string> {
  const url = new URL(req.url);
  let body = "";
  try {
    body = await req.clone().text();
  } catch {
    body = "";
  }
  return keyFor(req.method, route, sortedQuery(url.searchParams), body);
}

export function readTape(dir: string): Tape {
  const p = tapePath(dir);
  if (existsSync(p)) {
    try {
      const t = JSON.parse(readFileSync(p, "utf8")) as Tape;
      if (t && typeof t === "object" && t.entries) return t;
    } catch {
      // fall through to a fresh tape on a corrupt file
    }
  }
  return { version: 1, recordedAt: null, entries: {} };
}

export function lookup(dir: string, key: string): Envelope | null {
  const entry = readTape(dir).entries[key];
  if (!entry) return null;
  // Single = last-write-wins. Array (future ordered) → newest until cursors exist.
  return Array.isArray(entry) ? (entry[entry.length - 1] ?? null) : entry;
}

// Read-modify-write the tape with one captured response. Record sessions are
// low-concurrency, so a plain read/merge/write is fine.
export async function writeEntry(dir: string, key: string, env: Envelope): Promise<void> {
  const tape = readTape(dir);
  tape.entries[key] = env;
  tape.recordedAt = new Date().toISOString();
  await Bun.write(tapePath(dir), JSON.stringify(tape, null, 2) + "\n");
}

// Capture a live Response without consuming it for the real caller (clone first).
export async function envelopeFrom(res: Response): Promise<Envelope> {
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    body: await res.clone().text(),
  };
}

// Reconstruct a Response from a recorded envelope.
export function replay(env: Envelope): Response {
  return new Response(env.body, {
    status: env.status,
    headers: { "content-type": env.contentType },
  });
}

// Whether a viz has any tape on disk (used for the live-mode "--frozen" hint).
export function hasTape(dir: string): boolean {
  return existsSync(tapePath(dir));
}

function humanizeAge(recordedAt: string | null): string {
  if (!recordedAt) return "unknown age";
  const then = Date.parse(recordedAt);
  if (Number.isNaN(then)) return "unknown age";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  const units: [number, string][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "moments ago";
}

// A viz's "kind" (viz:kind meta) — "operational" vizzes are live-monitoring tools whose
// frozen data is illustrative, not current; everything else is "explanatory". Graceful
// default: absent/unrecognized → "explanatory" (never an error). Shared by the server's
// --frozen banner and the published export's banner so both label operational snapshots alike.
export function kindFromHtml(html: string): "explanatory" | "operational" {
  const m = html.match(/<meta\s+name=["']viz:kind["']\s+content=["']([^"']*)["']/i);
  return (m?.[1] ?? "").trim().toLowerCase() === "operational" ? "operational" : "explanatory";
}

// Slim, full-width, high-z-index top banner injected in --frozen mode so a viewer
// can never mistake a stale snapshot for live data. Pure HTML/CSS, no JS. An
// "operational" viz gets a louder, redder variant — its frozen data is indistinguishable
// from live but is a lie the moment the tape was cut, so the banner says so outright.
export function frozenBanner(
  recordedAt: string | null,
  kind: "explanatory" | "operational" = "explanatory",
): string {
  const age = humanizeAge(recordedAt);
  const op = kind === "operational";
  const bg = op ? "#fecaca" : "#fde68a";
  const fg = op ? "#7f1d1d" : "#78350f";
  const bd = op ? "#ef4444" : "#f59e0b";
  const msg = op
    ? `&#9208;&#65039; Frozen snapshot &middot; recorded ${age} &mdash; live monitoring tool, NOT current state`
    : `&#9208;&#65039; Frozen snapshot &middot; recorded ${age}`;
  return `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;
height:26px;line-height:26px;font:12px/26px ui-monospace,SFMono-Regular,Menlo,monospace;
color:${fg};background:${bg};border-bottom:1px solid ${bd};
text-align:center;letter-spacing:.02em;${op ? "font-weight:700;" : ""}box-shadow:0 1px 4px rgba(0,0,0,.12)">
${msg}</div>`;
}

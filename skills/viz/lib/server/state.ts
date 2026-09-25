// lib/server/state.ts — The live view of what exists — slug map, watchers, rebuilds, reloads.
//
// Extracted from server.ts, which was 522 lines.

// ---- Live state, rebuilt whenever the set of vizzes changes ----
import { publishReload, publishStatus, reloadSnippet } from "../../kit/reload.ts";
import { COMMENTS_FILE } from "./comments.ts";
import { BASE, STANDALONE, currentContainers } from "./config.ts";
import { CENTRAL, HOME, buildSlugMap, deepScan, idFor, readRegistry, writeRegistry } from "../../discovery.ts";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import type { SlugEntry } from "../../discovery.ts";
import type { FSWatcher } from "node:fs";
export let slugMap = new Map<string, SlugEntry>();
export let sortedIds: string[] = []; // ids longest-first, for prefix matching
export const watchers = new Map<string, FSWatcher>();

// Set once the listen loop below binds; the fs watcher needs it to publish reloads.
export let httpServer: Server | undefined;
/** Set by server.ts once Bun.serve binds — the fs watcher needs it to publish reloads. */
export function setHttpServer(s: Server): void {
  httpServer = s;
}

// Reload script is injected per-page with the viz's id baked in — the client
// can't infer a multi-segment id from the URL the way it used to with one segment.
// The id doubles as the pub/sub topic, so a reload reaches exactly the tabs showing
// that viz.
export function reloadScript(id: string): string {
  return reloadSnippet("/" + id + "/_reload", statusOf(id));
}

// ---- Build status: "is this frame worth reacting to?" ----
// The measured problem this exists for: a viz is on disk and in an open tab ~1.5min in,
// but the agent keeps editing for ~3.8min more across a median of 18 tool calls, so the
// page mutates under the reader with no way to tell "still being built" from "ready".
//
// "building" is INFERRED from writes (onFsEvent below) — the agent never has to remember
// it. Only "ready" is explicit, posted once at handoff. In memory only: a status is a
// fact about the current editing session, not about the viz, so it must not outlive the
// server or reach a published build.
const statuses = new Map<string, { v: string; at: number }>();
// ponytail: fixed TTL, not a per-viz lease. Without it a viz opened days later still
// reads "building" because nothing ever posted "ready" (58% of rounds never did).
const STATUS_TTL_MS = 10 * 60_000;

export function statusOf(id: string): string {
  const s = statuses.get(id);
  if (!s || Date.now() - s.at > STATUS_TTL_MS) return "";
  return s.v;
}

export function setStatus(id: string, v: string): void {
  if (statusOf(id) === v) return;
  if (v) statuses.set(id, { v, at: Date.now() });
  else statuses.delete(id);
  if (httpServer) publishStatus(httpServer, id, v);
}

// Live-only review/comment overlay (the kit's comments.js + comments.css). Dropped
// in next to the reload script, but NEVER in frozen mode — a published/static build
// carries no comment layer. The viz id rides in a data-attr so the client builds the
// right /<id>/_comments URL regardless of trailing slash, mirroring reloadScript.
export function commentOverlay(id: string): string {
  return (
    `<link rel="stylesheet" href="/_kit/comments.css">` +
    `<script type="module" src="/_kit/comments.js" data-viz-comments="${id}"></script>`
  );
}

// Coalesce bursty fs events into one reload per viz per 100ms.
export const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function broadcastReload(id: string) {
  const existing = debounceTimers.get(id);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    id,
    setTimeout(() => {
      debounceTimers.delete(id);
      if (httpServer) publishReload(httpServer, id);
    }, 100),
  );
}

// A change anywhere under a container maps back to the viz whose name is the
// first path segment. Dotfiles (.git/, .server*, .discovered.json) are ignored.
// If the change is a brand-new viz dir (unknown id), refresh the map so it routes
// immediately — fs.watch otherwise only triggers reloads, not (re)discovery.
export function onFsEvent(container: string, filename: string | null) {
  if (!filename) return;
  const name = filename.toString();
  // The comment overlay writes comments.json on every create/resolve/delete; that's
  // the overlay's own data, not an edit to the viz, so it must NOT reload the page
  // (a reload would nuke scroll/animation state out from under the user). The
  // overlay re-fetches its list itself after each mutation.
  if (path.basename(name) === COMMENTS_FILE) return;
  const first = name.split(path.sep)[0];
  if (!first || first.startsWith(".")) return;
  const id = idFor(path.join(container, first), BASE);
  if (!id) return;
  if (!slugMap.has(id)) scheduleRebuild();
  // A write means someone is mid-edit, so any earlier "ready" is now stale. Set before
  // the reload: the reloaded page re-reads statusOf() at injection and must see this.
  setStatus(id, "building");
  broadcastReload(id);
}

// Coalesce rapid map rebuilds (e.g. a burst of file creations) into one.
export let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 150);
}

export function syncWatchers(containers: string[]) {
  for (const c of containers) {
    if (watchers.has(c) || !existsSync(c)) continue;
    try {
      watchers.set(c, watch(c, { recursive: true }, (_e, fn) => onFsEvent(c, fn)));
    } catch {}
  }
  for (const [c, w] of watchers) {
    if (!containers.includes(c)) {
      try {
        w.close();
      } catch {}
      watchers.delete(c);
    }
  }
}

// Recompute the slug map + watchers from whatever containers are known right now.
export function rebuild() {
  const containers = currentContainers();
  slugMap = buildSlugMap(containers, BASE);
  sortedIds = [...slugMap.keys()].sort((a, b) => b.length - a.length);
  syncWatchers(containers);
}

// Deep-scan, union the result with the existing registry, persist, rebuild.
// Standalone serves one known container, so there's nothing to discover — just
// rebuild. (We never scan a cloner's $HOME.)
export async function runScan(): Promise<number> {
  if (STANDALONE) {
    rebuild();
    return slugMap.size;
  }
  const found = await deepScan();
  const containers = [...new Set([CENTRAL, ...readRegistry(), ...found])].filter((c) =>
    existsSync(c),
  );
  await writeRegistry(containers);
  rebuild();
  return slugMap.size;
}

// Given a leading-slash-stripped request path, find the longest viz id that owns
// it. Returns the entry plus the remaining path inside the viz (or a redirect
// signal when the id was requested without its trailing slash).
export function resolve(p: string): { entry: SlugEntry; rest: string } | { redirectTo: string } | null {
  for (const id of sortedIds) {
    if (p === id) return { redirectTo: "/" + id + "/" };
    if (p.startsWith(id + "/")) {
      const entry = slugMap.get(id)!;
      return { entry, rest: p.slice(id.length + 1) };
    }
  }
  return null;
}

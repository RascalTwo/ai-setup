// What more than one section of the Dashboard reads or writes. A section's own state (the filter
// option signatures, the lobby key, the open drawer's mirrors) lives in its module.
import type { ServerInfo, Slug } from "./dashboard-types.js";

interface DashboardState {
  gitFeed: Record<string, { commitCount: number }>;
  gitLoaded: boolean;
  lastSlugs: Slug[];
  lastServerInfo: ServerInfo | null;
  openDrawerId: string | null;
  filtersReady: boolean;
  drawerStatus: { id: string; msg: string; cls: string };
}

// ---- Merge model -------------------------------------------------------
// gitFeed is the SLOW map (id -> {commitCount}); it arrives
// once on load and again after a rescan. The 5s fast loop NEVER touches it.
// Rows render the commit col as "—" until the matching id appears here.
export const state: DashboardState = {
  gitFeed: {}, // { [id]: { commitCount } }
  gitLoaded: false, // have we ever resolved api/slugs-git?
  lastSlugs: [], // last fast-feed snapshot, for re-render after git lands
  // renderSlugs() rebuilds the stat band, which now OWNS the uptime/containers
  // readouts. renderServer() runs first on every 5s poll, so without keeping the
  // last payload here its values were wiped a moment after being written.
  lastServerInfo: null,
  openDrawerId: null, // which row's management drawer is expanded (ADR 0009)
  filtersReady: false,
  // Kept here as well as in the DOM: a write's refreshAfter() rebuilds the open drawer, and the
  // status line saying what the write did must survive that.
  drawerStatus: { id: "", msg: "", cls: "drawer-status" },
};

export function gitFor(id: string): { commitCount: number } | null {
  return state.gitLoaded ? (state.gitFeed[id] ?? null) : null;
}

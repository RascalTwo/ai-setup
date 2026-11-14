// A run's bar in this pane's app-panel, through the host's per-pane session file (skills/app-panel/host.ts),
// the same way `app-panel-progress` posts. No herdr pane or no file means no bar, never an error.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Bar = { title: string; stage?: string; started?: number; due?: number };
type Session = { url?: string; due?: number; running?: Bar[] };

const sessions = () => process.env.APP_PANEL_SESSIONS ?? join(homedir(), ".agents/state/app-panel/sessions");
export function session(pane = process.env.HERDR_PANE_ID): Session | undefined {
  if (!pane) return;
  try { return JSON.parse(readFileSync(join(sessions(), `${pane.replace(/[^\w.-]/g, "_")}.json`), "utf8")); } catch { return; }
}

/** Posts one update to this pane's panel; true if a panel took it. */
export async function post(update: Record<string, unknown>, s = session()): Promise<boolean> {
  if (!s?.url) return false;
  return fetch(s.url, { method: "POST", body: JSON.stringify(update) }).then(r => r.ok, () => false);
}

/** Updates the run's bar only if it is up, so a run that never posted one doesn't get one. */
export async function touch(title: string, update: Record<string, unknown>): Promise<void> {
  const s = session();
  if (s?.running?.some(b => b.title === title)) await post({ title, ...update }, s);
}

/** "90", "90s", "20m", "1h" → seconds, as app-panel-progress reads --eta. */
export function seconds(t: string): number {
  const m = t.trim().match(/^(\d+(?:\.\d+)?)([smh]?)$/);
  if (!m) throw new Error(`eta: can't read "${t}" (try 90s, 20m or 1h)`);
  return Number(m[1]) * { "": 1, s: 1, m: 60, h: 3600 }[m[2] as "" | "s" | "m" | "h"];
}

// As statusline-eta.sh writes it: time left rounds up, time passed rounds down; "1h05m" past an hour.
const fmt = (ms: number, up: boolean) => { const m = Math.floor((ms / 1000 + (up ? 59 : 0)) / 60); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`; };

/** The status Note for a working run: its longest running bar, then its own ETA. */
export function note(id: string, s: Session | undefined, now = Date.now()): string {
  const bars = s?.running ?? [], own = bars.find(b => b.title === id);
  // Not the session-eta hook's per-turn bar (tools/session-eta): that is the turn's guess, not something it waits on.
  const long = bars.filter(b => b !== own && b.started && !b.title.startsWith("Back in…")).sort((a, b) => a.started! - b.started!)[0];
  return ["working",
    long && `${long.title} ${fmt(now - long.started!, false)}${long.due ? ` (usually ${fmt(long.due - long.started!, true)})` : ""}`,
    own?.due && (own.due >= now ? `⏳~${fmt(own.due - now, true)}` : `⏳+${fmt(now - own.due, false)}`),
  ].filter(Boolean).join(" · ");
}

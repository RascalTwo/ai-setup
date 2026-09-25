// lib/library/linked.ts — Refusing to break the URL of a viz something links to (ADR 0016).
//
// A viz is "linked" iff its index.html carries ≥1 <meta name="viz:linked-from">. Every
// operation that changes or kills its URL (move, delete, rotate, a posture change) calls
// guardLinks first and refuses unless --break-links was passed.

import { die } from "../../cli.ts";
import { idFor } from "../../discovery.ts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { grabMetaAll } from "../publish/meta.ts";

export const LINKED_META = "viz:linked-from";

export function linkedFrom(dir: string): string[] {
  const idx = path.join(dir, "index.html");
  return existsSync(idx) ? grabMetaAll(readFileSync(idx, "utf8"), LINKED_META) : [];
}

/** Die unless no viz in `dirs` is linked, or the caller passed --break-links. */
export function guardLinks(dirs: string[], action: string, breakLinks: boolean): void {
  if (breakLinks) return;
  const linked = dirs.map((d) => ({ d, from: linkedFrom(d) })).filter((x) => x.from.length);
  if (!linked.length) return;
  die(
    [
      `ERROR: refusing to ${action} — the URL of ${linked.length === 1 ? "this linked viz" : `${linked.length} linked vizzes`} would break:`,
      ...linked.flatMap(({ d, from }) => [`  ${idFor(d) ?? d}, linked from:`, ...from.map((f) => `    - ${f}`)]),
      "Search Confluence/Slack for the URL to find the inbound links. To go ahead anyway, re-run with --break-links.",
    ].join("\n"),
    2,
  );
}

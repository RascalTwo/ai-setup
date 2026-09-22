// lib/library/list.ts — Read-only discovery over the corpus: ls and search.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- ls / search — read-only discovery over the corpus ----
//
// With 100+ vizzes across many repos there was no way to answer "what have I
// already built?" without grepping the filesystem by hand, so prior art stayed
// invisible and got rebuilt instead of forked.
//
// This is a DERIVED VIEW, never an authority. It reads what's on disk each time
// and writes nothing — no index file, no cache. That matters: ADR 0005 rejected a
// central manifest as source of truth and ADR 0006 rejected filesystem scanning as
// an authority mechanism. Neither objection applies to a read-only listing, and
// discovery.ts already computes exactly this map for routing.

import { grabMeta } from "../publish/meta.ts";
import { buildSlugMap } from "../../discovery.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
export type Row = {
  id: string;
  dir: string;
  title: string;
  posture: string;
  listed: string;
  desc: string;
  tags: string;
  mtime: number;
  central: boolean;
};

export function corpus(): Row[] {
  const rows: Row[] = [];
  for (const e of buildSlugMap().values()) {
    const idx = path.join(e.dir, "index.html");
    if (!existsSync(idx)) continue; // a dir without an index isn't a viz
    let html = "";
    try {
      html = readFileSync(idx, "utf8");
    } catch {
      continue;
    }
    let mtime = 0;
    try {
      mtime = statSync(idx).mtimeMs;
    } catch {
      /* keep 0 */
    }
    rows.push({
      id: e.id,
      dir: e.dir,
      title: grabMeta(html, "viz:title") || path.basename(e.dir),
      posture: grabMeta(html, "viz:posture") || "—",
      listed: grabMeta(html, "viz:listed") || "—",
      desc: grabMeta(html, "viz:description"),
      tags: grabMeta(html, "viz:tags"),
      mtime,
      central: e.isCentral,
    });
  }
  return rows.sort((a, b) => b.mtime - a.mtime); // newest first — usually what you want
}

export const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "??????????");

export function printRows(rows: Row[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(rows.map(({ mtime, ...r }) => ({ ...r, modified: day(mtime) })), null, 2));
    return;
  }
  if (!rows.length) {
    console.log("(no vizzes matched)");
    return;
  }
  // Fixed-width columns FIRST, then the path, then the title. Paths range from ~30
  // to ~100 chars, so leading with them makes every other column ragged.
  for (const r of rows) {
    const posture = `${r.posture}/${r.listed}`;
    console.log(`${day(r.mtime)}  ${posture.padEnd(16)}  ${r.id}\n${" ".repeat(30)}${r.title}`);
  }
  console.log(`\n${rows.length} viz(zes). Fork one:  bun bootstrap.ts <new-slug> --from <path>`);
}

// Filters are AND-ed; each is an exact match on the corresponding viz:* meta.
export function cmdLs(flags: Record<string, string | boolean>): void {
  let rows = corpus();
  // Only the axes Row actually carries. `triaged` is deliberately absent: it is
  // audit bookkeeping, not a browsing facet, and `ls` never advertised it.
  for (const axis of ["posture", "listed"] as const) {
    const want = flags[axis];
    if (typeof want === "string") rows = rows.filter((r) => r[axis] === want);
  }
  if (flags.central === true) rows = rows.filter((r) => r.central);
  if (flags.local === true) rows = rows.filter((r) => !r.central);
  printRows(rows, flags.json === true);
}

// Substring match (case-insensitive) over the metadata AND the page source, so
// "sankey" finds the viz that drew one even if the title never says so — which is
// the whole point when you're hunting for a technique to reuse rather than a title.
export function cmdSearch(term: string, flags: Record<string, string | boolean>): void {
  const q = term.toLowerCase();
  const rows = corpus().filter((r) => {
    if ([r.id, r.title, r.desc, r.tags].some((s) => s.toLowerCase().includes(q))) return true;
    try {
      return readFileSync(path.join(r.dir, "index.html"), "utf8").toLowerCase().includes(q);
    } catch {
      return false;
    }
  });
  printRows(rows, flags.json === true);
}

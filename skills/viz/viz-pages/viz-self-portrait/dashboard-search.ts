// Search terms, highlighting, and the ?hide= filters over slugs and commits.
import { byKind } from "./dashboard-dom.js";
import { esc } from "./dashboard-format.js";
import type { Slug } from "./dashboard-types.js";

// ---- Native search -----------------------------------------------------
// The list re-renders every 5s, which wipes the browser's own Ctrl+F
// highlights. This filter is re-applied on EVERY render from the live input
// value, so matches + highlights persist across the auto-refresh. It matches
// title (name) and path (id); space-separated terms are AND-ed.
export function currentTerms(): string[] {
  const q = byKind("#slug-search", HTMLInputElement).value.trim().toLowerCase();
  return q ? q.split(/\s+/u) : [];
}
export function matchTerms(s: Slug, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = (s.name + " " + s.id + " " + s.title + " " + s.tags.join(" ")).toLowerCase();
  return terms.every((t) => hay.includes(t));
}
// Escape `text`, wrapping any term occurrences in <mark>. Works on raw text
// (merging overlapping ranges) and escapes each segment, so highlights never
// break HTML.
export function hl(text: unknown, terms: string[]): string {
  const str = String(text);
  if (terms.length === 0) return esc(str);
  const lower = str.toLowerCase();
  const ranges: [number, number][] = [];
  for (const t of terms) {
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length))
      ranges.push([i, i + t.length]);
  }
  if (ranges.length === 0) return esc(str);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  let out = "",
    pos = 0;
  for (const [start, end] of merged) {
    out += esc(str.slice(pos, start)) + "<mark>" + esc(str.slice(start, end)) + "</mark>";
    pos = end;
  }
  return out + esc(str.slice(pos));
}

// ?hide= / ?hideSlug= / ?hideCommits= — match against id substrings now.
export function parseHidden(): { slugs: string[]; commits: string[] } {
  const params = new URLSearchParams(location.search);
  const split = (s: string | null) =>
    (s ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const both = split(params.get("hide"));
  const slugOnly = split(params.get("hideSlug"));
  const commitOnly = split(params.get("hideCommits"));
  return {
    slugs: [...both, ...slugOnly],
    commits: [...both, ...commitOnly],
  };
}
export const matchesAny = (hay: string, needles: string[]): boolean =>
  needles.some((n) => hay.includes(n));

export function commitSlug(subject: string): string | null {
  const create = subject.match(/^create viz:\s*(\S+)/u);
  if (create) return create[1]!;
  const prefixed = subject.match(/^([a-z0-9][a-z0-9-]*):/u);
  return prefixed ? prefixed[1]! : null;
}

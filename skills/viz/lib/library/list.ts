// lib/library/list.ts — Read-only discovery over the corpus: ls and search.
//
// Extracted from the since-deleted manage.ts, which was 878 lines of everything.

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

import { grabMeta, grabMetaAll, kindOf } from "../publish/meta.ts";
import { buildSlugMap } from "../../discovery.ts";
import { isHidden, hiddenTags } from "./hidden.ts";
import {
  approvalOf,
  cardPublicOf,
  type ApprovalState,
  type CardState,
} from "../publish/approval.ts";
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
  kind: string; // "" = a plain page
  template: string; // the kind this viz is a TEMPLATE for; "" = not a template
  linkedFrom: string[]; // non-empty = linked; move/delete/rotate/posture refuse (ADR 0016)
  cardPublic: CardState; // ADR 0018 — "public" gets a /share/<slug>/ page when built
  cardWas: string; // the decision a stale card last carried; "" otherwise
  approved: ApprovalState; // ADR 0015 — "stale" = approved once, edited since
  uid: string; // ADR 0014 — durable identity; "" = predates it
  uidClash: string[]; // OTHER vizzes (by id) claiming the same uid — never legitimate, see corpus()
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
    const card = cardPublicOf(e.dir);
    rows.push({
      id: e.id,
      dir: e.dir,
      title: grabMeta(html, "viz:title") || path.basename(e.dir),
      posture: grabMeta(html, "viz:posture") || "—",
      listed: grabMeta(html, "viz:listed") || "—",
      desc: grabMeta(html, "viz:description"),
      tags: grabMetaAll(html, "viz:tag").join(", "), // one <meta name="viz:tag"> per tag
      kind: kindOf(html),
      template: grabMeta(html, "viz:template").toLowerCase(),
      linkedFrom: grabMetaAll(html, "viz:linked-from"),
      cardPublic: card.state,
      cardWas: card.was,
      // Hashing a whole viz costs ~1ms, and almost none are approved — so only hash the ones
      // that carry a stored hash to compare against. Everything else is "never" by definition.
      approved: grabMeta(html, "viz:approved").startsWith("h-") ? approvalOf(e.dir).state : "never",
      uid: grabMeta(html, "viz:uid"),
      uidClash: [],
      mtime,
      central: e.isCentral,
    });
  }
  // Two vizzes claiming one uid silently merge everything keyed on it (rankings, notes).
  // A mirror or vendored copy IS its origin, so it shares the uid by design (ADR 0014) and
  // is left out; any clash among the rest is a hand-copied folder that needs a fresh uid.
  const byUid = new Map<string, Row[]>();
  for (const r of rows) {
    if (
      !r.uid ||
      existsSync(path.join(r.dir, ".mirror.json")) ||
      existsSync(path.join(r.dir, ".vendored.json"))
    )
      continue;
    byUid.set(r.uid, [...(byUid.get(r.uid) ?? []), r]);
  }
  for (const same of byUid.values()) {
    if (same.length < 2) continue;
    // Git worktrees of one repo check out the SAME viz several times; that is one viz, not
    // a clash. Only clashing groups pay for the git call, and they are rare.
    const key = new Map(same.map((r) => [r, sameCheckout(r.dir)]));
    for (const r of same)
      r.uidClash = same.filter((o) => o !== r && key.get(o) !== key.get(r)).map((o) => o.id);
  }
  return rows.toSorted((a, b) => b.mtime - a.mtime); // newest first — usually what you want
}

/** Identity of a checkout that survives worktrees: the shared .git dir + path inside the repo. */
function sameCheckout(dir: string): string {
  const git = (...a: string[]) =>
    Bun.spawnSync(["git", "-C", dir, ...a])
      .stdout.toString()
      .trim();
  const common = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  return common ? `${common}\0${git("rev-parse", "--show-prefix")}` : dir;
}

export const day = (ms: number): string =>
  ms ? new Date(ms).toISOString().slice(0, 10) : "??????????";

export function printRows(rows: Row[], json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify(
        rows.map(({ mtime, ...r }) => ({ ...r, modified: day(mtime) })),
        null,
        2,
      ),
    );
    return;
  }
  if (rows.length === 0) {
    console.log("(no vizzes matched)");
    return;
  }
  // Fixed-width columns FIRST, then the path, then the title. Paths range from ~30
  // to ~100 chars, so leading with them makes every other column ragged.
  for (const r of rows) {
    const posture = `${r.posture}/${r.listed}`;
    const linked = r.linkedFrom.length > 0 ? `  🔗 linked from: ${r.linkedFrom.join(" · ")}` : "";
    const card =
      r.cardPublic === "unreviewed"
        ? ""
        : `  🪪 card ${r.cardPublic === "stale" ? `stale (was ${r.cardWas.replace("-", " ")}, re-review)` : r.cardPublic.replace("-", " ")}`;
    const approved =
      r.approved === "approved"
        ? "  ✅ approved"
        : r.approved === "stale"
          ? "  ⚠️ approval stale (edited since)"
          : "";
    console.log(
      `${day(r.mtime)}  ${posture.padEnd(16)}  ${r.id}\n${" ".repeat(30)}${r.title}${approved}${linked}${card}`,
    );
    if (r.uidClash.length > 0)
      console.log(
        `${" ".repeat(30)}⚠️  duplicate viz:uid ${r.uid} — also on ${r.uidClash.join(", ")}; the copy needs a fresh uid (ADR 0014)`,
      );
  }
  console.log(`\n${rows.length} viz(zes). Fork one:  viz create <new-slug> --from <path>`);
}

// Rows tagged with a configured hidden tag (ADR 0020), unless --all. ls and search share
// the rule so a viz can't be absent from one and present in the other by default.
function visible(rows: Row[], flags: Record<string, string | boolean>): Row[] {
  if (flags.all === true) return rows;
  const hidden = hiddenTags();
  return rows.filter((r) => !isHidden(r.tags ? r.tags.split(", ") : [], hidden));
}

// Filters are AND-ed; each is an exact match on the corresponding viz:* meta.
export function cmdLs(flags: Record<string, string | boolean>): void {
  let rows = visible(corpus(), flags);
  // Only the axes Row actually carries. `triaged` is deliberately absent: it is
  // audit bookkeeping, not a browsing facet, and `ls` never advertised it.
  for (const axis of ["posture", "listed", "approved", "card-public"] as const) {
    const want = flags[axis];
    const key = axis === "card-public" ? "cardPublic" : axis;
    if (typeof want === "string") rows = rows.filter((r) => r[key] === want);
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
  const rows = visible(corpus(), flags).filter((r) => {
    if ([r.id, r.title, r.desc, r.tags].some((s) => s.toLowerCase().includes(q))) return true;
    try {
      return readFileSync(path.join(r.dir, "index.html"), "utf8").toLowerCase().includes(q);
    } catch {
      return false;
    }
  });
  printRows(rows, flags.json === true);
}

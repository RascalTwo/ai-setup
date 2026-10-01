// lib/library/ranking.ts — the pairwise ranking of the corpus (ADR 0014; engine: @rascaltwo/pairwise-sorter).
//
// Moved out of the self-portrait's api.ts so `viz ranking` and the Rank tab read ONE
// definition. Items are DERIVED from the live corpus on every read; only the decision
// log is stored. That split is the point: a viz that moves, is retitled, or is created
// afterwards still matches its answers, because identity is viz:uid and nothing here
// remembers a path. Copies (mirror/vendored) are skipped — they are the same viz as
// their origin and would otherwise appear on both sides of a comparison.
//
// MANY NAMED LISTS, not one. "Best" is only one thing you might rank on; each dimension
// keeps its own independent log, so answering one never disturbs another.
//
// Persisted in CENTRAL, not localStorage: ranking ~250 vizzes is ~1,900 comparisons
// gathered over weeks, and a browser-data clear must not be able to delete that.

import { existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { CENTRAL, buildSlugMap } from "../../discovery.ts";
import { grabMeta } from "../publish/meta.ts";
import { approvalOf } from "../publish/approval.ts";
// @ts-ignore — kit/pairwise.js is the generated browser bundle of @rascaltwo/pairwise-sorter (see
// maintainer/sync-kit.ts); importing the SAME file the Rank tab loads keeps CLI and UI in step.
import { createEngine } from "../../kit/pairwise.js";

export const RANKINGS = path.join(CENTRAL, "rankings.json");
export const blankList = (name: string) => ({ name, log: [] as any[], benched: [] as any[], priority: [] as any[], updated: null as string | null });

export function loadRankings(): any {
  let d: any;
  try { d = JSON.parse(readFileSync(RANKINGS, "utf8")); } catch { d = null; }
  if (!d) return { version: 2, current: "best", lists: { best: blankList("Best") } };
  // v1 was a single unnamed log at the top level. Adopt it as "Best" rather than
  // discarding it — it is the only dimension that existed, and that is what it meant.
  if (!d.lists) return { version: 2, current: "best",
    lists: { best: { name: "Best", log: d.log ?? [], benched: d.benched ?? [], priority: d.priority ?? [], updated: d.updated ?? null } } };
  return d;
}

export async function saveRankings(d: any): Promise<void> {
  const tmp = RANKINGS + ".tmp";
  await Bun.write(tmp, JSON.stringify(d, null, 2));
  renameSync(tmp, RANKINGS);   // torn write here costs weeks of judgment
}

/** The rankable corpus plus the current list's stored state — what the Rank tab boots from. */
export function rankingView() {
  const d = loadRankings();
  const current = d.lists[d.current] ? d.current : Object.keys(d.lists)[0];
  const cur = d.lists[current];

  const items: any[] = [];
  let noUid = 0;
  for (const s of buildSlugMap().values()) {
    if (!existsSync(path.join(s.dir, "index.html"))) continue;
    if (existsSync(path.join(s.dir, ".mirror.json")) || existsSync(path.join(s.dir, ".vendored.json"))) continue;
    let html = "";
    try { html = readFileSync(path.join(s.dir, "index.html"), "utf8"); } catch { continue; }
    const uid = grabMeta(html, "viz:uid");
    if (!uid) { noUid++; continue; }
    const p = grabMeta(html, "viz:posture").toLowerCase();
    const og = ["og.gif", "og.png", "og.jpg", "og.auto.png"].find((f) => existsSync(path.join(s.dir, f)));
    items.push({
      title: grabMeta(html, "viz:title") || path.basename(s.dir),
      url: "viz://" + uid,
      key: "viz://" + uid,            // EXPLICIT identity: not title-derived, so a retitle
                                      // does not orphan this viz's answers
      desc: grabMeta(html, "viz:description"),
      media: og ? ["/" + s.id + "/" + og] : [],
      tags: [s.isCentral ? "central" : path.basename(path.dirname(s.container)),
             p === "public" || p === "private" || p === "local" ? p : "untagged"],
      vizId: s.id,
      approval: approvalOf(s.dir).state,
    });
  }
  return {
    items,
    current,
    lists: Object.entries(d.lists).map(([id, l]: any) => ({ id, name: l.name, answered: (l.log ?? []).length })),
    log: cur.log ?? [], benched: cur.benched ?? [], priority: cur.priority ?? [],
    skippedNoUid: noUid, updated: cur.updated ?? null,
  };
}

/**
 * Replay a list's log through the shared engine WITHOUT asking anything. The sort is
 * deterministic, so the log alone reconstructs the order up to the first pair nobody has
 * answered yet — that prefix is the honest ranking; everything after it is "unranked".
 */
export async function currentRanking(listId?: string) {
  const v = rankingView();
  const d = loadRankings();
  const id = listId ?? v.current;
  const l = d.lists[id];
  if (!l) throw new Error(`no dimension "${id}" — have: ${Object.keys(d.lists).join(", ")}`);
  const eng = createEngine({ items: v.items, log: l.log ?? [], benched: l.benched ?? [], priority: l.priority ?? [] });
  let placed: number[] = [];
  const STOP = Symbol("unanswered");
  const order: number[] | null = await eng
    .run(() => Promise.reject(STOP), { onProgress: (p: { placed: number[] }) => { placed = p.placed; } })
    .catch((e: unknown) => { if (e === STOP) return null; throw e; });
  const ranked = (order ?? placed).map((i) => v.items[i]);
  return {
    list: id,
    name: l.name,
    answered: (l.log ?? []).length,
    complete: order !== null,
    total: eng.live().length,
    ranked: ranked.map((it: any, n: number) => ({ rank: n + 1, title: it.title, vizId: it.vizId, uid: it.key.slice("viz://".length) })),
  };
}

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
// @ts-expect-error — kit/pairwise.js is the generated browser bundle of @rascaltwo/pairwise-sorter (see
// maintainer/sync-kit.ts); importing the SAME file the Rank tab loads keeps CLI and UI in step.
import { createEngine } from "../../kit/pairwise.js";

export const RANKINGS = path.join(CENTRAL, "rankings.json");

/** One named dimension: its decision log plus the bench and priority sets. Entries are the engine's, opaque here. */
export interface RankList {
  name: string;
  log: unknown[];
  benched: unknown[];
  priority: unknown[];
  updated: string | null;
}
export interface Rankings {
  version: number;
  current: string;
  lists: Record<string, RankList>;
}
export interface RankItem {
  title: string;
  url: string;
  key: string;
  desc: string;
  media: string[];
  tags: string[];
  vizId: string;
  approval: string;
}

/** The slice of the pairwise engine this file drives; the kit bundle is untyped JS. */
interface Engine {
  run(
    ask: () => Promise<never>,
    opts: { onProgress: (p: { placed: number[] }) => void },
  ): Promise<number[]>;
  live(): unknown[];
}

/** The one place the untyped kit bundle is called; everything else sees `Engine`. */
function makeEngine(cfg: {
  items: RankItem[];
  log: unknown[];
  benched: unknown[];
  priority: unknown[];
}): Engine {
  // oxlint-disable-next-line typescript/no-unsafe-return, typescript/no-unsafe-call -- createEngine comes from untyped JS (see the ts-expect-error import)
  return createEngine(cfg);
}

export const blankList = (name: string): RankList => ({
  name,
  log: [],
  benched: [],
  priority: [],
  updated: null,
});

/** v1 files were one unnamed log at the top level, so they have no `lists`. */
type LegacyRankings = Partial<RankList> & { lists?: undefined };

export function loadRankings(): Rankings {
  let d: Rankings | LegacyRankings | null;
  try {
    const raw: unknown = JSON.parse(readFileSync(RANKINGS, "utf8"));
    // The file is hand-editable; this is the one boundary cast, the shape is checked by the `lists` test below.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary
    d = raw as Rankings | LegacyRankings | null;
  } catch {
    d = null;
  }
  if (!d) return { version: 2, current: "best", lists: { best: blankList("Best") } };
  // v1 was a single unnamed log at the top level. Adopt it as "Best" rather than
  // discarding it — it is the only dimension that existed, and that is what it meant.
  if (!d.lists)
    return {
      version: 2,
      current: "best",
      lists: {
        best: {
          name: "Best",
          log: d.log ?? [],
          benched: d.benched ?? [],
          priority: d.priority ?? [],
          updated: d.updated ?? null,
        },
      },
    };
  return d;
}

export async function saveRankings(d: Rankings): Promise<void> {
  const tmp = RANKINGS + ".tmp";
  await Bun.write(tmp, JSON.stringify(d, null, 2));
  renameSync(tmp, RANKINGS); // torn write here costs weeks of judgment
}

/** The live corpus as rank items; `noUid` counts the vizzes skipped for lacking an identity. */
function rankableItems(): { items: RankItem[]; noUid: number } {
  const items: RankItem[] = [];
  let noUid = 0;
  for (const s of buildSlugMap().values()) {
    if (!existsSync(path.join(s.dir, "index.html"))) continue;
    if (
      existsSync(path.join(s.dir, ".mirror.json")) ||
      existsSync(path.join(s.dir, ".vendored.json"))
    )
      continue;
    let html = "";
    try {
      html = readFileSync(path.join(s.dir, "index.html"), "utf8");
    } catch {
      continue;
    }
    const uid = grabMeta(html, "viz:uid");
    if (!uid) {
      noUid++;
      continue;
    }
    const p = grabMeta(html, "viz:posture").toLowerCase();
    const og = ["og.gif", "og.png", "og.jpg", "og.auto.png"].find((f) =>
      existsSync(path.join(s.dir, f)),
    );
    items.push({
      title: grabMeta(html, "viz:title") || path.basename(s.dir),
      url: "viz://" + uid,
      key: "viz://" + uid, // EXPLICIT identity: not title-derived, so a retitle
      // does not orphan this viz's answers
      desc: grabMeta(html, "viz:description"),
      media: og ? ["/" + s.id + "/" + og] : [],
      tags: [
        s.isCentral ? "central" : path.basename(path.dirname(s.container)),
        p === "public" || p === "private" || p === "local" ? p : "untagged",
      ],
      vizId: s.id,
      approval: approvalOf(s.dir).state,
    });
  }
  return { items, noUid };
}

export interface RankingView {
  items: RankItem[];
  current: string;
  lists: { id: string; name: string; answered: number }[];
  log: unknown[];
  benched: unknown[];
  priority: unknown[];
  skippedNoUid: number;
  updated: string | null;
}

/** The rankable corpus plus the current list's stored state — what the Rank tab boots from. */
export function rankingView(): RankingView {
  const d = loadRankings();
  const current = d.lists[d.current] ? d.current : Object.keys(d.lists)[0];
  const cur = current === undefined ? undefined : d.lists[current];
  if (current === undefined || cur === undefined) throw new Error("rankings.json has no lists");

  const { items, noUid } = rankableItems();
  return {
    items,
    current,
    lists: Object.entries(d.lists).map(([id, l]) => ({
      id,
      name: l.name,
      answered: (l.log ?? []).length,
    })),
    log: cur.log ?? [],
    benched: cur.benched ?? [],
    priority: cur.priority ?? [],
    skippedNoUid: noUid,
    updated: cur.updated ?? null,
  };
}

/**
 * Replay a list's log through the shared engine WITHOUT asking anything. The sort is
 * deterministic, so the log alone reconstructs the order up to the first pair nobody has
 * answered yet — that prefix is the honest ranking; everything after it is "unranked".
 */
export async function currentRanking(listId?: string): Promise<{
  list: string;
  name: string;
  answered: number;
  complete: boolean;
  total: number;
  ranked: { rank: number; title: string; vizId: string; uid: string }[];
}> {
  const v = rankingView();
  const d = loadRankings();
  const id = listId ?? v.current;
  const l = d.lists[id];
  if (!l) throw new Error(`no dimension "${id}" — have: ${Object.keys(d.lists).join(", ")}`);
  const eng = makeEngine({
    items: v.items,
    log: l.log ?? [],
    benched: l.benched ?? [],
    priority: l.priority ?? [],
  });
  let placed: number[] = [];
  const STOP = new Error("unanswered");
  const order: number[] | null = await eng
    // oxlint-disable-next-line typescript/promise-function-async -- async here would trip require-await: the callback only rejects
    .run(() => Promise.reject(STOP), {
      onProgress: (p) => {
        placed = p.placed;
      },
    })
    .catch((e: unknown) => {
      if (e === STOP) return null;
      throw e;
    });
  const ranked = (order ?? placed).flatMap((i) => v.items[i] ?? []);
  return {
    list: id,
    name: l.name,
    answered: (l.log ?? []).length,
    complete: order !== null,
    total: eng.live().length,
    ranked: ranked.map((it, n) => ({
      rank: n + 1,
      title: it.title,
      vizId: it.vizId,
      uid: it.key.slice("viz://".length),
    })),
  };
}

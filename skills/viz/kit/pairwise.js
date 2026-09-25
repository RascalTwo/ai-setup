// kit/pairwise.js — the pairwise-ranking engine, with no DOM in it.
//
// Extracted from the `pairwise-sorter` viz so a second consumer can rank things without
// forking 2,500 lines of page. The page keeps its own UI; this owns the parts that are
// the same wherever you rank: identity, the decision log, tiers, the sort, and the
// analyses (ties, conflicts) derived from a finished order.
//
// THE SEAM is `ask`. cmp() answers from the log first, then from the declared tiers, and
// only reaches the host when it genuinely needs a human. Everything above that line is
// deterministic and testable; everything below it is somebody's UI.
//
// Two properties the host must not break:
//   * The log is REPLAYABLE. The sort is deterministic, so replaying the log from scratch
//     reconstructs any point — undo, reload and resume all fall out of that, and nothing
//     serialises the recursion. Don't mutate the log out of order.
//   * Identity is never POSITION. By default it is `title + "\0" + url`, so reordering,
//     editing a description or adding items leaves earlier answers intact. A host with a
//     genuinely stable id should pass `key` and pin identity to that instead — the viz
//     corpus passes its viz:uid, because a title is editable and a retitle would otherwise
//     read as a different item. When identity legitimately changes, call migrateId — do
//     NOT rewrite the log by hand, because a pair whose two ids swap sides must also flip
//     its recorded sign.

export const SEP = "\u0001";
export const SEP_ID = "\u0000";

/** A rankable thing. `url` is opaque — a viz corpus passes `viz://<uid>` so identity
 *  survives a move, which a real URL would not. */
export const item = (title, url = "", media = [], desc = "", tags = [], key = "") => ({
  title: String(title ?? ""),
  url: String(url ?? ""),
  media: Array.isArray(media) ? media : [media].filter(Boolean),
  desc: String(desc ?? ""),
  tags: Array.isArray(tags) ? tags : [],
  ...(key ? { key: String(key) } : {}),
});

// Identity. A host may pin it explicitly with `key` — the viz corpus does, because a
// viz's TITLE is editable and title+url would make a rename look like a different item.
// Without `key` this is the historical title+url, so existing stored logs still match.
export const idOf = (it) => (it?.key ? String(it.key) : (it?.title ?? "") + SEP_ID + (it?.url ?? ""));

/** Canonical key for an unordered pair: the two ids sorted, so A-vs-B and B-vs-A collide.
 *  `flip` carries the orientation, because the stored verdict is relative to that order. */
export function pairKeyOf(idA, idB) {
  return idA < idB ? idA + SEP + idB : idB + SEP + idA;
}
export function flipOfIds(idA, idB) {
  return idA < idB ? 1 : -1;
}

/** Lowest priority index among an item's tags — Infinity for the untiered bottom band. */
export function tierOf(it, priority) {
  return (it?.tags ?? []).reduce((best, t) => {
    const i = priority.indexOf(t);
    return i >= 0 && i < best ? i : best;
  }, Infinity);
}

export const tierName = (t, priority) => (t === Infinity ? "untiered" : "#" + priority[t]);

/**
 * The synthesised verdict for a cross-tier pair, or null when the pair must be asked
 * about: tiers off, same tier, or both untiered. Never written to the log — recomputed
 * every time, so reordering tiers re-cuts the ranking with nothing stale left behind.
 */
export function tierVerdict(a, b, priority) {
  if (!priority.length) return null;
  const ta = tierOf(a, priority), tb = tierOf(b, priority);
  if (ta === tb) return null;
  return ta < tb ? -1 : 1;
}

/** Worst-case comparisons for binary insertion on n items. */
export function budgetFor(n) {
  let t = 0;
  for (let i = 1; i < n; i++) t += Math.ceil(Math.log2(i + 1));
  return Math.max(1, t);
}

/**
 * Binary insertion sort over indices, asking `cmp` for each probe.
 *
 * Binary insertion rather than merge sort because `arr` is append-stable: appending an
 * item leaves every earlier insertion identical, so those comparisons replay from the log
 * and only the newcomer costs questions (~log2 n). Merge sort re-partitions on every
 * count change and asks pairs it has never asked. It is also cheaper overall —
 * ~n·log2n − 1.44n against ~n·log2n.
 *
 * `onProgress` receives the live partial order so a host can show real progress mid-sort.
 *
 * `onProbe` exposes the search state before each comparison. It exists so a host can warm
 * exactly the right things: from any probe only TWO slots can be asked next, and a host
 * showing images wants both decoded before the reader answers. Without it a host would
 * have to re-implement this loop just to know where it was about to look.
 */
export async function sortIndices(arr, cmp, onProgress, onProbe) {
  const out = [];
  for (let n = 0; n < arr.length; n++) {
    onProgress?.({ placed: [...out], remaining: arr.slice(n), next: arr[n + 1] });
    let lo = 0, hi = out.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      onProbe?.({ out, lo, hi, mid });
      const v = await cmp(arr[n], out[mid]);
      if (v < 0) hi = mid; else lo = mid + 1; // ties fall after, keeping order stable
    }
    out.splice(lo, 0, arr[n]);
  }
  return out;
}

/**
 * Group items joined by a CHAIN of "equal" answers. Without the union-find, A = B and
 * B = C only share a rank when that pair happened to be compared directly and land
 * adjacent. Returns a find(id) → representative function.
 */
export function tieClasses(items, log) {
  const parent = new Map(items.map((it) => [idOf(it), idOf(it)]));
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  for (const [k, v] of log) {
    if (v !== 0) continue;
    const [a, b] = k.split(SEP);
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return find;
}

/**
 * Answers the finished ranking disagrees with. Any cycle (A>B, B>C, C>A) must violate at
 * least one of its own answers once flattened to a line, so this catches inconsistency
 * without building the graph — and points at the specific answers you can act on.
 */
export function findConflicts(log, rankById) {
  const bad = new Map();
  log.forEach(([k, v], n) => {
    const [x, y] = k.split(SEP);
    if (!rankById.has(x) || !rankById.has(y)) return;
    const rx = rankById.get(x), ry = rankById.get(y);
    if (v === 0) {
      if (rx !== ry) bad.set(n, "you called these equal, but they ranked apart");
    } else {
      const [win, lose] = v < 0 ? [rx, ry] : [ry, rx];
      if (win >= lose) bad.set(n, "this answer disagrees with the final ranking");
    }
  });
  return bad;
}

/**
 * Rewrite every logged answer that mentions `oldId` to mention `newId`.
 *
 * The sign flip is the whole reason this is a function and not a string replace: a key is
 * the two ids in sorted order and the verdict is relative to THAT order, so if renaming
 * swaps which id sorts first, the stored verdict must invert or the answer silently
 * reverses. Mutates `log` in place and returns it; also moves a bench entry.
 */
export function migrateId(log, benched, oldId, newId) {
  if (oldId === newId) return log;
  const out = log.map(([k, v]) => {
    const [x, y] = k.split(SEP);
    if (x !== oldId && y !== oldId) return [k, v];
    const nx = x === oldId ? newId : x, ny = y === oldId ? newId : y;
    return nx < ny ? [nx + SEP + ny, v] : [ny + SEP + nx, -v];
  });
  log.length = 0;
  log.push(...out);
  if (benched?.has(oldId)) { benched.delete(oldId); benched.add(newId); }
  return log;
}

/**
 * Tie the pieces together for one list.
 *
 * `ask(aIdx, bIdx)` is the host's job: show the pair, return -1 (a wins), 1 (b wins) or
 * 0 (equal). Reject to abort a run. Everything the host does NOT need to think about —
 * consulting the log, applying tiers, recording, ordering — happens here.
 *
 * Answer precedence is policy, not accident: a direct answer about a specific pair beats
 * the tier order, which is also the escape hatch for promoting one item across a divide.
 */
export function createEngine(state) {
  const s = {
    items: [], log: [], benched: new Set(), priority: [], weights: [], combine: "order",
    ...state,
  };
  if (!(s.benched instanceof Set)) s.benched = new Set(s.benched ?? []);

  const answers = new Map(s.log);
  const liveIdx = () => s.items.map((_, i) => i).filter((i) => !s.benched.has(idOf(s.items[i])));

  async function cmp(a, b, ask, onRecord) {
    const ia = idOf(s.items[a]), ib = idOf(s.items[b]);
    const k = pairKeyOf(ia, ib), flip = flipOfIds(ia, ib);
    if (answers.has(k)) return answers.get(k) * flip;          // your answer wins
    const tier = tierVerdict(s.items[a], s.items[b], s.priority); // then the declared tiers
    if (tier !== null) return tier;                             // (never logged — recomputed)
    const v = await ask(a, b);
    answers.set(k, v * flip);
    s.log.push([k, v * flip]);
    onRecord?.(s.log);
    return v;
  }

  return {
    state: s,
    live: liveIdx,
    budget: () => budgetFor(liveIdx().length),
    answeredCount: () => s.log.length,

    /** Run a full sort. Resolves to item indices, best first. */
    run: (ask, { onProgress, onRecord, onProbe } = {}) =>
      sortIndices(liveIdx(), (a, b) => cmp(a, b, ask, onRecord), onProgress, onProbe),

    ranking: (order) => order.map((i) => s.items[i]),
    ties: () => tieClasses(s.items, s.log),
    conflicts: (rankById) => findConflicts(s.log, rankById),
    migrate: (oldId, newId) => {
      migrateId(s.log, s.benched, oldId, newId);
      answers.clear();
      for (const [k, v] of s.log) answers.set(k, v);
    },

    /** Serialisable form — the host decides where it goes (localStorage, a file, an API). */
    toJSON: () => ({
      items: s.items, log: s.log, benched: [...s.benched],
      priority: s.priority, weights: s.weights, combine: s.combine,
    }),
  };
}

// GENERATED from @rascaltwo/pairwise-sorter/element (github:RascalTwo/pairwise-sorter#667e96ce5db66e690f9c5361b93eaf6bc3372f3f) by maintainer/sync-kit.ts — do not edit.
// Change the package, bump its pin in skills/viz/package.json, then run `npm run sync:kit`.
// node_modules/@rascaltwo/pairwise-sorter/dist/item.js
var SEP = "";
var SEP_ID = "\0";
var tagOf = (t) => String(t).trim().replace(/^#/, "").replace(/\s+/g, "-");
var item = (title, url = "", media = [], desc = "", tags = [], key = "") => ({
  title: String(title ?? ""),
  url: String(url ?? ""),
  media: [media].flat().filter(Boolean).map(String),
  desc: String(desc ?? ""),
  tags: [...new Set([tags].flat().filter(Boolean).map(tagOf).filter(Boolean))],
  ...key ? { key: String(key) } : {}
});
var idOf = (it) => it?.key ? String(it.key) : (it?.title ?? "") + SEP_ID + (it?.url ?? "");
var idParts = (id) => {
  const [title = "", url = ""] = id.split(SEP_ID);
  return { title, url };
};

// node_modules/@rascaltwo/pairwise-sorter/dist/engine.js
var pairKeyOf = (idA, idB) => idA < idB ? idA + SEP + idB : idB + SEP + idA;
var flipOfIds = (idA, idB) => idA < idB ? 1 : -1;
var orient = (v, sign) => v * sign || 0;
var tierOf = (it, priority) => (it?.tags ?? []).reduce((best, t) => {
  const i = priority.indexOf(t);
  return i >= 0 && i < best ? i : best;
}, Infinity);
var tierName = (t, priority) => t === Infinity ? "untiered" : "#" + priority[t];
function tierVerdict(a, b, priority) {
  if (!priority.length)
    return null;
  const ta = tierOf(a, priority), tb = tierOf(b, priority);
  if (ta === tb)
    return null;
  return ta < tb ? -1 : 1;
}
function budgetFor(n) {
  let t = 0;
  for (let i = 1; i < n; i++)
    t += Math.ceil(Math.log2(i + 1));
  return Math.max(1, t);
}
function slotsFor(n, out, known) {
  let lo = 0, hi = out.length;
  out.forEach((o, k) => {
    const v = known(n, o);
    if (v === null)
      return;
    if (v < 0)
      hi = Math.min(hi, k);
    else
      lo = Math.max(lo, k + 1);
  });
  return lo <= hi ? [lo, hi] : [0, out.length];
}
async function sortIndices(arr, cmp, onProgress, onProbe, known = () => null) {
  const out = [];
  for (let n = 0; n < arr.length; n++) {
    onProgress?.({ placed: [...out], remaining: arr.slice(n), next: arr[n + 1] });
    let [lo, hi] = slotsFor(arr[n], out, known);
    while (lo < hi) {
      const mid = lo + hi >> 1;
      onProbe?.({ out, lo, hi, mid });
      const v = await cmp(arr[n], out[mid]);
      if (v < 0)
        hi = mid;
      else
        lo = mid + 1;
    }
    out.splice(lo, 0, arr[n]);
  }
  return out;
}
function tieClasses(items, log) {
  const parent = new Map(items.map((it) => [idOf(it), idOf(it)]));
  const find = (x) => {
    while (parent.has(x) && parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const [k, v] of log) {
    if (v !== 0)
      continue;
    const [a = "", b = ""] = k.split(SEP);
    if (!parent.has(a) || !parent.has(b))
      continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb)
      parent.set(ra, rb);
  }
  return find;
}
function findConflicts(log, rankById) {
  const bad = /* @__PURE__ */ new Map();
  log.forEach(([k, v], n) => {
    const [x = "", y = ""] = k.split(SEP);
    const rx = rankById.get(x), ry = rankById.get(y);
    if (rx === void 0 || ry === void 0)
      return;
    if (v === 0) {
      if (rx !== ry)
        bad.set(n, "you called these equal, but they ranked apart");
    } else {
      const [win, lose] = v < 0 ? [rx, ry] : [ry, rx];
      if (win >= lose)
        bad.set(n, "this answer disagrees with the final ranking");
    }
  });
  return bad;
}
function migrateId(log, benched, oldId, newId) {
  if (oldId === newId)
    return log;
  const out = log.map(([k, v, ...implied]) => {
    const [x = "", y = ""] = k.split(SEP);
    if (x !== oldId && y !== oldId)
      return [k, v, ...implied];
    const nx = x === oldId ? newId : x, ny = y === oldId ? newId : y;
    return nx < ny ? [nx + SEP + ny, v, ...implied] : [ny + SEP + nx, orient(v, -1), ...implied];
  });
  log.length = 0;
  log.push(...out);
  if (benched?.delete(oldId))
    benched.add(newId);
  return log;
}
function replay(items, log, priority = []) {
  const answers = new Map(log.map(([k, v]) => [k, v]));
  const settled = (a, b) => {
    const ia = idOf(items[a]), ib = idOf(items[b]);
    const known = answers.get(pairKeyOf(ia, ib));
    if (known !== void 0)
      return orient(known, flipOfIds(ia, ib));
    return tierVerdict(items[a], items[b], priority);
  };
  const order = [];
  for (let n = 0; n < items.length; n++) {
    let [lo, hi] = slotsFor(n, order, settled);
    while (lo < hi) {
      const mid = lo + hi >> 1, v = settled(n, order[mid]);
      if (v === null)
        return { order, unplaced: items.map((_, i) => i).slice(n), next: [n, order[mid]] };
      if (v < 0)
        hi = mid;
      else
        lo = mid + 1;
    }
    order.splice(lo, 0, n);
  }
  return { order, unplaced: [], next: null };
}
function retireLog(items, log, ids, priority = []) {
  if (!ids.length)
    return [...log];
  const before = replay(items, log, priority);
  const pos = new Map(before.order.map((i, n) => [idOf(items[i]), n]));
  const tie = tieClasses(items, log);
  const gone = new Set(ids);
  const rest = items.filter((it) => !gone.has(idOf(it)));
  const out = log.filter(([k]) => !k.split(SEP).some((id) => gone.has(id)));
  let next = replay(rest, out, priority).next;
  while (next) {
    const ia = idOf(rest[next[0]]), ib = idOf(rest[next[1]]);
    const pa = pos.get(ia), pb = pos.get(ib);
    if (pa === void 0 || pb === void 0)
      break;
    const v = tie(ia) === tie(ib) ? 0 : pa < pb ? -1 : 1;
    out.push([pairKeyOf(ia, ib), orient(v, flipOfIds(ia, ib)), true]);
    next = replay(rest, out, priority).next;
  }
  return out;
}

// node_modules/@rascaltwo/pairwise-sorter/dist/analysis.js
function roc(rank, n) {
  let s = 0;
  for (let i = rank; i <= n; i++)
    s += 1 / i;
  return s / n;
}
function weightedOrder(base, items, priority, weights, combine) {
  if (!priority.length || combine !== "weights")
    return [...base];
  const within = new Map(priority.map((t) => [t, []]));
  for (const idx of base)
    for (const t of items[idx].tags)
      within.get(t)?.push(idx);
  const local = /* @__PURE__ */ new Map();
  for (const [t, list] of within)
    list.forEach((idx, i) => local.set(t + SEP + idx, roc(i + 1, list.length)));
  const weightOf = (t) => {
    const w = weights[priority.indexOf(t)] ?? 1;
    return w > 0 ? w : 1;
  };
  const scored = [], untiered = [];
  for (const idx of base) {
    const tags = items[idx].tags.filter((t) => within.has(t));
    if (!tags.length) {
      untiered.push(idx);
      continue;
    }
    scored.push([idx, tags.reduce((s, t) => s + weightOf(t) * local.get(t + SEP + idx), 0)]);
  }
  return scored.map((e, i) => [...e, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((e) => e[0]).concat(untiered);
}
function preferences(log) {
  const pref = /* @__PURE__ */ new Map();
  for (const [k, v] of log) {
    if (v === 0)
      continue;
    const [x, y] = k.split(SEP);
    const key = v < 0 ? x + SEP + y : y + SEP + x;
    pref.set(key, (pref.get(key) ?? 0) + 1);
  }
  return pref;
}
var beats = (pref, items, a, b) => pref.get(idOf(items[a]) + SEP + idOf(items[b])) ?? 0;
function disagreements(order, items, pref) {
  let total = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++)
      total += beats(pref, items, order[j], order[i]);
  return total;
}
function minimiseDisagreements(order, items, pref, maxPasses = 25) {
  let cur = [...order];
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < cur.length; i++) {
      const v = cur[i];
      const rest = cur.slice(0, i).concat(cur.slice(i + 1));
      let cost = rest.reduce((s, r) => s + beats(pref, items, r, v), 0);
      let best = 0, bestCost = cost, stay = cost;
      for (let at = 1; at <= rest.length; at++) {
        const r = rest[at - 1];
        cost += beats(pref, items, v, r) - beats(pref, items, r, v);
        if (at === i)
          stay = cost;
        if (cost < bestCost) {
          bestCost = cost;
          best = at;
        }
      }
      if (stay === bestCost)
        best = i;
      rest.splice(best, 0, v);
      if (best !== i)
        moved = true;
      cur = rest;
    }
    if (!moved)
      break;
  }
  return cur;
}
function tierOverrides(items, log, priority) {
  if (!priority.length)
    return [];
  const byId = new Map(items.map((it) => [idOf(it), it]));
  return log.flatMap(([k, v], n) => {
    const [x = "", y = ""] = k.split(SEP);
    const a = byId.get(x), b = byId.get(y);
    if (!a || !b)
      return [];
    const t = tierVerdict(a, b, priority);
    return t !== null && t !== v ? [n] : [];
  });
}
function tieredBudget(items, live, priority) {
  if (!priority.length)
    return budgetFor(live.length);
  const perTier = /* @__PURE__ */ new Map();
  for (const i of live) {
    const t = tierOf(items[i], priority);
    perTier.set(t, (perTier.get(t) ?? 0) + 1);
  }
  return [...perTier.values()].reduce((sum, n) => sum + budgetFor(n), 0);
}
var STOP_AT = 50;
function placement(partial) {
  const placed = partial.placed.length, total = placed + partial.remaining.length;
  return { placed, total, pct: total ? Math.round(placed / total * 100) : 100 };
}
function rankRows(order, items, log) {
  const cls = tieClasses(items, log);
  const rankById = /* @__PURE__ */ new Map();
  let rank = 0;
  const rows = order.map((index, pos) => {
    const tied = pos > 0 && cls(idOf(items[order[pos - 1]])) === cls(idOf(items[index]));
    if (!tied)
      rank = pos + 1;
    rankById.set(idOf(items[index]), rank);
    return { index, rank, tied };
  });
  return { rows, rankById };
}

// node_modules/@rascaltwo/pairwise-sorter/dist/parse.js
var VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)([?#]|$)/i;
var AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)([?#]|$)/i;
var IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)([?#]|$)/i;
var isVideo = (url) => VIDEO_EXT.test(url);
var isAudio = (url) => AUDIO_EXT.test(url);
var isMedia = (url) => IMAGE_EXT.test(url) || isVideo(url) || isAudio(url);
var tagsOf = (o) => o.tags ?? o.tag ?? o.labels ?? o.categories ?? o.category ?? [];
function fromJSON(o) {
  if (typeof o === "string")
    return item(o);
  if (!o || typeof o !== "object")
    return null;
  const r = o;
  return item(r.title ?? r.name ?? r.label ?? "", r.url ?? r.link ?? r.href ?? "", r.media ?? r.images ?? r.img ?? r.image ?? r.thumbnail ?? [], r.desc ?? r.description ?? r.subtitle ?? "", tagsOf(r), r.key ?? "");
}
var TAG_FIELD = /^#\S/;
function parseLine(line) {
  const md = line.match(/^\[(.+?)\]\((\S+?)\)\s*\|?\s*(.*)$/);
  const src = md ? [md[1], md[2], md[3]].filter(Boolean).join(" | ") : line;
  let url = "";
  const media = [], text = [], tags = [];
  for (const f of src.split("|").map((s) => s.trim()).filter(Boolean)) {
    if (TAG_FIELD.test(f) && f.split(/\s+/).every((t) => t.startsWith("#")))
      tags.push(...f.split(/\s+/));
    else if (!/^https?:\/\//i.test(f))
      text.push(f);
    else if (isMedia(f))
      media.push(f);
    else if (!url)
      url = f;
    else
      media.push(f);
  }
  return item(text[0] || url || media[0] || src, url, media, text.slice(1).join(" \u2014 "), tags);
}
function parseItems(raw) {
  const t = raw.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      let parsed = JSON.parse(t);
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.items))
        parsed = parsed.items;
      return (Array.isArray(parsed) ? parsed : [parsed]).map(fromJSON).filter((x) => !!x);
    } catch {
    }
  }
  return t.split("\n").map((l) => l.trim()).filter(Boolean).map(parseLine);
}
var toText = (list) => list.map((i) => [i.title, i.url, ...i.media, i.tags.map((t) => "#" + t).join(" "), i.desc].filter(Boolean).join(" | ")).join("\n");

// node_modules/@rascaltwo/pairwise-sorter/dist/store.js
var emptyList = (name) => ({ name, items: [], log: [], benched: [], priority: [], weights: [], combine: "order" });
var emptyLibrary = () => ({ version: SCHEMA, current: null, lists: {} });
var lists = (db) => Object.values(db.lists ?? {});
var MIGRATIONS = [
  // 0 → 1: baseline. Data from before versioning predates `tags` on items and
  // `priority`/`weights`/`combine` on lists, in any combination.
  (db) => {
    for (const l of lists(db)) {
      l.items = (Array.isArray(l.items) ? l.items : []).filter((it) => it && typeof it === "object").map((it) => item(it.title ?? "", it.url ?? "", it.media ?? [], it.desc ?? "", it.tags ?? []));
      l.log = Array.isArray(l.log) ? l.log : [];
      l.priority = (Array.isArray(l.priority) ? l.priority : []).filter((t) => typeof t === "string");
      l.weights = l.priority.map((_, i) => Number(l.weights?.[i]) > 0 ? Number(l.weights[i]) : 1);
      l.combine = l.combine === "weights" ? "weights" : "order";
    }
  },
  // 1 → 2: `removed` → `benched`.
  (db) => {
    for (const l of lists(db)) {
      l.benched = (Array.isArray(l.benched) ? l.benched : l.removed ?? []).filter((x) => typeof x === "string");
      delete l.removed;
    }
  }
];
var SCHEMA = MIGRATIONS.length;
function migrate(db) {
  const from = Number.isInteger(db.version) ? db.version : 0;
  if (from > SCHEMA)
    return 0;
  for (let v = from; v < SCHEMA; v++)
    MIGRATIONS[v](db);
  db.version = SCHEMA;
  return SCHEMA - from;
}
function localStore(key = "pairwise-sorter/v4", storage = globalThis.localStorage) {
  return {
    load() {
      let d = null;
      try {
        d = JSON.parse(storage.getItem(key) ?? "null");
      } catch {
      }
      if (!d || !d.lists || typeof d.lists !== "object")
        return emptyLibrary();
      migrate(d);
      return d;
    },
    save(lib) {
      lib.version = Math.max(SCHEMA, Number.isInteger(lib.version) ? lib.version : SCHEMA);
      storage.setItem(key, JSON.stringify(lib));
    }
  };
}
function addList(lib, name) {
  const id = "l" + Math.random().toString(36).slice(2, 9);
  lib.lists[id] = emptyList(name || `List ${Object.keys(lib.lists).length + 1}`);
  lib.current = id;
  return id;
}
function resolveList(lib, ref) {
  if (lib.lists[ref])
    return ref;
  const hits = Object.keys(lib.lists).filter((id) => lib.lists[id].name === ref);
  if (hits.length === 1)
    return hits[0];
  if (!hits.length)
    throw new Error(`no list named ${JSON.stringify(ref)} \u2014 have: ${Object.values(lib.lists).map((l) => l.name).join(", ")}`);
  throw new Error(`${hits.length} lists are named ${JSON.stringify(ref)} \u2014 pass an id instead: ${hits.join(", ")}`);
}
function deleteList(lib, id) {
  delete lib.lists[id];
  if (lib.current === id)
    lib.current = Object.keys(lib.lists)[0] ?? null;
}
function exportList(list, ranking = []) {
  const byId = new Map(list.items.map((it) => [idOf(it), it]));
  const ref = (id) => {
    const it = byId.get(id);
    return it ? { title: it.title, url: it.url, ...it.key ? { key: it.key } : {} } : idParts(id);
  };
  return {
    format: "pairwise-sorter/3",
    name: list.name,
    items: list.items,
    priority: list.priority,
    weights: list.weights,
    combine: list.combine,
    benched: list.benched.map(ref),
    comparisons: list.log.map(([k, verdict, implied]) => {
      const [a = "", b = ""] = k.split(SEP);
      return { a: ref(a), b: ref(b), verdict, ...implied ? { implied } : {} };
    }),
    ranking
  };
}
function importList(data) {
  if (!data || typeof data !== "object")
    throw new Error("not a JSON object");
  const d = data;
  const source = Array.isArray(d) ? d : d.items;
  if (!Array.isArray(source))
    throw new Error("no `items` array");
  const items = [...new Map(source.map(fromJSON).filter((x) => !!x).map((i) => [idOf(i), i])).values()];
  if (items.length < 2)
    throw new Error("needs at least 2 distinct items");
  const kept = new Set(items.map(idOf));
  let skipped = 0;
  const log = [];
  for (const c of Array.isArray(d.comparisons) ? d.comparisons : []) {
    const x = idOf(c?.a), y = idOf(c?.b);
    if (x === y || !kept.has(x) || !kept.has(y)) {
      skipped++;
      continue;
    }
    const v = c.verdict > 0 ? 1 : c.verdict < 0 ? -1 : 0;
    const implied = c.implied === true ? [true] : [];
    log.push(x < y ? [x + SEP + y, v, ...implied] : [y + SEP + x, orient(v, -1), ...implied]);
  }
  const benched = [d.benched, d.removed].flatMap((a) => Array.isArray(a) ? a : []).map(idOf).filter((id) => kept.has(id));
  const tagged = new Set(items.flatMap((i) => i.tags));
  const priority = [], weights = [];
  (Array.isArray(d.priority) ? d.priority : []).forEach((t, i) => {
    const obj = typeof t === "object" && t !== null ? t : null;
    const tag = typeof t === "string" ? tagOf(t) : tagOf(obj?.tag ?? "");
    if (!tagged.has(tag) || priority.includes(tag))
      return;
    priority.push(tag);
    const w = Number(obj ? obj.weight : d.weights?.[i]);
    weights.push(w > 0 ? w : 1);
  });
  const list = {
    name: d.name || "Imported",
    items,
    log,
    benched,
    priority,
    weights,
    combine: d.combine === "weights" ? "weights" : "order"
  };
  return { list, count: items.length, kept: log.length, skipped };
}

// node_modules/@rascaltwo/pairwise-sorter/dist/sorter.js
var VERDICTS = /* @__PURE__ */ new Set([-1, 0, 1]);
var Sorter = class extends EventTarget {
  /** The open list. Mutated in place; save it on `change`. */
  list;
  /** The pair waiting for an answer, or null. */
  question = null;
  #token = 0;
  #pending = null;
  #answers = /* @__PURE__ */ new Map();
  #order = [];
  #partial = { placed: [], remaining: [] };
  #conflicts = /* @__PURE__ */ new Map();
  #finished = false;
  #quiet = false;
  #waiters = [];
  constructor(list = emptyList("Untitled")) {
    super();
    this.open(list);
  }
  /** Switch to a list, abandoning any sort in progress. Malformed saved answers are dropped. */
  open(list) {
    list.log = (Array.isArray(list.log) ? list.log : []).filter((e) => Array.isArray(e) && (e.length === 2 || e.length === 3 && e[2] === true) && typeof e[0] === "string" && e[0].includes(SEP) && VERDICTS.has(e[1]));
    this.list = list;
    this.#run();
  }
  /** Resolves once the sorter is waiting on a question or has finished. */
  settled() {
    return new Promise((r) => this.#quiet ? r() : this.#waiters.push(r));
  }
  /** True once a full ranking exists and nothing is being asked. */
  get complete() {
    return this.#finished;
  }
  /** Answer the open question: -1 left wins, 1 right wins, 0 equal. Resolves when settled. */
  answer(v) {
    const p = this.#pending;
    if (!p)
      throw new Error("nothing is being asked right now");
    this.#pending = null;
    this.question = null;
    this.#quiet = false;
    p(v);
    return this.settled();
  }
  /** Drop the most recent answer; its question comes back. */
  undo() {
    if (this.list.log.length)
      this.#change(() => this.list.log.pop());
    return this.settled();
  }
  /** Forget one answer by its index in {@link comparisons}. */
  deleteAnswer(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.list.log.length)
      throw new Error(`no comparison at index ${i}`);
    return this.#change(() => this.list.log.splice(i, 1));
  }
  /** Clear every answer. Items and the bench are untouched. */
  resetAnswers() {
    return this.#change(() => {
      this.list.log = [];
    });
  }
  /** Take items out of the ranking. Their answers are kept. */
  bench(ids) {
    return this.#change(() => {
      this.list.benched = [.../* @__PURE__ */ new Set([...this.list.benched, ...ids])];
    });
  }
  /** Put a benched item back; its kept answers restore its place. */
  subIn(id) {
    if (!this.list.benched.includes(id))
      throw new Error("that item is not benched");
    return this.#change(() => {
      this.list.benched = this.list.benched.filter((b) => b !== id);
    });
  }
  subAll() {
    return this.#change(() => {
      this.list.benched = [];
    });
  }
  /**
   * Remove items for good — finished work, say — WITHOUT re-asking anything. An item that others
   * were compared against instead of each other takes those links with it, so replaying would
   * need new questions; but the order before the removal already settles every pair among the
   * items it had placed. Those questions are answered from it and logged as implied (ties stay
   * ties). Items it had not placed yet are still asked about for real.
   */
  retire(ids) {
    const l = this.list, have = new Set(l.items.map(idOf));
    const missing = ids.find((id) => !have.has(id));
    if (missing !== void 0)
      throw new Error(`no item with id ${missing}`);
    const gone = new Set(ids);
    return this.#change(() => {
      l.log = retireLog(this.live().map((i) => l.items[i]), l.log, ids, l.priority);
      l.items = l.items.filter((it) => !gone.has(idOf(it)));
      l.log = l.log.filter(([k]) => !k.split(SEP).some((id) => gone.has(id)));
      l.benched = l.benched.filter((id) => !gone.has(id));
      this.#pruneTiers();
    });
  }
  /** Benched items that still exist. */
  benchedItems() {
    const byId = new Map(this.list.items.map((it) => [idOf(it), it]));
    return this.list.benched.flatMap((id) => byId.get(id) ?? []);
  }
  /**
   * Replace the items. Survivors keep their EXISTING order and new items append — that
   * append-stability is what lets every earlier answer replay, so adding one item costs
   * ~log2 n questions. Only deleted items lose their answers.
   */
  setItems(next) {
    const byId = /* @__PURE__ */ new Map(), dupes = [];
    for (const it of next) {
      const id = idOf(it);
      if (byId.has(id))
        dupes.push(it.title);
      else
        byId.set(id, it);
    }
    if (byId.size < 2)
      throw new Error("need at least 2 distinct items");
    const l = this.list;
    const old = new Set(l.items.map(idOf));
    const before = l.log.length;
    this.#change(() => {
      l.items = l.items.filter((it) => byId.has(idOf(it))).map((it) => byId.get(idOf(it))).concat([...byId.values()].filter((it) => !old.has(idOf(it))));
      const kept = new Set(l.items.map(idOf));
      l.log = l.log.filter(([k]) => k.split(SEP).every((id) => kept.has(id)));
      l.benched = l.benched.filter((id) => kept.has(id));
      this.#pruneTiers();
    });
    return { dupes: [...new Set(dupes)], dropped: before - l.log.length };
  }
  /**
   * Change an item's fields. A rename CARRIES its answers across (see `migrateId`); a rename
   * onto another existing item would merge two histories, so it is refused.
   */
  editItem(index, patch) {
    const l = this.list, cur = l.items[index];
    if (!cur)
      throw new Error(`no item at index ${index}`);
    const next = item(String(patch.title ?? cur.title).trim(), patch.url ?? cur.url, patch.media ?? cur.media, patch.desc ?? cur.desc, patch.tags ?? cur.tags, cur.key);
    if (!next.title)
      throw new Error("a title is required");
    const oldId = idOf(cur), newId = idOf(next);
    if (oldId !== newId && l.items.some((o, j) => j !== index && idOf(o) === newId))
      throw new Error("another item already has that title and link");
    return this.#change(() => {
      const benched = new Set(l.benched);
      migrateId(l.log, benched, oldId, newId);
      l.benched = [...benched];
      l.items[index] = next;
      this.#pruneTiers();
    });
  }
  /** Every tag on any item, sorted. */
  tags() {
    return [...new Set(this.list.items.flatMap((it) => it.tags))].sort();
  }
  /**
   * Set the tiers, best first — tags or `{tag, weight}`. Cross-tier pairs are then answered from
   * this order instead of being asked. `[]` turns tiers off.
   */
  setPriority(tiers) {
    const seen = /* @__PURE__ */ new Map();
    for (const e of tiers) {
      const tag = tagOf(typeof e === "string" ? e : e.tag ?? e.name ?? "");
      const w = typeof e === "object" ? Number(e.weight) : 1;
      if (tag && !seen.has(tag))
        seen.set(tag, w > 0 ? w : 1);
    }
    const known = new Set(this.tags());
    const unknown = [...seen.keys()].filter((t) => !known.has(t));
    if (unknown.length)
      throw new Error(`no item carries ${unknown.map((t) => "#" + t).join(", ")} \u2014 have: ${[...known].join(", ") || "none"}`);
    return this.#change(() => {
      this.list.priority = [...seen.keys()];
      this.list.weights = [...seen.values()];
    });
  }
  /** "order": a higher tier wins outright · "weights": tiers contribute in proportion. */
  setCombine(mode) {
    if (mode !== "order" && mode !== "weights")
      throw new Error("combine expects 'order' or 'weights'");
    return this.#change(() => {
      this.list.combine = mode;
    });
  }
  /** Your answers that go against the tier order. Yours win until dropped. */
  overrides() {
    const all = this.comparisons();
    return tierOverrides(this.list.items, this.list.log, this.list.priority).map((n) => all[n]);
  }
  /** Forget the answers that go against the tiers, letting the tiers decide those pairs. */
  dropOverrides() {
    const drop = new Set(tierOverrides(this.list.items, this.list.log, this.list.priority));
    return this.#change(() => {
      this.list.log = this.list.log.filter((_, n) => !drop.has(n));
    });
  }
  /** Indices of items in the ranking (not benched). */
  live() {
    const benched = new Set(this.list.benched);
    return this.list.items.map((_, i) => i).filter((i) => !benched.has(idOf(this.list.items[i])));
  }
  /** Worst-case questions for the whole sort, honest about tiers. */
  budget() {
    return tieredBudget(this.list.items, this.live(), this.list.priority);
  }
  /** How much of the ranking is already final. */
  placement() {
    return placement(this.#partial);
  }
  /** The ranking with shared ranks for ties — final once {@link complete}, else the placed part. */
  ranking() {
    const src = this.#finished ? this.#order : this.#partial.placed;
    return rankRows(src, this.list.items, this.list.log).rows.map((r) => ({ ...r, item: this.list.items[r.index] }));
  }
  /** Items with no position yet while a sort is running — empty once complete. */
  unplaced() {
    return this.#partial.remaining.map((i) => this.list.items[i]);
  }
  /** Every answer given, as readable pairs; `why` is set when the ranking contradicts it. */
  comparisons() {
    const byId = new Map(this.list.items.map((it) => [idOf(it), it]));
    const ref = (id) => {
      const it = byId.get(id);
      return it ? { title: it.title, url: it.url } : idParts(id);
    };
    return this.list.log.map(([k, verdict, implied], index) => {
      const [x = "", y = ""] = k.split(SEP);
      return { index, a: ref(x), b: ref(y), verdict, implied: implied === true, why: this.#conflicts.get(index) ?? null };
    });
  }
  /**
   * Reorder to contradict as few answers as possible (best-effort local search, not a proof
   * of the minimum). Lasts until the next change re-runs the sort.
   */
  resolve() {
    const { items } = this.list, pref = preferences(this.list.log);
    const before = disagreements(this.#order, items, pref);
    const next = minimiseDisagreements(this.#order, items, pref);
    const after = disagreements(next, items, pref);
    if (after >= before)
      return { before, after: before };
    this.#order = next;
    this.#conflicts = findConflicts(this.list.log, rankRows(next, items, this.list.log).rankById);
    this.#emit("done");
    return { before, after };
  }
  #change(mutate) {
    mutate();
    this.#run();
    this.#emit("change");
    return this.settled();
  }
  #pruneTiers() {
    const l = this.list, tagged = new Set(l.items.flatMap((it) => it.tags));
    l.weights = l.priority.map((t, i) => [t, l.weights[i] ?? 1]).filter(([t]) => tagged.has(t)).map(([, w]) => w);
    l.priority = l.priority.filter((t) => tagged.has(t));
  }
  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  #settle() {
    this.#quiet = true;
    for (const w of this.#waiters.splice(0))
      w();
  }
  async #run() {
    const my = ++this.#token;
    this.#pending = null;
    this.question = null;
    this.#quiet = false;
    this.#finished = false;
    this.#order = [];
    this.#partial = { placed: [], remaining: [] };
    this.#conflicts = /* @__PURE__ */ new Map();
    this.#answers = new Map(this.list.log.map(([k, v]) => [k, v]));
    await null;
    if (my !== this.#token)
      return;
    const { items } = this.list;
    const sorted = await sortIndices(this.live(), (a, b) => this.#cmp(a, b, my), ({ placed, remaining, next }) => {
      this.#partial = { placed, remaining };
      if (next !== void 0)
        this.#emit("upcoming", [next]);
    }, ({ out, lo, hi, mid }) => this.#emit("upcoming", [out[lo + mid >> 1], out[mid + 1 + hi >> 1]].filter((i) => i !== void 0)), (a, b) => this.#known(a, b));
    this.#order = weightedOrder(sorted, items, this.list.priority, this.list.weights, this.list.combine);
    this.#partial = { placed: [...sorted], remaining: [] };
    this.#conflicts = findConflicts(this.list.log, rankRows(this.#order, items, this.list.log).rankById);
    this.#finished = true;
    this.#emit("done");
    this.#settle();
  }
  /** A pair's answer without asking anyone, or null. Also what narrows the search (`slotsFor`). */
  #known(a, b) {
    const { items } = this.list;
    const ia = idOf(items[a]), ib = idOf(items[b]);
    const known = this.#answers.get(pairKeyOf(ia, ib));
    if (known !== void 0)
      return orient(known, flipOfIds(ia, ib));
    return tierVerdict(items[a], items[b], this.list.priority);
  }
  #cmp(a, b, my) {
    const settled = this.#known(a, b);
    if (settled !== null)
      return settled;
    const { items } = this.list;
    const ia = idOf(items[a]), ib = idOf(items[b]);
    const k = pairKeyOf(ia, ib), flip = flipOfIds(ia, ib);
    return new Promise((resolve) => {
      this.#pending = (v) => {
        const stored = orient(v, flip);
        this.#answers.set(k, stored);
        this.list.log.push([k, stored]);
        this.#emit("change");
        resolve(v);
      };
      this.question = { a, b };
      this.#emit("question", this.question);
      this.#settle();
    });
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/base.js
var theme = new CSSStyleSheet();
theme.replaceSync(`
  :host {
    --pw-bg: #0f1420; --pw-panel: #171e2e; --pw-text: #e6eaf2; --pw-muted: #8a95a8;
    --pw-border: #2a3448; --pw-accent: #6aa8ff; --pw-warn: #e0b04a; --pw-danger: #e06a6a;
    --pw-radius: 8px;
    display: block; color: var(--pw-text); font: inherit;
  }
  :host([hidden]) { display: none; }
  [hidden] { display: none !important; }
  button { background: var(--pw-panel); color: var(--pw-text); border: 1px solid var(--pw-border);
           border-radius: var(--pw-radius); padding: 6px 12px; font: inherit; font-size: 14px; cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--pw-accent); }
  button:disabled { opacity: .4; cursor: default; }
  button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--pw-accent); outline-offset: 2px; }
  input, select, textarea { background: var(--pw-panel); color: var(--pw-text); border: 1px solid var(--pw-border);
           border-radius: var(--pw-radius); padding: 6px 9px; font: inherit; font-size: 14px; }
  a { color: var(--pw-accent); }
  .muted { color: var(--pw-muted); font-size: 13px; }
  .tag { display: inline-flex; gap: 4px; padding: 1px 8px; border: 1px solid var(--pw-border); border-radius: 999px;
         font-size: 12px; color: var(--pw-muted); background: var(--pw-panel); white-space: nowrap; }
  .tag.on { border-color: var(--pw-accent); color: var(--pw-accent); }
  .banner { background: var(--pw-panel); border: 1px solid var(--pw-warn); border-left-width: 3px;
            border-radius: var(--pw-radius); padding: 10px 14px; font-size: 13px; margin: 8px 0; }
  .banner.info { border-color: var(--pw-accent); }
  .banner button { padding: 3px 10px; font-size: 12px; margin-left: 10px; }
`);
var esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
var PairwiseElement = class extends HTMLElement {
  root = this.attachShadow({ mode: "open" });
  #sorter = null;
  #listening = null;
  constructor() {
    super();
    this.root.adoptedStyleSheets = [theme, ...this.styles()];
  }
  /** The Sorter this element shows and drives. Several elements may share one. */
  get sorter() {
    return this.#sorter;
  }
  set sorter(s) {
    this.#listening?.abort();
    this.#sorter = s;
    if (s) {
      this.#listening = new AbortController();
      const signal = this.#listening.signal;
      for (const type of ["question", "change", "done"])
        s.addEventListener(type, () => this.render(), { signal });
      this.listen(s, signal);
    }
    this.render();
  }
  connectedCallback() {
    this.render();
  }
  /** Subscribe to further sorter events; removed automatically when the sorter changes. */
  listen(_s, _signal) {
  }
  /** Fire a composed event a host can listen for on this element. */
  fire(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
};
var css = (text) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  return sheet;
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/app.js
var style = css(`
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between; margin: 16px 0; }
  .row > span { display: flex; gap: 10px; flex-wrap: wrap; }
  pairwise-lists { margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--pw-border); }
  pairwise-progress { margin-top: 24px; }
  details { margin: 12px 0; }
  summary { cursor: pointer; color: var(--pw-muted); font-size: 13px; }
  .tabs button.on { border-color: var(--pw-accent); }
  .search { display: flex; gap: 10px; align-items: center; margin: 8px 0; }
  .search input { flex: 1; max-width: 340px; }
`);
var PairwiseSorter = class extends PairwiseElement {
  #library = emptyLibrary();
  #store = null;
  #view = "sort";
  #paused = false;
  #tab = "ranking";
  #note = "";
  #query = "";
  #started = false;
  constructor() {
    super();
    this.root.innerHTML = `
      <pairwise-lists></pairwise-lists>
      <section part="setup"><pairwise-io></pairwise-io></section>
      <section part="import"><pairwise-io view="import"></pairwise-io></section>
      <section part="compare"><pairwise-compare></pairwise-compare><pairwise-progress></pairwise-progress></section>
      <section part="done">
        <div class="row"><strong part="heading"></strong>
          <span class="tabs"><button part="tab-ranking"></button><button part="tab-comparisons"></button></span></div>
        <p part="conflict-banner" class="banner"><span></span><button part="show-conflicts">Show them</button>
          <button part="resolve" title="Reorder to contradict as few of your answers as possible">Resolve</button></p>
        <p part="resolve-note" class="banner info" hidden></p>
        <details part="tiers-panel"><summary>Tiers and weights</summary><pairwise-tiers></pairwise-tiers><pairwise-weights></pairwise-weights></details>
        <div class="search"><input part="search" type="search" placeholder="Filter by title\u2026" aria-label="Filter by title">
          <button part="clear-search" hidden>Clear</button></div>
        <pairwise-ranking no-search></pairwise-ranking><pairwise-conflicts></pairwise-conflicts>
      </section>
      <div class="row" part="controls">
        <span><button part="undo">\u21A9 Undo</button><button part="resume">\u21A9 Resume sorting</button></span>
        <span><button part="pause">See list so far</button><button part="export">Export JSON</button>
          <button part="edit-list">Edit list</button><button part="reset">Reset answers</button></span>
      </div>
      <details part="bench-panel"><summary>Bench</summary><pairwise-bench></pairwise-bench></details>
      <pairwise-editor></pairwise-editor>`;
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    const on = (type, f) => this.root.addEventListener(type, (e) => {
      e.stopPropagation();
      f(e.detail);
    });
    $("undo").onclick = () => this.sorter.undo();
    $("reset").onclick = () => this.sorter.resetAnswers();
    $("edit-list").onclick = () => this.goto("setup");
    $("pause").onclick = () => this.pause();
    $("resume").onclick = () => this.resume();
    $("export").onclick = () => this.#copy();
    $("tab-ranking").onclick = () => this.tab("ranking");
    $("tab-comparisons").onclick = () => this.tab("comparisons");
    $("show-conflicts").onclick = () => this.tab("comparisons");
    $("resolve").onclick = () => {
      this.#note = this.#child("pairwise-conflicts").resolve();
      this.render();
    };
    $("search").oninput = () => this.search($("search").value);
    $("clear-search").onclick = () => this.search("");
    on("pairwise-search", (d) => this.search(d.query));
    on("pairwise-benched", () => {
      if (this.screen === "done")
        this.#paused = true;
      this.render();
    });
    on("pairwise-edit", (d) => this.root.querySelector("pairwise-editor").edit(d.index));
    on("pairwise-stop", () => this.pause());
    on("pairwise-list-open", (d) => this.openList(d.id));
    on("pairwise-list-new", () => this.newList());
    on("pairwise-list-rename", (d) => this.renameList(d.name));
    on("pairwise-list-delete", () => this.deleteList(this.#library.current));
    on("pairwise-import", () => this.goto("import"));
    on("pairwise-imported", (d) => this.addList(d.list));
    on("pairwise-cancel", () => this.goto("compare"));
    on("pairwise-saved", () => {
      this.#view = "sort";
      this.#paused = false;
      this.render();
    });
    this.sorter = new Sorter();
    this.sorter.addEventListener("change", () => {
      this.#note = "";
      this.#save();
    });
    this.sorter.addEventListener("done", () => {
      this.#paused = false;
      this.render();
    });
  }
  styles() {
    return [style];
  }
  connectedCallback() {
    if (!this.#started) {
      this.#started = true;
      const key = this.getAttribute("storage-key");
      if (key)
        this.#store = localStore(key);
      this.library = this.#store?.load() ?? this.#library;
    }
    super.connectedCallback();
  }
  /** Every list. Setting it opens its current list (or a new one); the host keeps ownership. */
  get library() {
    return this.#library;
  }
  set library(lib) {
    this.#library = lib;
    const id = lib.current && lib.lists[lib.current] ? lib.current : Object.keys(lib.lists)[0];
    if (id)
      this.openList(id);
    else
      this.newList();
  }
  /** What is on screen. */
  get screen() {
    const s = this.sorter;
    if (this.#view !== "sort")
      return this.#view;
    if (s.live().length < 2)
      return "setup";
    return s.question && !this.#paused ? "compare" : "done";
  }
  get paused() {
    return this.#paused && !!this.sorter.question;
  }
  /** The title filter across the ranking, the answers, the bench and the items text. Display only. */
  get query() {
    return this.#query;
  }
  search(query) {
    this.#query = query;
    this.root.querySelector("[part=search]").value = query;
    for (const el of this.root.querySelectorAll("pairwise-ranking, pairwise-conflicts, pairwise-bench, pairwise-io"))
      el.query = query;
    this.render();
  }
  openList(id) {
    this.#library.current = id;
    this.#view = "sort";
    this.#paused = false;
    this.sorter.open(this.#library.lists[id]);
    this.root.querySelector("pairwise-io").reset();
    this.search("");
    this.#save();
  }
  newList(name) {
    const id = addList(this.#library, name);
    this.openList(id);
    return id;
  }
  /** Add an existing list (an import, say) and open it. */
  addList(list) {
    const id = this.newList();
    this.#library.lists[id] = list;
    this.openList(id);
    return id;
  }
  renameList(name) {
    this.sorter.list.name = name;
    this.#save();
  }
  deleteList(id) {
    deleteList(this.#library, id);
    this.library = this.#library;
  }
  goto(screen) {
    this.#view = screen === "setup" || screen === "import" ? screen : "sort";
    this.#paused = screen === "done";
    if (screen === "setup")
      this.root.querySelector("pairwise-io").reset();
    this.render();
  }
  /** Leave the question to see the ranking so far. False when nothing is being asked. */
  pause() {
    if (!this.sorter.question)
      return false;
    this.goto("done");
    return true;
  }
  resume() {
    if (!this.paused)
      return false;
    this.goto("compare");
    return true;
  }
  tab(which) {
    this.#tab = which;
    this.render();
  }
  /** The open list as a readable export. */
  exportJSON() {
    return exportList(this.sorter.list, this.sorter.ranking().map((r) => r.item.title));
  }
  render() {
    const s = this.sorter, lists2 = this.root.querySelector("pairwise-lists");
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    const screen = this.screen, cmp = this.#tab === "comparisons";
    for (const el of this.root.querySelectorAll("pairwise-io, pairwise-compare, pairwise-progress, pairwise-tiers, pairwise-weights, pairwise-ranking, pairwise-conflicts, pairwise-bench, pairwise-editor"))
      if (el.sorter !== s)
        el.sorter = s;
    lists2.library = this.#library;
    for (const part of ["setup", "import", "compare", "done"])
      $(part).hidden = part !== screen;
    $("controls").hidden = screen === "setup" || screen === "import";
    $("pause").hidden = screen !== "compare";
    $("resume").hidden = !this.paused;
    $("export").hidden = screen !== "done";
    $("heading").textContent = cmp ? "Comparisons you made" : "Sorted \u2014 best first";
    $("tab-ranking").textContent = `${s.ranking().length} items`;
    $("tab-comparisons").textContent = `${s.list.log.length} comparisons`;
    $("tab-ranking").classList.toggle("on", !cmp);
    $("tab-comparisons").classList.toggle("on", cmp);
    this.root.querySelector("pairwise-ranking").hidden = cmp;
    this.root.querySelector("pairwise-conflicts").hidden = !cmp;
    $("tiers-panel").hidden = !s.tags().length;
    const bad = s.comparisons().filter((c) => c.why).length;
    $("conflict-banner").hidden = cmp || !s.complete || !bad;
    $("conflict-banner").querySelector("span").textContent = `\u26A0 ${bad} answer${bad === 1 ? " contradicts" : "s contradict"} the ranking \u2014 your choices can't all be true at once.`;
    $("resolve-note").hidden = cmp || !this.#note;
    $("resolve-note").textContent = this.#note;
    $("clear-search").hidden = !this.#query;
    $("bench-panel").hidden = !s.list.benched.length;
  }
  #child(tag) {
    return this.root.querySelector(tag);
  }
  #save() {
    this.#store?.save(this.#library);
    this.fire("pairwise-change", { library: this.#library });
    this.render();
  }
  async #copy() {
    const text = JSON.stringify(this.exportJSON(), null, 2), btn = this.root.querySelector("[part=export]");
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
      setTimeout(() => btn.textContent = "Export JSON", 1200);
    } catch {
      this.goto("import");
      this.root.querySelector("pairwise-io[view=import]").show(text, "Copy failed \u2014 the export is in the box below; select it and copy.");
    }
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/bench.js
var style2 = css(`
  ul { list-style: none; padding: 0; margin: 10px 0 0; }
  li { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--pw-border); }
  li [part=name] { flex: 1; color: var(--pw-muted); overflow-wrap: anywhere; }
  li button { padding: 3px 10px; font-size: 12px; }
`);
var PairwiseBench = class extends PairwiseElement {
  #query = "";
  /** Show only benched items whose title contains this. Display only. */
  get query() {
    return this.#query;
  }
  set query(q) {
    this.#query = q;
    this.render();
  }
  constructor() {
    super();
    this.root.innerHTML = `
      <div class="muted">Benched \u2014 <span part="count">0</span>
        <button part="sub-all">Sub all in</button></div>
      <ul part="list"></ul>`;
    this.root.querySelector("[part=sub-all]").onclick = () => this.sorter.subAll();
    this.root.querySelector("[part=list]").onclick = (e) => {
      const d = e.target.closest("button")?.dataset;
      if (!d)
        return;
      const s = this.sorter, i = Number(d.i);
      if (d.edit)
        this.fire("pairwise-edit", { index: i });
      else
        s.subIn(idOf(s.list.items[i]));
    };
  }
  styles() {
    return [style2];
  }
  render() {
    const s = this.sorter, benched = s?.benchedItems() ?? [];
    this.root.querySelector("[part=count]").textContent = String(benched.length);
    this.root.querySelector("[part=list]").innerHTML = benched.map((it) => {
      const i = s.list.items.indexOf(it), name = esc(it.title);
      const q = this.#query.trim().toLowerCase();
      return `<li part="benched" ${!q || it.title.toLowerCase().includes(q) ? "" : "hidden"}><span part="name">${name}</span>
        <button part="edit" data-i="${i}" data-edit="1" aria-label="Edit ${name}">\u270E</button>
        <button part="sub-in" data-i="${i}">Sub in</button></li>`;
    }).join("");
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/media.js
var mediaStyle = css(`
  img, video { max-width: 100%; border-radius: 6px; object-fit: contain; }
  img { cursor: zoom-in; }
  audio { width: 100%; }
  .lightbox { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
              background: rgba(0,0,0,.88); padding: 64px; }
  .lightbox[hidden] { display: none; }
  .lightbox img { width: 100%; height: 100%; object-fit: contain; cursor: default; }
  .lightbox .close { position: absolute; top: 18px; right: 22px; }
  .lightbox .nav { position: absolute; top: 50%; transform: translateY(-50%); width: 46px; height: 72px; font-size: 22px; }
  .lightbox .prev { left: 14px; }
  .lightbox .next { right: 14px; }
  .lightbox .count { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); color: var(--pw-muted); font-size: 13px; }
`);
var mediaHTML = (m) => isVideo(m) ? `<video src="${esc(m)}" controls loop muted playsinline preload="metadata"></video>` : isAudio(m) ? `<audio src="${esc(m)}" controls preload="metadata"></audio>` : `<img src="${esc(m)}" alt="">`;
var imagesOf = (it) => it.media.filter((m) => !isVideo(m) && !isAudio(m));
var tagChip = (t, priority) => {
  const tier = priority.indexOf(t);
  return tier >= 0 ? `<span class="tag on" title="Tier ${tier + 1}"><b>${tier + 1}</b>#${esc(t)}</span>` : `<span class="tag">#${esc(t)}</span>`;
};
var preloaded = /* @__PURE__ */ new Set();
function preload(items, idxs) {
  for (const i of idxs)
    for (const m of imagesOf(items[i])) {
      if (preloaded.has(m))
        continue;
      preloaded.add(m);
      new Image().src = m;
    }
}
var Lightbox = class {
  static html = `<div part="lightbox" class="lightbox" hidden tabindex="-1" role="dialog" aria-modal="true" aria-label="Enlarged image">
    <button class="close" aria-label="Close enlarged image">\u2715</button>
    <button class="nav prev" data-step="-1" aria-label="Previous image">\u2039</button>
    <img alt="">
    <button class="nav next" data-step="1" aria-label="Next image">\u203A</button>
    <span class="count"></span></div>`;
  el;
  #pool = [];
  #at = 0;
  constructor(root) {
    this.el = root.querySelector("[part=lightbox]");
    this.el.onclick = (e) => {
      const t = e.target;
      if (t === this.el || t.matches(".close"))
        this.close();
      else if (t.dataset.step)
        this.step(Number(t.dataset.step));
    };
    this.el.onkeydown = (e) => this.key(e);
  }
  get isOpen() {
    return !this.el.hidden;
  }
  show(src, pool) {
    this.#pool = pool.length ? pool : [src];
    this.#at = Math.max(0, this.#pool.indexOf(src));
    this.el.hidden = false;
    this.#draw();
    this.el.querySelector(".close").focus();
  }
  close() {
    this.el.hidden = true;
    this.el.querySelector("img").removeAttribute("src");
  }
  step(d) {
    if (this.#pool.length < 2)
      return;
    this.#at = (this.#at + d + this.#pool.length) % this.#pool.length;
    this.#draw();
  }
  key(e) {
    const act = { Escape: () => this.close(), ArrowLeft: () => this.step(-1), ArrowRight: () => this.step(1) }[e.key];
    if (act) {
      e.preventDefault();
      act();
    }
  }
  #draw() {
    const many = this.#pool.length > 1;
    this.el.querySelector("img").src = this.#pool[this.#at];
    this.el.querySelector(".count").textContent = many ? `${this.#at + 1} / ${this.#pool.length}` : "";
    for (const b of this.el.querySelectorAll("[data-step]"))
      b.hidden = !many;
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/compare.js
var PER_PAGE = 4;
var SIDES = ["a", "b"];
var style3 = css(`
  /* minmax(0, \u2026): a 1fr track never shrinks below its longest word, so one long URL a host draws
     would take the other card's width. */
  .duel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
  .card { position: relative; background: var(--pw-panel); border: 2px solid var(--pw-border); border-radius: 12px;
          padding: 48px 24px 24px; min-height: 180px; display: flex; flex-direction: column; align-items: center;
          gap: 14px; text-align: center; overflow-wrap: anywhere; }
  .card:has(.choose:hover) { border-color: var(--pw-accent); }
  .body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; width: 100%; }
  .title { font-size: 20px; line-height: 1.4; }
  .desc { font-size: 13px; color: var(--pw-muted); }
  .media { display: grid; gap: 8px; width: 100%; justify-items: center; align-items: center; }
  .media.many { grid-template-columns: 1fr 1fr; }
  .media img, .media video { max-height: min(340px, 34vh); }
  .media.many img, .media.many video { max-height: min(150px, 18vh); }
  .pages { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 12px; color: var(--pw-muted); }
  .pages button { padding: 1px 9px; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .choose { width: 100%; font-weight: 600; }
  .act { position: absolute; top: 10px; width: 30px; height: 30px; padding: 0; display: inline-flex; align-items: center;
         justify-content: center; color: var(--pw-muted); text-decoration: none; opacity: .5;
         border: 1px solid var(--pw-border); border-radius: var(--pw-radius); }
  .card:hover .act, .act:focus-visible { opacity: 1; }
  .act.open { left: 10px; }
  .act.edit { right: 46px; }
  .act.bench { right: 10px; }
  .act.bench:hover { color: var(--pw-danger); border-color: var(--pw-danger); }
  .equal { display: flex; justify-content: center; margin-top: 16px; }
`);
var PairwiseCompare = class extends PairwiseElement {
  /** Draw an item into its card instead of the default title, media, description and tags. */
  renderItem;
  #pages = { a: 0, b: 0 };
  #asked = "";
  #lightbox;
  constructor() {
    super();
    this.root.innerHTML = `
      <p part="idle" class="muted">Nothing to compare right now.</p>
      <div part="duel" class="duel"></div>
      <div class="equal"><button part="equal">Equal <span class="muted">(\u2193 or =)</span></button></div>
      ${Lightbox.html}`;
    this.#lightbox = new Lightbox(this.root);
    this.root.querySelector("[part=equal]").onclick = () => this.sorter?.answer(0);
    this.root.querySelector("[part=duel]").onclick = (e) => this.#click(e);
  }
  styles() {
    return [mediaStyle, style3];
  }
  listen(s, signal) {
    s.addEventListener("upcoming", (e) => preload(s.list.items, e.detail), { signal });
  }
  connectedCallback() {
    super.connectedCallback();
    addEventListener("keydown", this.#keys);
  }
  disconnectedCallback() {
    removeEventListener("keydown", this.#keys);
  }
  render() {
    const q = this.sorter?.question;
    this.root.querySelector("[part=idle]").hidden = !!q;
    this.root.querySelector(".equal").hidden = !q;
    const duel = this.root.querySelector("[part=duel]");
    if (!q) {
      duel.innerHTML = "";
      return;
    }
    const asked = `${q.a},${q.b}`;
    if (asked !== this.#asked)
      this.#pages = { a: 0, b: 0 };
    this.#asked = asked;
    duel.innerHTML = SIDES.map((side) => this.#card(side, q[side])).join("");
    if (this.renderItem)
      for (const side of SIDES)
        this.renderItem(this.#item(side), duel.querySelector(`[part~=body-${side}]`));
  }
  #item(side) {
    const s = this.sorter;
    return s.list.items[s.question[side]];
  }
  #card(side, index) {
    const s = this.sorter, it = s.list.items[index];
    const pages = Math.max(1, Math.ceil(it.media.length / PER_PAGE));
    const page = (this.#pages[side] % pages + pages) % pages;
    const shown = it.media.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    const body = this.renderItem ? "" : [
      shown.length ? `<div class="media${shown.length > 1 ? " many" : ""}">${shown.map(mediaHTML).join("")}</div>` : "",
      pages > 1 ? `<div part="pages" class="pages"><button data-side="${side}" data-step="-1" aria-label="Previous media">\u2039</button>
        <span>${page + 1} / ${pages}</span><button data-side="${side}" data-step="1" aria-label="More media">\u203A</button></div>` : "",
      `<div part="title title-${side}" class="title">${esc(it.title)}</div>`,
      it.desc ? `<div part="desc" class="desc">${esc(it.desc)}</div>` : "",
      it.tags.length ? `<div class="tags">${it.tags.map((t) => tagChip(t, s.list.priority)).join("")}</div>` : ""
    ].join("");
    const name = esc(it.title);
    return `<div part="card card-${side}" class="card">
      <div part="body body-${side}" class="body">${body}</div>
      <button part="choose choose-${side}" class="choose" data-choose="${side}" aria-label="Choose ${name}">${side === "a" ? "\u2190 Choose this" : "Choose this \u2192"}</button>
      <a part="open open-${side}" class="act open" href="${esc(it.url)}" target="_blank" rel="noopener" ${it.url ? "" : "hidden"} aria-label="Open ${name} in a new tab">\u2197</a>
      <button part="edit edit-${side}" class="act edit" data-edit="${index}" aria-label="Edit ${name}">\u270E</button>
      <button part="bench bench-${side}" class="act bench" data-bench="${side}" aria-label="Bench ${name}">\u2715</button>
    </div>`;
  }
  #click(e) {
    const t = e.target, s = this.sorter;
    const img = t.closest("img");
    if (img) {
      this.#lightbox.show(img.getAttribute("src"), [...imagesOf(this.#item("a")), ...imagesOf(this.#item("b"))]);
      return;
    }
    const d = t.closest("button")?.dataset;
    if (!d)
      return;
    if (d.choose)
      s.answer(d.choose === "a" ? -1 : 1);
    else if (d.step) {
      const side = d.side;
      this.#pages[side] += Number(d.step);
      this.render();
    } else if (d.edit)
      this.fire("pairwise-edit", { index: Number(d.edit) });
    else if (d.bench)
      s.bench([idOf(this.#item(d.bench))]);
  }
  #keys = (e) => {
    if (this.#lightbox.isOpen)
      return;
    const s = this.sorter;
    if (e.defaultPrevented || !s?.question || this.hasAttribute("no-keyboard") || !this.checkVisibility())
      return;
    const path = e.composedPath(), target = path[0];
    if (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable]"))
      return;
    if (path.some((n) => n instanceof HTMLDialogElement && n.open))
      return;
    const v = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: 0, "=": 0 }[e.key];
    if (v !== void 0) {
      e.preventDefault();
      s.answer(v);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      s.undo();
    }
  };
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/conflicts.js
var style4 = css(`
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-bottom: 1px solid var(--pw-border); }
  li [part=pair] { flex: 1; overflow-wrap: anywhere; }
  li.conflict { border-left: 3px solid var(--pw-warn); padding-left: 9px; }
  [part=why] { color: var(--pw-warn); font-size: 12px; }
  [part=implied] { color: var(--pw-muted); font-size: 12px; border: 1px dashed var(--pw-border); border-radius: 999px; padding: 0 8px; }
  li button { padding: 3px 10px; font-size: 12px; }
  li button:hover { color: var(--pw-danger); border-color: var(--pw-danger); }
`);
var PairwiseConflicts = class extends PairwiseElement {
  #result = "";
  #query = "";
  /** Show only answers naming an item whose title contains this. Display only. */
  get query() {
    return this.#query;
  }
  set query(q) {
    this.#query = q;
    this.render();
  }
  constructor() {
    super();
    this.root.innerHTML = `
      <p part="banner" class="banner" hidden><span></span><button part="resolve" title="Reorder to contradict as few of your answers as possible">Resolve</button></p>
      <p part="result" class="banner info" hidden></p>
      <p part="empty" class="muted" hidden>No comparisons recorded yet.</p>
      <p part="count" class="muted"></p>
      <ul part="list"></ul>`;
    this.root.querySelector("[part=resolve]").onclick = () => this.resolve();
    this.root.querySelector("[part=list]").onclick = (e) => {
      const i = e.target.closest("button")?.dataset.delete;
      if (i)
        this.sorter.deleteAnswer(Number(i));
    };
  }
  styles() {
    return [style4];
  }
  listen(s, signal) {
    s.addEventListener("change", () => {
      this.#result = "";
      this.render();
    }, { signal });
  }
  render() {
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    const all = this.sorter?.comparisons() ?? [];
    const bad = all.filter((c) => c.why).length;
    $("banner").hidden = !bad;
    $("banner").querySelector("span").textContent = `\u26A0 ${bad} answer${bad === 1 ? " contradicts" : "s contradict"} the ranking \u2014 your choices can't all be true at once.`;
    $("result").hidden = !this.#result;
    $("result").textContent = this.#result;
    $("empty").hidden = !this.sorter || all.length > 0;
    const q = this.#query.trim().toLowerCase(), hit = (t) => !q || t.toLowerCase().includes(q);
    const shown = all.filter((c) => hit(c.a.title) || hit(c.b.title)).length;
    $("count").textContent = q ? `showing ${shown} of ${all.length}` : "";
    $("list").innerHTML = all.map((c) => {
      const pair = c.verdict === 0 ? [c.a.title, "=", c.b.title] : c.verdict < 0 ? [c.a.title, "\u203A", c.b.title] : [c.b.title, "\u203A", c.a.title];
      return `<li part="answer${c.why ? " conflict" : ""}" class="${c.why ? "conflict" : ""}" ${hit(c.a.title) || hit(c.b.title) ? "" : "hidden"}>
        <span part="pair">${pair.map(esc).join(" ")}</span>
        ${c.implied ? `<span part="implied" title="Filled in from the earlier order when an item was retired \u2014 not something you answered">implied</span>` : ""}
        ${c.why ? `<span part="why">${esc(c.why)}</span>` : ""}
        <button part="delete" data-delete="${c.index}" title="Forget this answer \u2014 it will be asked again if the sort still needs it">delete</button>
      </li>`;
    }).join("");
  }
  /** Reorder to contradict as few answers as possible; returns (and shows) what happened. */
  resolve() {
    const { before, after } = this.sorter.resolve();
    const s = (n) => n === 1 ? "" : "s";
    this.#result = after < before ? `Reordered \u2014 now contradicts ${after} of your answers, down from ${before}. This is a best-effort search rather than a proof of the true minimum, and it lasts until the next change re-runs the sort.` : `Already as consistent as this search can make it \u2014 ${before} answer${s(before)} still contradicted. Those are genuine cycles: no order can satisfy them all, so the fix is to change an answer.`;
    this.render();
    return this.#result;
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/editor.js
var style5 = css(`
  dialog { border: 1px solid var(--pw-border); border-radius: 12px; background: var(--pw-bg); color: var(--pw-text);
           padding: 0; width: min(620px, calc(100vw - 48px)); }
  dialog::backdrop { background: rgba(0,0,0,.7); }
  form { display: flex; flex-direction: column; gap: 14px; padding: 22px 24px; }
  h2 { margin: 0; font-size: 17px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: var(--pw-muted); }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .row input { flex: 1; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .tag button { border: 0; background: none; padding: 0 2px; color: inherit; }
  [part=error] { color: var(--pw-danger); margin: 0; }
`);
var PairwiseEditor = class extends PairwiseElement {
  #index = -1;
  #tags = [];
  #media = [];
  constructor() {
    super();
    this.root.innerHTML = `<dialog part="dialog"><form method="dialog" novalidate>
      <h2>Edit item</h2>
      <label>Title <input part="title" type="text" required></label>
      <label>Link <input part="url" type="url" placeholder="https://\u2026"></label>
      <label>Description <textarea part="desc" rows="3"></textarea></label>
      <div><span class="muted">Tags</span><div part="tags" class="tags"></div>
        <div class="row"><input part="tag-input" type="text" list="tag-options" placeholder="Add a tag, then Enter">
          <datalist id="tag-options"></datalist><button part="tag-add" type="button">Add</button></div></div>
      <div><span class="muted">Media \u2014 images, audio and video, in order</span>
        <div part="media-list"></div><button part="media-add" type="button">+ Add media</button></div>
      <p part="error" hidden></p>
      <div class="row"><button part="save" type="submit">Save</button><button part="cancel" type="button">Cancel</button></div>
    </form></dialog>`;
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    $("tag-add").onclick = () => this.#addTags();
    $("tag-input").onkeydown = (e) => {
      if (e.key !== "Enter")
        return;
      e.preventDefault();
      this.#addTags();
    };
    $("tags").onclick = (e) => {
      const i = e.target.closest("button")?.dataset.i;
      if (i) {
        this.#tags.splice(Number(i), 1);
        this.#draw();
      }
    };
    $("media-add").onclick = () => {
      this.#media.push("");
      this.#draw();
    };
    $("media-list").oninput = (e) => {
      const input = e.target;
      this.#media[Number(input.dataset.i)] = input.value;
    };
    $("media-list").onclick = (e) => {
      const d = e.target.closest("button")?.dataset;
      if (!d)
        return;
      const i = Number(d.i), m = this.#media;
      if (d.move) {
        const j = i + Number(d.move);
        [m[i], m[j]] = [m[j], m[i]];
      } else
        m.splice(i, 1);
      this.#draw();
    };
    $("cancel").onclick = () => this.#dialog.close();
    this.root.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      this.#save();
    };
  }
  styles() {
    return [style5];
  }
  get #dialog() {
    return this.root.querySelector("dialog");
  }
  /** Open the editor on `list.items[index]`. */
  edit(index) {
    const it = this.sorter?.list.items[index];
    if (!it)
      return;
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    this.#index = index;
    this.#tags = [...it.tags];
    this.#media = [...it.media];
    $("title").value = it.title;
    $("url").value = it.url;
    $("desc").value = it.desc;
    $("tag-input").value = "";
    $("error").hidden = true;
    this.root.querySelector("datalist").innerHTML = this.sorter.tags().map((t) => `<option value="${esc(t)}">`).join("");
    this.#draw();
    this.#dialog.showModal();
  }
  render() {
  }
  #addTags() {
    const input = this.root.querySelector("[part=tag-input]");
    for (const t of input.value.split(",").map(tagOf))
      if (t && !this.#tags.includes(t))
        this.#tags.push(t);
    input.value = "";
    this.#draw();
  }
  #draw() {
    const tags = this.root.querySelector("[part=tags]"), media = this.root.querySelector("[part=media-list]");
    tags.innerHTML = this.#tags.map((t, i) => `<span class="tag">#${esc(t)} <button type="button" data-i="${i}" aria-label="Remove tag ${esc(t)}">\xD7</button></span>`).join("") || `<span class="muted">No tags yet.</span>`;
    const last = this.#media.length - 1;
    media.innerHTML = this.#media.map((m, i) => `<div part="media" class="row">
      <input part="media-url" type="url" data-i="${i}" value="${esc(m)}" aria-label="Media URL ${i + 1}">
      <button type="button" data-i="${i}" data-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Move media ${i + 1} up">\u2191</button>
      <button type="button" data-i="${i}" data-move="1" ${i === last ? "disabled" : ""} aria-label="Move media ${i + 1} down">\u2193</button>
      <button type="button" data-i="${i}" aria-label="Remove media ${i + 1}">\u2715</button></div>`).join("") || `<span class="muted">No media yet.</span>`;
  }
  async #save() {
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    this.#addTags();
    try {
      await this.sorter.editItem(this.#index, {
        title: $("title").value,
        url: $("url").value.trim(),
        desc: $("desc").value.trim(),
        tags: this.#tags,
        media: this.#media.map((m) => m.trim()).filter(Boolean)
      });
      this.#dialog.close();
    } catch (err) {
      $("error").textContent = err.message;
      $("error").hidden = false;
    }
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/io.js
var style6 = css(`
  textarea { width: 100%; box-sizing: border-box; min-height: 240px; font: 14px/1.6 ui-monospace, monospace; resize: vertical; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
  details { margin: 12px 0; font-size: 13px; color: var(--pw-muted); }
  code { background: var(--pw-panel); padding: 1px 5px; border-radius: 4px; }
  td { padding: 4px 14px 4px 0; vertical-align: top; }
  .search { display: flex; gap: 10px; align-items: center; margin: 8px 0; }
  .search input { flex: 1; max-width: 340px; }
  ul[part=filtered] { list-style: none; margin: 0; padding: 0; max-height: 420px; overflow: auto; border: 1px solid var(--pw-border);
    border-radius: var(--pw-radius); background: var(--pw-panel); }
  ul[part=filtered] li { padding: 7px 12px; border-bottom: 1px solid var(--pw-border); font: 13px/1.5 ui-monospace, monospace; overflow-wrap: anywhere; }
`);
var FORMATS = `<details><summary>Input formats</summary><table>
  <tr><td><code>Cold brew</code></td><td>plain text</td></tr>
  <tr><td><code>[Title](https://\u2026)</code></td><td>titled link</td></tr>
  <tr><td><code>Title | https://\u2026 | https://\u2026.jpg | https://\u2026.mp3 | Description</code></td><td>full card</td></tr>
  <tr><td><code>#gameplay #qol</code></td><td>tags (a field of <code>#</code>-tokens)</td></tr>
  <tr><td><code>[{"title":"\u2026","url":"\u2026","media":["\u2026"],"desc":"\u2026","tags":["\u2026"]}]</code></td><td>JSON array</td></tr>
  </table><p>Pipe fields are matched by content, not order: an image, audio or video URL is media; the first other
  URL is the link; the first text is the title and the rest the description.</p></details>`;
var PairwiseIo = class extends PairwiseElement {
  #filled = false;
  #query = "";
  static get observedAttributes() {
    return ["view"];
  }
  attributeChangedCallback() {
    this.#build();
  }
  constructor() {
    super();
    this.#build();
  }
  styles() {
    return [style6];
  }
  /**
   * Filter the item lines by title. The box is the input to Save, so it is never filtered in
   * place — a filtered box that got saved would drop every line it hid. Matches show read-only
   * beside it instead, and saving is locked until the filter is cleared.
   */
  get query() {
    return this.#query;
  }
  set query(q) {
    this.#query = q;
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    const filter = $("filter");
    if (!filter)
      return;
    filter.value = q;
    const on = !!q.trim(), needle = q.trim().toLowerCase();
    const lines = this.#box().value.split("\n").map((l) => l.trim()).filter(Boolean);
    const hits = lines.filter((l) => parseLine(l).title.toLowerCase().includes(needle));
    $("filtered").innerHTML = hits.map((l) => `<li>${esc(l)}</li>`).join("") || `<li class="muted">No titles match.</li>`;
    $("filtered").hidden = !on;
    this.#box().hidden = on;
    $("filter-count").textContent = on ? `showing ${hits.length} of ${lines.length}` : "";
    $("filter-clear").hidden = !on;
    const save = $("save");
    save.disabled = on;
    save.textContent = on ? "Clear the filter to save" : "Save & sort";
  }
  /** Refill the text from the list, discarding unsaved edits. */
  reset() {
    this.#filled = false;
    this.#hint("");
    this.render();
  }
  /** Put text in the box with a note — e.g. an export the clipboard refused. */
  show(text, note) {
    this.#box().value = text;
    this.#hint(note);
  }
  render() {
    if (this.#filled || !this.sorter || this.getAttribute("view") === "import")
      return;
    this.#box().value = toText(this.sorter.list.items);
    this.#filled = true;
    this.query = this.#query;
  }
  #build() {
    const importing = this.getAttribute("view") === "import";
    this.root.innerHTML = importing ? `<p class="muted">Paste a full export \u2014 items and comparisons. It lands as a new list, so nothing you already have is touched.</p>
        <textarea part="text" placeholder='{"format": "pairwise-sorter/3", "name": "\u2026", "items": [...], "comparisons": [...]}'></textarea>
        <div class="row"><button part="import">Import as new list</button><button part="cancel">Cancel</button><span part="hint" class="muted"></span></div>` : `<p class="muted">One item per line \u2014 plain text, markdown links, pipe-separated fields, or a JSON array.</p>
        <div class="search"><input part="filter" type="search" placeholder="Filter by title\u2026" aria-label="Filter items by title">
          <span part="filter-count" class="muted"></span><button part="filter-clear" hidden>Clear</button></div>
        <textarea part="text" placeholder="Cold brew&#10;[Flat white](https://example.com/fw)"></textarea>
        <ul part="filtered" hidden></ul>${FORMATS}
        <div class="row"><button part="save">Save &amp; sort</button><span part="hint" class="muted"></span></div>`;
    const on = (p, f) => {
      const b = this.root.querySelector(`[part=${p}]`);
      if (b)
        b.onclick = f;
    };
    on("save", () => this.#save());
    on("import", () => this.#import());
    on("cancel", () => this.fire("pairwise-cancel"));
    on("filter-clear", () => {
      this.query = "";
      this.fire("pairwise-search", { query: "" });
    });
    const filter = this.root.querySelector("[part=filter]");
    if (filter)
      filter.oninput = () => {
        this.query = filter.value;
        this.fire("pairwise-search", { query: filter.value });
      };
    this.#filled = false;
    this.render();
  }
  #box = () => this.root.querySelector("[part=text]");
  #hint = (text) => {
    this.root.querySelector("[part=hint]").textContent = text;
  };
  #save() {
    try {
      const { dupes, dropped } = this.sorter.setItems(parseItems(this.#box().value));
      const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      this.#hint([
        dupes.length ? `Merged ${n(dupes.length, "duplicate", "duplicates")}: ${dupes.join(", ")}.` : "",
        dropped ? `${n(dropped, "answer", "answers")} dropped with deleted items.` : ""
      ].filter(Boolean).join(" "));
      this.fire("pairwise-saved");
    } catch (err) {
      this.#hint(err.message);
    }
  }
  #import() {
    try {
      const result = importList(JSON.parse(this.#box().value));
      this.#box().value = "";
      this.fire("pairwise-imported", result);
    } catch (err) {
      this.#hint("Could not import: " + err.message);
    }
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/lists.js
var style7 = css(`
  :host { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  [part=name] { flex: 1; min-width: 140px; max-width: 380px; }
  [part=delete].armed { border-color: var(--pw-danger); color: var(--pw-danger); }
`);
var PairwiseLists = class extends PairwiseElement {
  #library = null;
  /** How long an armed Delete waits for its second click, in ms. */
  disarmAfter = 4e3;
  constructor() {
    super();
    this.root.innerHTML = `
      <select part="pick" aria-label="Switch list"></select>
      <input part="name" placeholder="List name" aria-label="Rename this list">
      <button part="new">+ New list</button>
      <button part="import">Import JSON</button>
      <button part="delete">Delete</button>`;
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    $("pick").onchange = () => this.fire("pairwise-list-open", { id: $("pick").value });
    $("name").oninput = () => this.fire("pairwise-list-rename", { name: $("name").value });
    $("new").onclick = () => this.fire("pairwise-list-new");
    $("import").onclick = () => this.fire("pairwise-import");
    $("delete").onclick = () => {
      const del = $("delete");
      if (del.classList.toggle("armed")) {
        del.textContent = "Really delete?";
        setTimeout(() => this.#disarm(), this.disarmAfter);
        return;
      }
      this.#disarm();
      this.fire("pairwise-list-delete");
    };
  }
  styles() {
    return [style7];
  }
  /** The lists to show. */
  set library(lib) {
    this.#library = lib;
    this.render();
  }
  render() {
    const lib = this.#library, $ = (p) => this.root.querySelector(`[part=${p}]`);
    $("pick").innerHTML = Object.entries(lib?.lists ?? {}).map(([id, l]) => `<option value="${esc(id)}">${esc(l.name || "Untitled")} (${l.items.length})</option>`).join("");
    if (!lib?.current)
      return;
    $("pick").value = lib.current;
    if (this.root.activeElement !== $("name"))
      $("name").value = lib.lists[lib.current].name;
  }
  #disarm() {
    const del = this.root.querySelector("[part=delete]");
    del.classList.remove("armed");
    del.textContent = "Delete";
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/progress.js
var style8 = css(`
  .bar { height: 8px; background: var(--pw-panel); border: 1px solid var(--pw-border); border-radius: 4px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--pw-accent); transition: width .25s; }
  [part=status] { margin-top: 8px; font-variant-numeric: tabular-nums; }
`);
var PairwiseProgress = class extends PairwiseElement {
  styles() {
    return [style8];
  }
  render() {
    const s = this.sorter;
    if (!s) {
      this.root.innerHTML = "";
      return;
    }
    const answered = s.list.log.length, total = s.budget(), at = s.placement();
    const canStop = !!s.question && at.pct >= STOP_AT && at.placed < at.total;
    this.root.innerHTML = `
      <div class="bar" part="bar"><i part="fill" style="width:${Math.min(100, answered / total * 100)}%"></i></div>
      <div part="status" class="muted">${answered} of ~${total} comparisons \xB7 ${at.placed} of ${at.total} placed</div>
      <p part="stop" class="banner info" ${canStop ? "" : "hidden"}>
        ${at.placed} of ${at.total} items are placed, and placed items are already in their final order \u2014
        you can stop here and keep them. The rest simply have no position yet.
        <button>See the list</button>
      </p>`;
    this.root.querySelector("button").onclick = () => this.fire("pairwise-stop");
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/ranking.js
var style9 = css(`
  .tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 8px 0; }
  .tools input { flex: 1; max-width: 340px; }
  ol, ul { list-style: none; padding: 0; margin: 0; }
  ol.filtering { border-left: 3px solid var(--pw-warn); padding-left: 11px; }
  li { display: flex; flex-wrap: wrap; gap: 14px; align-items: baseline; padding: 9px 12px; border-bottom: 1px solid var(--pw-border); }
  .rank { min-width: 2.2em; text-align: right; color: var(--pw-accent); font-weight: 600; font-variant-numeric: tabular-nums; }
  li.tied .rank { color: var(--pw-warn); }
  .title { background: none; border: 0; padding: 0; color: var(--pw-text); text-align: left; font-size: inherit; }
  button.title { cursor: pointer; }
  button.title::before { content: "\u25B8"; display: inline-block; width: 1em; color: var(--pw-muted); transition: transform .12s; }
  button.title[aria-expanded=true]::before { transform: rotate(90deg); }
  span.title::before { content: ""; display: inline-block; width: 1em; }
  .tags { display: inline-flex; flex-wrap: wrap; gap: 6px; }
  .acts { margin-left: auto; display: inline-flex; gap: 8px; align-items: center; }
  .acts button { padding: 1px 8px; font-size: 12px; opacity: .4; }
  li:hover .acts button, .acts button:focus-visible { opacity: 1; }
  .acts [part~=bench]:hover { color: var(--pw-danger); border-color: var(--pw-danger); }
  .detail { flex-basis: 100%; padding: 6px 0 4px 3.4em; }
  .strip { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .strip img, .strip video { max-height: 130px; max-width: 220px; }
  li.rule { border-bottom: 0; padding: 16px 12px 6px; color: var(--pw-muted); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
  li.rule::after { content: ""; flex: 1; height: 1px; background: var(--pw-border); }
  .unplaced li { color: var(--pw-muted); }
`);
var PairwiseRanking = class extends PairwiseElement {
  #open = /* @__PURE__ */ new Set();
  #query = "";
  #lightbox;
  constructor() {
    super();
    this.root.innerHTML = `
      <p part="partial" class="banner info" hidden></p>
      <div class="tools">
        <input part="search" type="search" placeholder="Filter by title\u2026" aria-label="Filter by title">
        <span part="count" class="muted"></span>
        <button part="clear" hidden>Clear</button>
        <button part="expand-all">Expand all</button>
        <button part="collapse-all">Collapse all</button>
      </div>
      <p part="note" class="muted" hidden></p>
      <ol part="list"></ol>
      <ul part="unplaced" class="unplaced"></ul>
      ${Lightbox.html}`;
    this.#lightbox = new Lightbox(this.root);
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    $("search").oninput = () => {
      this.query = $("search").value;
    };
    $("clear").onclick = () => {
      this.query = "";
    };
    $("expand-all").onclick = () => this.expandAll();
    $("collapse-all").onclick = () => this.collapseAll();
    $("list").onclick = (e) => this.#click(e);
  }
  styles() {
    return [mediaStyle, style9];
  }
  static get observedAttributes() {
    return ["no-search"];
  }
  attributeChangedCallback() {
    this.render();
  }
  /** The title filter. Display only: it hides rows, never changes a rank. */
  get query() {
    return this.root.querySelector("[part=search]").value;
  }
  set query(q) {
    this.root.querySelector("[part=search]").value = q;
    this.#query = q.trim().toLowerCase();
    this.#filter();
  }
  /** Open (or close) the detail row of `list.items[index]`. */
  expand(index, on = true) {
    const id = idOf(this.sorter.list.items[index]);
    if (on)
      this.#open.add(id);
    else
      this.#open.delete(id);
    this.render();
  }
  /** Open every row that has media or a description. */
  expandAll() {
    this.#open = new Set(this.sorter.ranking().filter((r) => detailed(r.item)).map((r) => idOf(r.item)));
    this.render();
  }
  collapseAll() {
    this.#open.clear();
    this.render();
  }
  render() {
    const s = this.sorter, $ = (p) => this.root.querySelector(`[part=${p}]`);
    const rows = s?.ranking() ?? [];
    const { priority = [], combine = "order" } = s?.list ?? {};
    const partial = !!s && !s.complete;
    const at = s?.placement();
    for (const p of ["search", "count"])
      $(p).hidden = this.hasAttribute("no-search");
    $("partial").hidden = !partial;
    if (at)
      $("partial").textContent = `Sorting in progress \u2014 ${at.placed} of ${at.total} placed so far. This order is provisional; the rest slot in as you keep answering.`;
    $("unplaced").innerHTML = partial ? s.unplaced().map((it) => `<li>${esc(it.title)}</li>`).join("") : "";
    $("note").hidden = !priority.length;
    $("note").textContent = combine === "weights" ? "Tiers are on, so positions across tiers come from the weights you set, not from answers you gave. Within a tier the order is entirely yours." : "Tiers are on, so cross-tier positions come from the tier order you set, not from answers you gave. Within a tier the order is entirely yours.";
    let lastTier = null;
    $("list").innerHTML = rows.map(({ item: it, index, rank, tied }) => {
      let rule = "";
      if (priority.length && combine === "order") {
        const tier = tierOf(it, priority);
        if (tier !== lastTier)
          rule = `<li part="rule" class="rule">${esc(tierName(tier, priority))}</li>`;
        lastTier = tier;
      }
      const id = idOf(it), open = this.#open.has(id), name = esc(it.title);
      const title = detailed(it) ? `<button part="title" class="title" data-toggle="${index}" aria-expanded="${open}">${name}</button>` : `<span part="title" class="title">${name}</span>`;
      return `${rule}<li part="row" class="${tied ? "tied" : ""}" data-title="${esc(it.title.toLowerCase())}">
        <span part="rank" class="rank">${tied ? "=" : rank}</span>${title}
        ${it.tags.length ? `<span class="tags">${it.tags.map((t) => tagChip(t, priority)).join("")}</span>` : ""}
        <span class="acts">
          ${it.url ? `<a part="open" href="${esc(it.url)}" target="_blank" rel="noopener" aria-label="Open ${name} in a new tab">\u2197</a>` : ""}
          <button part="edit" data-edit="${index}" aria-label="Edit ${name}">\u270E</button>
          <button part="bench" data-bench="${index}" aria-label="Bench ${name}">Bench</button>
        </span>
        ${open ? `<div part="detail" class="detail" data-images="${esc(JSON.stringify(imagesOf(it)))}">
          <div class="strip">${it.media.map(mediaHTML).join("")}</div>${it.desc ? `<p class="muted">${esc(it.desc)}</p>` : ""}</div>` : ""}
      </li>`;
    }).join("");
    this.#filter();
  }
  /** Display only: hides rows whose title does not match, never changes a rank. */
  #filter() {
    const list = this.root.querySelector("[part=list]"), q = this.#query;
    const rows = [...list.children];
    for (const li of rows)
      if (!li.matches(".rule"))
        li.hidden = !!q && !li.dataset.title.includes(q);
    rows.forEach((li, i) => {
      if (!li.matches(".rule"))
        return;
      let j = i + 1, any = false;
      for (; j < rows.length && !rows[j].matches(".rule"); j++)
        any ||= !rows[j].hidden;
      li.hidden = !any;
    });
    const items = rows.filter((li) => !li.matches(".rule"));
    list.classList.toggle("filtering", !!q);
    this.root.querySelector("[part=count]").textContent = q ? `showing ${items.filter((li) => !li.hidden).length} of ${items.length}` : "";
    this.root.querySelector("[part=clear]").hidden = !q || this.hasAttribute("no-search");
  }
  #click(e) {
    const t = e.target;
    const img = t.closest("img");
    if (img) {
      this.#lightbox.show(img.getAttribute("src"), JSON.parse(img.closest("[part=detail]").dataset.images));
      return;
    }
    const d = t.closest("button")?.dataset;
    if (!d)
      return;
    const it = (i) => idOf(this.sorter.list.items[Number(i)]);
    if (d.toggle)
      this.expand(Number(d.toggle), !this.#open.has(it(d.toggle)));
    else if (d.edit)
      this.fire("pairwise-edit", { index: Number(d.edit) });
    else if (d.bench) {
      this.sorter.bench([it(d.bench)]);
      this.fire("pairwise-benched");
    }
  }
};
var detailed = (it) => it.media.length > 0 || !!it.desc;

// node_modules/@rascaltwo/pairwise-sorter/dist/element/tiers.js
var style10 = css(`
  ol { list-style: none; padding: 0; margin: 10px 0; }
  li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--pw-border); }
  li .n { color: var(--pw-accent); min-width: 1.6em; font-variant-numeric: tabular-nums; }
  li [part=name] { flex: 1; }
  li button { padding: 2px 9px; font-size: 12px; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  [part=summary] { color: var(--pw-text); }
  input[type=number] { width: 5.5em; }
`);
var tiersOf = (p, w) => p.map((tag, i) => ({ tag, weight: w[i] }));
var PairwiseTiers = class extends PairwiseElement {
  constructor() {
    super();
    this.root.innerHTML = `
      <p class="muted">Tier order \u2014 <span part="summary">off</span></p>
      <p part="untagged" class="muted" hidden>Tag items to use tiers: a higher tier then outranks a lower one without being asked.</p>
      <ol part="list"></ol>
      <div class="row"><select part="add-tag" aria-label="Tag to add as a tier"></select><button part="add">Add tier</button></div>
      <p part="overrides" class="banner" hidden><span></span><button title="Forget those answers and let the tier order decide those pairs">Drop them</button></p>`;
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    $("add").onclick = () => this.#set((t) => [...t, { tag: $("add-tag").value }]);
    $("overrides").querySelector("button").onclick = () => this.sorter.dropOverrides();
    $("list").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b)
        return;
      const i = Number(b.dataset.i);
      if (b.dataset.move)
        this.#set((t) => {
          const j = i + Number(b.dataset.move);
          [t[i], t[j]] = [t[j], t[i]];
          return t;
        });
      else
        this.#set((t) => t.filter((_, k) => k !== i));
    };
  }
  styles() {
    return [style10];
  }
  render() {
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    const s = this.sorter, priority = s?.list.priority ?? [], tags = s?.tags() ?? [];
    $("summary").textContent = priority.length ? priority.map((t) => "#" + t).join(" \u203A ") : "off";
    $("untagged").hidden = !s || tags.length > 0;
    $("list").innerHTML = priority.map((t, i) => `<li part="tier">
      <span class="n">${i + 1}</span><span part="name">#${esc(t)}</span>
      <button part="up" data-i="${i}" data-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(t)} up">\u2191</button>
      <button part="down" data-i="${i}" data-move="1" ${i === priority.length - 1 ? "disabled" : ""} aria-label="Move ${esc(t)} down">\u2193</button>
      <button part="remove" data-i="${i}" aria-label="Remove tier ${esc(t)}">\u2715</button></li>`).join("");
    const free = tags.filter((t) => !priority.includes(t));
    $("add-tag").innerHTML = free.map((t) => `<option value="${esc(t)}">#${esc(t)}</option>`).join("");
    $("add").disabled = !free.length;
    const over = s?.overrides().length ?? 0;
    $("overrides").hidden = !over;
    $("overrides").querySelector("span").textContent = `${over} answer${over === 1 ? " of yours overrides" : "s of yours override"} the tier order \u2014 yours win.`;
  }
  #set(edit) {
    const l = this.sorter.list;
    this.sorter.setPriority(edit(tiersOf(l.priority, l.weights)));
  }
};
var PairwiseWeights = class extends PairwiseElement {
  constructor() {
    super();
    this.root.innerHTML = `
      <div part="combine" class="row"><span class="muted">Combine tiers by</span>
        <label><input part="order" type="radio" name="combine" value="order"> Strict order</label>
        <label><input part="weights" type="radio" name="combine" value="weights"> Weights</label></div>
      <p part="note" class="muted"></p>
      <ol part="list"></ol>`;
    this.root.querySelector("[part=combine]").onchange = (e) => this.sorter.setCombine(e.target.value);
    this.root.querySelector("[part=list]").onchange = (e) => {
      const input = e.target, l = this.sorter.list;
      const tiers = tiersOf(l.priority, l.weights);
      tiers[Number(input.dataset.i)] = { tag: l.priority[Number(input.dataset.i)], weight: Number(input.value) };
      this.sorter.setPriority(tiers);
    };
  }
  styles() {
    return [style10];
  }
  render() {
    const $ = (p) => this.root.querySelector(`[part=${p}]`);
    const l = this.sorter?.list, priority = l?.priority ?? [], weighted = l?.combine === "weights";
    $("combine").hidden = !priority.length;
    $("order").checked = !weighted;
    $("weights").checked = weighted;
    $("note").textContent = !priority.length ? "Add tiers first \u2014 weights say how much each tier counts." : weighted ? "Every tier contributes in proportion to its weight, so a lower tier's best item can outrank a higher tier's worst. Position within a tier is scored by rank-order centroid, the fairest reading of an order when order is all you gave." : "A higher tier beats a lower one outright, whatever the items are.";
    $("list").innerHTML = weighted ? priority.map((t, i) => `<li><span part="name">#${esc(t)}</span>
      <input part="weight" type="number" min="0.1" step="0.1" data-i="${i}" value="${l.weights[i]}" aria-label="Weight for ${esc(t)}"></li>`).join("") : "";
  }
};

// node_modules/@rascaltwo/pairwise-sorter/dist/element/console.js
var HELP = `pairwiseSorter \u2014 rank a list by pairwise comparison. Every UI action has a method here.

READ
  help()               this text
  state()              current list, screen, progress, the pair being asked, conflict count
                       (readers are sync; every method that CHANGES something returns a
                        Promise of the settled state \u2014 await it)
  ranking()            [{rank, tied, title, url, media, desc, tags}] \u2014 final, or partial while sorting
  comparisons()        [{index, a, b, verdict, implied, conflicts, why}] every answer (verdict: -1 a, 1 b, 0 equal)
  conflicts()          only the answers the ranking contradicts
  lists()              [{id, name, items, answered, current}]
  placement()          {placed, total, pct} \u2014 placed items are already final

LISTS
  newList(name?)  openList(ref)  renameList(name)  deleteList(ref?)   \u2014 ref is an id or a unique name

ITEMS   item = string | {title, url?, media?: string[], desc?, tags?: string[]}
  load(items, {name, replace=true})   set the list's items (the usual entry point)
  addItems(items)      append; only new items get asked about (~log2(n) questions each)
  setItemsText(text)   the same, in the text syntax (pipes / markdown links / #tags / JSON)
  editItem(title, patch)   change {title, url, desc, media, tags}; a rename keeps its answers
  tag(title, tags) / untag(title, tags)
  bench(title) / benchMany(titles) / subIn(title) / subAll()
  removeItem(title) / restoreItem(title)   the old names for bench / subIn
  retire(titles)       remove finished items for good WITHOUT re-asking: answers they carried are
                       filled in from the current order and marked implied

TIERS
  priority()  setPriority(tags | [{tag, weight}])  combineBy('order'|'weights')
  overrides()  dropOverrides()

ANSWERING
  answer('a'|'b'|'equal')   also 'left' / 'right' / 'tie' / 'same'
  undo()  deleteComparison(i)  resetAnswers()  resolve()

SEARCH  display only \u2014 never changes what is compared, stored or saved
  search(text)         filter every list view by title. search('') clears it

VIEWS
  pause() / resume()   goto('setup'|'import'|'compare'|'done')   tab('ranking'|'comparisons')
  expand(title, on?)   open a ranked row to show its media and description
  expandAll() / collapseAll()

DATA
  schema()  exportJSON()  importJSON(data)

NOTE: if an AI answers the questions, the ranking is the AI's preferences, not yours.`;
var CHOICES = { a: -1, left: -1, b: 1, right: 1, equal: 0, tie: 0, same: 0 };
var pub = (it) => ({ title: it.title, url: it.url, media: it.media, desc: it.desc, tags: it.tags });
var asItems = (list) => [list].flat().map(fromJSON).filter((x) => !!x);
function installConsole(el, name = "pairwiseSorter") {
  const s = () => el.sorter;
  const items = () => s().list.items;
  const find = (title) => {
    const hits = items().flatMap((it, i) => it.title === title ? [i] : []);
    if (hits.length === 1)
      return hits[0];
    if (!hits.length)
      throw new Error(`no item titled ${JSON.stringify(title)}`);
    throw new Error(`${hits.length} items are titled ${JSON.stringify(title)} \u2014 titles must be unique to address one`);
  };
  const state = () => {
    const sorter = s(), q = sorter.question, screen = el.screen;
    const asking = q && screen === "compare";
    return {
      list: sorter.list.name,
      screen,
      paused: el.paused,
      items: items().length,
      active: sorter.live().length,
      benched: sorter.benchedItems().map((i) => i.title),
      answered: sorter.list.log.length,
      estimatedTotal: sorter.budget(),
      placed: sorter.ranking().length,
      complete: sorter.complete,
      pending: asking ? { a: pub(items()[q.a]), b: pub(items()[q.b]) } : null,
      conflicts: sorter.comparisons().filter((c) => c.why).length,
      priority: [...sorter.list.priority],
      weights: [...sorter.list.weights],
      combine: sorter.list.combine,
      tierOverrides: sorter.overrides().length,
      tags: sorter.tags(),
      query: el.query,
      ranking: sorter.ranking().map((r) => r.item.title)
    };
  };
  const ranking = () => el.shadowRoot.querySelector("pairwise-ranking");
  const settled = async (work) => {
    await work;
    await s().settled();
    return state();
  };
  const setItems = (next) => {
    s().setItems(next);
    el.goto("compare");
    return settled();
  };
  const api = {
    version: "2",
    help: () => HELP,
    state,
    ranking: () => s().ranking().map((r) => ({ rank: r.rank, tied: r.tied, ...pub(r.item) })),
    comparisons: () => s().comparisons().map((c) => ({ index: c.index, a: c.a, b: c.b, verdict: c.verdict, implied: c.implied, conflicts: !!c.why, why: c.why })),
    conflicts: () => api.comparisons().filter((c) => c.conflicts),
    lists: () => Object.entries(el.library.lists).map(([id, l]) => ({
      id,
      name: l.name,
      items: l.items.length,
      answered: l.log.length,
      current: id === el.library.current
    })),
    placement: () => s().placement(),
    newList: (listName) => settled(el.newList(listName)),
    openList: (ref) => settled(el.openList(resolveList(el.library, ref))),
    renameList: (listName) => settled(el.renameList(String(listName))),
    deleteList: (ref) => settled(el.deleteList(ref === void 0 ? el.library.current : resolveList(el.library, ref))),
    load(list, { name: listName, replace = true } = {}) {
      const next = asItems(list);
      if (!next.length)
        throw new Error("no items given");
      const all = replace ? next : [...items(), ...next];
      if (all.length < 2)
        throw new Error("need at least 2 items in the list");
      if (listName)
        el.renameList(listName);
      return setItems(all);
    },
    addItems: (list) => api.load(list, { replace: false }),
    setItemsText: (text) => setItems(parseItems(String(text))),
    editItem: (title, patch) => settled(s().editItem(find(title), patch)),
    tag: (title, tags) => api.editItem(title, { tags: [...items()[find(title)].tags, ...[tags].flat()] }),
    untag(title, tags) {
      const drop = new Set([tags].flat().map(tagOf));
      return api.editItem(title, { tags: items()[find(title)].tags.filter((t) => !drop.has(t)) });
    },
    bench: (title) => api.benchMany([title]),
    /** Every title is resolved BEFORE anything changes, so one typo fails the whole batch. */
    benchMany: (titles) => settled(s().bench(titles.map((t) => idOf(items()[find(t)])))),
    subIn(title) {
      const it = s().benchedItems().find((b) => b.title === title);
      if (!it)
        throw new Error(`${JSON.stringify(title)} is not benched`);
      return settled(s().subIn(idOf(it)));
    },
    subAll: () => settled(s().subAll()),
    // The pre-"bench" names, so scripts written against the original page keep working.
    retire: (titles) => settled(s().retire([titles].flat().map((t) => idOf(items()[find(t)])))),
    removeItem: (title) => api.bench(title),
    restoreItem: (title) => api.subIn(title),
    priority: () => s().list.priority.map((tag, i) => ({ tag, weight: s().list.weights[i] })),
    setPriority: (tiers) => settled(s().setPriority(tiers)),
    combineBy: (mode) => settled(s().setCombine(mode)),
    overrides: () => s().overrides(),
    dropOverrides: () => settled(s().dropOverrides()),
    answer(choice) {
      const v = CHOICES[String(choice).toLowerCase()];
      if (v === void 0)
        throw new Error("answer expects 'a' | 'b' | 'equal'");
      const screen = el.screen;
      if (!s().question || screen === "setup" || screen === "import")
        throw new Error("nothing is being asked right now \u2014 screen is " + screen);
      return settled(s().answer(v));
    },
    undo: () => settled(s().undo()),
    deleteComparison: (i) => settled(s().deleteAnswer(i)),
    resetAnswers: () => settled(s().resetAnswers()),
    resolve: () => s().resolve(),
    pause() {
      if (!el.pause())
        throw new Error("nothing to pause \u2014 no question is open");
      return settled();
    },
    resume() {
      if (!el.resume())
        throw new Error("nothing to resume");
      return settled();
    },
    goto(screen) {
      if (!["setup", "import", "compare", "done"].includes(screen))
        throw new Error("unknown screen: " + screen);
      el.goto(screen);
      return settled();
    },
    tab(which) {
      if (which !== "ranking" && which !== "comparisons")
        throw new Error("tab expects 'ranking' or 'comparisons'");
      el.tab(which);
      return settled();
    },
    search: (text) => {
      el.search(String(text ?? ""));
      return settled();
    },
    expand(title, on = true) {
      const i = find(title), it = items()[i];
      if (!it.media.length && !it.desc)
        throw new Error(`${JSON.stringify(title)} has no media or description to show`);
      ranking().expand(i, on);
      return settled();
    },
    expandAll: () => {
      ranking().expandAll();
      return settled();
    },
    collapseAll: () => {
      ranking().collapseAll();
      return settled();
    },
    schema: () => SCHEMA,
    exportJSON: () => el.exportJSON(),
    async importJSON(data) {
      const r = importList(typeof data === "string" ? JSON.parse(data) : data);
      el.addList(r.list);
      return { ...await settled(), imported: { items: r.count, comparisons: r.kept, skipped: r.skipped } };
    }
  };
  globalThis[name] = api;
  return api;
}

// node_modules/@rascaltwo/pairwise-sorter/dist/element/index.js
var define = (tag, cls) => customElements.get(tag) ?? customElements.define(tag, cls);
define("pairwise-bench", PairwiseBench);
define("pairwise-compare", PairwiseCompare);
define("pairwise-conflicts", PairwiseConflicts);
define("pairwise-editor", PairwiseEditor);
define("pairwise-io", PairwiseIo);
define("pairwise-lists", PairwiseLists);
define("pairwise-progress", PairwiseProgress);
define("pairwise-ranking", PairwiseRanking);
define("pairwise-tiers", PairwiseTiers);
define("pairwise-weights", PairwiseWeights);
define("pairwise-sorter", PairwiseSorter);
export {
  PairwiseBench,
  PairwiseCompare,
  PairwiseConflicts,
  PairwiseEditor,
  PairwiseElement,
  PairwiseIo,
  PairwiseLists,
  PairwiseProgress,
  PairwiseRanking,
  PairwiseSorter,
  PairwiseTiers,
  PairwiseWeights,
  installConsole,
  theme
};

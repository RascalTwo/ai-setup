// GENERATED from @rascaltwo/pairwise-sorter (github:RascalTwo/pairwise-sorter#67f1448ae078a93cd8de474188bae002c07f712e) by maintainer/sync-kit.ts — do not edit.
// Change the package, bump its pin in skills/viz/package.json, then run `bun run sync:kit`.
// node_modules/@rascaltwo/pairwise-sorter/dist/item.js
var SEP = "\x01";
var SEP_ID = "\x00";
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
  for (let i = 1;i < n; i++)
    t += Math.ceil(Math.log2(i + 1));
  return Math.max(1, t);
}
async function sortIndices(arr, cmp, onProgress, onProbe) {
  const out = [];
  for (let n = 0;n < arr.length; n++) {
    onProgress?.({ placed: [...out], remaining: arr.slice(n), next: arr[n + 1] });
    let lo = 0, hi = out.length;
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
  const bad = new Map;
  log.forEach(([k, v], n) => {
    const [x = "", y = ""] = k.split(SEP);
    const rx = rankById.get(x), ry = rankById.get(y);
    if (rx === undefined || ry === undefined)
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
  const out = log.map(([k, v]) => {
    const [x = "", y = ""] = k.split(SEP);
    if (x !== oldId && y !== oldId)
      return [k, v];
    const nx = x === oldId ? newId : x, ny = y === oldId ? newId : y;
    return nx < ny ? [nx + SEP + ny, v] : [ny + SEP + nx, orient(v, -1)];
  });
  log.length = 0;
  log.push(...out);
  if (benched?.delete(oldId))
    benched.add(newId);
  return log;
}
function createEngine(input = {}) {
  const s = {
    items: input.items ?? [],
    log: input.log ?? [],
    benched: new Set(input.benched ?? []),
    priority: input.priority ?? [],
    weights: input.weights ?? [],
    combine: input.combine ?? "order"
  };
  const answers = new Map(s.log);
  const live = () => s.items.map((_, i) => i).filter((i) => !s.benched.has(idOf(s.items[i])));
  async function cmp(a, b, ask, onRecord) {
    const ia = idOf(s.items[a]), ib = idOf(s.items[b]);
    const k = pairKeyOf(ia, ib), flip = flipOfIds(ia, ib);
    const known = answers.get(k);
    if (known !== undefined)
      return orient(known, flip);
    const tier = tierVerdict(s.items[a], s.items[b], s.priority);
    if (tier !== null)
      return tier;
    const v = await ask(a, b);
    answers.set(k, orient(v, flip));
    s.log.push([k, orient(v, flip)]);
    onRecord?.(s.log);
    return v;
  }
  return {
    state: s,
    live,
    budget: () => budgetFor(live().length),
    answeredCount: () => s.log.length,
    run: (ask, { onProgress, onRecord, onProbe } = {}) => sortIndices(live(), (a, b) => cmp(a, b, ask, onRecord), onProgress, onProbe),
    ranking: (order) => order.map((i) => s.items[i]),
    ties: () => tieClasses(s.items, s.log),
    conflicts: (rankById) => findConflicts(s.log, rankById),
    migrate: (oldId, newId) => {
      migrateId(s.log, s.benched, oldId, newId);
      answers.clear();
      for (const [k, v] of s.log)
        answers.set(k, v);
    },
    toJSON: () => ({ ...s, benched: [...s.benched] })
  };
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
  return item(text[0] || url || media[0] || src, url, media, text.slice(1).join(" — "), tags);
}
function parseItems(raw) {
  const t = raw.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      let parsed = JSON.parse(t);
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.items))
        parsed = parsed.items;
      return (Array.isArray(parsed) ? parsed : [parsed]).map(fromJSON).filter((x) => !!x);
    } catch {}
  }
  return t.split(`
`).map((l) => l.trim()).filter(Boolean).map(parseLine);
}
var toText = (list) => list.map((i) => [i.title, i.url, ...i.media, i.tags.map((t) => "#" + t).join(" "), i.desc].filter(Boolean).join(" | ")).join(`
`);
// node_modules/@rascaltwo/pairwise-sorter/dist/analysis.js
function roc(rank, n) {
  let s = 0;
  for (let i = rank;i <= n; i++)
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
  const local = new Map;
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
  const pref = new Map;
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
  for (let i = 0;i < order.length; i++)
    for (let j = i + 1;j < order.length; j++)
      total += beats(pref, items, order[j], order[i]);
  return total;
}
function minimiseDisagreements(order, items, pref, maxPasses = 25) {
  let cur = [...order];
  for (let pass = 0;pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0;i < cur.length; i++) {
      const v = cur[i];
      const rest = cur.slice(0, i).concat(cur.slice(i + 1));
      let cost = rest.reduce((s, r) => s + beats(pref, items, r, v), 0);
      let best = 0, bestCost = cost, stay = cost;
      for (let at = 1;at <= rest.length; at++) {
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
  const perTier = new Map;
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
  const rankById = new Map;
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
// node_modules/@rascaltwo/pairwise-sorter/dist/store.js
var emptyList = (name) => ({ name, items: [], log: [], benched: [], priority: [], weights: [], combine: "order" });
var emptyLibrary = () => ({ version: SCHEMA, current: null, lists: {} });
var lists = (db) => Object.values(db.lists ?? {});
var MIGRATIONS = [
  (db) => {
    for (const l of lists(db)) {
      l.items = (Array.isArray(l.items) ? l.items : []).filter((it) => it && typeof it === "object").map((it) => item(it.title ?? "", it.url ?? "", it.media ?? [], it.desc ?? "", it.tags ?? []));
      l.log = Array.isArray(l.log) ? l.log : [];
      l.priority = (Array.isArray(l.priority) ? l.priority : []).filter((t) => typeof t === "string");
      l.weights = l.priority.map((_, i) => Number(l.weights?.[i]) > 0 ? Number(l.weights[i]) : 1);
      l.combine = l.combine === "weights" ? "weights" : "order";
    }
  },
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
  for (let v = from;v < SCHEMA; v++)
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
      } catch {}
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
    throw new Error(`no list named ${JSON.stringify(ref)} — have: ${Object.values(lib.lists).map((l) => l.name).join(", ")}`);
  throw new Error(`${hits.length} lists are named ${JSON.stringify(ref)} — pass an id instead: ${hits.join(", ")}`);
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
    comparisons: list.log.map(([k, verdict]) => {
      const [a = "", b = ""] = k.split(SEP);
      return { a: ref(a), b: ref(b), verdict };
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
    log.push(x < y ? [x + SEP + y, v] : [y + SEP + x, orient(v, -1)]);
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
var VERDICTS = new Set([-1, 0, 1]);

class Sorter extends EventTarget {
  list;
  question = null;
  #token = 0;
  #pending = null;
  #answers = new Map;
  #order = [];
  #partial = { placed: [], remaining: [] };
  #conflicts = new Map;
  #finished = false;
  #quiet = false;
  #waiters = [];
  constructor(list = emptyList("Untitled")) {
    super();
    this.open(list);
  }
  open(list) {
    list.log = (Array.isArray(list.log) ? list.log : []).filter((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && e[0].includes(SEP) && VERDICTS.has(e[1]));
    this.list = list;
    this.#run();
  }
  settled() {
    return new Promise((r) => this.#quiet ? r() : this.#waiters.push(r));
  }
  get complete() {
    return this.#finished;
  }
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
  undo() {
    if (this.list.log.length)
      this.#change(() => this.list.log.pop());
    return this.settled();
  }
  deleteAnswer(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.list.log.length)
      throw new Error(`no comparison at index ${i}`);
    return this.#change(() => this.list.log.splice(i, 1));
  }
  resetAnswers() {
    return this.#change(() => {
      this.list.log = [];
    });
  }
  bench(ids) {
    return this.#change(() => {
      this.list.benched = [...new Set([...this.list.benched, ...ids])];
    });
  }
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
  benchedItems() {
    const byId = new Map(this.list.items.map((it) => [idOf(it), it]));
    return this.list.benched.flatMap((id) => byId.get(id) ?? []);
  }
  setItems(next) {
    const byId = new Map, dupes = [];
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
  tags() {
    return [...new Set(this.list.items.flatMap((it) => it.tags))].sort();
  }
  setPriority(tiers) {
    const seen = new Map;
    for (const e of tiers) {
      const tag = tagOf(typeof e === "string" ? e : e.tag ?? e.name ?? "");
      const w = typeof e === "object" ? Number(e.weight) : 1;
      if (tag && !seen.has(tag))
        seen.set(tag, w > 0 ? w : 1);
    }
    const known = new Set(this.tags());
    const unknown = [...seen.keys()].filter((t) => !known.has(t));
    if (unknown.length)
      throw new Error(`no item carries ${unknown.map((t) => "#" + t).join(", ")} — have: ${[...known].join(", ") || "none"}`);
    return this.#change(() => {
      this.list.priority = [...seen.keys()];
      this.list.weights = [...seen.values()];
    });
  }
  setCombine(mode) {
    if (mode !== "order" && mode !== "weights")
      throw new Error("combine expects 'order' or 'weights'");
    return this.#change(() => {
      this.list.combine = mode;
    });
  }
  overrides() {
    const all = this.comparisons();
    return tierOverrides(this.list.items, this.list.log, this.list.priority).map((n) => all[n]);
  }
  dropOverrides() {
    const drop = new Set(tierOverrides(this.list.items, this.list.log, this.list.priority));
    return this.#change(() => {
      this.list.log = this.list.log.filter((_, n) => !drop.has(n));
    });
  }
  live() {
    const benched = new Set(this.list.benched);
    return this.list.items.map((_, i) => i).filter((i) => !benched.has(idOf(this.list.items[i])));
  }
  budget() {
    return tieredBudget(this.list.items, this.live(), this.list.priority);
  }
  placement() {
    return placement(this.#partial);
  }
  ranking() {
    const src = this.#finished ? this.#order : this.#partial.placed;
    return rankRows(src, this.list.items, this.list.log).rows.map((r) => ({ ...r, item: this.list.items[r.index] }));
  }
  unplaced() {
    return this.#partial.remaining.map((i) => this.list.items[i]);
  }
  comparisons() {
    const byId = new Map(this.list.items.map((it) => [idOf(it), it]));
    const ref = (id) => {
      const it = byId.get(id);
      return it ? { title: it.title, url: it.url } : idParts(id);
    };
    return this.list.log.map(([k, verdict], index) => {
      const [x = "", y = ""] = k.split(SEP);
      return { index, a: ref(x), b: ref(y), verdict, why: this.#conflicts.get(index) ?? null };
    });
  }
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
  async#run() {
    const my = ++this.#token;
    this.#pending = null;
    this.question = null;
    this.#quiet = false;
    this.#finished = false;
    this.#order = [];
    this.#partial = { placed: [], remaining: [] };
    this.#conflicts = new Map;
    this.#answers = new Map(this.list.log);
    await null;
    if (my !== this.#token)
      return;
    const { items } = this.list;
    const sorted = await sortIndices(this.live(), (a, b) => this.#cmp(a, b, my), ({ placed, remaining, next }) => {
      this.#partial = { placed, remaining };
      if (next !== undefined)
        this.#emit("upcoming", [next]);
    }, ({ out, lo, hi, mid }) => this.#emit("upcoming", [out[lo + mid >> 1], out[mid + 1 + hi >> 1]].filter((i) => i !== undefined)));
    this.#order = weightedOrder(sorted, items, this.list.priority, this.list.weights, this.list.combine);
    this.#partial = { placed: [...sorted], remaining: [] };
    this.#conflicts = findConflicts(this.list.log, rankRows(this.#order, items, this.list.log).rankById);
    this.#finished = true;
    this.#emit("done");
    this.#settle();
  }
  #cmp(a, b, my) {
    const { items } = this.list;
    const ia = idOf(items[a]), ib = idOf(items[b]);
    const k = pairKeyOf(ia, ib), flip = flipOfIds(ia, ib);
    const known = this.#answers.get(k);
    if (known !== undefined)
      return orient(known, flip);
    const tier = tierVerdict(items[a], items[b], this.list.priority);
    if (tier !== null)
      return tier;
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
}
export {
  weightedOrder,
  toText,
  tieredBudget,
  tierVerdict,
  tierOverrides,
  tierOf,
  tierName,
  tieClasses,
  tagOf,
  sortIndices,
  roc,
  resolveList,
  rankRows,
  preferences,
  placement,
  parseLine,
  parseItems,
  pairKeyOf,
  orient,
  minimiseDisagreements,
  migrateId,
  migrate,
  localStore,
  item,
  isVideo,
  isMedia,
  isAudio,
  importList,
  idParts,
  idOf,
  fromJSON,
  flipOfIds,
  findConflicts,
  exportList,
  emptyList,
  emptyLibrary,
  disagreements,
  deleteList,
  createEngine,
  budgetFor,
  addList,
  Sorter,
  STOP_AT,
  SEP_ID,
  SEP,
  SCHEMA
};

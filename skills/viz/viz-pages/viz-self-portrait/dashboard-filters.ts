// The scope, tag and axis filters and the sort: reading their controls, applying them to a list, and
// keeping them in the URL.
import { $, byKind } from "./dashboard-dom.js";
import { esc } from "./dashboard-format.js";
import { gitFor, state } from "./dashboard-state.js";
import type { Slug } from "./dashboard-types.js";

// Scope filter options = one per container (place). Label central as its own path,
// externals by their host repo path. Rebuilt only when the container set changes so
// it never clobbers the current selection or an open dropdown on the 5s poll.
let scopeSig = "";
export function populateScope(slugs: Slug[]): void {
  const map = new Map<string, { value: string; isCentral: boolean; label: string }>();
  for (const s of slugs) {
    if (map.has(s.container)) continue;
    map.set(s.container, {
      value: s.container,
      isCentral: s.isCentral,
      label: s.isCentral ? ".agents/state/viz" : s.host + "/viz-pages",
    }); // api/slugs gives every non-central row a host
  }
  const conts = [...map.values()].toSorted(
    (a, b) => +b.isCentral - +a.isCentral || a.label.localeCompare(b.label),
  );
  const sig = conts.map((c) => c.value).join("|");
  if (sig === scopeSig) return;
  scopeSig = sig;
  const sel = byKind("#f-scope", HTMLSelectElement),
    cur = sel.value;
  sel.innerHTML =
    '<option value="">all</option>' +
    conts.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join("");
  sel.value = conts.some((c) => c.value === cur) ? cur : "";
}

// Tag filter — dropdown adds a tag to activeTags (OR semantics), each shown as a removable
// pill. Options rebuilt only when the (all-tags − active) set changes, so the 5s poll never
// clobbers an open dropdown.
export const activeTags = new Set<string>();
let tagSig = "";
export function renderTagFilter(slugs: Slug[]): void {
  document.querySelector("#tag-pills")!.innerHTML = [...activeTags]
    .toSorted()
    .map(
      (t) =>
        `<span class="tag-pill">${esc(t)}<button data-tag-rm="${esc(t)}" title="remove">✕</button></span>`,
    )
    .join("");
  const all = [...new Set(slugs.flatMap((s) => s.tags))]
    .filter((t) => !activeTags.has(t))
    .toSorted();
  const sig = all.join("|");
  if (sig !== tagSig) {
    tagSig = sig;
    byKind("#f-tag", HTMLSelectElement).innerHTML =
      '<option value="">add tag…</option>' +
      all.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  }
}

// ---- Filter + sort controls (client-side over the fast snapshot) -------
export interface Filters {
  sortKey: string;
  sortDir: string | undefined;
  posture: string;
  listed: string;
  approved: string;
  card: string;
  api: string;
  scope: string;
  kind: string;
  tags: string[];
  originals: boolean;
  all: boolean;
}
export function filterState(): Filters {
  const v = (id: string) => byKind(`#${id}`, HTMLSelectElement).value;
  return {
    sortKey: v("sort-key"),
    sortDir: $("#sort-dir").dataset["dir"],
    posture: v("f-posture"),
    listed: v("f-listed"),
    approved: v("f-approved"),
    card: v("f-card"),
    api: v("f-api"),
    scope: v("f-scope"),
    kind: v("f-kind"),
    tags: [...activeTags],
    originals: byKind("#f-originals", HTMLInputElement).checked,
    all: byKind("#f-all", HTMLInputElement).checked,
  };
}
export function applyFilters(list: Slug[], f: Filters): Slug[] {
  return list.filter((s) => passesAxisFilters(s, f) && passesOtherFilters(s, f));
}
function passesAxisFilters(s: Slug, f: Filters): boolean {
  if (f.tags.length > 0 && !s.tags.some((t) => f.tags.includes(t))) return false; // OR within tags
  if (f.posture && s.posture !== f.posture) return false;
  if (f.listed === "listed" && !s.listed) return false;
  if (f.listed === "unlisted" && s.listed) return false;
  if (f.approved && s.approval !== f.approved) return false;
  return true;
}
function passesOtherFilters(s: Slug, f: Filters): boolean {
  if (f.card && s.cardPublic !== f.card) return false;
  if (f.api === "yes" && !s.hasApi) return false;
  if (f.api === "no" && s.hasApi) return false;
  // Empty string means "no kind" = a plain page, which the
  // lobby names `page`. Normalise here so the two surfaces agree.
  if (f.kind && (s.kind || "page") !== f.kind) return false;
  if (f.scope && s.container !== f.scope) return false;
  if (f.originals && s.mirroredIn) return false;
  return true;
}
const SORT_KEYS: Record<string, (s: Slug) => string | number> = {
  modified: (s) => s.mtime,
  created: (s) => s.created,
  name: (s) => s.name.toLowerCase(),
  size: (s) => s.sizeBytes,
  files: (s) => s.fileCount,
  commits: (s) => gitFor(s.id)?.commitCount ?? -1,
};
export const NATURAL_DIR: Record<string, string> = {
  modified: "desc",
  created: "desc",
  name: "asc",
  size: "desc",
  files: "desc",
  commits: "desc",
};
export function sortSlugs(list: Slug[], f: Filters): Slug[] {
  const key = SORT_KEYS[f.sortKey]!; // the <select> offers only these keys
  const dir = f.sortDir === "asc" ? 1 : -1;
  return list.toSorted((a, b) => {
    const va = key(a),
      vb = key(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.name.localeCompare(b.name); // stable tiebreak by name
  });
}
export function markActiveControls(f: Filters): void {
  for (const id of FILTER_IDS)
    byKind(`#${id}`, HTMLSelectElement).classList.toggle(
      "active",
      !!byKind(`#${id}`, HTMLSelectElement).value,
    );
  byKind("#f-tag", HTMLSelectElement).classList.toggle("active", activeTags.size > 0);
  document.querySelector(".ctl-check")!.classList.toggle("active", f.originals);
  document.querySelector("#f-all-label")!.classList.toggle("active", f.all);
  persistFilters(f);
}

// ---- Filter state in the URL -----------------------------------------
// A filtered view is worth sharing, and the server's hot-reload is a full
// page refresh that would otherwise drop every filter you had set.
//
// NOT the kit's saveHash(): it serialises JSON into the hash, which would
// overwrite the "#dashboard" the tab shell routes on. The tab owns the
// hash; filters ride behind "&", which the tab router already splits off.
export const FILTER_IDS = [
  "f-posture",
  "f-listed",
  "f-approved",
  "f-card",
  "f-api",
  "f-scope",
  "f-kind",
];

function persistFilters(f: Filters) {
  // The Dashboard re-renders every 5s whether or not you are looking at it,
  // and this used to write "#dashboard&…" unconditionally — so reading the
  // Guide silently rewrote the URL out from under you, clobbering the guide's
  // own "&stop=" state. Only the visible tab owns the hash.
  if (!document.querySelector("#tab-dashboard")!.classList.contains("active")) return;
  const q = new URLSearchParams();
  for (const id of FILTER_IDS) {
    const v = byKind(`#${id}`, HTMLSelectElement).value;
    if (v) q.set(id.slice(2), v);
  }
  if (f.sortKey && f.sortKey !== "modified") q.set("sort", f.sortKey); // the default stays out of the URL
  if (f.sortDir === "asc") q.set("dir", "asc");
  if (f.originals) q.set("originals", "1");
  if (f.all) q.set("all", "1");
  if (activeTags.size > 0) q.set("tags", [...activeTags].join(","));
  const search = byKind("#slug-search", HTMLInputElement).value.trim();
  if (search) q.set("q", search);
  const tail = q.toString();
  const next = "#dashboard" + (tail ? "&" + tail : "");
  if (location.hash !== next) history.replaceState(null, "", next);
}

export function restoreFilters(fromHash?: string): void {
  // On boot, read the ORIGINAL hash (see window.__initialHash). On a later
  // hashchange, read the new one — pasting a filtered link into an already
  // open tab is a same-document navigation, so nothing re-inits by itself.
  const tail = (fromHash ?? window.__initialHash).replace(/^#[^&]*&?/u, "");
  if (tail) {
    const q = new URLSearchParams(tail);
    for (const id of FILTER_IDS) {
      const v = q.get(id.slice(2)),
        sel = byKind(`#${id}`, HTMLSelectElement);
      if (!v) continue;
      // Scope and most kinds are options the first render adds; until then, hold the value in
      // one of its own (the render keeps it if the library has it, and drops it if not).
      if (![...sel.options].some((o) => o.value === v)) sel.add(new Option(v, v));
      sel.value = v;
    }
    // Only a key the <select> offers: an old link's sort=recent would blank it, and the list with it.
    const sortSel = byKind("#sort-key", HTMLSelectElement),
      sort = q.get("sort");
    if (sort && [...sortSel.options].some((o) => o.value === sort)) sortSel.value = sort;
    if (q.get("dir") === "asc") setSortDir("asc");
    if (q.get("originals")) byKind("#f-originals", HTMLInputElement).checked = true;
    if (q.get("all")) byKind("#f-all", HTMLInputElement).checked = true;
    for (const t of (q.get("tags") ?? "").split(",").filter(Boolean)) activeTags.add(t);
    if (q.get("q")) byKind("#slug-search", HTMLInputElement).value = q.get("q")!;
  }
  // "show all" is remembered across visits (like the list/grid view); a link's &all=1 still wins.
  if (fromHash === undefined)
    try {
      if (localStorage.getItem("sp-show-all") === "1")
        byKind("#f-all", HTMLInputElement).checked = true;
    } catch {
      /* storage blocked: stay on the default */
    }
  state.filtersReady = true;
}

export function setSortDir(dir: string): void {
  const b = $("#sort-dir");
  b.dataset["dir"] = dir;
  b.textContent = dir === "asc" ? "↑" : "↓";
}

// Wiring of the list's own controls: search box, posture/kind bars, filter selects, view and sort.
import { $, byKind, closestTo } from "./dashboard-dom.js";
import { activeTags, FILTER_IDS, setSortDir, NATURAL_DIR } from "./dashboard-filters.js";
import { ICONS } from "./dashboard-format.js";
import { renderSlugs } from "./dashboard-list.js";
import { state } from "./dashboard-state.js";

// ---- Search wiring -----------------------------------------------------
const searchEl = byKind("#slug-search", HTMLInputElement);
document.querySelector("#search-icon")!.innerHTML = ICONS.search;
// Re-render rows from the last snapshot on every keystroke — no refetch.
searchEl.addEventListener("input", () => renderSlugs(state.lastSlugs));
searchEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    searchEl.value = "";
    renderSlugs(state.lastSlugs);
    searchEl.blur();
  }
});
// ⌘/Ctrl+F and "/" focus this box instead of the (futile) browser find.
window.addEventListener("keydown", (e) => {
  const typing = document.activeElement === searchEl;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
  } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    searchEl.focus();
  }
});

// The posture bar is a chart AND the posture filter. Delegated on the
// container, which survives every re-render of its contents. Clicking the
// segment that's already active clears the filter, so the bar is a toggle
// rather than a one-way trip that leaves you hunting for the reset button.
$("#slug-totals").addEventListener("click", (e) => {
  const pseg = closestTo(e, ".pb-seg");
  if (pseg) {
    const sel = byKind("#f-posture", HTMLSelectElement);
    sel.value = sel.value === pseg.dataset["posture"] ? "" : pseg.dataset["posture"]!;
    return renderSlugs(state.lastSlugs);
  }
  const sseg = closestTo(e, ".sb-seg");
  if (sseg) {
    const sel = byKind("#f-kind", HTMLSelectElement);
    sel.value = sel.value === sseg.dataset["kind"] ? "" : sseg.dataset["kind"]!;
    return renderSlugs(state.lastSlugs);
  }
});

[...FILTER_IDS, "f-originals", "f-all"].forEach((id) =>
  $(`#${id}`).addEventListener("change", () => renderSlugs(state.lastSlugs)),
);
byKind("#f-all", HTMLInputElement).addEventListener("change", (e) => {
  try {
    localStorage.setItem(
      "sp-show-all",
      e.target instanceof HTMLInputElement && e.target.checked ? "1" : "0",
    );
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
});
// Tag dropdown ADDS to the active set (doesn't replace) — that's how one <select> gives the
// lobby's multi-tag behavior. Pills remove on click.
byKind("#f-tag", HTMLSelectElement).addEventListener("change", (e) => {
  const sel = e.target;
  if (sel instanceof HTMLSelectElement && sel.value) {
    activeTags.add(sel.value);
    sel.value = "";
    renderSlugs(state.lastSlugs);
  }
});
$("#tag-pills").addEventListener("click", (e) => {
  const b = closestTo(e, "[data-tag-rm]");
  if (b) {
    activeTags.delete(b.dataset["tagRm"]!);
    renderSlugs(state.lastSlugs);
  }
});
// List / grid view toggle — flips a class on #slugs (same markup, CSS reflow); choice persists.
const viewSeg = $("#slug-view");
function setView(v: string) {
  document.querySelector("#slugs")!.classList.toggle("cards", v === "cards");
  for (const b of viewSeg.querySelectorAll("button"))
    b.classList.toggle("on", b.dataset["view"] === v);
  try {
    localStorage.setItem("sp-view", v);
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
}
viewSeg.addEventListener("click", (e) => {
  const b = closestTo(e, "button[data-view]");
  if (b) setView(b.dataset["view"]!);
});
setView(
  (() => {
    try {
      return localStorage.getItem("sp-view") ?? "list";
    } catch {
      return "list";
    }
  })(),
);
byKind("#sort-key", HTMLSelectElement).addEventListener("change", () => {
  setSortDir(NATURAL_DIR[byKind("#sort-key", HTMLSelectElement).value]!); // sensible default per key
  renderSlugs(state.lastSlugs);
});
$("#sort-dir").addEventListener("click", () => {
  setSortDir($("#sort-dir").dataset["dir"] === "asc" ? "desc" : "asc");
  renderSlugs(state.lastSlugs);
});
$("#filters-reset").addEventListener("click", () => {
  for (const id of FILTER_IDS) byKind(`#${id}`, HTMLSelectElement).value = "";
  activeTags.clear();
  byKind("#f-originals", HTMLInputElement).checked = false;
  byKind("#f-all", HTMLInputElement).checked = false;
  try {
    localStorage.setItem("sp-show-all", "0");
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
  byKind("#sort-key", HTMLSelectElement).value = "modified";
  setSortDir("desc");
  renderSlugs(state.lastSlugs);
});

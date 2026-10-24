// The tab shell (Guide / Dashboard / Rank). What other scripts use is put on window below: showTab
// (inline onclick handlers), __initialHash, and the guide:shown event.
import { restoreFilters } from "./dashboard-filters.js";
import { renderSlugs } from "./dashboard-list.js";
import { state } from "./dashboard-state.js";

// ---- tab shell: Guide / Dashboard ----
// README and Quick Start collapsed into the Guide's first two bands. Their
// old hashes still resolve — #quickstart lands on the band that replaced it,
// so links published before the rebuild don't 404 into an empty page.
const TABS = ["guide", "dashboard", "rank"];
const HASH_ALIAS: Record<string, [string, string | null]> = {
  readme: ["guide", null],
  quickstart: ["guide", "install"],
};

// The hash exactly as the page was opened with, captured before anything
// rewrites it. Both the guide's "&stop=" deep link and the Dashboard's
// "&posture=…" filter state live in the tail, and this classic script runs
// BEFORE any module — so without snapshotting here, showTab() below would
// strip the tail and every deep link would silently degrade to defaults.
window.__initialHash = location.hash;

function showTab(name: string, stop?: string | null) {
  // name: one of TABS — every caller passes one
  for (const t of TABS) {
    document.querySelector("#tab-" + t)!.classList.toggle("active", t === name);
    document.querySelector("#tabbtn-" + t)!.classList.toggle("active", t === name);
  }
  try {
    localStorage.setItem("viz-sp-seen", "1");
  } catch {
    /* storage blocked: the Guide just shows first again */
  }
  // Rewrite the hash only when the TAB actually changes. Comparing against
  // the whole hash meant arriving at "#dashboard&posture=local" instantly
  // rewrote it to "#dashboard", destroying the state before the Dashboard
  // could restore from it.
  const curTab = location.hash.replace("#", "").split("&")[0];
  if (curTab !== name) history.replaceState(null, "", "#" + name);
  if (name === "guide") {
    // the rail measures document geometry, which is only real once visible
    window.dispatchEvent(new CustomEvent("guide:shown", { detail: { stop } }));
  }
  if (!stop) window.scrollTo(0, 0);
}
window.showTab = showTab;

function routeHash() {
  const h = location.hash.replace("#", "").split("&")[0]!;
  if (TABS.includes(h)) {
    showTab(h);
    // Re-apply any filter tail that came with it — unless the Dashboard never booted (the
    // api isn't live), when there is nothing to filter.
    if (h === "dashboard" && state.filtersReady) {
      restoreFilters(location.hash);
      renderSlugs(state.lastSlugs);
    }
    return;
  }
  if (HASH_ALIAS[h]) return showTab(...HASH_ALIAS[h]);
}
window.addEventListener("hashchange", routeHash);

(function initTab() {
  const h = location.hash.replace("#", "").split("&")[0]!;
  let seen = false;
  try {
    seen = !!localStorage.getItem("viz-sp-seen");
  } catch {
    /* storage blocked: treat as a first visit */
  }
  if (TABS.includes(h)) return showTab(h);
  if (HASH_ALIAS[h]) {
    // Resolved to the canonical hash, as if the page had been opened by it: the guide boots
    // later, and reads its stop from __initialHash (guide:shown fires before it listens).
    const [tab, stop] = HASH_ALIAS[h];
    history.replaceState(
      null,
      "",
      (window.__initialHash = "#" + tab + (stop ? "&stop=" + stop : "")),
    );
    return showTab(tab, stop);
  }
  // first-timers land on the Guide, returning visitors on the Dashboard
  showTab(seen ? "dashboard" : "guide");
})();

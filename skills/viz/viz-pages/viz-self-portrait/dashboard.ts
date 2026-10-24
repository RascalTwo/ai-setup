// A module (served with a source map, so verify measures it). The Dashboard is one module per
// section, each named dashboard-<section>.ts; this one boots them. What other scripts use is put on
// window by dashboard-tabs.ts: showTab (inline onclick handlers), __initialHash, and the guide:shown event.
import { fire } from "./dashboard-dom.js";
import { loadCommits, loadFast, loadGit, rescanBtn } from "./dashboard-feed.js";
import { restoreFilters } from "./dashboard-filters.js";
/* oxlint-disable import/no-unassigned-import -- these modules are wiring: importing one attaches its listeners */
import "./dashboard-tabs.js";
import "./dashboard-preview.js";
import "./dashboard-controls.js";
import "./dashboard-acts.js";
/* oxlint-enable import/no-unassigned-import */

// ---- Boot --------------------------------------------------------------
// Live data only means anything with a running server behind us. Detect the
// environment (this is the kit's vizEnv(), inlined since this standalone page
// doesn't import the module): a static publish (window.__VIZ_STATIC__, stamped
// by viz publish) or an unreachable server → show a "run me locally" placeholder in
// each live region and skip all fetching / auto-refresh. Live → business as usual.
async function vizEnv() {
  if (window.__VIZ_STATIC__) return "static";
  try {
    return (await fetch("/_health", { cache: "no-store" })).ok ? "live" : "offline";
  } catch {
    return "offline";
  }
}
async function boot(): Promise<void> {
  const env = await vizEnv();
  if (env !== "live") {
    const why =
      env === "static"
        ? "This is a static copy — there's no live server behind it."
        : "The viz server isn't reachable right now.";
    const ph = (what: string) =>
      '<div style="padding:26px 20px; text-align:center; color:var(--muted); line-height:1.7; ' +
      'border:1px dashed var(--border); border-radius:10px; background:var(--panel)">' +
      '🔌 <b style="color:var(--text)">Live only.</b> ' +
      why +
      "<br>Run <code>/viz</code> locally and open the " +
      "self-portrait to see " +
      what +
      " here.</div>";
    document.querySelector("#slug-totals")!.innerHTML = "";
    document.querySelector("#git-status")!.textContent = "";
    document.querySelector("#slugs")!.innerHTML = ph("your live library");
    document.querySelector("#server-info")!.innerHTML = ph("server status");
    document.querySelector("#commits")!.innerHTML = ph("recent commits");
    rescanBtn.style.display = "none";
    // Nothing to search, filter or sort: without this, typing in the search box replaced the
    // "Live only" placeholder with "no viz matches".
    for (const el of document.querySelectorAll<HTMLInputElement>(
      "#slug-search, #slug-controls select, #slug-controls input, #slug-controls button",
    ))
      el.disabled = true;
    return;
  }
  document.querySelector("#git-status")!.textContent = "· git feed loading…";
  restoreFilters(); // must precede the first render, or it renders unfiltered
  fire(loadFast());
  fire(loadCommits());
  fire(loadGit()); // slow feed: once on load (and again after rescan)
  setInterval(() => {
    fire(loadFast());
  }, 5000);
  setInterval(() => {
    fire(loadCommits());
  }, 30000);
}
// oxlint-disable-next-line unicorn/prefer-top-level-await -- awaiting here would hold this module's evaluation, and the page's load event, on the network
fire(boot());

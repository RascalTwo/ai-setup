// The data loops: the 5s server-info + slugs poll, the slow git feed, the commit log and the rescan button.
import { byKind, fire } from "./dashboard-dom.js";
import { esc, fmtUptime, ICONS } from "./dashboard-format.js";
import { renderSlugs } from "./dashboard-list.js";
import { getJson } from "./dashboard-net.js";
import { commitSlug, matchesAny, parseHidden } from "./dashboard-search.js";
import { state } from "./dashboard-state.js";
import type { Slug, ServerInfo, Commit } from "./dashboard-types.js";

export async function loadGit(): Promise<void> {
  try {
    state.gitFeed = await getJson<Record<string, { commitCount: number }>>("api/slugs-git");
    state.gitLoaded = true;
    document.querySelector("#git-status")!.textContent = "";
    renderSlugs(state.lastSlugs);
  } catch (e) {
    console.error("loadGit failed:", e);
  }
}

function renderCommits(allCommits: Commit[]) {
  const hidden = parseHidden();
  const commits = allCommits.filter((c) => {
    const slug = commitSlug(c.subject);
    return !slug || !matchesAny(slug, hidden.commits);
  });
  document.querySelector("#commit-total")!.textContent =
    commits.length === 0 ? "" : "(" + commits.length + ")";
  document.querySelector("#commits")!.innerHTML =
    commits.length === 0
      ? '<div style="color: var(--muted)">no commits yet</div>'
      : commits
          .map(
            (c) => `<div class="commit">
          <span class="commit-hash">${esc(c.hash)}</span>${esc(c.subject)}<br>
          <span class="commit-when">${esc(c.when)}</span>
        </div>`,
          )
          .join("");
}

function renderServer(info: ServerInfo) {
  document.querySelector("#server-info")!.innerHTML = [
    ["bun", info.bunVersion],
    ["pid", info.pid],
    ["uptime", fmtUptime(info.uptimeSec)],
    ["port", info.port],
    ["containers", info.containers],
  ]
    .map(([k, v]) => `<div class="row"><span class="k">${k}</span><span>${esc(v)}</span></div>`)
    .join("");
  // These two used to be <text> nodes inside the runtime architecture SVG on
  // the old README tab. That diagram is gone (the Guide traces the runtime
  // interactively instead), so they're optional now — re-homed into the
  // Dashboard's stat row below. Guarded rather than deleted so the values
  // stay wired if either element exists.
  state.lastServerInfo = info;
  // Write into the value element, not the whole cell — the cell carries its
  // own <i> label now, and textContent on the parent would delete it.
  const upEl = document.querySelector("#server-uptime b");
  if (upEl) upEl.textContent = fmtUptime(info.uptimeSec);
  const ctEl = document.querySelector("#server-containers b");
  if (ctEl) ctEl.textContent = String(info.containers);
}

// ---- Fast loop (5s): server-info + slugs only. NO git feed here. -------
export async function loadFast(): Promise<void> {
  try {
    const [info, slugs]: [ServerInfo, Slug[]] = await Promise.all([
      getJson<ServerInfo>("api/server-info"),
      getJson<Slug[]>("api/slugs"),
    ]);
    renderServer(info);
    // An open drawer holds live form state — don't clobber it on the 5s poll.
    // Keep the snapshot fresh so closing/re-rendering shows current data.
    if (state.openDrawerId) state.lastSlugs = slugs;
    else renderSlugs(slugs);
  } catch (e) {
    console.error("loadFast failed:", e);
  }
}

export async function loadCommits(): Promise<void> {
  try {
    renderCommits(await getJson<Commit[]>("api/log"));
  } catch (e) {
    console.error("loadCommits failed:", e);
  }
}

// ---- Rescan button -----------------------------------------------------
export const rescanBtn = byKind("#rescan-btn", HTMLButtonElement);
document.querySelector("#rescan-icon")!.innerHTML = ICONS.refresh;
rescanBtn.addEventListener("click", () => {
  fire(rescan());
});
async function rescan(): Promise<void> {
  rescanBtn.disabled = true;
  rescanBtn.classList.add("scanning");
  document.querySelector("#rescan-label")!.textContent = "scanning…";
  document.querySelector("#git-status")!.textContent = "· git feed refreshing…";
  state.gitLoaded = false; // force "—" placeholders until the fresh git feed lands
  try {
    // /_rescan is an ABSOLUTE server route (not under this viz's api/).
    await getJson<unknown>("/_rescan");
    // Re-pull fast feed (slugs/containers may have changed) + slow git feed.
    await loadFast();
    await loadGit();
  } catch (e) {
    console.error("rescan failed:", e);
    await loadGit(); // the commit counts were blanked for the rescan: bring them back
  } finally {
    rescanBtn.disabled = false;
    rescanBtn.classList.remove("scanning");
    document.querySelector("#rescan-label")!.textContent = "Rescan $HOME";
  }
}
export async function refreshAfter(): Promise<void> {
  await loadFast();
  await loadGit();
}

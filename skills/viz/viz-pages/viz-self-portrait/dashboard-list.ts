// The library list: each viz's row, and the render that filters, sorts and draws them.
import { byKind } from "./dashboard-dom.js";
import { drawerHtml } from "./dashboard-drawer.js";
import {
  applyFilters,
  filterState,
  markActiveControls,
  populateScope,
  renderTagFilter,
  sortSlugs,
} from "./dashboard-filters.js";
import { esc, fmtAgo, fmtSize, ICONS } from "./dashboard-format.js";
import { currentTerms, hl, matchesAny, matchTerms, parseHidden } from "./dashboard-search.js";
import { renderStatBand } from "./dashboard-statband.js";
import { gitFor, state } from "./dashboard-state.js";
import type { Slug } from "./dashboard-types.js";

// Render the per-viz axis badges (posture · listed) read live from <head>.
const POSTURE_ICON: Record<string, keyof typeof ICONS> = {
  public: "globe",
  private: "lock",
  local: "home",
  untagged: "alert",
};
function axisBadges(s: Slug) {
  const p = s.posture;
  const parts = [
    `<span class="axis ${p}" title="posture: ${p} — ${p === "public" ? "hosted as-is" : p === "private" ? "sealed, magic-link only" : p === "local" ? "never published" : "no viz:posture — publish would refuse"}">${ICONS[POSTURE_ICON[p]!]}${p}</span>`,
  ];
  if (s.linkedFrom.length > 0)
    parts.push(
      `<span class="axis linked" title="linked from: ${esc(s.linkedFrom.join(" · "))} — move, delete and posture changes refuse (ADR 0016)">🔗 linked</span>`,
    );
  if (s.cardPublic === "public")
    parts.push(
      `<span class="axis linked" title="card public — a public build with --base-url emits an unfurlable /share/${esc(s.name)}/ page (ADR 0018)">🪪 card public</span>`,
    );
  else if (s.cardPublic === "not-public")
    parts.push(
      `<span class="axis kind" title="card reviewed and deliberately NOT public — no share page (ADR 0018)">🪪 card not public</span>`,
    );
  else if (s.cardPublic === "stale")
    parts.push(
      `<span class="axis unlisted" title="card changed (slug, title, description or hero) since it was reviewed as ${esc(s.cardWas.replace("-", " "))} — no share page until re-reviewed">🪪 card stale (was ${esc(s.cardWas.replace("-", " "))})</span>`,
    );
  if (!s.listed)
    parts.push(
      `<span class="axis unlisted" title="unlisted — built &amp; reachable by URL, but off the lobby">unlisted</span>`,
    );
  // Kind — badge ONLY when there is one. 166 of 235 vizzes are plain
  // pages, so a "page" pill on every row is noise, not information. The
  // generated lobby makes the same call; the axis is still *filterable* to
  // `page` from the control above, which is where the absent case belongs.
  if (s.template)
    parts.push(
      `<span class="axis kind"${s.mirroredIn ? "" : ' data-act="from-open"'} title="viz:template = ${s.template} — a template: \`viz create <slug> --from ${esc(s.name)}\` starts a new ${s.template} from it.${s.mirroredIn ? "" : " Click: new from this."}">${s.template.replace("-", " ")} template</span>`,
    );
  else if (s.kind)
    parts.push(
      `<span class="axis kind" title="viz:page-kind = ${s.kind} — the kind of template this page was made from. A structural fact, never edited afterwards.">${s.kind.replace("-", " ")}</span>`,
    );
  return `<span class="slug-axes">${parts.join("")}</span>`;
}
// Tag chips: show up to 3 inline; the rest collapse into a +N that lists all on hover.
function tagChips(s: Slug) {
  const tags = s.tags;
  if (tags.length === 0) return "";
  const shown = tags
    .slice(0, 3)
    .map((t) => `<span class="tag-chip" title="tag">${esc(t)}</span>`)
    .join("");
  const extra =
    tags.length > 3
      ? `<span class="tag-chip more" title="${esc(tags.join(", "))}">+${tags.length - 3}</span>`
      : "";
  return `<span class="slug-tags">${shown}${extra}</span>`;
}

export function renderSlugs(allSlugs: Slug[]): void {
  const hidden = parseHidden();
  // A hidden-tagged viz (viz.config.json hiddenTags, ADR 0020) drops out HERE, before the
  // stats and tag list, so "show all" off means it isn't counted either — as in viz ls.
  const showAll = byKind("#f-all", HTMLInputElement).checked;
  const slugs = allSlugs.filter((s) => !matchesAny(s.id, hidden.slugs) && (showAll || !s.hidden));
  state.lastSlugs = allSlugs;
  populateScope(slugs);
  renderTagFilter(slugs);

  renderStatBand(slugs.filter((s) => !s.isMirror));

  // Search filters only the RENDERED rows — the totals + diagram stats above
  // still describe the whole library, so they don't lurch around while typing.
  const terms = currentTerms();
  const f = filterState();
  markActiveControls(f);
  const shown = sortSlugs(
    applyFilters(slugs, f).filter((s) => matchTerms(s, terms)),
    f,
  );
  // The row's age badge tracks whatever time axis you're sorting on; any non-time sort falls back to modified.
  const timeField = f.sortKey === "created" ? "created" : "modified";

  const narrowed = terms.length > 0 || shown.length !== slugs.length;
  const countEl = document.querySelector("#search-count")!;
  countEl.textContent = narrowed ? `${shown.length} / ${slugs.length}` : "";
  countEl.classList.toggle("zero", narrowed && shown.length === 0);

  document.querySelector("#slugs")!.innerHTML =
    shown.length === 0
      ? `<div style="color: var(--muted)">${
          terms.length > 0
            ? `no viz matches “${esc(terms.join(" "))}”`
            : narrowed
              ? "no viz matches the current filters"
              : "none yet"
        }</div>`
      : shown.map((s) => slugRowHtml(s, terms, timeField)).join("");
}

/** While searching, the full path (highlighted) instead of just the host: that's how a
 *  path-only match becomes visible. Otherwise the compact host line for external vizzes. */
function slugSubHtml(s: Slug, terms: string[]): string {
  if (terms.length > 0) return `<span class="slug-path">${hl(s.id, terms)}</span>`;
  if (s.isMirror)
    return `<span class="slug-host" title="publish-mirror row from ${esc(s.mirrorFrom)} — single-file, build-time only">↳ mirror ← ${esc(s.mirrorFrom)}</span>`;
  if (s.isVendored)
    return `<span class="slug-host" title="vendored full copy of ${esc(s.mirrorFrom)} — runs standalone; edit the origin and re-sync">↳ vendored ← ${esc(s.mirrorFrom)}</span>`;
  if (!s.isCentral)
    return `<span class="slug-host" title="host repo: ${esc(s.host)}">↳ ${esc(s.host)}</span>`;
  return "";
}
function slugThumbHtml(s: Slug, vizHref: string): string {
  return s.og
    ? `<span class="slug-thumb" style="background-image:url('${vizHref}${s.og}')" title="${esc(s.description || "OG preview (" + s.og + ")")}"></span>`
    : `<span class="slug-thumb empty" title="no OG preview image"></span>`;
}
function apiIconHtml(s: Slug): string {
  return `<span class="icon-only ${s.hasApi ? "api-on" : "api-off"}" title="${s.hasApi ? "has api.ts" : "no api.ts"}">
                ${s.hasApi ? ICONS.zap : ICONS.zapOff}
              </span>`;
}
function heroIconHtml(s: Slug, vizHref: string): string {
  return s.hero
    ? `<a class="icon-only hero-on" href="${vizHref}hero.html" target="_blank" rel="noopener" title="has hero.html — the OG card source (click to open)">${ICONS.image}</a>`
    : `<span class="icon-only hero-off" title="no hero.html OG card">${ICONS.image}</span>`;
}
function specLinkHtml(s: Slug, vizHref: string): string {
  return s.hasSpec
    ? `<a class="icon-only hero-on" href="${vizHref}.verify/tests/spec.html" target="_blank" rel="noopener" title="its living spec, generated from its tests: features, scenarios, steps, pass/fail (viz spec)">spec</a>`
    : "";
}
function mirrorIconHtml(s: Slug): string {
  if (s.mirroredIn)
    return `<span class="icon-only mirror-on" title="${s.isVendored ? "vendored full copy of " + esc(s.mirrorFrom) + " — runs standalone; edit the origin and re-sync" : "mirrored-in copy from " + esc(s.mirrorFrom ?? "") + " — edit the origin viz, not this sink"}">${ICONS.link}</span>`;
  if (s.vendoredOut.length > 0)
    return `<span class="icon-only mirror-src" title="origin viz — vendored (full copy) into: ${esc(s.vendoredOut.join(", "))}">${ICONS.link}</span>`;
  if (s.mirrorsOut.length > 0)
    return `<span class="icon-only mirror-src" title="origin viz — publish-mirrored to: ${esc(s.mirrorsOut.join(", "))}">${ICONS.link}</span>`;
  return `<span class="icon-only mirror-off" title="not mirrored">${ICONS.link}</span>`;
}
function manageHtml(s: Slug): string {
  return s.mirroredIn && !s.isVendored // a vendored copy is managed here too: its drawer holds re-sync
    ? '<span class="manage-btn spacer" aria-hidden="true">⋯</span>'
    : `<button class="manage-btn" data-act="toggle" title="manage axes · rename · move · mirror">⋯</button>`;
}
function slugRowHtml(s: Slug, terms: string[], timeField: "created" | "modified"): string {
  const origin = s.originId ?? s.id;
  const g = gitFor(origin);
  const commitCount = g ? g.commitCount : null;
  // Badge only the RARE case. 222 of 235 vizzes are repo-local, so an
  // "external" pill on nearly every row carried ~5% signal — the exact
  // failure ADR 0011 deleted viz:kind for. Where a repo-local viz lives
  // is already on the row underneath, as its host path.
  const badge = s.isCentral
    ? '<span class="badge central" title="central — lives in the shared scratch library (~/.agents/state/viz), not inside one of your repos.">central</span>'
    : "";
  const commitInner =
    commitCount === null
      ? '<span class="count pending">—</span>'
      : `<span class="count">${commitCount}</span>`;
  const vizHref = "/" + origin.split("/").map(encodeURIComponent).join("/") + "/";
  const title = s.title || s.name;
  return `<div class="slug" data-id="${esc(s.id)}"
                       data-viz-id="slug-${esc(s.id)}"
                       data-label="${esc(title)} — ${s.posture}, ${fmtSize(s.sizeBytes)}">
            ${slugThumbHtml(s, vizHref)}
            <span class="slug-id">
              <a class="slug-name" href="${vizHref}" target="_blank" rel="noopener"${s.description ? ` title="${esc(s.description)}"` : ""}>${badge}${hl(title, terms)}</a>
              ${slugSubHtml(s, terms)}
              ${axisBadges(s)}${tagChips(s)}
            </span>
            <span class="slug-meta">
              <span class="icon-badge files" title="${s.fileCount} file${s.fileCount === 1 ? "" : "s"}">
                ${ICONS.file}<span class="count">${s.fileCount}</span>
              </span>
              <span class="icon-badge commits" title="${commitCount === null ? "commits — git feed loading" : commitCount + " commit" + (commitCount === 1 ? "" : "s")}">
                ${ICONS.commit}${commitInner}
              </span>
              <span class="slug-age" title="showing ${timeField}&#10;modified ${new Date(s.mtime).toLocaleString()}${s.created ? "&#10;created  " + new Date(s.created).toLocaleString() : ""}">
                ${ICONS.clock}${fmtAgo(timeField === "created" ? s.created : s.mtime)}
              </span>
              <span class="slug-size" title="${s.sizeBytes.toLocaleString()} bytes on disk">${fmtSize(s.sizeBytes)}</span>
              ${apiIconHtml(s)}
              ${heroIconHtml(s, vizHref)}
              ${specLinkHtml(s, vizHref)}
              ${mirrorIconHtml(s)}
              ${manageHtml(s)}
            </span>
          </div>${s.id === state.openDrawerId ? drawerHtml(s) : ""}`;
}

// The management drawer's markup (ADR 0009): what a row opens into. Its behaviour is dashboard-acts.ts.
import { esc } from "./dashboard-format.js";
import { state } from "./dashboard-state.js";
import type { Slug, RenderJob, Mirror } from "./dashboard-types.js";

const cssEsc = (s: string) => s.replaceAll(/["\\]/gu, "\\$&");
export const drawerOf = (id: string): Element | null =>
  document.querySelector(`.slug-drawer[data-id="${cssEsc(id)}"]`);
export const chipHtml = (t: string): string =>
  `<span class="chip" data-tag="${esc(t)}">${esc(t)}<button class="chip-x" data-act="chip-rm" title="remove">✕</button></span>`;

// Sink/destination containers = every other container in the library.
function containerOptions(currentContainer: string) {
  return (
    [...new Set(state.lastSlugs.map((s) => s.container))]
      .filter((c) => c !== currentContainer)
      .map((c) => ({ value: c, label: c.split("/").slice(-3).join("/") }))
      .toSorted((a, b) => a.label.localeCompare(b.label))
      .map(({ value, label }) => `<option value="${esc(value)}">${esc(label)}</option>`)
      .join("") || '<option value="" disabled>no other containers</option>'
  );
}

export function drawerHtml(s: Slug): string {
  const cur: Record<string, string | undefined> = {
    posture: s.posture,
    listed: s.listed ? "listed" : "unlisted",
    approved: s.approval === "approved" ? "true" : "false",
    "card-public": ({ public: "true", "not-public": "false" } as Record<string, string>)[
      s.cardPublic
    ],
  };
  const grp = (axis: string, label: string | undefined, opts: [string, string][]) =>
    `<div class="dg"><span class="dg-l">${label}</span>` +
    opts
      .map(
        ([v, t]) =>
          `<button class="dg-b ${cur[axis] === v ? "on" : ""}" data-act="axis" data-axis="${axis}" data-val="${v}">${t}</button>`,
      )
      .join("") +
    `</div>`;
  return `<div class="slug-drawer" data-id="${esc(s.id)}">
      <div class="dg-row">
        <div class="dg"><span class="dg-l" title="viz:uid — durable identity; survives move and rename (ADR 0014)">uid</span>${
          s.uid
            ? `<button class="dg-b" data-act="copy-uid" data-uid="${esc(s.uid)}" title="click to copy">${esc(s.uid)}</button>`
            : '<span class="mz">none yet — backfill-uids.ts mints one</span>'
        }</div>
      </div>
      ${
        s.template
          ? `<div class="dg-row">
        <div class="dg grow"><span class="dg-l" title="viz create <slug> --from this">new from this</span>
          <input class="d-in" data-fld="newSlug" placeholder="new-slug (central library)" spellcheck="false">
          <button class="dg-b" data-act="create-from">create</button></div>
      </div>`
          : ""
      }
      <div class="dg-row">
        ${grp("posture", "posture", [
          ["public", "public"],
          ["private", "private"],
          ["local", "local"],
        ])}
        ${grp("listed", "listed", [
          ["listed", "listed"],
          ["unlisted", "unlisted"],
        ])}
      </div>
      <div class="dg-row">
        ${grp(
          "approved",
          { approved: "approved", stale: "⚠ changed since approval", never: "not approved" }[
            s.approval
          ],
          [
            ["true", s.approval === "stale" ? "re-approve this version" : "approve this version"],
            ["false", "withdraw"],
          ],
        )}
      </div>
      <div class="dg-row">
        ${grp(
          "card-public",
          {
            public: "🪪 card public",
            "not-public": "🪪 card not public",
            unreviewed: "card unreviewed",
            stale: `⚠ card changed since reviewed (was ${s.cardWas.replace("-", " ")})`,
          }[s.cardPublic],
          [
            ["true", "card is public"],
            ["false", "card is not public"],
          ],
        )}
        ${
          s.cardPublic === "public" && (s.lobby || s.posture !== "public")
            ? `<span class="mz">no share page: ${
                s.lobby
                  ? "this container has a private lobby — its lobby shim carries the card instead"
                  : `posture is ${esc(s.posture)} — only public vizzes get one`
              }</span>`
            : ""
        }
      </div>
      <div class="dg-row">
        <div class="dg grow"><span class="dg-l">rename</span>
          <input class="d-in" data-fld="name" value="${esc(s.name)}" spellcheck="false">
          <button class="dg-b" data-act="rename">save</button></div>
        <div class="dg grow"><span class="dg-l">move →</span>
          <select class="d-sel" data-fld="toContainer">${containerOptions(s.container)}</select>
          <button class="dg-b warn" data-act="move">move</button></div>
      </div>
      <div class="dg-row">
        <div class="dg grow"><span class="dg-l">title</span>
          <input class="d-in wide" data-fld="title" value="${esc(s.title)}" placeholder="${esc(s.name)}" spellcheck="false"></div>
      </div>
      <div class="dg-row">
        <div class="dg grow"><span class="dg-l">desc</span>
          <input class="d-in wide" data-fld="description" value="${esc(s.description)}" placeholder="one-line description" spellcheck="false"></div>
      </div>
      <div class="dg-row">
        <div class="dg tag-edit"><span class="dg-l">tags</span>
          <span class="chips" data-fld="tags">${s.tags.map(chipHtml).join("")}<input class="tag-input" list="all-tags" placeholder="add tag…" spellcheck="false"></span>
          <button class="dg-b" data-act="meta-save" title="save title · description · tags">save</button></div>
      </div>
      <div class="dg-row">
        <div class="dg grow"><span class="dg-l" title="where this viz's URL is linked from; any entry makes move/delete/posture refuse (ADR 0016)">linked from</span>
          <span class="link-list">${s.linkedFrom.map((l) => `<span class="mchip">${esc(l)}<button class="mx" data-act="unlink" data-link="${esc(l)}" title="remove this entry">✕</button></span>`).join("") || '<span class="mz">not linked</span>'}</span>
          <input class="d-in wide" data-fld="linkedFrom" placeholder="add: a URL, or e.g. 'a Confluence page'" spellcheck="false">
          <button class="dg-b" data-act="link">add</button></div>
      </div>
      <datalist id="all-tags">${[...new Set(state.lastSlugs.flatMap((x) => x.tags))]
        .toSorted()
        .map((t) => `<option value="${esc(t)}">`)
        .join("")}</datalist>
      <div class="dg-row">
        <div class="dg"><span class="dg-l">mirror →</span>
          <select class="d-sel" data-fld="to">${containerOptions(s.container)}</select>
          <select class="d-sel" data-fld="access"><option value="public">public</option><option value="private">private</option></select>
          <button class="dg-b" data-act="mirror-add">add</button></div>
        <div class="dg"><span class="dg-l">mirrors</span><span class="mirror-list"><span class="mz">…</span></span></div>
        <div class="mirror-edit"></div>
      </div>
      <div class="dg-row">
        <div class="dg"><span class="dg-l">vendor →</span>
          <select class="d-sel" data-fld="vto">${containerOptions(s.container)}</select>
          <button class="dg-b" data-act="vendor-add" title="copy this viz as a self-contained, runnable copy into another repo (+ a drift-guard hook)">copy as ${esc(s.posture)}</button></div>
        <div class="dg"><span class="dg-l">vendored</span><span class="vendor-list"><span class="mz">…</span></span></div>
        ${
          s.isVendored
            ? `<div class="dg"><span class="dg-l">origin</span>
          <button class="dg-b" data-act="vendor-sync" title="re-pull this vendored copy from its origin — overwrites local edits">re-sync</button></div>`
            : ""
        }
      </div>
      <div class="dg-row">
        <div class="dg"><span class="dg-l">video</span>
          <button class="dg-b" data-act="render" title="render this viz to an mp4 (needs window.__viz.timeline for an exact render; narration.json adds audio + captions)">render mp4</button>
          <span class="render-state mz">${renderLine(s.id)}</span></div>
      </div>
      <details class="hist"><summary data-act="history">history · restore an earlier version</summary><div class="hist-rows"></div></details>
      <div class="dg-row">
        <div class="dg"><span class="dg-l">danger</span>
          <button class="dg-b warn" data-act="delete" title="delete this viz folder — click twice to confirm">delete viz</button></div>
      </div>
      ${state.drawerStatus.id === s.id ? `<div class="${state.drawerStatus.cls}">${esc(state.drawerStatus.msg)}</div>` : '<div class="drawer-status"></div>'}
    </div>`;
}

// Render jobs by viz id. The drawer re-renders on every poll, so the line is rebuilt from
// this map rather than kept in the DOM.
export const renderJobs = new Map<string, RenderJob>();
export function renderLine(id: string): string {
  const j = renderJobs.get(id);
  if (!j) return "";
  const pct = j.frames ? ` ${Math.floor((j.frame / j.frames) * 100)}%` : "";
  const warn = j.warnings?.length ? ` · ⚠ ${j.warnings.map(esc).join(" · ⚠ ")}` : "";
  if (j.state === "running")
    return `rendering${pct} <button class="mx" data-act="render-cancel" title="cancel this render">✕</button>${warn}`;
  if (j.state === "done")
    return `✓ <code title="copy the path to open it">${esc(j.out)}</code>${warn}`;
  return `${esc(j.state)}${j.error ? ": " + esc(j.error) : ""} <span title="${esc(j.log)}">(log)</span>${warn}`;
}

// Per-mirror overrides: every field is sent, so blanking one clears that override.
export function mirrorEditHtml(m: Mirror): string {
  const o = m.overrides ?? {};
  return `<div class="dg-row">
      <div class="dg"><span class="dg-l">→ ${esc(m.to)}</span>
        <select class="d-sel" data-fld="m-listed"><option value="listed"${m.listed ? " selected" : ""}>listed</option><option value="unlisted"${m.listed ? "" : " selected"}>unlisted</option></select></div>
      <div class="dg grow"><input class="d-in" data-fld="m-title" value="${esc(o.title ?? "")}" placeholder="title override" spellcheck="false">
        <input class="d-in" data-fld="m-description" value="${esc(o.description ?? "")}" placeholder="description override" spellcheck="false">
        <input class="d-in" data-fld="m-tags" value="${esc((o.tags ?? []).join(", "))}" placeholder="tags override (comma-separated)" spellcheck="false">
        <button class="dg-b" data-act="mirror-save" data-to="${esc(m.to)}">save</button></div>
    </div>`;
}

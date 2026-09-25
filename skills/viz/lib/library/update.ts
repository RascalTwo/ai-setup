// lib/library/update.ts — Editing a viz's posture, listing, triage and descriptive metadata.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- update ----
import { die } from "../../cli.ts";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { escAttr, upsertMeta } from "./meta.ts";
import { setApprovalMeta, vizHash } from "../publish/approval.ts";
import { Viz } from "./viz.ts";
import { LINKED_META, guardLinks } from "./linked.ts";
import { decodeEntities, grabMeta, grabMetaAll } from "../publish/meta.ts";

export const AXES: Record<string, string[]> = {
  posture: ["public", "private", "local"],
  listed: ["listed", "unlisted"],
};

// `approved` is NOT in AXES: the user types true|false but what gets STORED is a content
// hash (ADR 0015), so it cannot go through the generic literal-value path above.
const APPROVED_VALUES = ["true", "false"];

// Insert a meta just after <head> (or at the top if there is none).
const prependMeta = (html: string, block: string) =>
  /<head[^>]*>/i.test(html) ? html.replace(/(<head[^>]*>\s*)/i, (m) => `${m}${block}`) : block + html;

// A repeatable flag arrives as string[] from Commander, as a single string from manage.ts.
const many = (v: string | boolean | string[] | undefined, name: string): string[] => {
  if (v === undefined) return [];
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  if (!list.length || list.some((e) => !e.trim())) die(`ERROR: --${name} needs a non-empty value.`, 2);
  return list.map((e) => e.trim());
};

export function cmdUpdate(viz: Viz, flags: Record<string, string | boolean | string[]>): string[] {
  const indexPath = path.join(viz.dir, "index.html");
  let html = readFileSync(indexPath, "utf8");
  const changes: string[] = [];

  // A posture change moves or kills the viz's URL, so a linked viz refuses it (ADR 0016).
  if (typeof flags.posture === "string" && flags.posture !== grabMeta(html, "viz:posture"))
    guardLinks([viz.dir], `change the posture of ${viz.id}`, flags["break-links"] === true);

  for (const axis of Object.keys(AXES)) {
    const v = flags[axis];
    if (v === undefined) continue;
    if (typeof v !== "string" || !AXES[axis].includes(v)) die(`ERROR: --${axis} must be one of ${AXES[axis].join("|")} (got "${v}").`, 2);
    html = upsertMeta(html, `viz:${axis}`, v);
    changes.push(`${axis}=${v}`);
  }

  // Free-text frame metadata — the same viz:title / viz:description metas a mirror
  // can override (inline.ts), here edited on the source. Empty value clears.
  for (const field of ["title", "description"]) {
    const v = flags[field];
    if (v === undefined) continue;
    if (typeof v !== "string") die(`ERROR: --${field} needs a value.`, 2);
    html = upsertMeta(html, `viz:${field}`, escAttr(v));
    // Keep the visible <title> in sync with viz:title for the standalone artifact.
    if (field === "title" && /<title[^>]*>[\s\S]*?<\/title>/i.test(html))
      html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => `<title>${escAttr(v)}</title>`);
    changes.push(`${field} set`);
  }

  // tags: multi viz:tag — clear all, re-add the comma-split set.
  if (flags.tags !== undefined) {
    if (typeof flags.tags !== "string") die("ERROR: --tags needs a comma-separated value.", 2);
    const tags = flags.tags.split(",").map((t) => t.trim()).filter(Boolean);
    html = html.replace(/[ \t]*<meta\s+name=["']viz:tag["'][^>]*>\s*\n?/gi, "");
    if (tags.length) html = prependMeta(html, tags.map((t) => `  <meta name="viz:tag" content="${escAttr(t)}">`).join("\n") + "\n");
    changes.push(`tags=${tags.join("·") || "(cleared)"}`);
  }

  // linked-from: multi viz:linked-from, like viz:tag, but added/removed one exact entry at
  // a time and never comma-split — an entry is free text, often a URL (ADR 0016).
  for (const e of many(flags["linked-from"], "linked-from")) {
    if (grabMetaAll(html, LINKED_META).includes(e)) {
      changes.push(`already linked from "${e}"`);
      continue;
    }
    html = prependMeta(html, `  <meta name="${LINKED_META}" content="${escAttr(e)}">\n`);
    changes.push(`linked from "${e}"`);
  }
  for (const e of many(flags["unlinked-from"], "unlinked-from")) {
    const current = grabMetaAll(html, LINKED_META);
    if (!current.includes(e))
      die(`ERROR: ${viz.id} has no linked-from entry "${e}" (exact match). Current entries:\n${current.map((c) => `  - ${c}`).join("\n") || "  (none)"}`, 2);
    html = html.replace(/[ \t]*<meta\s+name=["']viz:linked-from["']\s+content=(["'])(.*?)\1[^>]*>\s*\n?/gi, (m, _q, c) =>
      decodeEntities(c.trim()) === e ? "" : m);
    changes.push(`unlinked from "${e}"${current.length === 1 ? " (no longer linked)" : ""}`);
  }

  // Approval is stamped LAST and from disk, so the hash covers every other change made
  // in this same command. Approving and flipping posture at once must record the posture
  // you approved, not the one you started with.
  if (flags.approved !== undefined) {
    const v = flags.approved;
    if (typeof v !== "string" || !APPROVED_VALUES.includes(v))
      die(`ERROR: --approved must be one of ${APPROVED_VALUES.join("|")}`, 2);
    if (v === "false") {
      html = upsertMeta(html, "viz:approved", "false");
      changes.push("approved=false");
    } else {
      writeFileSync(indexPath, html);              // land the other edits first
      html = setApprovalMeta(readFileSync(indexPath, "utf8"), vizHash(viz.dir));
      changes.push("approved=this version");
    }
  }

  if (changes.length === 0) die("ERROR: update needs at least one of --posture / --listed / --approved / --title / --description / --tags / --linked-from / --unlinked-from.", 2);
  writeFileSync(indexPath, html);
  console.log(`Updated ${viz.slug}: ${changes.join(", ")}`);
  return [indexPath];
}

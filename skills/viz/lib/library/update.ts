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

export const AXES: Record<string, string[]> = {
  posture: ["public", "private", "local"],
  listed: ["listed", "unlisted"],
};

// `approved` is NOT in AXES: the user types true|false but what gets STORED is a content
// hash (ADR 0015), so it cannot go through the generic literal-value path above.
const APPROVED_VALUES = ["true", "false"];

export function cmdUpdate(viz: Viz, flags: Record<string, string | boolean>): string[] {
  const indexPath = path.join(viz.dir, "index.html");
  let html = readFileSync(indexPath, "utf8");
  const changes: string[] = [];

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
    if (tags.length) {
      const block = tags.map((t) => `  <meta name="viz:tag" content="${escAttr(t)}">`).join("\n") + "\n";
      html = /<head[^>]*>/i.test(html) ? html.replace(/(<head[^>]*>\s*)/i, (m) => `${m}${block}`) : block + html;
    }
    changes.push(`tags=${tags.join("·") || "(cleared)"}`);
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

  if (changes.length === 0) die("ERROR: update needs at least one of --posture / --listed / --approved / --title / --description / --tags.", 2);
  writeFileSync(indexPath, html);
  console.log(`Updated ${viz.slug}: ${changes.join(", ")}`);
  return [indexPath];
}

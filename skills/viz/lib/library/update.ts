// lib/library/update.ts — Editing a viz's posture, listing, triage and descriptive metadata.
//
// Extracted from the since-deleted manage.ts, which was 878 lines of everything.

// ---- update ----
import { die } from "../../cli.ts";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { escAttr, upsertMeta } from "./meta.ts";
import { cardHash, designedHero, setApprovalMeta, vizHash } from "../publish/approval.ts";
import type { Viz } from "./viz.ts";
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
  /<head[^>]*>/iu.test(html)
    ? html.replace(/(<head[^>]*>\s*)/iu, (m) => `${m}${block}`)
    : block + html;

// A repeatable flag arrives as string[] from Commander, as a single string from a hand-built flags record.
const many = (v: string | boolean | string[] | undefined, name: string): string[] => {
  if (v === undefined) return [];
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  if (list.length === 0 || list.some((e) => !e.trim()))
    die(`ERROR: --${name} needs a non-empty value.`, 2);
  return list.map((e) => e.trim());
};

// oxlint-disable-next-line complexity -- one independent block per metadata flag; splitting it is a rewrite
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
    const allowed = AXES[axis]!;
    if (typeof v !== "string" || !allowed.includes(v))
      die(
        `ERROR: --${axis} must be one of ${allowed.join("|")} (got "${Array.isArray(v) ? v.join(",") : String(v)}").`,
        2,
      );
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
    if (field === "title" && /<title[^>]*>[\s\S]*?<\/title>/iu.test(html))
      html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/iu, () => `<title>${escAttr(v)}</title>`);
    changes.push(`${field} set`);
  }

  // tags: multi viz:tag — clear all, re-add the comma-split set.
  if (flags.tags !== undefined) {
    if (typeof flags.tags !== "string") die("ERROR: --tags needs a comma-separated value.", 2);
    const tags = flags.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    html = html.replaceAll(/[ \t]*<meta\s+name=["']viz:tag["'][^>]*>\s*\n?/giu, "");
    if (tags.length > 0)
      html = prependMeta(
        html,
        tags.map((t) => `  <meta name="viz:tag" content="${escAttr(t)}">`).join("\n") + "\n",
      );
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
      die(
        `ERROR: ${viz.id} has no linked-from entry "${e}" (exact match). Current entries:\n${current.map((c) => `  - ${c}`).join("\n") || "  (none)"}`,
        2,
      );
    html = html.replaceAll(
      /[ \t]*<meta\s+name=["']viz:linked-from["']\s+content=(["'])(.*?)\1[^>]*>\s*\n?/giu,
      (m: string, _q: string, c: string) => (decodeEntities(c.trim()) === e ? "" : m),
    );
    changes.push(`unlinked from "${e}"${current.length === 1 ? " (no longer linked)" : ""}`);
  }

  // Card-public stores a fingerprint of the card (ADR 0018), computed from the html as
  // edited so far — a --title in the same command is part of the card being judged.
  if (flags["card-public"] !== undefined) {
    const v = flags["card-public"];
    if (v !== "true" && v !== "false") die("ERROR: --card-public must be one of true|false", 2);
    // "Not public" is a decision too, and always allowed; only "public" needs a designed hero.
    if (v === "true") {
      const { why } = designedHero(viz.dir, html);
      if (why)
        die(
          `ERROR: refusing --card-public true for ${viz.id} — a public card needs a designed hero:\n  ${why.replace("<id>", viz.id)}`,
          2,
        );
    }
    html = upsertMeta(
      html,
      "viz:card-public",
      `${v === "true" ? "c" : "n"}-${cardHash(viz.dir, html)}`,
    );
    changes.push(`card-public=${v === "true" ? "public" : "not public"} (this card)`);
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
      writeFileSync(indexPath, html); // land the other edits first
      html = setApprovalMeta(readFileSync(indexPath, "utf8"), vizHash(viz.dir));
      changes.push("approved=this version");
    }
  }

  if (changes.length === 0)
    die(
      "ERROR: update needs at least one of --posture / --listed / --approved / --title / --description / --tags / --linked-from / --unlinked-from / --card-public.",
      2,
    );
  writeFileSync(indexPath, html);
  console.log(`Updated ${viz.slug}: ${changes.join(", ")}`);
  return [indexPath];
}

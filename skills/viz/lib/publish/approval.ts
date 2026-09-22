// lib/publish/approval.ts — "a human judged THIS VERSION fit to publish."
//
// Supersedes the boolean `viz:triaged` (ADR 0013). A boolean records that someone once
// looked; it says nothing about what they looked AT. You could approve a viz, rewrite it
// completely, and the deploy gate would still wave it through — the gate stopped working
// at exactly the moment it mattered.
//
// So the meta stores a CONTENT HASH instead of `true`:
//
//     <meta name="viz:approved" content="h-7f3a9c2e1b04">
//
// "Is this approved?" becomes recompute-and-compare. Any edit invalidates the approval and
// the deploy gate refuses until a human re-approves. Approving rewrites the hash.
//
// Three rules make it behave:
//   * Hash the WHOLE viz, not index.html. An exchange-scaffold viz keeps essentially all
//     of its content in content.js; an index-only hash would miss almost every real edit.
//   * Strip the viz:approved meta from its own input, or stamping the hash changes the
//     hash and nothing is ever approved.
//   * Exclude GENERATED artifacts. Re-shooting an OG card or leaving a review comment is
//     not a content change, and revoking approval for one would train you to ignore this.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Regenerated or scratch — never part of what a human approved. */
const NOT_CONTENT = new Set([
  "og.auto.png",      // re-shot by `verify --og`
  "comments.json",    // review scratch, gitignored, never published
  ".mirror.json",     // a sink's receipt, written by the publisher
  ".vendored.json",   // ditto for a vendored copy
  ".DS_Store",
]);

const APPROVED_META = /<meta\s+name=["']viz:approved["']\s+content=["'][^"']*["']\s*\/?>\s*\n?/gi;

function filesOf(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || NOT_CONTENT.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) filesOf(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

/**
 * A stable digest of everything a human would call "this viz".
 *
 * Paths are sorted and hashed alongside their bytes, so a rename or a moved file changes
 * the digest even when the bytes are identical — that IS a content change. index.html is
 * hashed with its own approval meta stripped (see the header).
 */
export function vizHash(dir: string): string {
  const h = createHash("sha256");
  for (const rel of filesOf(dir).sort()) {
    const abs = path.join(dir, rel);
    let buf: Buffer | string;
    try {
      buf = rel === "index.html"
        ? readFileSync(abs, "utf8").replace(APPROVED_META, "")
        : readFileSync(abs);
    } catch {
      continue; // unreadable (a broken symlink) — skip rather than refuse to hash
    }
    h.update(rel).update("\0").update(buf).update("\0");
  }
  return "h-" + h.digest("hex").slice(0, 12);
}

/** The hash a human last approved, or "" when never approved. */
export function readApproval(dir: string): string {
  const idx = path.join(dir, "index.html");
  if (!existsSync(idx)) return "";
  const m = readFileSync(idx, "utf8").match(/<meta\s+name=["']viz:approved["']\s+content=["']([^"']*)["']/i);
  return (m?.[1] ?? "").trim();
}

export type ApprovalState = "approved" | "stale" | "never";

/**
 * `stale` is the case this whole file exists for: approved once, edited since. It is
 * reported distinctly from `never` because the two need different words in front of a
 * human — "you have not looked at this" versus "you approved a different version of this".
 *
 * The legacy boolean `true` (ADR 0013) reads as `never`: it records that someone looked,
 * but not at what, so it cannot support the guarantee this replaces it with.
 */
export function approvalOf(dir: string): { state: ApprovalState; stored: string; actual: string } {
  const stored = readApproval(dir);
  const actual = vizHash(dir);
  if (!stored || stored === "true" || stored === "false") return { state: "never", stored, actual };
  return { state: stored === actual ? "approved" : "stale", stored, actual };
}

export const isApproved = (dir: string) => approvalOf(dir).state === "approved";

/** Insert or replace the approval meta, stamping the viz's CURRENT hash. */
export function setApprovalMeta(html: string, hash: string): string {
  const tag = `<meta name="viz:approved" content="${hash}">`;
  const re = /<meta\s+name=["']viz:approved["']\s+content=["'][^"']*["']\s*\/?>/i;
  if (re.test(html)) return html.replace(re, tag);
  const posture = /(<meta\s+name=["']viz:posture["'][^>]*>)/i;
  if (posture.test(html)) return html.replace(posture, `${tag}\n$1`);
  return html.replace(/<\/head>/i, `${tag}\n</head>`);
}

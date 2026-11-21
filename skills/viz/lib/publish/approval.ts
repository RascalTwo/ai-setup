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
//   * Hash the WHOLE viz, not index.html. An exchange viz keeps essentially all
//     of its content in content.js; an index-only hash would miss almost every real edit.
//   * Strip the viz:approved meta from its own input, or stamping the hash changes the
//     hash and nothing is ever approved.
//   * Exclude GENERATED artifacts. Re-shooting an OG card or leaving a review comment is
//     not a content change, and revoking approval for one would train you to ignore this.

import { createHash } from "node:crypto";
import { findOgImage } from "./og.ts";
import { grabMeta, stripComments, vizCardMeta } from "./meta.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Regenerated or scratch — never part of what a human approved. */
const NOT_CONTENT = new Set([
  "og.auto.png", // re-shot by `verify --og`
  "comments.json", // review scratch, gitignored, never published
  ".viz-data", // page data (ADR 0019): user input, gitignored, never published
  ".verify", // verify's report and floor: generated or ratcheted, not something a human approved
  ".mirror.json", // a sink's receipt, written by the publisher
  ".vendored.json", // ditto for a vendored copy
  ".DS_Store",
]);

const APPROVED_META = /<meta\s+name=["']viz:approved["']\s+content=["'][^"']*["']\s*\/?>\s*\n?/giu;
// Where a viz is linked from is bookkeeping about the outside world, not content: recording
// a new inbound link must not revoke approval (ADR 0016).
const LINKED_META =
  /[ \t]*<meta\s+name=["']viz:linked-from["']\s+content=(["']).*?\1[^>]*>\s*\n?/giu;
// Marking the CARD public is a judgment about the card, not the content (ADR 0018).
const CARD_META = /[ \t]*<meta\s+name=["']viz:card-public["']\s+content=(["']).*?\1[^>]*>\s*\n?/giu;

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
  for (const rel of filesOf(dir).toSorted()) {
    const abs = path.join(dir, rel);
    let buf: Buffer | string;
    try {
      buf =
        rel === "index.html"
          ? readFileSync(abs, "utf8")
              .replace(APPROVED_META, "")
              .replace(LINKED_META, "")
              .replace(CARD_META, "")
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
  const m = readFileSync(idx, "utf8").match(
    /<meta\s+name=["']viz:approved["']\s+content=["']([^"']*)["']/iu,
  );
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

export const isApproved = (dir: string): boolean => approvalOf(dir).state === "approved";

/** Insert or replace the approval meta, stamping the viz's CURRENT hash. */
export function setApprovalMeta(html: string, hash: string): string {
  const tag = `<meta name="viz:approved" content="${hash}">`;
  const re = /<meta\s+name=["']viz:approved["']\s+content=["'][^"']*["']\s*\/?>/iu;
  if (re.test(html)) return html.replace(re, tag);
  const posture = /(<meta\s+name=["']viz:posture["'][^>]*>)/iu;
  if (posture.test(html)) return html.replace(posture, `${tag}\n$1`);
  return html.replace(/<\/head>/iu, `${tag}\n</head>`);
}

// ---- Card-public: "this viz's CARD is safe on the open internet" (ADR 0018) ----
// The same version-bound shape as approval, over a smaller object: the slug (it is in the
// share URL), the card title + description, and the bytes of the hero image. The meta
// stores a fingerprint of those; any change makes the card stale and it gets no share page.

/**
 * The designed hero image a public card would carry, or why there is none. A hand-made
 * og.gif/og.png/og.jpg counts; og.auto.png counts only when rendered from a card source
 * (hero.html, or a viz:card=self index) — the same rule ogTagsFor uses to stop nagging.
 * A bare og.auto.png is a screenshot of the page itself, i.e. the gated body.
 */
export function designedHero(dir: string, html: string): { file: string; why: string } {
  const found = findOgImage(dir);
  if (!found)
    return {
      file: "",
      why: "no hero image — add og.png (1200×630), or a hero.html then `viz verify <id> --og`",
    };
  if (path.basename(found) !== "og.auto.png") return { file: found, why: "" };
  const hero = path.join(dir, "hero.html");
  const self = /<meta[^>]+name=["']viz:card["'][^>]+content=["']self["']/iu.test(
    stripComments(html),
  );
  const src = existsSync(hero) ? hero : self ? path.join(dir, "index.html") : "";
  if (!src)
    return {
      file: "",
      why: "og.auto.png is a screenshot of the page itself, not a designed hero — add og.png or a hero.html, then `viz verify <id> --og`",
    };
  // index.html is rewritten by this very command, so only a hero.html can be out of date.
  if (src === hero && statSync(hero).mtimeMs > statSync(found).mtimeMs)
    return {
      file: "",
      why: "hero.html changed since og.auto.png was rendered — regenerate: `viz verify <id> --og`",
    };
  return { file: found, why: "" };
}

/**
 * Fingerprint of the card as it would publish: slug, title, description, and the designed
 * hero's bytes when there is one. A card with no designed hero still has a fingerprint, so
 * "reviewed, NOT public" can be recorded on it — and adding a hero later stales that too.
 */
export function cardHash(
  dir: string,
  html = readFileSync(path.join(dir, "index.html"), "utf8"),
): string {
  const { file } = designedHero(dir, html);
  const { title, description } = vizCardMeta(html);
  const h = createHash("sha256")
    .update(path.basename(dir))
    .update("\0")
    .update(title)
    .update("\0")
    .update(description)
    .update("\0");
  if (file) h.update(readFileSync(file));
  return h.digest("hex").slice(0, 12);
}

// Stored as c-<hash> (reviewed: public) or n-<hash> (reviewed: NOT public). Anything else —
// no meta, or the legacy bare "false" that carried no fingerprint — reads as unreviewed.
export type CardState = "public" | "not-public" | "stale" | "unreviewed";

/** `was` names the decision a stale card last carried, so a human knows what to re-review. */
export function cardPublicOf(dir: string): {
  state: CardState;
  was: "public" | "not-public" | "";
  image: string;
} {
  const idx = path.join(dir, "index.html");
  const html = existsSync(idx) ? readFileSync(idx, "utf8") : "";
  const m = grabMeta(html, "viz:card-public").match(/^([cn])-([0-9a-f]+)$/u);
  if (!m) return { state: "unreviewed", was: "", image: "" };
  const decision = m[1] === "c" ? "public" : "not-public";
  if (m[2] !== cardHash(dir, html)) return { state: "stale", was: decision, image: "" };
  return {
    state: decision,
    was: "",
    image: decision === "public" ? designedHero(dir, html).file : "",
  };
}

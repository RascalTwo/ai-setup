// lib/create/uid.ts — a viz's durable identity.
//
// ADR 0001 makes a viz's ID its PATH, which is also its URL. That is right for
// addressing and wrong for remembering: `viz move` changes the id, by design and with
// no redirect. Anything that accumulates knowledge ABOUT a viz across time — a pairwise
// ranking, review history, analytics — loses its link to that viz the moment it moves.
//
// This is not hypothetical. The mirror system's originId is `sha256(originPath)`, so an
// orphaned mirror of the self-portrait carried src-56cee0045be0 while its live origin
// carried src-e4fd2f6343c6: the same viz, two identities, because the paths differed.
// Anything derived from a path inherits the path's instability.
//
// So: `viz:uid` is RANDOM, minted once, and never recomputed. It lives in index.html,
// which means a move carries it along for free — the file moves, the uid moves.
//
// Shape is `v-` + 12 hex, matching the existing `src-xxxxxxxxxxxx` convention. 48 bits
// over a corpus in the hundreds is far past sufficient (a collision needs ~16M vizzes
// for even a 1% chance), and it stays short enough to read in a meta tag.

import { randomUUID } from "node:crypto";

export function mintUid(): string {
  return "v-" + randomUUID().replace(/-/g, "").slice(0, 12);
}

// Insert or replace a meta in a <head>. Mirrors fork.ts's local setMeta — kept separate
// because that one is fork-private and this is called from create, backfill and update.
export function setUidMeta(html: string, uid: string): string {
  const tag = `<meta name="viz:uid" content="${uid}">`;
  const re = /<meta\s+name=["']viz:uid["']\s+content=["'][^"']*["']\s*\/?>/i;
  if (re.test(html)) return html.replace(re, tag);
  // Sit it directly above viz:posture so the identity block reads together.
  const posture = /(<meta\s+name=["']viz:posture["'][^>]*>)/i;
  if (posture.test(html)) return html.replace(posture, `${tag}\n$1`);
  return html.replace(/<\/head>/i, `${tag}\n</head>`);
}

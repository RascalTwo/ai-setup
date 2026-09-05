// lib/publish/lobby-write.ts — Assembling cards and writing the lobby to disk.
//
// Extracted from build.ts, which was 1993 lines.

import { PLACEHOLDER_HOST } from "./constants.ts";
import { renderLobby } from "./lobby-render.ts";
import { renderLobbyOg } from "./lobby.ts";
import { grabMeta, readPreamble, vizCardMeta } from "./meta.ts";
import { findOgImage } from "./og.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export function vizMtime(dir: string): number {
  try {
    const p = Bun.spawnSync(["git", "-C", dir, "log", "-1", "--format=%ct", "--", "."], { stdout: "pipe", stderr: "ignore" });
    const s = p.stdout.toString().trim();
    if (p.success && s) return parseInt(s, 10) * 1000;
  } catch { /* git missing / not a repo — fall through to fs mtime */ }
  let newest = 0;
  try {
    for (const f of readdirSync(dir)) {
      const st = statSync(path.join(dir, f));
      if (st.isFile() && st.mtimeMs > newest) newest = st.mtimeMs;
    }
  } catch { /* ignore */ }
  return newest || Date.now();
}

// A viz's "created" epoch (ms), for the created sort + age badge. Prefer the FIRST git commit
// that touched the dir (project birth, stable across clones). Fall back to the oldest file
// birthtime on disk, then to vizMtime. (On a squashed 1-commit mirror, created == modified.)
export function vizCreated(dir: string): number {
  try {
    const p = Bun.spawnSync(["git", "-C", dir, "log", "--format=%ct", "--", "."], { stdout: "pipe", stderr: "ignore" });
    const lines = p.stdout.toString().trim().split("\n").filter(Boolean);
    if (p.success && lines.length) return parseInt(lines[lines.length - 1], 10) * 1000; // last line = oldest commit
  } catch { /* git missing / not a repo — fall through */ }
  let oldest = 0;
  try {
    for (const f of readdirSync(dir)) {
      const st = statSync(path.join(dir, f));
      if (!st.isFile()) continue;
      const t = st.birthtimeMs || st.ctimeMs || st.mtimeMs;
      if (t && (oldest === 0 || t < oldest)) oldest = t;
    }
  } catch { /* ignore */ }
  return oldest || vizMtime(dir);
}

// `image` is the ABSOLUTE source path to the viz's hero (OG) image, for the grid-view
// thumbnail — public cards only (a private card stays minimal so its visual never leaks).
// `mtime` is epoch ms (see vizMtime) — drives the default newest-first order + the age badge.
export type Card = { slug: string; title: string; description: string; tags: string[]; scaffold: string; private: boolean; spoiler: boolean; image?: string; mtime: number; created: number };

// <meta name="viz:spoiler" content="true"> → the lobby card blurs its hero image AND
// its blurb until the viewer clicks it once to reveal (per SKILL "spoiler"). Title stays
// visible (it's the episode name, not a spoiler). Does NOT touch the OG unfurl — a shared
// link still previews the full hero (that surface is the poster's call to strip).
export function isSpoiler(html: string): boolean {
  return /^(true|1|yes|spoiler|spoilers)$/i.test(grabMeta(html, "viz:spoiler").trim());
}

// Build a card from a viz's SOURCE index.html (not the built/sealed artifact).
export function cardFor(slug: string, sourceDir: string, isPrivate: boolean): Card {
  const html = readFileSync(path.join(sourceDir, "index.html"), "utf8");
  return { slug, ...vizCardMeta(html), private: isPrivate, spoiler: isSpoiler(html), image: isPrivate ? undefined : findOgImage(sourceDir) || undefined, mtime: vizMtime(sourceDir), created: vizCreated(sourceDir) };
}

// `srcContainer` is the SOURCE container (where `_preamble.html` lives) — distinct from
// `outRoot` (the dist dir) for a publish/preview, identical to it for an in-place mirror rebuild.
export async function writeLobby(
  outRoot: string,
  cards: Card[],
  pageTitle: string,
  srcContainer: string,
  shareHost: string,
  opts: { sealed?: boolean; description?: string } = {},
): Promise<void> {
  // Default order: newest first (most-recently-modified on top), slug as a stable tiebreak.
  // The client can re-sort to oldest / A–Z; this is just the initial DOM order.
  const sorted = [...cards].sort((a, b) => b.created - a.created || a.slug.localeCompare(b.slug));
  // Copy each public card's hero image into _thumbs/ so the grid view has a same-origin
  // thumbnail. Host-independent (unlike the OG image, which is only copied with --base-url),
  // so grid works in `preview` too. Only public cards carry an image (see cardFor).
  const model = sorted.map((c) => {
    if (!c.image || !existsSync(c.image)) return { ...c, thumb: undefined };
    const rel = "_thumbs/" + c.slug + (path.extname(c.image) || ".png");
    mkdirSync(path.join(outRoot, "_thumbs"), { recursive: true });
    cpSync(c.image, path.join(outRoot, rel));
    return { ...c, thumb: rel };
  });

  // The lobby's own OG card. Default blurb is a count; --index-description overrides. A
  // SEALED lobby (private) can't carry tags in its encrypted head, so skip it entirely.
  const n = cards.length;
  const description = opts.description || `${n} interactive visualization${n === 1 ? "" : "s"}`;
  const haveHost = shareHost !== PLACEHOLDER_HOST;
  let og: Parameters<typeof renderLobby>[3];
  if (!opts.sealed) {
    // The montage (og:image) only under a real host: crawlers reject relative/placeholder
    // URLs, and gating on the host also keeps preview's live-reload rebuilds Chrome-free.
    let imageUrl: string | undefined;
    if (haveHost) {
      const thumbs = model.filter((m) => m.thumb).map((m) => path.join(outRoot, m.thumb!)); // newest-first
      if (thumbs.length) {
        const ok = await renderLobbyOg(thumbs, pageTitle, description, path.join(outRoot, "_thumbs", "lobby-og.png"));
        if (ok) imageUrl = shareHost.replace(/\/$/, "") + "/_thumbs/lobby-og.png";
      }
    }
    og = { title: pageTitle, description, pageUrl: haveHost ? shareHost : undefined, imageUrl };
  }
  await Bun.write(path.join(outRoot, "index.html"), renderLobby(model, pageTitle, readPreamble(srcContainer), og));
}

// ============================================================================
// Mirrors (ADR 0006) — one source viz published into other containers
// ============================================================================
//
// A <container>/mirrors.json declares where that container's NATIVE vizzes are
// mirrored. `path` points at the SINK's SOURCE container; each mirrored viz lands
// there as a self-describing unit (index.html + a .mirror.json sidecar), so any
// container's index composes from local presence — native dirs card-from-head,
// sidecar'd dirs card-from-sidecar — with no "who pushes into me" discovery.
//
//   access   REQUIRED per (viz × mirror): "public" | "private". The ONE field that
//            never inherits — posture across a mirror is a trust boundary, re-decided
//            consciously (a missing/invalid access is a hard error, like an undeclared
//            viz:posture). Everything else inherits the source viz's viz:* meta.

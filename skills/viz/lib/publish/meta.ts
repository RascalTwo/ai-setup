// lib/publish/meta.ts — Reading a viz's declared metadata out of its HTML.
//
// Extracted from build.ts, which was 1993 lines.

// ---- Multi-viz lobby index ----
// A deployment place holds many vizzes, one per slug dir. After building, we
// regenerate a small lobby page at the out root listing every viz in THIS run.
// The container run is the source of truth for the whole site (it regenerates the
// index each time) — so cards are read from the SOURCE viz dirs, never the built
// artifacts. That matters for private vizzes: a sealed artifact's <head> is
// encrypted (its title is just "Protected Page"), so its real card text can only
// come from the source. A private card is rendered minimally (real title + a lock
// marker, no description) so the index can list it without leaking its blurb.
//
// Card text comes from each viz's own <head>: a card title from <meta name=
// "viz:title"> (else <title>), a blurb from <meta name="viz:description"> (else
// <meta name="description">), and optional eyebrow tags from one or more
// <meta name="viz:tag"> elements (repeat the element to attach several tags).

import { renderLobby } from "./lobby-render.ts";
import { Card } from "./lobby-write.ts";
import { seal } from "./seal.ts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Decode the handful of HTML entities a meta `content` attribute may carry, so card
// values are PLAIN text. Without this, a title written as `Roadmap &amp; Vision`
// (the entity for a literal &) would be stored raw and then re-escaped by escHtml on
// render → `&amp;amp;` (and re-escaped by escAttr into a mirror's head). Decode &amp;
// LAST so an already-literal "&lt;" inside the source isn't double-decoded.
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// The content value is delimited by whichever quote opened it (captured group 1) and
// read lazily up to that SAME quote — so an apostrophe inside a double-quoted value
// (e.g. content="Beta's blurb") doesn't truncate the match. Returns DECODED plain text.
// Commented-out metas are disabled, not live: strip HTML comments before matching so a
// scaffold's <!-- <meta name="viz:spoiler" …> --> example isn't parsed as a real declaration.
export const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

export function grabMeta(html: string, name: string): string {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])(.*?)\\1`, "i");
  return decodeEntities((stripComments(html).match(re)?.[2] ?? "").trim());
}

// Like grabMeta but returns EVERY matching meta's content — repeated elements with
// the same name (valid HTML) become an ordered list. Used for multi-valued metas
// like viz:tag. Empties are dropped; order follows document order.
export function grabMetaAll(html: string, name: string): string[] {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])(.*?)\\1`, "ig");
  return [...stripComments(html).matchAll(re)].map((m) => decodeEntities(m[2].trim())).filter(Boolean);
}

export function vizCardMeta(html: string): { title: string; description: string; tags: string[]; scaffold: string } {
  return {
    title: grabMeta(html, "viz:title") || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim() || "Untitled viz",
    description: grabMeta(html, "viz:description") || grabMeta(html, "description"),
    tags: grabMetaAll(html, "viz:tag"),
    // viz:scaffold — which built-in scaffold generated the page (poster | poster-dive |
    // deck | exchange). Absent on a blank-starter page; the lobby materialises that
    // absence as "page" so the facet can offer it as a choice (see renderLobby).
    scaffold: grabMeta(html, "viz:scaffold"),
  };
}

// Posture is declared by the viz itself: <meta name="viz:posture" content="public|private|local">.
// It is the SOLE source of truth — there is no --public/--private flag. Three values:
//   public  → built + hosted as-is
//   private → built + StatiCrypt-sealed + magic link
//   local   → NEVER published; the run silently skips it (the viz stays on your machine)
// A viz that declares NONE of these is an ERROR (publish refuses), so nothing is ever
// published on a guessed posture. Returns the value, or null (undeclared → refuse).
export function readPosture(vizDir: string): "public" | "private" | "local" | null {
  const indexPath = path.join(vizDir, "index.html");
  if (!existsSync(indexPath)) return null;
  const v = grabMeta(readFileSync(indexPath, "utf8"), "viz:posture").toLowerCase();
  return v === "public" || v === "private" || v === "local" ? v : null;
}

// Listing is a SEPARATE axis from posture. <meta name="viz:listed" content="unlisted"> (or the
// legacy "false") hides a viz from the lobby index — but it is still BUILT and reachable by
// its direct URL. This is UX-level non-advertisement (obscurity), NOT access control. Default
// (meta absent, or "listed"/"true") = listed; "unlisted" or "false" (case-insensitive) unlist.
export function readListed(vizDir: string): boolean {
  const indexPath = path.join(vizDir, "index.html");
  if (!existsSync(indexPath)) return true;
  const v = grabMeta(readFileSync(indexPath, "utf8"), "viz:listed").toLowerCase();
  return v !== "false" && v !== "unlisted";
}

// Optional per-container preamble: raw HTML in <container>/_preamble.html, injected on the
// lobby page between the eyebrow and the card grid. Absent → no preamble. It's authored HTML
// (same trust as every viz), so it's emitted verbatim — no escaping, no markdown engine.
export function readPreamble(container: string): string {
  const p = path.join(container, "_preamble.html");
  return existsSync(p) ? readFileSync(p, "utf8").trim() : "";
}

// Private lobby (whole-site seal). By default a lobby is public. A container carrying a
// _private-lobby marker makes its lobby PRIVATE: the whole published site sits behind ONE
// StatiCrypt password (the lobby key), and that same key opens every PUBLIC-tier page AND
// the lobby page itself — so a visitor enters once and browses freely (StatiCrypt remember-me,
// all pages
// sharing one passphrase+salt). Already-PRIVATE vizzes keep their OWN keystore key: a
// lobby visitor sees their (minimal) card but needs that page's separate link —
// deliberate compartmentalization.
//
// The marker is a pure OPT-IN flag — its PRESENCE is the whole signal (create an empty
// file: `touch <container>/_private-lobby`) — and it carries NO secret; it's the only
// lobby thing that's committed. The lobby KEY lives in the machine-local keystore, keyed
// by the container (id + "#lobby"), exactly like a private viz's key: auto-minted on
// first build, rotatable, and — like private keys — machine-local (a fresh clone
// re-mints and the old magic link dies; that's the existing keystore tradeoff, not a new
// one). Any contents of the marker are ignored.

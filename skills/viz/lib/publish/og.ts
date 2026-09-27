// lib/publish/og.ts — Rich link previews: Open Graph tags, and rendering the card image.
//
// Extracted from the since-deleted build.ts, which was 1993 lines.

// ---- Rich link previews (Open Graph / Twitter Card). ----
// When a viz URL is pasted into Slack/Discord/Webex/etc., the platform fetches the page
// and builds a preview card from these <head> tags. It lives here (publish), not in
// inline.ts (the single-file builder), for two reasons:
//   1. Absolute URLs: og:url/og:image must be absolute (crawlers reject relative and
//      data: URIs), so we need the host (shareHost) + slug — known here, not in inline.
//   2. Image is a real sibling file: an optional og.png/og.jpg (human-made, preferred)
//      or og.auto.png (a verify screenshot, fallback) in the viz dir is copied BESIDE
//      the artifact and referenced absolutely. STATIC only — animated GIFs animate in
//      link cards on Discord alone (everywhere else shows frame 1), so the motion isn't
//      worth the weight; a crisp 1200×630 still is the whole game.
// Provenance is the FILENAME, not embedded metadata (no exiftool dep, visible in ls/git):
// a human image is og.png/og.jpg; `verify --og` writes og.auto.png. We prefer the human
// one and WARN when a viz would ship an auto-only or missing image — the publish-time
// flag for "this card still needs a real picture".
// Graceful degrade: no host (no --base-url) or no image → a text-only card, still unfurls.
//
// Two consumers (both via ogTagsFor):
//   - PUBLIC viz  → tags injected into the plaintext page head (withOgTags).
//   - PRIVATE viz → the sealed page can't carry a card (its head is encrypted), so we
//     publish a tiny UNSEALED shim at a secret path whose head carries the card and whose
//     body JS-redirects to the sealed page's #staticrypt_pwd fragment (see shimDoc). The
//     shim's og image lives UNDER that same secret path, so nothing sits at a guessable
//     URL — the card is only ever served to whoever already holds the secret link.

// The viz's preview image, by filename provenance (no embedded metadata): a hand-made
// og.png/jpg wins over the auto-rendered og.auto.png. Used for BOTH the OG unfurl card
// and the lobby grid's hero thumbnail. Returns an absolute path, or "" if none.
import { seal } from "./seal.ts";
import { PLACEHOLDER_HOST } from "./constants.ts";
import { Card } from "./lobby-write.ts";
import { escHtml, stripComments, vizCardMeta } from "./meta.ts";
import { staticrypt } from "./seal.ts";
import { HOME, idFor } from "../../discovery.ts";
import { start as startServer } from "../../server-control.ts";
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const OG_NAMES = ["og.png", "og.jpg", "og.auto.png"];
export function findOgImage(dir: string): string {
  const n = OG_NAMES.find((n) => existsSync(path.join(dir, n)));
  return n ? path.join(dir, n) : "";
}

// ---- Auto-generate the OG preview image at build time ----
// So the author never hand-runs `viz verify --og`. Best-effort and NON-FATAL: it needs the
// local dev server (:5180) + Chrome (via `viz verify`). On any miss it leaves the viz text-only
// (exactly the prior behavior) with a warning — it never fails the build.
// Reach the dev server through server-control, the one module that knows its port and
// script. These used to hand-roll both: a hardcoded :5180 and a spawn of a server.ts that
// lived one directory up, so once the file moved into lib/ the spawn silently did nothing.
export async function ensureDevServer(): Promise<boolean> {
  try {
    await startServer();
    return true;
  } catch {
    return false; // foreign process on the port, or it never came up — caller skips auto-og
  }
}

/**
 * The command auto-og runs. Exported so a test can assert the script exists: the previous
 * path pointed at lib/publish/verify.ts, which never existed, and because the failure went
 * to an ignored stderr every publish silently skipped the render for weeks.
 */
export const OG_RENDER = [process.execPath, path.resolve(import.meta.dir, "../../viz.ts"), "verify"];

// Generate <vizDir>/og.auto.png when missing or stale, by shelling to `viz verify --og` (which
// renders hero.html if present, else the live page, and writes into the viz dir). Mirrors
// ogTagsFor's own staleness rule: skip if a hand-made og.png/og.jpg exists (human art wins) or
// the auto shot is already newer than its card source (hero.html / a viz:card=self index).
// ponytail: one Chrome launch per STALE viz, serial in the publish loop — fine because it's
// incremental (fresh shots are skipped on re-publish); parallelize only if a big container's
// first build gets slow.
export async function ensureOgImage(vizDir: string, warnings: string[]): Promise<void> {
  const id = idFor(vizDir);
  if (!id) return;                                                                // outside $HOME → verify can't resolve it
  if (OG_NAMES.slice(0, 2).some((n) => existsSync(path.join(vizDir, n)))) return; // og.png/og.jpg = hand-made, keep it
  const auto = path.join(vizDir, "og.auto.png");
  const hero = path.join(vizDir, "hero.html");
  const selfHero = /<meta[^>]+name=["']viz:card["'][^>]+content=["']self["']/i.test(stripComments(readFileSync(path.join(vizDir, "index.html"), "utf8")));
  const cardSrc = existsSync(hero) ? hero : selfHero ? path.join(vizDir, "index.html") : "";
  if (existsSync(auto) && (!cardSrc || statSync(cardSrc).mtimeMs <= statSync(auto).mtimeMs)) return; // fresh enough
  if (!(await ensureDevServer())) {
    warnings.push("no/stale og image and the dev server was unreachable to auto-generate one — text-only card (start the viz server, or add og.png)");
    return;
  }
  const proc = Bun.spawn([...OG_RENDER, id, "--og"], { stdout: "ignore", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    const last = err.trim().split("\n").at(-1) ?? "";
    warnings.push(`og image render failed (exit ${code})${last ? `: ${last}` : ""} — text-only card; retry with \`viz verify <id> --og\``);
  }
}

// Build the OG/Twitter tag block for a viz and copy its preview image into imgDestDir.
// urlBase is the absolute URL of imgDestDir (trailing slash); ogUrl is the canonical page
// URL. haveHost is false under the placeholder host — then no absolute-URL tags (og:url/
// og:image) are emitted (crawlers reject relative), degrading to a text-only card.
export function ogTagsFor(
  vizDir: string, imgDestDir: string, haveHost: boolean, urlBase: string, ogUrl: string,
  html: string, warnings: string[],
): string {
  const { title, description } = vizCardMeta(html);
  let image = "";
  const found = OG_NAMES.find((n) => existsSync(path.join(vizDir, n))) ?? "";
  // A card SOURCE makes og.auto.png polished (don't nag for a hand-made png): either a
  // hand-authored hero.html, OR a self-hero viz (viz:card=self) whose own index.html IS the
  // 1200×630 card. `verify --og` renders either into og.auto.png.
  const hero = path.join(vizDir, "hero.html");
  const haveHero = existsSync(hero);
  const selfHero = /<meta[^>]+name=["']viz:card["'][^>]+content=["']self["']/i.test(stripComments(html));
  const cardSrc = haveHero ? hero : selfHero ? path.join(vizDir, "index.html") : "";
  // Provenance flag: nudge toward a hand-made image (the filename is the fingerprint).
  if (!found) warnings.push(cardSrc
    ? `card source present (${haveHero ? "hero.html" : "viz:card=self"}) but no og image yet — generate it: viz verify <id> --og`
    : "no preview image — add og.png (1200×630) or a hero.html card, then viz verify <id> --og (text-only card for now)");
  else if (found === "og.auto.png" && !cardSrc) warnings.push("preview image is auto-generated (og.auto.png from verify) — supply og.png or a hero.html for a polished card");
  else if (found === "og.auto.png" && cardSrc && statSync(cardSrc).mtimeMs > statSync(path.join(vizDir, found)).mtimeMs)
    warnings.push(`${haveHero ? "hero.html" : "index.html"} changed since og.auto.png was generated — regenerate: viz verify <id> --og`);
  if (found) {
    if (!haveHost) warnings.push(`${found} present but no --base-url — text-only card built; pass --base-url <host> to include the image`);
    else {
      cpSync(path.join(vizDir, found), path.join(imgDestDir, found));
      image = urlBase + found;
    }
  }
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escHtml(title)}">`,
    description ? `<meta property="og:description" content="${escHtml(description)}">` : "",
    haveHost ? `<meta property="og:url" content="${escHtml(ogUrl)}">` : "",
    image ? `<meta property="og:image" content="${escHtml(image)}">` : "",
    // Declared dims let Slack/Discord lay out the card before fetching, and reinforce the
    // large-card choice. Our cards (hero.html + posters) are all 1200×630.
    image ? `<meta property="og:image:width" content="1200">` : "",
    image ? `<meta property="og:image:height" content="630">` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
  ].filter(Boolean).join("\n");
}

// Insert a <head> tag block into an HTML string (before </head>, or after <head> if the
// doc has no close tag). No-op on an empty block.
export function injectHead(html: string, tags: string): string {
  if (!tags) return html;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, tags + "\n</head>")
    : html.replace(/(<head[^>]*>)/i, `$1\n${tags}`);
}

export function withOgTags(vizDir: string, dest: string, slug: string, shareHost: string, html: string, warnings: string[]): string {
  const haveHost = shareHost !== PLACEHOLDER_HOST;
  const base = shareHost.replace(/\/$/, "") + "/" + slug + "/";
  return injectHead(html, ogTagsFor(vizDir, dest, haveHost, base, base, html, warnings));
}

// The private-viz share shim: an UNSEALED page carrying the OG card in its head and a
// JS-only redirect to the sealed page's #staticrypt_pwd magic link. JS-only is deliberate
// — crawlers don't run JS, so they stop here and read the card (never reaching the sealed
// "Protected Page"); humans get bounced straight through to auto-decrypt. Lives at a secret
// path (the staticrypt hash), so possession of the link is the whole access gate.
export function shimDoc(headTags: string, redirectUrl: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags}
</head><body>
<script>location.replace(${JSON.stringify(redirectUrl)});</script>
<noscript><a href="${escHtml(redirectUrl)}">Open</a></noscript>
</body></html>
`;
}

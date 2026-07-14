#!/usr/bin/env bun
// build.ts — turn viz tapes into hostable static artifacts. AUTHOR-SIDE ONLY.
//
// This is deliberately NOT vendored into a repo's .runtime/ — publishing is an
// author action, never something a cloner does. It also never deploys: it builds
// artifacts into a local dist dir and STOPS. Pushing the result to a Pages branch
// is a separate, explicit, human-confirmed step.
//
// Posture is per-VIZ and self-declared — each viz's own index.html carries
// <meta name="viz:posture" content="public|private">. That meta is the SOLE source
// of truth: there is no --public/--private flag, the CLI is invoked the same way
// every time, and a single run can mix public and private vizzes. A viz that
// declares no posture is a hard error (the run refuses) — nothing is ever published
// on a guessed posture. The deployment is therefore NOT homogeneous, and public and
// private vizzes may live in the same container (this supersedes the earlier
// all-public-or-all-private design).
//
//   public   inline the viz into one self-contained HTML (kit + tape + api shim).
//            Anyone with the URL sees it. No encryption, no keystore.
//   private  do the same, then seal the HTML with StatiCrypt (AES-256) using the
//            viz's stable passphrase+salt from the keystore, and publish an unsealed
//            SHARE SHIM at a secret path (<slug>/<staticrypt-hash>/) whose head carries
//            the OG card and whose body JS-redirects to the sealed page's #staticrypt_pwd
//            magic link. The shim URL is what you share; possession of it = access.
//   local    NOT published at all — the run silently skips it. The viz (and its
//            source) stay on your machine. This is the safe default new vizzes scaffold
//            with, so nothing reaches a host until you consciously flip it.
//
// The tape on disk is sealed AS-IS. There is no scrubber here: sanitizing a tape
// (the AI secret-scan + human gate) is a PROCESS step in SKILL.md that happens
// before this runs. This CLI is purely mechanical: build, seal, assemble.
//
// A deployment place can hold MANY vizzes — one self-contained page per slug dir.
// The container run (re)generates a lobby index.html at the out root listing every
// viz in the run; private ones are listed minimally (real title + lock, no blurb),
// so the index never leaks a sealed viz's content. The container run owns the whole
// -site index; a single `export` builds one artifact and leaves the index alone.
//
// Mirrors (ADR 0006): a <container>/mirrors.json declares where this container's
// NATIVE vizzes are mirrored into OTHER containers, each under its own frame
// (title/description/tags) and a consciously re-decided posture (per-mirror `access`,
// required). Each mirrored viz lands in the sink as a self-describing unit
// (index.html + a .mirror.json sidecar); the sink's index composes from local
// presence (natives card-from-head + sidecars card-from-sidecar), so it's the same
// whoever writes it. A container that is also a sink copies its mirrored-in artifacts
// verbatim (never rebuilds them) and cards them from their sidecars.
//
// usage:
//   bun build.ts <container> [--out <dir>] [--base-url <url>] [--no-index] [--index-title <t>] [--index-description <t>]
//   bun build.ts export <vizDir> [--out <dir>] [--base-url <url>]
//   bun build.ts rotate <vizDir>            (or: rotate <container> --lobby)
//
// --no-index            skip the lobby-index regeneration
// --index-title         title for the generated lobby page (default "Visualizations")
// --index-description   lobby OG/unfurl blurb (default: an auto count of the vizzes)
//
// The lobby is itself a shareable surface: with a real --base-url it gets its OWN OG card —
// title/blurb + an auto-rendered 1200×630 montage of the contained vizzes' hero thumbnails
// (dist path _thumbs/lobby-og.png) — so pasting the site root unfurls like a viz does.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync, renameSync, statSync, watch } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";
import { buildSelfContained, type HeadOverrides } from "./inline.ts";
import { getOrCreate, rotate, type KeyEntry } from "./keystore.ts";
import { idFor } from "./discovery.ts";

const MIRROR_SIDECAR = ".mirror.json";

const PLACEHOLDER_HOST = "https://YOUR-PAGES-HOST/";

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

// ---- Argument parsing ----
const argv = process.argv.slice(2);
let out: string | undefined;
let baseUrl: string | undefined;
let noIndex = false;
let indexTitle: string | undefined;
let indexDescription: string | undefined; // lobby OG/unfurl blurb (default: an auto count)
let port: number | undefined; // preview: explicit port (default: an OS-assigned free one)
let open = false; // preview: also open the URL in the OS default browser
let lobbyFlag = false; // rotate: target the container's lobby key (id + "#lobby")
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") out = argv[++i];
  else if (a.startsWith("--out=")) out = a.slice(6);
  else if (a === "--base-url") baseUrl = argv[++i];
  else if (a.startsWith("--base-url=")) baseUrl = a.slice(11);
  else if (a === "--no-index") noIndex = true;
  else if (a === "--index-title") indexTitle = argv[++i];
  else if (a.startsWith("--index-title=")) indexTitle = a.slice(14);
  else if (a === "--index-description") indexDescription = argv[++i];
  else if (a.startsWith("--index-description=")) indexDescription = a.slice(20);
  else if (a === "--port") port = Number(argv[++i]);
  else if (a.startsWith("--port=")) port = Number(a.slice(7));
  else if (a === "--open") open = true;
  else if (a === "--lobby") lobbyFlag = true;
  else positional.push(a);
}

// ---- StatiCrypt drivers (run via bunx; the chosen sealing tool — don't roll our own crypto) ----
// Seal writes the encrypted file; share is a SEPARATE link-only invocation (with
// --share, StatiCrypt prints the link and writes nothing). Same passphrase+salt in
// both, so the #staticrypt_pwd hash in the link matches the sealed file — and that
// hash depends only on passphrase+salt, never the host, so links are host-stable.
async function staticrypt(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  const proc = Bun.spawn(["bunx", "staticrypt", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = (await new Response(proc.stdout).text()).trim();
  const ok = (await proc.exited) === 0;
  if (!ok) {
    const err = (await new Response(proc.stderr).text()).trim();
    console.error(`  staticrypt failed: ${err || stdout}`);
  }
  return { ok, stdout };
}

async function seal(stageDir: string, file: string, outDir: string, key: KeyEntry): Promise<boolean> {
  const { ok } = await staticrypt(
    [file, "-p", key.passphrase, "-s", key.salt, "-d", outDir, "--short", "-c", "false"],
    stageDir,
  );
  return ok;
}

async function magicLink(stageDir: string, file: string, key: KeyEntry, shareBase: string): Promise<string> {
  const { ok, stdout } = await staticrypt(
    [file, "-p", key.passphrase, "-s", key.salt, "--short", "-c", "false", "--share", shareBase],
    stageDir,
  );
  const link = stdout.split("\n").find((l) => l.includes("#staticrypt_pwd="));
  return ok && link ? link.trim() : "(failed to produce magic link)";
}

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
const OG_NAMES = ["og.png", "og.jpg", "og.auto.png"];
function findOgImage(dir: string): string {
  const n = OG_NAMES.find((n) => existsSync(path.join(dir, n)));
  return n ? path.join(dir, n) : "";
}

// ---- Auto-generate the OG preview image at build time ----
// So the author never hand-runs `verify.ts --og`. Best-effort and NON-FATAL: it needs the
// local dev server (:5180) + Chrome (via verify.ts). On any miss it leaves the viz text-only
// (exactly the prior behavior) with a warning — it never fails the build.
async function devServerUp(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:5180/_health", { signal: AbortSignal.timeout(500) });
    return r.ok && (await r.text()) === "OK";
  } catch { return false; }
}

// Reach the dev server, spawning it (detached) if the port is free. Returns false if it can't
// be reached (foreign process on the port, or it never came up) — caller then skips auto-og.
async function ensureDevServer(): Promise<boolean> {
  if (await devServerUp()) return true;
  try {
    const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "server.ts")],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    proc.unref();
    for (let i = 0; i < 30; i++) { if (await devServerUp()) return true; await Bun.sleep(100); }
  } catch { /* ignore — degrade to text-only */ }
  return false;
}

// Generate <vizDir>/og.auto.png when missing or stale, by shelling to verify.ts --og (which
// renders hero.html if present, else the live page, and writes into the viz dir). Mirrors
// build.ts's own staleness rule: skip if a hand-made og.png/og.jpg exists (human art wins) or
// the auto shot is already newer than its card source (hero.html / a viz:card=self index).
// ponytail: one Chrome launch per STALE viz, serial in the publish loop — fine because it's
// incremental (fresh shots are skipped on re-publish); parallelize only if a big container's
// first build gets slow.
async function ensureOgImage(vizDir: string, warnings: string[]): Promise<void> {
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
  const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "verify.ts"), id, "--og"],
    { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

// Build the OG/Twitter tag block for a viz and copy its preview image into imgDestDir.
// urlBase is the absolute URL of imgDestDir (trailing slash); ogUrl is the canonical page
// URL. haveHost is false under the placeholder host — then no absolute-URL tags (og:url/
// og:image) are emitted (crawlers reject relative), degrading to a text-only card.
function ogTagsFor(
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
    ? `card source present (${haveHero ? "hero.html" : "viz:card=self"}) but no og image yet — generate it: bun verify.ts <id> --og`
    : "no preview image — add og.png (1200×630) or a hero.html card, then bun verify.ts <id> --og (text-only card for now)");
  else if (found === "og.auto.png" && !cardSrc) warnings.push("preview image is auto-generated (og.auto.png from verify) — supply og.png or a hero.html for a polished card");
  else if (found === "og.auto.png" && cardSrc && statSync(cardSrc).mtimeMs > statSync(path.join(vizDir, found)).mtimeMs)
    warnings.push(`${haveHero ? "hero.html" : "index.html"} changed since og.auto.png was generated — regenerate: bun verify.ts <id> --og`);
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
function injectHead(html: string, tags: string): string {
  if (!tags) return html;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, tags + "\n</head>")
    : html.replace(/(<head[^>]*>)/i, `$1\n${tags}`);
}

function withOgTags(vizDir: string, dest: string, slug: string, shareHost: string, html: string, warnings: string[]): string {
  const haveHost = shareHost !== PLACEHOLDER_HOST;
  const base = shareHost.replace(/\/$/, "") + "/" + slug + "/";
  return injectHead(html, ogTagsFor(vizDir, dest, haveHost, base, base, html, warnings));
}

// The private-viz share shim: an UNSEALED page carrying the OG card in its head and a
// JS-only redirect to the sealed page's #staticrypt_pwd magic link. JS-only is deliberate
// — crawlers don't run JS, so they stop here and read the card (never reaching the sealed
// "Protected Page"); humans get bounced straight through to auto-decrypt. Lives at a secret
// path (the staticrypt hash), so possession of the link is the whole access gate.
function shimDoc(headTags: string, redirectUrl: string): string {
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

// ---- Per-viz publish: build, then (private) seal + link. Returns a report line. ----
// opts (ADR 0006 mirrors): `overrides` rewrites the artifact's head frame BEFORE
// sealing; `sidecar`, when set, is written as a .mirror.json beside the artifact so
// the destination becomes self-describing. Plain (home-container) publishes pass
// neither and behave exactly as before.
async function publishOne(
  vizDir: string,
  outRoot: string,
  isPrivate: boolean,
  shareHost: string,
  opts?: { overrides?: HeadOverrides; sidecar?: Sidecar; lobby?: KeyEntry },
): Promise<{ slug: string; ok: boolean; warnings: string[]; link?: string }> {
  const slug = path.basename(vizDir);
  let { html, warnings } = buildSelfContained(vizDir, opts?.overrides);
  const dest = path.join(outRoot, slug);
  let link: string | undefined;

  // Make sure the viz has a preview image before we read it into the card — regenerates a
  // stale/missing og.auto.png (from hero.html or the live page) so no manual verify.ts --og.
  await ensureOgImage(vizDir, warnings);

  // Which key seals this page?
  //   private            → its OWN keystore key; emits a per-viz share shim (its own hash).
  //   public + lobby     → the shared LOBBY key; ALSO emits a per-viz share shim, so a sealed
  //                        page still has an unfurl-able share link — the shim carries the OG
  //                        card and redirects with the lobby key (+remember_me → open one viz,
  //                        browse the whole site). Its hash IS the lobby key, so that per-viz
  //                        link grants WHOLE-SITE access (the lobby model); use posture:private
  //                        for a viz that must have its own separate key.
  //   public + no lobby  → not sealed: ship plaintext + rich-link-preview tags.
  let sealKey: KeyEntry | null = null;
  let emitLink = false;
  if (isPrivate) {
    const id = idFor(vizDir);
    // ok:false on these early exits so the caller can tell the unit was NOT written
    // (e.g. a mirror push must not mark a failed slug "kept" and spare it from prune).
    if (!id) return { slug, ok: false, warnings: [...warnings, "viz is outside $HOME — cannot key a keystore entry; skipped"] };
    sealKey = await getOrCreate(id);
    emitLink = true;
  } else if (opts?.lobby) {
    sealKey = opts.lobby;
    emitLink = true; // lobby-sealed public viz → its own unfurl-able share shim (redirects with the lobby key)
  }

  if (!sealKey) {
    mkdirSync(dest, { recursive: true });
    html = withOgTags(vizDir, dest, slug, shareHost, html, warnings);
    await Bun.write(path.join(dest, "index.html"), html);
    // Publish the hand-authored hero card too — it's a viewable, interactive full-screen page
    // in its own right, not just the OG-image source. PUBLIC (unsealed) only: a sealed viz must
    // never drop a plaintext hero at a guessable path (it'd leak the content the seal protects).
    // ponytail: verbatim copy — our heroes are self-contained; if a future hero pulls /_kit,
    // inline it through buildSelfContained here instead.
    const heroSrc = path.join(vizDir, "hero.html");
    if (existsSync(heroSrc)) cpSync(heroSrc, path.join(dest, "hero.html"));
  } else {
    // Stage the plaintext in a throwaway dir, seal into the out tree.
    const stageDir = path.join(os.tmpdir(), "viz-publish-stage", slug);
    mkdirSync(stageDir, { recursive: true });
    await Bun.write(path.join(stageDir, "index.html"), html);

    const sealed = await seal(stageDir, "index.html", dest, sealKey);
    if (!sealed) return { slug, ok: false, warnings: [...warnings, "sealing failed (see staticrypt error above)"] };

    if (emitLink) {
      const shareBase = shareHost.replace(/\/$/, "") + "/" + slug + "/";
      const magic = await magicLink(stageDir, "index.html", sealKey, shareBase);
      // The shim path IS the staticrypt hash from the magic link — one secret, reused as
      // both the unguessable locator and the auto-decrypt credential the shim redirects
      // with. No new keystore field; rotate mints a new passphrase → new hash → new shim.
      const hash = magic.match(/#staticrypt_pwd=([^&]+)/)?.[1];
      const haveHost = shareHost !== PLACEHOLDER_HOST;
      // A lobby shim redirects with &remember_me so opening ONE viz stores the shared lobby
      // credential and the whole site opens as you navigate (the lobby is "enter once, browse
      // freely"). A private viz is a single sealed page, so it redirects with the bare magic link.
      const redirect = opts?.lobby ? magic + "&remember_me" : magic;
      if (hash && haveHost) {
        const shimDir = path.join(dest, hash);
        mkdirSync(shimDir, { recursive: true });
        const shimBase = shareBase + hash + "/"; // absolute URL of the shim dir (card + og image live here)
        const tags = ogTagsFor(vizDir, shimDir, haveHost, shimBase, shimBase, html, warnings);
        await Bun.write(path.join(shimDir, "index.html"), shimDoc(tags, redirect));
        link = shimBase; // the shim URL is the thing you share
      } else {
        // No real host yet (placeholder) or unparseable hash → fall back to the raw magic
        // link; a shim needs an absolute host to be useful. The publish NOTE covers this.
        link = redirect;
      }
    }
  }

  // Self-describing sink: the sidecar is the local card-truth (load-bearing for a
  // private mirror, whose sealed head is encrypted). Written for BOTH postures.
  if (opts?.sidecar) {
    await Bun.write(path.join(dest, MIRROR_SIDECAR), JSON.stringify(opts.sidecar, null, 2) + "\n");
  }
  return { slug, ok: true, warnings, link };
}

// List a container's immediate child vizzes (dirs with an index.html, no dotdirs).
// Sorted by slug so the lobby index (and every other consumer) has a DETERMINISTIC order —
// readdirSync order is filesystem-dependent (alphabetical on macOS/APFS, but not guaranteed on
// Linux/CI), which would otherwise shuffle the cards between build hosts.
// ponytail: alphabetical-by-slug is the deterministic default; add a curation meta if you ever
// want hand-ordered cards.
function vizzesIn(container: string): string[] {
  return readdirSync(container, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => path.join(container, d.name))
    .filter((d) => existsSync(path.join(d, "index.html")))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

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

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Decode the handful of HTML entities a meta `content` attribute may carry, so card
// values are PLAIN text. Without this, a title written as `Roadmap &amp; Vision`
// (the entity for a literal &) would be stored raw and then re-escaped by escHtml on
// render → `&amp;amp;` (and re-escaped by escAttr into a mirror's head). Decode &amp;
// LAST so an already-literal "&lt;" inside the source isn't double-decoded.
function decodeEntities(s: string): string {
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
const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

export function grabMeta(html: string, name: string): string {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])(.*?)\\1`, "i");
  return decodeEntities((stripComments(html).match(re)?.[2] ?? "").trim());
}

// Like grabMeta but returns EVERY matching meta's content — repeated elements with
// the same name (valid HTML) become an ordered list. Used for multi-valued metas
// like viz:tag. Empties are dropped; order follows document order.
function grabMetaAll(html: string, name: string): string[] {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])(.*?)\\1`, "ig");
  return [...stripComments(html).matchAll(re)].map((m) => decodeEntities(m[2].trim())).filter(Boolean);
}

function vizCardMeta(html: string): { title: string; description: string; tags: string[]; kind: "explanatory" | "operational" } {
  return {
    title: grabMeta(html, "viz:title") || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim() || "Untitled viz",
    description: grabMeta(html, "viz:description") || grabMeta(html, "description"),
    tags: grabMetaAll(html, "viz:tag"),
    kind: grabMeta(html, "viz:kind").toLowerCase() === "operational" ? "operational" : "explanatory",
  };
}

// Posture is declared by the viz itself: <meta name="viz:posture" content="public|private|local">.
// It is the SOLE source of truth — there is no --public/--private flag. Three values:
//   public  → built + hosted as-is
//   private → built + StatiCrypt-sealed + magic link
//   local   → NEVER published; the run silently skips it (the viz stays on your machine)
// A viz that declares NONE of these is an ERROR (publish refuses), so nothing is ever
// published on a guessed posture. Returns the value, or null (undeclared → refuse).
function readPosture(vizDir: string): "public" | "private" | "local" | null {
  const indexPath = path.join(vizDir, "index.html");
  if (!existsSync(indexPath)) return null;
  const v = grabMeta(readFileSync(indexPath, "utf8"), "viz:posture").toLowerCase();
  return v === "public" || v === "private" || v === "local" ? v : null;
}

// Listing is a SEPARATE axis from posture. <meta name="viz:listed" content="unlisted"> (or the
// legacy "false") hides a viz from the lobby index — but it is still BUILT and reachable by
// its direct URL. This is UX-level non-advertisement (obscurity), NOT access control. Default
// (meta absent, or "listed"/"true") = listed; "unlisted" or "false" (case-insensitive) unlist.
function readListed(vizDir: string): boolean {
  const indexPath = path.join(vizDir, "index.html");
  if (!existsSync(indexPath)) return true;
  const v = grabMeta(readFileSync(indexPath, "utf8"), "viz:listed").toLowerCase();
  return v !== "false" && v !== "unlisted";
}

// Optional per-container preamble: raw HTML in <container>/_preamble.html, injected on the
// lobby page between the eyebrow and the card grid. Absent → no preamble. It's authored HTML
// (same trust as every viz), so it's emitted verbatim — no escaping, no markdown engine.
function readPreamble(container: string): string {
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
const LOBBY_MARKER = "_private-lobby";
async function readLobby(container: string): Promise<KeyEntry | null> {
  if (!existsSync(path.join(container, LOBBY_MARKER))) return null;
  const id = idFor(container);
  // Fail closed: a lobby was requested but we can't key it — refuse rather than fall
  // back to publishing everything in the clear (that would leak a site meant to be sealed).
  if (!id) {
    die(`ERROR: ${LOBBY_MARKER} present but ${container} is outside $HOME — cannot key the lobby.\nMove the container under your home directory, or remove the marker.`, 2);
  }
  return getOrCreate(id + "#lobby");
}

// ---- Lobby hero — the "meta" OG card the site root unfurls into ------------
// A viz gets a rich link preview from its own hero.html/og image; the LOBBY is its own
// shareable surface, so it gets one too — auto-generated, and meta: a 1200×630 montage
// that SHOWCASES the vizzes it contains (a wall of their hero thumbnails under the site
// title). Rendered with the same headless Chrome verify.ts uses for og.auto.png, written
// into the dist as _thumbs/lobby-og.png. Best-effort: no Chrome → text-only card, build
// still succeeds. Only for a PUBLIC lobby with a real --base-url (a sealed lobby's head is
// encrypted; a placeholder host can't emit an absolute og:image crawlers accept).
function chromePath(): string | null {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const c of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ]) if (existsSync(c)) return c;
  return null;
}

const THUMB_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
function dataUri(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return `data:${THUMB_MIME[ext] ?? "image/png"};base64,${readFileSync(file).toString("base64")}`;
}

// The montage page: a grid of the hero thumbnails at THEIR OWN 1.91:1 aspect — never cropped.
// Fully DYNAMIC: for the actual viz count, we pick the column count that makes the tiles as
// large as they can be (max tile size = max coverage) so the heroes fill as much of the
// 1200×630 frame as possible while staying whole. Rows are centered, so a short last row sits
// balanced instead of leaving a corner gap. A slim caption (title + count) sits on its own
// strip below the images. Up to 20 tiles; beyond that a "+N" tile stands in for the rest —
// past ~20 the thumbnails get too small to read.
function lobbyHeroHtml(title: string, subtitle: string, thumbSrcs: string[]): string {
  const CAP = 20;
  const cells = thumbSrcs.slice(0, CAP).map((src) => `<div class="c"><img src="${src}" alt=""></div>`);
  const extra = thumbSrcs.length - CAP;
  if (extra > 0) cells.push(`<div class="c more">+${extra}</div>`);
  const n = cells.length;

  // Pick the column count that makes the tiles biggest. Each tile keeps the hero aspect
  // (AR); for every candidate `cols` a tile is bounded by BOTH the available width and the
  // available height (the grid area above the caption) — take the arrangement whose tiles
  // come out largest. Bigger tiles ⇒ more total area covered, for any count.
  const AR = 1200 / 630, GAP = 16, PAD = 30, CAP_H = 76;
  const availW = 1200 - PAD * 2, availH = 630 - CAP_H - PAD * 2;
  let best = { cols: 1, tw: 0, th: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const twByW = (availW - (cols - 1) * GAP) / cols;
    const twByH = ((availH - (rows - 1) * GAP) / rows) * AR;
    const tw = Math.min(twByW, twByH);
    if (tw > best.tw) best = { cols, tw: Math.floor(tw), th: Math.floor(tw / AR) };
  }

  const cap = (title || subtitle)
    ? `<div class="cap">${title ? `<span class="t">${escHtml(title)}</span>` : ""}${subtitle ? `<span class="s">${escHtml(subtitle)}</span>` : ""}</div>`
    : "";
  // Flex-wrap (not fixed grid columns) so each row — including a short last one — is centered.
  // The grid is exactly availW wide and each tile is sized so `cols` fit per row, so it wraps
  // predictably at the chosen column count.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  body{width:1200px;height:630px;overflow:hidden;background:#0d1117;color:#e6edf3;
    display:flex;flex-direction:column;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .mosaic{flex:1;display:flex;align-items:center;justify-content:center;padding:${PAD}px;min-height:0}
  .grid{width:${availW}px;display:flex;flex-wrap:wrap;gap:${GAP}px;justify-content:center;align-content:center}
  .c{width:${best.tw}px;height:${best.th}px;border-radius:12px;overflow:hidden;
    border:1px solid #30363d;background:#0b1220;flex:0 0 auto}
  .c img{width:100%;height:100%;object-fit:contain;display:block}
  .c.more{display:flex;align-items:center;justify-content:center;color:#c9d1d9;
    font:700 40px/1 ui-monospace,SFMono-Regular,Menlo,monospace;background:linear-gradient(135deg,#11203a,#1b2942)}
  .cap{height:${CAP_H}px;flex:0 0 auto;display:flex;align-items:center;gap:16px;
    padding:0 ${PAD}px;border-top:1px solid #21262d}
  .cap .t{font-size:30px;font-weight:800;letter-spacing:-0.02em}
  .cap .s{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;
    letter-spacing:.14em;text-transform:uppercase;color:#8b949e}
  </style></head><body>
  <div class="mosaic"><div class="grid">${cells.join("")}</div></div>
  ${cap}
  </body></html>`;
}

// Render lobbyHeroHtml to a 1200×630 PNG at outPng. Returns false on any failure (no
// Chrome, launch/render error) so the caller degrades to a text-only card, never breaks.
async function renderLobbyOg(thumbAbsPaths: string[], title: string, subtitle: string, outPng: string): Promise<boolean> {
  const exe = chromePath();
  if (!exe) return false;
  const html = lobbyHeroHtml(title, subtitle, thumbAbsPaths.map(dataUri));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath: exe, headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15000 });
    mkdirSync(path.dirname(outPng), { recursive: true });
    await page.screenshot({ path: outPng, fullPage: false });
    return true;
  } catch {
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

// The lobby's own OG/Twitter head tags (mirrors ogTagsFor, minus the per-viz image
// provenance dance — the montage is always at a known dist path). Absent imageUrl → a
// text-only card that still unfurls.
function lobbyOgTags(og: { title: string; description: string; pageUrl?: string; imageUrl?: string }): string {
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escHtml(og.title)}">`,
    og.description ? `<meta property="og:description" content="${escHtml(og.description)}">` : "",
    og.pageUrl ? `<meta property="og:url" content="${escHtml(og.pageUrl)}">` : "",
    og.imageUrl ? `<meta property="og:image" content="${escHtml(og.imageUrl)}">` : "",
    og.imageUrl ? `<meta property="og:image:width" content="1200">` : "",
    og.imageUrl ? `<meta property="og:image:height" content="630">` : "",
    `<meta name="twitter:card" content="${og.imageUrl ? "summary_large_image" : "summary"}">`,
    og.description ? `<meta name="description" content="${escHtml(og.description)}">` : "",
  ].filter(Boolean).join("\n");
}

function renderLobby(
  vizzes: { slug: string; title: string; description: string; tags: string[]; kind: "explanatory" | "operational"; private: boolean; spoiler: boolean; thumb?: string; mtime: number; created: number }[],
  pageTitle: string,
  preamble: string,
  og?: { title: string; description: string; pageUrl?: string; imageUrl?: string },
): string {
  // A private card shows MINIMAL info — real title + a lock marker, no description —
  // so the index can list everything without leaking a sealed viz's blurb. The link
  // still points at ./slug/, which lands on the StatiCrypt gate (the index never
  // carries the key); access needs the separately-shared magic link.
  //
  // Each card wraps its text in .card__body and optionally leads with a .card__thumb
  // hero image. In LIST view the thumb is hidden (identical to the original layout); in
  // GRID/cards view it becomes the visual banner. A thumbless card gets a CSS-only
  // placeholder header in grid view so the grid stays uniform.
  const cards = vizzes
    .map((v) =>
      v.private
        ? `      <a class="card card--private" data-search="${escHtml(v.title.toLowerCase())}" data-posture="private" data-slug="${escHtml(v.slug)}" data-mtime="${v.mtime}" data-created="${v.created}" href="./${escHtml(v.slug)}/">\n` +
          `        <div class="card__body">\n` +
          `          <div class="tag">&#128274; Private</div>\n` +
          `          <h2>${escHtml(v.title)}</h2>\n` +
          `          <div class="go go--locked">Link required</div>\n        </div>\n      </a>`
        : `      <a class="card${v.thumb ? " has-thumb" : ""}${v.spoiler ? " has-spoiler" : ""}"${v.spoiler ? ` data-spoiler="1"` : ""} data-search="${escHtml([v.title, v.description, ...v.tags].join(" ").toLowerCase())}" data-kind="${v.kind}" data-tags="${escHtml(v.tags.join("|"))}" data-posture="public" data-slug="${escHtml(v.slug)}" data-mtime="${v.mtime}" data-created="${v.created}" href="./${escHtml(v.slug)}/">\n` +
          (v.thumb ? `        <img class="card__thumb" src="./${escHtml(v.thumb)}" alt="" loading="lazy">\n` : "") +
          (v.spoiler ? `        <div class="card__veil"><span>&#9888;</span> Spoilers &mdash; click to reveal</div>\n` : "") +
          `        <div class="card__body">\n` +
          (v.kind === "operational" || v.tags.length
            ? `          <div class="tags">\n` +
              (v.kind === "operational" ? `            <span class="tag tag--op">&#9889; Operational</span>\n` : "") +
              v.tags.map((t) => `            <span class="tag">${escHtml(t)}</span>\n`).join("") +
              `          </div>\n`
            : "") +
          `          <h2>${escHtml(v.title)}</h2>\n` +
          (v.description ? `          <p>${escHtml(v.description)}</p>\n` : "") +
          `          <div class="go">Open</div>\n        </div>\n      </a>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escHtml(pageTitle)}</title>
${og ? lobbyOgTags(og) + "\n" : ""}<!-- generated by /viz build.ts — regenerated on each publish; edit the vizzes, not this file -->
<style>
  :root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;
    --accent:#58a6ff;--c4:#bc8cff;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
  *{box-sizing:border-box}html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.5;
    display:flex;flex-direction:column;align-items:center;padding:48px 11px 64px}
  .wrap{width:100%;max-width:1600px}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 24px}
  .preamble{margin:0 0 28px;color:#cdd6e0;font-size:15px}
  .preamble :where(h1,h2,h3){color:var(--text);letter-spacing:-0.01em;margin:0 0 10px}
  .preamble p{margin:0 0 12px}
  .preamble a{color:var(--accent);text-decoration:none}
  .preamble a:hover{text-decoration:underline}
  .preamble code{font-family:var(--mono);font-size:.92em}
  .grid{display:grid;gap:16px}
  a.card{display:block;text-decoration:none;color:inherit;background:var(--panel);
    border:1px solid var(--border);border-radius:14px;overflow:hidden;transition:.16s}
  a.card:hover{border-color:var(--accent);background:#11203a;transform:translateY(-1px)}
  .card__body{padding:20px 22px}
  .card__thumb{display:none}
  /* List view: OG thumbnail as a full-height strip at the row's left edge, mirroring the
     self-portrait rows. Absolutely positioned so it never breaks the spoiler veil / body
     order; scoped to :not(.grid--cards) so the grid rules below re-lay the same <img> as a
     full-width hero. Thumbless rows (private, or public with no og) get a placeholder strip
     so every row's left edge stays aligned. */
  .grid:not(.grid--cards) a.card{position:relative;padding-left:112px}
  .grid:not(.grid--cards) .card__thumb,
  .grid:not(.grid--cards) a.card:not(.has-thumb)::before{
    position:absolute;left:0;top:0;bottom:0;width:112px;
    object-fit:cover;background:#0b1220;border-right:1px solid var(--border)}
  .grid:not(.grid--cards) .card__thumb{display:block}
  .grid:not(.grid--cards) a.card:not(.has-thumb)::before{content:"";
    background:linear-gradient(135deg,#11203a,#1b2942)}
  .grid:not(.grid--cards) a.card--private:not(.has-thumb)::before{content:"\\1F512";display:flex;
    align-items:center;justify-content:center;font-size:24px;color:var(--muted);
    background:linear-gradient(135deg,#161b22,#20262f)}
  /* Grid / cards view: multi-column, hero image on top, description clamped. */
  .grid.grid--cards{grid-template-columns:repeat(auto-fill,minmax(400px,1fr))}
  .grid--cards a.card{display:flex;flex-direction:column}
  .grid--cards .card__thumb{display:block;width:100%;aspect-ratio:1200/630;object-fit:cover;
    background:#0b1220;border-bottom:1px solid var(--border)}
  .grid--cards a.card:not(.has-thumb) .card__body{padding-top:20px}
  .grid--cards a.card:not(.has-thumb)::before{content:"";display:block;aspect-ratio:1200/630;
    background:linear-gradient(135deg,#11203a,#1b2942);border-bottom:1px solid var(--border)}
  .grid--cards a.card--private:not(.has-thumb)::before{content:"\\1F512";display:flex;
    align-items:center;justify-content:center;font-size:30px;color:var(--muted);
    background:linear-gradient(135deg,#161b22,#20262f)}
  .grid--cards .card__body{padding:16px 18px}
  .grid--cards .card__body p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .card .tags{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
  .card .tag{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--c4)}
  .card .tag--op{color:#f0883e;font-weight:600}
  .card h2{font-size:19px;margin:7px 0 8px;letter-spacing:-0.01em}
  .card p{margin:0 0 12px;color:#cdd6e0;font-size:14px}
  .card .go{font-size:13.5px;color:var(--accent);font-weight:600}
  .card .go::after{content:" →"}
  .card--private .tag{color:var(--muted)}
  .card--private:hover{border-color:var(--muted)}
  .card .go--locked{color:var(--muted);font-weight:500}
  .card .go--locked::after{content:""}
  /* Spoiler cards: hero image + blurb blurred, with a warning strip, until clicked to reveal.
     The strip sits in normal flow (banner under the hero in grid; top of the card in list). */
  .card__veil{display:flex;align-items:center;gap:8px;padding:9px 18px;cursor:pointer;
    font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;
    color:#f0b429;background:rgba(240,180,41,.1);border-bottom:1px solid rgba(240,180,41,.25)}
  .card__veil span{font-size:13px;line-height:1}
  .card.revealed .card__veil{display:none}
  .card.has-spoiler:not(.revealed) .card__thumb{filter:blur(26px)}
  .card.has-spoiler:not(.revealed) .card__body p{filter:blur(6px);user-select:none}
  .card.has-spoiler:not(.revealed):hover{border-color:#f0b429}
  .toolbar{margin:0 0 22px}
  .search-row{display:flex;align-items:center;gap:12px;margin:0 0 12px}
  #viz-search{flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:10px;
    color:var(--text);font:15px/1.4 var(--sans);padding:10px 14px;outline:none}
  #viz-search:focus{border-color:var(--accent)}
  #viz-search::placeholder{color:var(--muted)}
  .viz-count{font-family:var(--mono);font-size:12px;color:var(--muted);white-space:nowrap}
  .facets{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center}
  .facet{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .facet-label{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-right:2px}
  .chip{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;
    color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:999px;
    padding:4px 11px;cursor:pointer;user-select:none;transition:.14s;line-height:1.4}
  .chip:hover{border-color:var(--accent);color:var(--text)}
  .chip.on{background:#11203a;border-color:var(--accent);color:var(--accent)}
  .card__age{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:11px;
    letter-spacing:.04em;color:var(--muted);margin-top:10px}
  .card__age svg{width:12px;height:12px;opacity:.85}
  .viewbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px}
  .segmented{display:inline-flex;background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:2px}
  .seg{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--muted);background:none;border:0;border-radius:999px;padding:5px 13px;cursor:pointer;transition:.14s}
  .seg:hover{color:var(--text)}
  .seg.on{background:#11203a;color:var(--accent)}
  .sortwrap{display:inline-flex;align-items:center;gap:8px}
  .segdir{font-family:var(--mono);font-size:14px;line-height:1;color:var(--muted);background:var(--panel);
    border:1px solid var(--border);border-radius:999px;padding:6px 11px;cursor:pointer;transition:.14s;min-width:34px}
  .segdir:hover{color:var(--accent);border-color:var(--accent)}
  .viz-empty{color:var(--muted);text-align:center;padding:40px 0;font-size:15px}
  .card mark{background:rgba(240,136,62,.32);color:inherit;border-radius:3px;padding:0 1px}
  .card .tag mark{background:rgba(240,136,62,.42)}
</style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow">visualizations</div>
${preamble ? `    <div class="preamble">\n${preamble}\n    </div>\n` : ""}    <div class="toolbar" id="viz-toolbar" hidden>
      <div class="search-row">
        <input id="viz-search" type="search" placeholder="Search title, description, tags…" autocomplete="off" spellcheck="false">
        <span class="viz-count" id="viz-count"></span>
      </div>
      <div class="facets" id="viz-facets"></div>
    </div>
    <div class="viewbar" id="viz-viewbar" hidden>
      <div class="sortwrap">
        <div class="segmented" role="group" aria-label="Sort by" id="viz-sort">
          <button type="button" class="seg" data-key="modified" aria-pressed="false">Modified</button>
          <button type="button" class="seg on" data-key="created" aria-pressed="true">Created</button>
          <button type="button" class="seg" data-key="title" aria-pressed="false">Title</button>
        </div>
        <button type="button" class="segdir" id="viz-sortdir" data-dir="desc" aria-label="Sort direction" title="Toggle ascending / descending">&#8595;</button>
      </div>
      <div class="segmented" role="group" aria-label="View" id="viz-view">
        <button type="button" class="seg" data-view="list" aria-pressed="false">List</button>
        <button type="button" class="seg on" data-view="cards" aria-pressed="true">Grid</button>
      </div>
    </div>
    <div class="grid grid--cards">
${cards}
    </div>
    <div class="viz-empty" id="viz-empty" hidden>No visualizations match your filters.</div>
  </div>
  <script>
  (function(){
    var cards=[].slice.call(document.querySelectorAll("a.card"));
    // Spoiler cards: the FIRST click reveals (unblurs) instead of navigating; a second click
    // opens the viz. So a spoiler is never sprung by a stray click, and never persists across
    // reloads (re-blurs on refresh). Keyboard Enter behaves the same (it fires a click).
    cards.forEach(function(c){
      if(!c.dataset.spoiler)return;
      c.addEventListener("click",function(e){
        if(c.classList.contains("revealed"))return;   // already revealed → let the link open
        e.preventDefault();e.stopPropagation();
        c.classList.add("revealed");
      });
    });
    // Age badge — a clock + relative time that TRACKS whichever time field you're sorting on
    // (created / modified; a Title sort falls back to modified). Rendered client-side so it stays
    // fresh, re-rendered when the key changes, and hovering shows BOTH absolute dates. Runs for
    // every card, even a lone one.
    var CLOCK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    function fmtAgo(ms){
      if(!ms)return "unknown";
      var m=(Date.now()-ms)/60000,h=m/60,d=h/24;
      if(m<1)return "just now";
      if(m<60)return Math.floor(m)+"m ago";
      if(h<24)return Math.floor(h)+"h ago";
      if(d<30)return Math.floor(d)+"d ago";
      if(d<365)return Math.floor(d/30)+"mo ago";
      return Math.floor(d/365)+"y ago";
    }
    function absDate(ms){return ms?new Date(ms).toLocaleString():"unknown";}
    function renderAges(field){                              // field: "created" | "modified"
      cards.forEach(function(c){
        var mt=+c.dataset.mtime||0, ct=+c.dataset.created||0;
        if(!mt&&!ct)return;
        var body=c.querySelector(".card__body")||c;
        var age=c.querySelector(".card__age");
        if(!age){age=document.createElement("div");age.className="card__age";body.appendChild(age);}
        age.innerHTML=CLOCK+"<span>"+field+" "+fmtAgo(field==="created"?ct:mt)+"</span>";
        age.title="created "+absDate(ct)+"  ·  modified "+absDate(mt);
      });
    }
    // Sort control — pick a KEY (modified / created / title) and, INDEPENDENTLY, a direction
    // (down=desc / up=asc) that applies to all three. Default: created, descending. The age badge
    // follows the key (title falls back to modified). Both choices persist per user.
    (function(){
      var bar=document.getElementById("viz-sort"),dirBtn=document.getElementById("viz-sortdir"),grid=document.querySelector(".grid");
      var key="created",dir="desc";
      try{key=localStorage.getItem("viz-sortkey")||key;}catch(e){}
      try{dir=localStorage.getItem("viz-sortdir")||dir;}catch(e){}
      function apply(){
        if(grid&&cards.length>1){
          var arr=cards.slice();
          arr.sort(function(a,b){
            var r;
            if(key==="title")r=(a.dataset.slug||"").localeCompare(b.dataset.slug||"");
            else{var f=key==="created"?"created":"mtime";r=(+a.dataset[f]||0)-(+b.dataset[f]||0);}
            return dir==="desc"?-r:r;
          });
          arr.forEach(function(c){grid.appendChild(c);});
        }
        if(bar)[].slice.call(bar.querySelectorAll(".seg")).forEach(function(s){
          var on=s.dataset.key===key;s.classList.toggle("on",on);s.setAttribute("aria-pressed",on);});
        if(dirBtn){dirBtn.textContent=dir==="desc"?"↓":"↑";dirBtn.dataset.dir=dir;
          dirBtn.title=(dir==="desc"?"Descending":"Ascending")+" — click to toggle";}
        renderAges(key==="created"?"created":"modified");
        try{localStorage.setItem("viz-sortkey",key);localStorage.setItem("viz-sortdir",dir);}catch(e){}
      }
      if(bar)[].slice.call(bar.querySelectorAll(".seg")).forEach(function(s){s.onclick=function(){key=s.dataset.key;apply();};});
      if(dirBtn)dirBtn.onclick=function(){dir=dir==="desc"?"asc":"desc";apply();};
      apply();
    })();
    // View toggle (list <-> grid) — independent of search/facets. Defaults to grid;
    // the user's choice is remembered in localStorage.
    (function(){
      var bar=document.getElementById("viz-viewbar"),group=document.getElementById("viz-view"),grid=document.querySelector(".grid");
      if(!bar||!group||!grid||cards.length<2)return;
      bar.hidden=false;
      var segs=[].slice.call(group.querySelectorAll(".seg"));   // scope to the View group only — .seg also matches the Sort group
      var saved=null;try{saved=localStorage.getItem("viz-view");}catch(e){}
      function set(v){
        grid.classList.toggle("grid--cards",v==="cards");
        segs.forEach(function(s){var on=s.dataset.view===v;s.classList.toggle("on",on);s.setAttribute("aria-pressed",on);});
        try{localStorage.setItem("viz-view",v);}catch(e){}
      }
      segs.forEach(function(s){s.onclick=function(){set(s.dataset.view);};});
      set(saved||"cards");                          // default to grid; user's toggle sticks
    })();
    var toolbar=document.getElementById("viz-toolbar");
    if(cards.length<2)return;                       // nothing worth filtering
    toolbar.hidden=false;
    var search=document.getElementById("viz-search"),facetBox=document.getElementById("viz-facets"),
        count=document.getElementById("viz-count"),empty=document.getElementById("viz-empty");
    var cap=function(s){return s.charAt(0).toUpperCase()+s.slice(1);};
    var uniq=function(a){return a.filter(function(v,i){return v&&a.indexOf(v)===i;});};
    var groups=[
      {key:"Kind",attr:"kind",label:cap,values:uniq(cards.map(function(c){return c.dataset.kind;}))},
      {key:"Posture",attr:"posture",label:cap,values:uniq(cards.map(function(c){return c.dataset.posture;}))},
      {key:"Tags",attr:"tags",multi:true,label:function(v){return v;},
        values:uniq([].concat.apply([],cards.map(function(c){return c.dataset.tags?c.dataset.tags.split("|"):[];})))}
    ];
    var sel={};                                     // group.key -> Set of active values (OR within, AND across)
    groups.forEach(function(g){
      sel[g.key]=new Set();
      if(g.values.length<2)return;                  // one value = pointless facet
      var wrap=document.createElement("span");wrap.className="facet";
      var lab=document.createElement("span");lab.className="facet-label";lab.textContent=g.key;wrap.appendChild(lab);
      g.values.forEach(function(v){
        var chip=document.createElement("button");chip.type="button";chip.className="chip";chip.textContent=g.label(v);
        chip.onclick=function(){
          if(sel[g.key].has(v)){sel[g.key].delete(v);chip.classList.remove("on");}
          else{sel[g.key].add(v);chip.classList.add("on");}
          apply();
        };
        wrap.appendChild(chip);
      });
      facetBox.appendChild(wrap);
    });
    var esc=function(s){return s.replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});};
    var rx=function(s){return s.replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&");};
    function hl(el,terms){                            // wrap each term in <mark>, restore when none
      if(!el)return;
      if(el.dataset.orig==null)el.dataset.orig=el.textContent;
      var raw=el.dataset.orig;
      if(!terms.length){el.textContent=raw;return;}
      var re=new RegExp("("+terms.map(rx).join("|")+")","ig"),out="",last=0,m;
      while((m=re.exec(raw))){
        out+=esc(raw.slice(last,m.index))+"<mark>"+esc(m[0])+"</mark>";
        last=m.index+m[0].length;
        if(m.index===re.lastIndex)re.lastIndex++;
      }
      el.innerHTML=out+esc(raw.slice(last));
    }
    function apply(){
      var terms=search.value.toLowerCase().split(/\\s+/).filter(Boolean),shown=0;
      cards.forEach(function(c){
        var ok=terms.every(function(t){return (c.dataset.search||"").indexOf(t)>=0;});
        groups.forEach(function(g){
          if(!ok||!sel[g.key].size)return;
          if(g.multi){var vals=c.dataset.tags?c.dataset.tags.split("|"):[];ok=vals.some(function(v){return sel[g.key].has(v);});}
          else ok=sel[g.key].has(c.dataset[g.attr]);
        });
        c.style.display=ok?"":"none";
        if(ok){shown++;hl(c.querySelector("h2"),terms);hl(c.querySelector("p"),terms);[].forEach.call(c.querySelectorAll(".tags .tag"),function(t){hl(t,terms);});}
      });
      count.textContent=shown+" / "+cards.length;
      empty.hidden=shown>0;
    }
    search.addEventListener("input",apply);
    document.addEventListener("keydown",function(e){
      if(e.key==="/"&&document.activeElement!==search){e.preventDefault();search.focus();}
      else if(e.key==="Escape"&&document.activeElement===search){search.value="";apply();search.blur();}
    });
    apply();
  })();
  </script>
</body>
</html>
`;
}

// A viz's "last modified" epoch (ms), for the lobby index's newest-first sort + age badge.
// Prefer the last git commit that touched the dir — meaningful project time, stable across
// machines and clones (fs mtime is reset by a fresh checkout). Fall back to the newest file
// mtime on disk when the dir is untracked or outside a git repo.
function vizMtime(dir: string): number {
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
function vizCreated(dir: string): number {
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
type Card = { slug: string; title: string; description: string; tags: string[]; kind: "explanatory" | "operational"; private: boolean; spoiler: boolean; image?: string; mtime: number; created: number };

// <meta name="viz:spoiler" content="true"> → the lobby card blurs its hero image AND
// its blurb until the viewer clicks it once to reveal (per SKILL "spoiler"). Title stays
// visible (it's the episode name, not a spoiler). Does NOT touch the OG unfurl — a shared
// link still previews the full hero (that surface is the poster's call to strip).
function isSpoiler(html: string): boolean {
  return /^(true|1|yes|spoiler|spoilers)$/i.test(grabMeta(html, "viz:spoiler").trim());
}

// Build a card from a viz's SOURCE index.html (not the built/sealed artifact).
function cardFor(slug: string, sourceDir: string, isPrivate: boolean): Card {
  const html = readFileSync(path.join(sourceDir, "index.html"), "utf8");
  return { slug, ...vizCardMeta(html), private: isPrivate, spoiler: isSpoiler(html), image: isPrivate ? undefined : findOgImage(sourceDir) || undefined, mtime: vizMtime(sourceDir), created: vizCreated(sourceDir) };
}

// `srcContainer` is the SOURCE container (where `_preamble.html` lives) — distinct from
// `outRoot` (the dist dir) for a publish/preview, identical to it for an in-place mirror rebuild.
async function writeLobby(
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

export type MirrorOverrides = { title?: string; description?: string; tags?: string[] };
export type MirrorVizEntry = { slug: string; access: "public" | "private"; listed?: boolean; overrides?: MirrorOverrides };
export type MirrorTarget = { path: string; vizzes: MirrorVizEntry[] };

// The sidecar's card is a lobby Card minus the slug (the dir name IS the slug).
type SidecarCard = { title: string; description: string; tags: string[]; kind: "explanatory" | "operational"; listed: boolean; private: boolean };
type Sidecar = { origin: string; card: SidecarCard };

// Read + validate a child dir's .mirror.json. A dir carrying one is a mirrored-in
// artifact (terminal — never re-mirrored, never rebuilt). Returns null if absent/bad.
function readSidecar(dir: string): Sidecar | null {
  const p = path.join(dir, MIRROR_SIDECAR);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j && typeof j.origin === "string" && j.card && typeof j.card === "object") return j as Sidecar;
  } catch {
    /* fall through */
  }
  return null;
}

// Read + FAIL-CLOSED validate <container>/mirrors.json. Returns [] if no file.
// Collects ALL problems and refuses (non-zero, naming offenders) BEFORE anything is
// written — mirroring the undeclared-posture refusal. `nativeSlugs` is the set of
// the container's own native vizzes; a mirror entry may only name one of those (you
// mirror only what you own).
// A mirrors.json maps to sibling-repo filesystem PATHS — it's local-only by policy
// (committing it exposes where other repos live). Self-heal: ensure the enclosing
// git repo ignores it so it can never be committed. Idempotent; no-op outside a repo.
function ensureMirrorsIgnored(mirrorsFile: string): void {
  const abs = path.resolve(mirrorsFile);
  let dir = path.dirname(abs);
  let repoRoot = "";
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) { repoRoot = dir; break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!repoRoot) return; // not inside a git repo — nothing to ignore
  const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
  const giPath = path.join(repoRoot, ".gitignore");
  const existing = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  const lines = existing.split("\n").map((l) => l.trim());
  if (lines.includes(rel) || lines.includes("mirrors.json") || lines.includes("**/mirrors.json")) return;
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(giPath, existing + sep + "\n# viz mirror config: sibling-repo paths — local-only, never commit\n" + rel + "\n");
  console.error(`  ↳ gitignored ${rel} (local-only mirror config)`);
}

// Pure fail-closed validation of an already-parsed mirrors.json `raw`. Collects ALL
// problems; returns them alongside the cleaned targets so a caller can refuse BEFORE
// writing (manage.ts validates a candidate in memory; readMirrors dies on a bad file).
export function validateMirrors(raw: any, container: string, nativeSlugs: Set<string>): { targets: MirrorTarget[]; errors: string[] } {
  const errors: string[] = [];
  const targets: MirrorTarget[] = [];
  if (!raw || !Array.isArray(raw.mirrors)) {
    return { targets, errors: ['must be an object with a "mirrors" array'] };
  }
  raw.mirrors.forEach((m: any, mi: number) => {
    const where = `mirrors[${mi}]`;
    if (!m || typeof m.path !== "string" || !m.path.trim()) {
      errors.push(`${where}: missing/invalid "path" (must be a non-empty string)`);
      return;
    }
    if (!Array.isArray(m.vizzes)) {
      errors.push(`${where} (path="${m.path}"): missing "vizzes" array`);
      return;
    }
    const vizzes: MirrorVizEntry[] = [];
    m.vizzes.forEach((v: any, vi: number) => {
      const vw = `${where}.vizzes[${vi}]`;
      if (!v || typeof v.slug !== "string") {
        errors.push(`${vw}: missing "slug" (string)`);
        return;
      }
      if (!nativeSlugs.has(v.slug)) {
        errors.push(`${vw}: "${v.slug}" is not a native viz in ${container} — you mirror only what you own`);
        return;
      }
      if (v.access !== "public" && v.access !== "private") {
        errors.push(
          `${vw} ("${v.slug}"): "access" is REQUIRED and must be "public" or "private" — ` +
            `posture is re-decided per mirror (trust boundary), never inherited`,
        );
        return;
      }
      const entry: MirrorVizEntry = { slug: v.slug, access: v.access };
      if (v.listed !== undefined) {
        if (typeof v.listed !== "boolean") {
          errors.push(`${vw} ("${v.slug}"): "listed" must be a boolean`);
          return;
        }
        entry.listed = v.listed;
      }
      if (v.overrides !== undefined) {
        const o = v.overrides;
        if (!o || typeof o !== "object" || Array.isArray(o)) {
          errors.push(`${vw} ("${v.slug}"): "overrides" must be an object`);
          return;
        }
        const ov: MirrorOverrides = {};
        if (o.title !== undefined) {
          if (typeof o.title !== "string") { errors.push(`${vw}: overrides.title must be a string`); return; }
          ov.title = o.title;
        }
        if (o.description !== undefined) {
          if (typeof o.description !== "string") { errors.push(`${vw}: overrides.description must be a string`); return; }
          ov.description = o.description;
        }
        if (o.tags !== undefined) {
          if (!Array.isArray(o.tags) || o.tags.some((t: any) => typeof t !== "string")) {
            errors.push(`${vw}: overrides.tags must be an array of strings`);
            return;
          }
          ov.tags = o.tags;
        }
        entry.overrides = ov;
      }
      vizzes.push(entry);
    });
    targets.push({ path: m.path, vizzes });
  });

  return { targets, errors };
}

function readMirrors(container: string, nativeSlugs: Set<string>): MirrorTarget[] {
  const file = path.join(container, "mirrors.json");
  if (!existsSync(file)) return [];
  ensureMirrorsIgnored(file);
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    die(`ERROR: ${file} is not valid JSON: ${(e as Error).message}`, 2);
  }
  const { targets, errors } = validateMirrors(raw, container, nativeSlugs);
  if (errors.length) {
    die(`ERROR: invalid ${file} — NOTHING was written:\n  - ${errors.join("\n  - ")}`, 2);
  }
  return targets;
}

// Resolve a (viz × mirror) card: access decides `private`; everything else inherits
// the source viz's viz:* meta unless an override is present.
function resolveMirrorCard(vizDir: string, entry: MirrorVizEntry): SidecarCard {
  const base = vizCardMeta(readFileSync(path.join(vizDir, "index.html"), "utf8"));
  const o = entry.overrides ?? {};
  return {
    title: o.title ?? base.title,
    description: o.description ?? base.description,
    tags: o.tags ?? base.tags,
    kind: base.kind,
    listed: entry.listed ?? readListed(vizDir),
    private: entry.access === "private",
  };
}

// The ONE writer-agnostic composition rule (ADR 0006), run over a SOURCE container:
// a native child dir is carded from its (plaintext) <head>; a child dir carrying a
// .mirror.json is carded from that sidecar (load-bearing — a sealed mirror's head is
// encrypted). Both filtered by `listed`. LENIENT about natives that are
// undeclared/local/unlisted (skips them) so a foreign push never fails on a sink's
// own posture hygiene — refuse-on-undeclared is enforced only by a container's own
// publish over its own natives.
function composeCards(sourceContainer: string): { cards: Card[]; unlisted: number } {
  const cards: Card[] = [];
  let unlisted = 0;
  for (const dir of vizzesIn(sourceContainer)) {
    const slug = path.basename(dir);
    const side = readSidecar(dir);
    if (side) {
      if (!side.card.listed) { unlisted++; continue; }
      const { title, description, tags, kind, private: isPriv } = side.card;
      // ponytail: mirrored-in cards aren't spoiler-gated (sidecar carries no spoiler flag) —
      // add it to the sidecar schema if a mirrored viz ever needs it.
      cards.push({ slug, title, description, tags, kind, private: isPriv, spoiler: false, image: isPriv ? undefined : findOgImage(dir) || undefined, mtime: vizMtime(dir), created: vizCreated(dir) });
    } else {
      const posture = readPosture(dir);
      if (!posture || posture === "local") continue;
      if (!readListed(dir)) { unlisted++; continue; }
      cards.push(cardFor(slug, dir, posture === "private"));
    }
  }
  return { cards, unlisted };
}

// Push a container's native vizzes into each declared mirror target: write the
// self-describing units (artifact + sidecar), origin-scoped-prune our stale ones,
// then regenerate the sink's index from local presence. Build-and-STOP boundary is
// unchanged — this writes finished files into the mirror paths and does not deploy.
async function pushMirrors(container: string, mirrors: MirrorTarget[], shareHost: string): Promise<void> {
  const originPath = idFor(container) ?? container;
  // origin is an OWNERSHIP TAG for prune-matching only — mirrored-in artifacts are
  // terminal (copied verbatim, never rebuilt from here), so the sink never needs the
  // real source path. Hash it so the committed .mirror.json carries a stable id, not
  // a revealing filesystem path. Writer + pruner both use originId, so matching holds.
  const originId = "src-" + createHash("sha256").update(originPath).digest("hex").slice(0, 12);
  for (const mt of mirrors) {
    const mirrorPath = path.resolve(container, mt.path);
    mkdirSync(mirrorPath, { recursive: true });
    console.log(`\nMirror → ${mirrorPath}\n  origin: ${originPath}`);

    const kept = new Set<string>();
    for (const entry of mt.vizzes) {
      const vizDir = path.join(container, entry.slug);
      const card = resolveMirrorCard(vizDir, entry);
      const r = await publishOne(vizDir, mirrorPath, card.private, shareHost, {
        overrides: { title: card.title, description: card.description, tags: card.tags },
        sidecar: { origin: originId, card },
      });
      // Only a successfully-written unit is "kept" — a failed push must NOT spare a
      // stale/partial dir of the same slug from the origin-scoped prune below.
      if (r.ok) kept.add(entry.slug);
      const status = r.ok ? (card.private ? "private (sealed)" : "public") : "FAILED — not written";
      console.log(`  • ${r.slug} — ${status}${r.ok && !card.listed ? ", unlisted" : ""}`);
      for (const w of r.warnings) console.log(`      ⚠️  ${w}`);
      if (r.link) console.log(`      🔗 ${r.link}`);
    }

    // Origin-scoped prune: drop ONLY our stale mirrored dirs (origin == us, no longer
    // listed). Never touch the sink's natives or another origin's mirrored-in dirs.
    let pruned = 0;
    for (const dir of vizzesIn(mirrorPath)) {
      const side = readSidecar(dir);
      if (side && side.origin === originId && !kept.has(path.basename(dir))) {
        rmSync(dir, { recursive: true, force: true });
        pruned++;
        console.log(`  ✂️  pruned ${path.basename(dir)} (dropped from manifest)`);
      }
    }

    // Regenerate the sink's index from local presence (same rule any writer applies).
    const { cards } = composeCards(mirrorPath);
    await writeLobby(mirrorPath, cards, "Visualizations", mirrorPath, shareHost);
    console.log(`  index → ${path.join(mirrorPath, "index.html")}  (${cards.length} listed${pruned ? `, ${pruned} pruned` : ""})`);
  }
}

// ---- Build one container's publishable tree (shared by `publish` and `preview`) ----
// Builds NATIVE vizzes (per their viz:posture), copies MIRRORED-IN artifacts verbatim,
// and regenerates the lobby index — into `outRoot`. This is the build-and-STOP core:
// it writes ONLY inside outRoot. It does NOT push mirrors (an OUTBOUND write into other
// containers) and does NOT deploy — those are layered on top by `publish` alone, so
// `preview` can reuse this to produce an identical tree with zero outside side effects.
async function buildPublishableTree(
  container: string,
  outRoot: string,
  shareHost: string,
  opts: { noIndex?: boolean; indexTitle?: string; indexDescription?: string } = {},
): Promise<{ built: number; anyPrivate: boolean; mirroredIn: number; empty: boolean }> {
  const children = vizzesIn(container);
  const mirroredInDirs = children.filter((d) => existsSync(path.join(d, MIRROR_SIDECAR)));
  const natives = children.filter((d) => !existsSync(path.join(d, MIRROR_SIDECAR)));
  // A PRIVATE lobby (_private-lobby marker) seals every public-tier page + the lobby page
  // itself behind one key; `lobby` here is that key (null when the lobby is public).
  const lobby = await readLobby(container);

  // Resolve each native's posture — public/private build, local is skipped, undeclared
  // refuses the whole run (nothing is published, nor withheld, on a guess).
  const resolved: { vizDir: string; slug: string; private: boolean; listed: boolean }[] = [];
  const undeclared: string[] = [];
  const skippedLocal: string[] = [];
  for (const vizDir of natives) {
    const posture = readPosture(vizDir);
    if (posture === "local") skippedLocal.push(path.basename(vizDir));
    else if (!posture) undeclared.push(path.basename(vizDir));
    else resolved.push({ vizDir, slug: path.basename(vizDir), private: posture === "private", listed: readListed(vizDir) });
  }
  if (undeclared.length) {
    die(
      `ERROR: no posture declared for: ${undeclared.join(", ")}\n` +
        `Add <meta name="viz:posture" content="public"> (or "private", or "local" to keep it\n` +
        `off the host) to each viz's index.html. There is no default — nothing is published,\n` +
        `nor withheld, on a guess.`,
      2,
    );
  }
  if (skippedLocal.length) {
    console.log(`Skipping ${skippedLocal.length} local viz(es) — viz:posture=local, never published: ${skippedLocal.join(", ")}`);
  }
  if (resolved.length === 0 && mirroredInDirs.length === 0) {
    return { built: 0, anyPrivate: false, mirroredIn: 0, empty: true };
  }

  mkdirSync(outRoot, { recursive: true });
  if (resolved.length) {
    const split = resolved.map((t) => `${t.slug} → ${t.private ? "PRIVATE" : "PUBLIC"}${t.listed ? "" : " (unlisted)"}`).join("   ·   ");
    console.log(`Building ${resolved.length} viz(es) → ${outRoot}`);
    console.log(`Postures:  ${split}\n`);
  }

  let anyPrivate = false;
  for (const t of resolved) {
    const r = await publishOne(t.vizDir, outRoot, t.private, shareHost, lobby ? { lobby } : undefined);
    const tier = t.private ? "private (sealed)" : lobby ? "public (lobby-sealed)" : "public";
    console.log(`• ${r.slug} — ${tier}${t.listed ? "" : ", unlisted (hidden from index)"}`);
    for (const w of r.warnings) console.log(`    ⚠️  ${w}`);
    if (r.link) console.log(`    🔗 ${r.link}`);
    if (t.private) anyPrivate = true;
  }

  // Mirrored-in artifacts: copy verbatim (never rebuild a possibly-sealed file); the
  // index composes their card from the sidecar (the only local card-truth when sealed).
  for (const dir of mirroredInDirs) {
    const slug = path.basename(dir);
    const dest = path.join(outRoot, slug);
    mkdirSync(dest, { recursive: true });
    cpSync(path.join(dir, "index.html"), path.join(dest, "index.html"));
    cpSync(path.join(dir, MIRROR_SIDECAR), path.join(dest, MIRROR_SIDECAR));
    const side = readSidecar(dir);
    // Carry a PUBLIC mirror's hero.html + preview image too (native vizzes get these via
    // publishOne) so its card shows a real thumbnail and its hero page is viewable. A private
    // mirror stays sealed/verbatim — never emit its plaintext hero at a guessable path.
    if (!side?.card.private) {
      for (const f of ["hero.html", ...OG_NAMES]) {
        if (existsSync(path.join(dir, f))) cpSync(path.join(dir, f), path.join(dest, f));
      }
    }
    // A lobby also seals PUBLIC mirrored-in artifacts (a private one is already sealed
    // with its origin's key — leave it verbatim, it keeps its own password).
    if (lobby && side && !side.card.private) {
      const stageDir = path.join(os.tmpdir(), "viz-lobby-mirror-stage", slug);
      mkdirSync(stageDir, { recursive: true });
      cpSync(path.join(dir, "index.html"), path.join(stageDir, "index.html"));
      const ok = await seal(stageDir, "index.html", dest, lobby);
      console.log(`• ${slug} — mirrored-in, ${ok ? "lobby-sealed" : "SEAL FAILED (left verbatim)"}${side ? `, origin ${side.origin}` : ""}`);
    } else if (side) {
      console.log(`• ${slug} — mirrored-in (copied verbatim, origin ${side.origin})`);
    } else {
      console.log(`• ${slug} — mirrored-in (copied verbatim)`);
      console.log(`    ⚠️  ${MIRROR_SIDECAR} is malformed — this viz will be MISSING from the lobby index`);
    }
  }

  // The lobby (index.html) — one writer-agnostic rule (ADR 0006): native dirs card-from-source-
  // head, mirrored-in dirs card-from-sidecar; both filtered by `listed`.
  if (!opts.noIndex) {
    const { cards, unlisted } = composeCards(container);
    await writeLobby(outRoot, cards, opts.indexTitle ?? "Visualizations", container, shareHost, {
      sealed: !!lobby, // a private lobby's index is sealed after this — no plaintext OG head
      description: opts.indexDescription,
    });
    const pub = cards.filter((c) => !c.private).length;
    const prv = cards.length - pub;
    const mi = cards.filter((c) => existsSync(path.join(container, c.slug, MIRROR_SIDECAR))).length;
    const hidden = unlisted ? `; ${unlisted} unlisted (built, hidden from the lobby)` : "";
    console.log(
      `\nLobby → ${path.join(outRoot, "index.html")}  ` +
        `(${cards.length} listed: ${pub} public, ${prv} private${mi ? `, ${mi} mirrored-in` : ""}${hidden})`,
    );

    // Private lobby: seal the lobby page itself with the lobby key, then print the one
    // password + magic link that opens the whole site. The link carries #staticrypt_pwd
    // (host-independent hash) plus &remember_me, so opening it stores the credential and
    // every same-key page (public-tier vizzes) auto-decrypts — enter once, browse freely.
    if (lobby) {
      const stageDir = path.join(os.tmpdir(), "viz-lobby-index-stage", path.basename(outRoot));
      mkdirSync(stageDir, { recursive: true });
      cpSync(path.join(outRoot, "index.html"), path.join(stageDir, "index.html"));
      const ok = await seal(stageDir, "index.html", outRoot, lobby);
      const link = (await magicLink(stageDir, "index.html", lobby, shareHost.replace(/\/$/, "") + "/")) + "&remember_me";
      console.log(`\n🔒 Lobby — whole site sealed behind ONE password (enter once, browse freely):`);
      console.log(`   index seal: ${ok ? "ok" : "FAILED — index left in plaintext!"}`);
      console.log(`   passphrase: ${lobby.passphrase}`);
      console.log(`   link:       ${link}`);
      console.log(`   (already-private vizzes keep their own separate links)`);
    }
  }

  return { built: resolved.length, anyPrivate, mirroredIn: mirroredInDirs.length, empty: false };
}

// ---- Preview: a dumb local static server over a built tree (no deps, Bun.file sets
// content-types just like server.ts). Binds 127.0.0.1; port 0 ⇒ OS picks a free one. ----
// Serve the built preview tree with LIVE RELOAD: watch the source container, rebuild the
// publishable tree on any change, and push an SSE "reload" so open tabs refresh — the same
// enter-once-and-see-your-edits loop the dev server (server.ts) gives editable source, but
// here over the *publishable* snapshot, so `preview` tracks what you type.
// ponytail: naive full-tree rebuild per change, debounced; a preview is one local container,
// so this is fine — shard the rebuild only if a huge container makes it sluggish.
function servePreview(
  container: string,
  root: string,
  shareHost: string,
  opts: { noIndex?: boolean; indexTitle?: string; indexDescription?: string },
  requestedPort: number | undefined,
) {
  const RELOAD_PATH = "/_preview_reload";
  const RELOAD_SNIPPET =
    `<script>(function(){try{var es=new EventSource(${JSON.stringify(RELOAD_PATH)});` +
    `es.onmessage=function(e){if(e.data==='reload')location.reload();};}catch(_){}})();</script>`;
  const clients = new Set<ReadableStreamDefaultController>();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: requestedPort ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      // SSE channel the injected snippet listens on.
      if (url.pathname === RELOAD_PATH) {
        let self: ReadableStreamDefaultController;
        const stream = new ReadableStream({
          start(c) { self = c; clients.add(c); c.enqueue(": ok\n\n"); },
          cancel() { clients.delete(self); },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const filePath = path.normalize(path.join(root, rel));
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        return new Response("forbidden", { status: 403 }); // refuse path escape
      }
      const file = Bun.file(filePath);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      // Inject the reload client into served HTML (preview-only; the published bytes are untouched).
      if (filePath.endsWith(".html")) {
        const html = await file.text();
        const withReload = /<\/body>/i.test(html)
          ? html.replace(/<\/body>/i, RELOAD_SNIPPET + "</body>")
          : html + RELOAD_SNIPPET;
        return new Response(withReload, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response(file);
    },
  });

  // Rebuild → reload. Debounced so a burst of saves coalesces into one rebuild. We build into
  // a staging dir and swap only on success, so a mid-edit build error (e.g. a viz saved with
  // an undeclared posture) keeps the LAST GOOD build served instead of blanking the preview.
  // Both dirs live in os.tmpdir() (outside `container`), so the watcher never sees its own
  // output — no rebuild loop — and the rename is same-filesystem.
  const staging = root + ".next";
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(container, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      // ponytail: buildPublishableTree calls die()→process.exit on a refused build (e.g. a viz
      // saved mid-edit with no viz:posture). In a long-lived preview that would kill the server,
      // so trap exit→throw for the rebuild window; the reason is still printed (die console.errors
      // first) and we keep the last good build up. Restore exit in finally.
      const realExit = process.exit;
      (process as unknown as { exit: (c?: number) => never }).exit = (c?: number) => {
        throw new Error(`build refused (would exit ${c ?? 2})`);
      };
      try {
        rmSync(staging, { recursive: true, force: true });
        await buildPublishableTree(container, staging, shareHost, opts);
        rmSync(root, { recursive: true, force: true });
        renameSync(staging, root);
        for (const c of clients) { try { c.enqueue("data: reload\n\n"); } catch { clients.delete(c); } }
        console.log("↻ rebuilt — reloaded");
      } catch (e) {
        rmSync(staging, { recursive: true, force: true }); // drop the partial build
        console.error("⚠️  preview rebuild failed (kept the last good build up):", e instanceof Error ? e.message : e);
      } finally {
        process.exit = realExit;
      }
    }, 200);
  });

  return server;
}

// Open a URL in the OS default browser (best-effort; never throws into the caller).
function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* opening is a nicety; the printed URL is the source of truth */
  }
}

// ---- Dispatch ----
// Guarded so other tools (manage.ts) can `import` the helpers above without
// triggering the CLI. Runs only when build.ts is the invoked entrypoint.
if (import.meta.main) {
const cmd = positional[0];

if (cmd === "rotate") {
  const target = positional[1];
  if (!target) die("usage: bun build.ts rotate <vizDir>   |   bun build.ts rotate <container> --lobby", 2);
  const abs = path.resolve(target);
  const base = idFor(abs);
  if (!base) die(`ERROR: ${lobbyFlag ? "container" : "viz"} must live under your home directory to be keyed.`);
  if (lobbyFlag) {
    // Rotate the CONTAINER's lobby key (keyed <container>#lobby). Warn — don't refuse —
    // if the container has no _private-lobby marker: the new key is minted but unused
    // until the marker exists, so this is almost always a wrong target.
    if (!existsSync(path.join(abs, LOBBY_MARKER))) {
      console.log(`⚠️  ${abs} has no ${LOBBY_MARKER} marker — it isn't lobby-sealed, so this key won't be used until you add one.`);
    }
    const key = await rotate(base + "#lobby");
    console.log(`Rotated the LOBBY key for '${base}' to version ${key.version}.`);
    console.log(`The previous lobby link AND passphrase are now DEAD. Re-publish + redeploy to mint the new one, then redistribute it.`);
  } else {
    const key = await rotate(base);
    console.log(`Rotated '${base}' to version ${key.version}.`);
    console.log(`The previous share link (and its shim) is now DEAD. Re-publish to mint the new one.`);
  }
  process.exit(0);
}

if (cmd === "preview") {
  // `preview <container>` — build the publishable tree to a THROWAWAY temp dir and serve
  // it locally, so you can see EXACTLY what would publish, right now, on your machine.
  // Side-effect-free: never pushes mirrors into other containers, never deploys.
  const container = path.resolve(positional[1] ?? "");
  if (!positional[1] || !existsSync(container)) {
    die("usage: bun build.ts preview <container> [--port <n>] [--open]", 2);
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    die(`ERROR: --port must be an integer 0–65535 (got "${port}"). Omit it to let the OS pick a free port.`, 2);
  }
  const previewRoot = path.join(os.tmpdir(), "viz-preview", (idFor(container) ?? "site").replace(/[\\/]/g, "_"));
  rmSync(previewRoot, { recursive: true, force: true });
  // The preview's own origin isn't known until the server is up, so private vizzes seal
  // with the placeholder host — their StatiCrypt gate still renders (preview shows the lock).
  const summary = await buildPublishableTree(container, previewRoot, baseUrl ?? PLACEHOLDER_HOST, { noIndex, indexTitle, indexDescription });
  if (summary.empty) {
    console.log("Nothing to preview — every viz in scope is local (or none were found).");
    process.exit(0);
  }
  const server = servePreview(container, previewRoot, baseUrl ?? PLACEHOLDER_HOST, { noIndex, indexTitle, indexDescription }, port);
  const url = `http://127.0.0.1:${server.port}/`;
  console.log(`\n👀 Preview — this is exactly what would publish, served locally (live-reloading):\n\n    ${url}\n`);
  console.log(`Built from: ${container}`);
  console.log(`Temp tree:  ${previewRoot}`);
  console.log(`(throwaway build — nothing committed, no mirrors pushed, NOT deployed)`);
  console.log(`Edits to the container rebuild the publishable tree and reload open tabs.`);
  if (open) {
    openInBrowser(url);
    console.log(`\nOpened in your default browser. Ctrl-C to stop the server.`);
  } else {
    console.log(`\nOpen the URL above (or re-run with --open). Ctrl-C to stop the server.`);
  }
  // Bun.serve keeps the process alive — intentionally no exit, no fall-through.
} else if (cmd === "export") {
  // `export <vizDir>` — build ONE viz (a dev/test primitive); no lobby index, no mirrors.
  const vizDir = path.resolve(positional[1] ?? "");
  if (!positional[1] || !existsSync(path.join(vizDir, "index.html"))) {
    die("usage: bun build.ts export <vizDir>   (vizDir must contain index.html)", 2);
  }
  const posture = readPosture(vizDir);
  if (!posture) {
    die(`ERROR: no viz:posture declared for ${path.basename(vizDir)} — add <meta name="viz:posture" content="public"> (or "private"/"local").`, 2);
  }
  if (posture === "local") {
    console.log(`Skipping ${path.basename(vizDir)} — viz:posture=local, never published.`);
    process.exit(0);
  }
  const outRoot = path.resolve(out ?? path.join(process.cwd(), ".viz-dist"));
  mkdirSync(outRoot, { recursive: true });
  const shareHost = baseUrl ?? PLACEHOLDER_HOST;
  const r = await publishOne(vizDir, outRoot, posture === "private", shareHost);
  console.log(`• ${r.slug} — ${posture === "private" ? "private (sealed)" : "public"}`);
  for (const w of r.warnings) console.log(`    ⚠️  ${w}`);
  if (r.link) console.log(`    🔗 ${r.link}`);
  console.log(`\nBuilt to: ${outRoot}`);
  console.log(`\nNOT DEPLOYED. This only built one local artifact.`);
} else {
  // `<container>` — orchestrate the whole container: build the publishable tree, then
  // push mirrors (the only OUTBOUND write) and print the deploy reminder.
  const container = path.resolve(cmd ?? "");
  if (!cmd || !existsSync(container)) {
    die(
      "usage: bun build.ts <container> [--out <dir>] [--base-url <url>] [--no-index] [--index-title <t>] [--index-description <t>]\n" +
        "   or: bun build.ts preview <container> [--port <n>] [--open]\n" +
        "   or: bun build.ts export <vizDir>\n" +
        "   or: bun build.ts rotate <vizDir>   (or: rotate <container> --lobby)",
      2,
    );
  }
  const outRoot = path.resolve(out ?? path.join(process.cwd(), ".viz-dist"));
  const shareHost = baseUrl ?? PLACEHOLDER_HOST;

  // Validate mirrors.json NOW — fail-closed (naming offenders) BEFORE any artifact is
  // written, exactly like the undeclared-posture refusal inside buildPublishableTree.
  const children = vizzesIn(container);
  if (children.length === 0) die(`ERROR: no vizzes (child dirs with index.html) in ${container}`);
  const nativeSlugs = new Set(children.filter((d) => !existsSync(path.join(d, MIRROR_SIDECAR))).map((d) => path.basename(d)));
  const mirrors = readMirrors(container, nativeSlugs);

  const summary = await buildPublishableTree(container, outRoot, shareHost, { noIndex, indexTitle, indexDescription });
  if (summary.empty && mirrors.length === 0) {
    console.log("Nothing to publish — every viz in scope is local (or none were found).");
    process.exit(0);
  }

  if (mirrors.length) await pushMirrors(container, mirrors, shareHost);

  console.log(`\nBuilt to: ${outRoot}`);
  if (summary.anyPrivate) {
    if (baseUrl) {
      console.log(`Share links use base ${shareHost} — the 🔗 above unfurls a preview card and auto-decrypts; share it with the people you want to have access.`);
    } else {
      console.log(
        `NOTE: no --base-url, so private vizzes fell back to a raw #staticrypt_pwd magic link (no\n` +
          `preview-card shim — that needs an absolute host). Re-run with --base-url <url> for shareable shim links.`,
      );
    }
  }
  console.log(
    `\nNOT DEPLOYED. This only built local artifacts. Review them, then deploy as a separate,\n` +
      `explicit step (force-push the sealed set to the Pages branch) once you've confirmed.`,
  );
}
} // end import.meta.main

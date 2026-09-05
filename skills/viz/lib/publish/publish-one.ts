// lib/publish/publish-one.ts — Publishing ONE viz: build it, then seal and link it if it is private.
//
// Extracted from build.ts, which was 1993 lines.

// ---- Per-viz publish: build, then (private) seal + link. Returns a report line. ----
// opts (ADR 0006 mirrors): `overrides` rewrites the artifact's head frame BEFORE
// sealing; `sidecar`, when set, is written as a .mirror.json beside the artifact so
// the destination becomes self-describing. Plain (home-container) publishes pass
// neither and behave exactly as before.
import { MIRROR_SIDECAR } from "./constants.ts";
import { PLACEHOLDER_HOST } from "./constants.ts";
import { Sidecar } from "./mirrors.ts";
import { ensureOgImage, ogTagsFor, shimDoc, withOgTags } from "./og.ts";
import { magicLink, seal, staticrypt } from "./seal.ts";
import { HOME, idFor } from "../../discovery.ts";
import { buildSelfContained, inlineKitCss, type HeadOverrides } from "../../inline.ts";
import { KeyEntry, getOrCreate, rotate } from "../../keystore.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function publishOne(
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
    // The scaffolded hero (bootstrap.ts --hero) links /_kit/viz-kit.css AND
    // /_kit/viz-og.css — that "future hero pulls /_kit" case arrived. /_kit/ is a
    // dev-server route with no equivalent on a static host, so a verbatim copy shipped
    // a hero whose stylesheets 404 and which rendered unstyled. It stayed invisible
    // because almost every hero hand-rolled its card CSS, i.e. the behaviour SKILL.md
    // tells you NOT to use was the only thing masking this. Inline the kit instead.
    // (The OG *image* was never affected — it's a PNG shot locally, where /_kit resolves.)
    const heroSrc = path.join(vizDir, "hero.html");
    if (existsSync(heroSrc)) {
      await Bun.write(path.join(dest, "hero.html"), inlineKitCss(readFileSync(heroSrc, "utf8")));
    }
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

  // Runtime asset manifest — copy every `<meta name="viz:asset" content="...">` path
  // (file or dir, viz-relative) verbatim into dest, so assets the self-contained builder
  // can't see (JS-injected <img src>, lazily-fetched data, fonts) survive publish. Trust
  // model: we ship what the viz DECLARES; we don't verify each is referenced.
  // NOTE: beside a SEALED viz these land at a guessable, UNENCRYPTED path — StatiCrypt
  // seals the HTML, not runtime-fetched assets. Declare only non-secret sidecars.
  {
    const srcHtml = readFileSync(path.join(vizDir, "index.html"), "utf8");
    for (const m of srcHtml.matchAll(/<meta\s+name=["']viz:asset["']\s+content=["']([^"']+)["']\s*\/?>/gi)) {
      const rel = m[1].trim().replace(/^\/+/, "");
      if (!rel || rel.includes("..")) { warnings.push(`viz:asset "${m[1]}" ignored (must be a viz-relative path)`); continue; }
      const from = path.join(vizDir, rel);
      if (existsSync(from)) cpSync(from, path.join(dest, rel), { recursive: true });
      else warnings.push(`viz:asset "${rel}" declared but not found in ${slug} — skipped`);
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
export function vizzesIn(container: string): string[] {
  return readdirSync(container, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => path.join(container, d.name))
    .filter((d) => existsSync(path.join(d, "index.html")))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

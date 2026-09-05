// lib/create/templates.ts — The scaffolded starting pages — blank starter, deck, poster, hero, exchange.
//
// Extracted from bootstrap.ts.

import { readFileSync } from "node:fs";
import path from "node:path";

// The *-template.html files live at the skill root, not beside this module — this file
// moved during the decomposition and import.meta.dir moved with it.
const SKILL_DIR = path.resolve(import.meta.dir, "../..");

export function starterHtml(slug: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${slug}</title>
<!-- Publish posture — the SOLE source of truth for build.ts. Default "local" = stays
     on this machine, never published. Change to "public" (open web) or "private"
     (magic-link sealed) ONLY when you intend to share this viz. -->
<meta name="viz:posture" content="local">
<meta name="viz:listed" content="unlisted">
<meta name="viz:title" content="${slug}">
<meta name="viz:description" content="">
<!-- Spoilers — opt-in. Uncomment to blur this viz's hero image AND blurb on the public
     index until a viewer clicks the card to reveal (the title stays visible). Lets you write
     an honest, spoiler-full hero/description without spoiling anyone browsing the lobby.
     (Does NOT affect the OG unfurl — a shared link still previews the full hero.) -->
<!-- <meta name="viz:spoiler" content="true"> -->
<!-- Safe defaults on BOTH axes: local = never published; unlisted = off the index even once
     published (still reachable by direct URL). When you publish, set posture to public/private,
     and set listed to "listed" to advertise it on the public index. -->
<link rel="stylesheet" href="/_kit/viz-kit.css">
</head>
<body>
  <!-- Meaning lives in SPACE, not in sentences: point at any mark and say what its
       position, size or colour MEANS. "A box with words in it" is a document.
       The full five-point bar was printed when this file was scaffolded, and lives in
       SKILL.md § Ambition — re-read it there rather than trusting memory of it. -->
  <div class="viz-header">
    <h1>${slug}</h1>
    <div class="sub">Scaffolded by /viz — replace this with your visualization.</div>
  </div>

  <script type="module">
    // The kit's helpers. Delete what you don't use — but SKIM THIS LIST FIRST: if a
    // name here sounds like what you're about to hand-roll, it is, and the kit
    // version already handles the edge cases yours won't.
    import {
      arrowMarkers, connect, center, side, labelBox, vizAudit, // SVG diagrams
      stepper, twoAxis, figureLifecycle,                       // interaction
      $, $$, esc, saveHash, loadHash,                          // utilities
    } from "/_kit/viz.js";
    // Full reference: /_kit/README.md
  </script>
</body>
</html>
`;
}

// Self-contained arrow-key slide deck starter (--deck): scale-to-fit 16:9 canvas,
// keyboard nav, reversible per-slide fragments, auto progress bar. Zero external
// assets (fonts via CDN). Lives as an editable HTML file alongside this script.
export function deckHtml(slug: string): string {
  return readFileSync(path.join(SKILL_DIR, "deck-template.html"), "utf8").replaceAll("__SLUG__", slug);
}

// Self-hero poster starter (--poster): a fixed 1200×630 (1.91:1) .og-card that scales to fit
// the browser and IS its own OG card (viz:card=self) — verify.ts --og clips it straight to
// og.auto.png, no separate hero.html. 1200×630 is the verified cross-platform-safe unfurl size.
// `--poster-dive` swaps in the variant where the card is the TOP of a scrollable
// page rather than the whole of it. Promoted after 6 vizzes hand-copied it
// byte-identically; the layout-box trap it avoids is documented in the template.
export function posterHtml(slug: string, dive = false): string {
  // `dive` used to be a module-scope let in bootstrap.ts that this closed over. It is a
  // parameter now — a template function reaching outside itself for which template to
  // render is exactly the coupling this decomposition exists to remove.
  const tpl = dive ? "poster-dive-template.html" : "poster-template.html";
  return readFileSync(path.join(SKILL_DIR, tpl), "utf8").replaceAll("__SLUG__", slug);
}

// Hero card starter (--hero): a separate hero.html beside index.html, holding the
// 1200×630 .og-card that verify.ts --og renders and clips into og.auto.png.
//
// This exists because nothing scaffolded a hero before it: 94 hero.html files were
// authored, NONE loaded the kit, and every one was copy-pasted from a sibling —
// which is why the same ~90 lines of card CSS drifted into six variants. Reuse that
// lives in the scaffold gets used; reuse that lives in documentation doesn't.
//
// Not for a --poster viz: that page IS its own card (viz:card=self), so it needs no
// hero.html at all.
export function heroHtml(slug: string): string {
  return readFileSync(path.join(SKILL_DIR, "hero-template.html"), "utf8").replaceAll("__SLUG__", slug);
}

// Exchange starter (--exchange): index.html bolts the shared /_kit/exchange.js
// runtime to a sibling content.js, which is the only file most edits touch.
//
// The runtime lives in the kit rather than in each repo because 11 variants
// across 2 repos were sharing it by hand-copied directory — two byte-identical
// copies, no way to fix a bug in both, and a contract file whose whole job was
// to beg people not to edit their local copy. Now it rides the same pipe as
// viz-kit.css: served at /_kit/, vendored into each repo's .runtime/ by
// vendorRuntime(), inlined into the published page by build.ts.
export function exchangeHtml(slug: string): string {
  return readFileSync(path.join(SKILL_DIR, "exchange-template.html"), "utf8").replaceAll("__SLUG__", slug);
}
export function exchangeContent(slug: string): string {
  return readFileSync(path.join(SKILL_DIR, "exchange-content-template.js"), "utf8").replaceAll("__SLUG__", slug);
}

// lib/create/templates.ts — The pages built into the code: the blank starter and the --hero card.
//
// Every other starting point is a TEMPLATE viz (lib/library/templates.ts), not code.
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

// Hero card starter (--hero): a separate hero.html beside index.html, holding the
// 1200×630 .og-card that verify.ts --og renders and clips into og.auto.png.
//
// This exists because nothing scaffolded a hero before it: 94 hero.html files were
// authored, NONE loaded the kit, and every one was copy-pasted from a sibling —
// which is why the same ~90 lines of card CSS drifted into six variants. Reuse that
// lives in the starting page gets used; reuse that lives in documentation doesn't.
//
// Not for a page that IS its own card (viz:card=self, e.g. a poster), which needs no
// hero.html at all.
export function heroHtml(slug: string): string {
  return readFileSync(path.join(SKILL_DIR, "hero-template.html"), "utf8").replaceAll("__SLUG__", slug);
}

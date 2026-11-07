#!/usr/bin/env bun
// Puts the walkthrough's guide into a built web app, never its source: copies the product-tour skill
// (tour.js, theme.css, vendored driver.js) and start.js into <dist>/walk-guide/, writes the steps from
// walk.json beside them, and loads them from <dist>/index.html. Re-run after every build.
// Usage: inject.ts <dist dir> <walk.json>
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TAGS = `<link rel="stylesheet" href="./walk-guide/vendor/driver.css" /><link rel="stylesheet" href="./walk-guide/theme.css" /><script type="module" src="./walk-guide/start.js"></script>`;

type WalkStep = { id: string; say: string; target?: string | null; done?: object; reset?: object; clip?: object };

/** walk.json's steps in product-tour's shape: a clip step points the human at the recording on the page. */
export const tourSteps = (steps: WalkStep[]) =>
  steps.map((s) => ({
    id: s.id,
    say: s.clip ? `${s.say}<br><small>The recording is on the page, below the app.</small>` : s.say,
    ...(s.target ? { target: s.target } : {}),
    ...(s.done ? { done: s.done } : {}),
    ...(s.reset ? { reset: s.reset } : {}),
  }));

/** index.html with the guide loaded, once. */
export const withGuide = (html: string) =>
  html.includes("walk-guide/start.js") ? html : html.replace(/<\/head>/iu, `${TAGS}</head>`);

if (import.meta.main) {
  const [dist, walkFile] = process.argv.slice(2);
  if (!dist || !walkFile) throw new Error("usage: inject.ts <dist dir> <walk.json>");
  const tour = path.join(import.meta.dir, "../../product-tour");
  const out = path.join(dist, "walk-guide");
  mkdirSync(out, { recursive: true });
  for (const f of ["tour.js", "theme.css", "vendor"]) cpSync(path.join(tour, f), path.join(out, f), { recursive: true });
  cpSync(path.join(import.meta.dir, "start.js"), path.join(out, "start.js"));
  const walk = JSON.parse(readFileSync(walkFile, "utf8"));
  writeFileSync(path.join(out, "steps.json"), JSON.stringify(tourSteps(walk.steps), null, 1));
  const index = path.join(dist, "index.html");
  const html = readFileSync(index, "utf8");
  if (!/<\/head>/iu.test(html)) throw new Error(`${index} has no </head> to load the guide from`);
  writeFileSync(index, withGuide(html));
  console.log(`guide injected into ${dist} (${walk.steps.length} steps)`);
}

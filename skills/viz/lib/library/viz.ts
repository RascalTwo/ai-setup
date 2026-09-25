// lib/library/viz.ts — What a viz IS: resolving a directory to one, and refusing what isn't.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- viz resolution ----
import { die } from "../../cli.ts";
import { CENTRAL, idFor } from "../../discovery.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
export type Viz = { dir: string; slug: string; container: string; id: string };

// A container is either the resolved central library — whatever resolveVizRoot picked,
// which today defaults to ~/.agents/state/viz and so has no "viz-pages" in its name at
// all — or a dir named "viz-pages" / ".viz-pages" (repo-local, or an older central path).
// Matching CENTRAL by path rather than by name is what keeps this honest: the guard used
// to test the basename only, so every rename of the central default silently made Save
// reject real vizzes, first under ~/.viz-pages and now under ~/.agents/state/viz. It also
// means a $VIZ_PAGES_DIR pointed anywhere at all works, instead of only at a lucky name.
export function isContainerName(container: string): boolean {
  if (path.resolve(container) === path.resolve(CENTRAL)) return true;
  const b = path.basename(container);
  return b === "viz-pages" || b === ".viz-pages";
}

export function resolveViz(input: string | undefined): Viz {
  if (!input) die("ERROR: missing <viz-folder>.", 2);
  const dir = path.resolve(input);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) die(`ERROR: ${dir} is not a directory.`, 2);
  if (!existsSync(path.join(dir, "index.html"))) die(`ERROR: ${dir} has no index.html — not a viz.`, 2);
  const container = path.dirname(dir);
  if (!isContainerName(container)) die(`ERROR: ${dir} is not directly inside a viz-pages container.`, 2);
  const sidecar = path.join(dir, ".mirror.json");
  if (existsSync(sidecar)) {
    let origin = "unknown";
    try {
      origin = JSON.parse(readFileSync(sidecar, "utf8")).origin ?? origin;
    } catch {
      /* keep "unknown" */
    }
    die(`ERROR: ${path.basename(dir)} is a mirrored-in copy (origin: ${origin}). It's terminal — edit the origin viz, not this sink.`, 2);
  }
  const slug = path.basename(dir);
  return { dir, slug, container, id: idFor(dir) ?? slug };
}

// Native vizzes of a container = child dirs with index.html and no .mirror.json
// (same rule build.ts uses to build nativeSlugs).
export function nativeSlugsOf(container: string): Set<string> {
  if (!existsSync(container)) return new Set();
  return new Set(
    readdirSync(container, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          !d.name.startsWith(".") &&
          existsSync(path.join(container, d.name, "index.html")) &&
          !existsSync(path.join(container, d.name, ".mirror.json")),
      )
      .map((d) => d.name),
  );
}

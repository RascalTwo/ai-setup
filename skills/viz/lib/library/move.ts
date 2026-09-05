// lib/library/move.ts — Renaming or relocating a viz, and dragging its mirror declarations along.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- move ----
// Relocate/rename a viz (rename = same-parent move). Migrates any mirror
// declarations across containers, re-resolving each container-relative path so it
// still points at the same sink.
import { die } from "../../cli.ts";
import { idFor } from "../../discovery.ts";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { EdgeKind, loadMirrorsRaw, tidyRaw, writeMirrors } from "./mirrors-file.ts";
import { Viz, isContainerName } from "./viz.ts";

export function cmdMove(viz: Viz, destInput: string): string[] {
  const destDir = path.resolve(destInput);
  const destContainer = path.dirname(destDir);
  if (!isContainerName(destContainer)) die(`ERROR: dest ${destDir} is not directly inside a viz-pages container.`, 2);
  if (!existsSync(destContainer)) die(`ERROR: dest container ${destContainer} does not exist — move won't create it.`, 2);
  if (existsSync(destDir)) die(`ERROR: dest ${destDir} already exists — refusing to clobber.`, 2);

  renameSync(viz.dir, destDir);
  const touched = [viz.dir, destDir];
  migrateMirrors(viz.container, destContainer, viz.slug, path.basename(destDir), touched);

  console.log(`Moved ${viz.id} → ${idFor(destDir) ?? path.basename(destDir)}`);
  console.log(`  (the old URL now 404s — id = URL, ADR 0001.)`);
  return touched;
}

// Pull a moved viz's mirror AND vendor entries out of the source container's
// mirrors.json and into the destination's, re-resolving each target path. Same-container
// rename just rewrites the slug in place. No-op if the source has no mirrors.json.
//
// Vendor edges are migrated for the same reason mirror edges always were: without this,
// moving or renaming an origin viz silently orphans every copy of it (ADR 0010) — the
// copies keep pointing at a path that no longer exists and nothing notices.
export function migrateMirrors(srcContainer: string, dstContainer: string, oldSlug: string, newSlug: string, touched: string[]): void {
  const srcFile = path.join(srcContainer, "mirrors.json");
  if (!existsSync(srcFile)) return;
  const src = loadMirrorsRaw(srcFile);
  const sameContainer = srcContainer === dstContainer;
  const dst = sameContainer ? src : loadMirrorsRaw(path.join(dstContainer, "mirrors.json"));
  let any = false;

  for (const kind of ["mirrors", "vendors"] as EdgeKind[]) {
    const srcTargets = src[kind];
    if (!Array.isArray(srcTargets)) continue;

    const moved: { absSink: string; entry: any }[] = [];
    for (const t of srcTargets) {
      if (!Array.isArray(t.vizzes)) continue;
      const keep: any[] = [];
      for (const v of t.vizzes) {
        if (v && v.slug === oldSlug) moved.push({ absSink: path.resolve(srcContainer, t.path), entry: { ...v, slug: newSlug } });
        else keep.push(v);
      }
      t.vizzes = keep;
    }
    if (moved.length === 0) continue;
    any = true;

    const dstTargets = (dst[kind] ??= []);
    for (const { absSink, entry } of moved) {
      let tgt = dstTargets.find((t) => path.resolve(dstContainer, t.path) === absSink);
      if (!tgt) {
        tgt = { path: path.relative(dstContainer, absSink), vizzes: [] };
        dstTargets.push(tgt);
      }
      tgt.vizzes.push(entry);
    }
  }
  if (!any) return;

  if (sameContainer) {
    writeMirrors(srcFile, tidyRaw(src), dstContainer);
    touched.push(srcFile);
  } else {
    writeMirrors(srcFile, tidyRaw(src), srcContainer);
    const dstFile = path.join(dstContainer, "mirrors.json");
    writeMirrors(dstFile, tidyRaw(dst), dstContainer);
    touched.push(srcFile, dstFile);
  }
}

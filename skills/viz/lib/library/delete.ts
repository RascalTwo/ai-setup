// lib/library/delete.ts — Removing a viz.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- delete ----
// Remove a viz folder and drop any mirror declarations that pointed at it, so the
// container's mirrors.json keeps no dangling slug. resolveViz already refuses a
// mirrored-in sink (.mirror.json), so this only ever deletes an origin viz.
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { EdgeKind, loadMirrorsRaw, tidyRaw, writeMirrors } from "./mirrors-file.ts";
import { Viz, resolveViz } from "./viz.ts";

export function cmdDelete(viz: Viz): string[] {
  const touched = [viz.dir];
  const file = path.join(viz.container, "mirrors.json");
  if (existsSync(file)) {
    const raw = loadMirrorsRaw(file);
    let had = false;
    for (const kind of ["mirrors", "vendors"] as EdgeKind[]) {
      const targets = raw[kind];
      if (!Array.isArray(targets)) continue;
      if (!targets.some((t) => (t.vizzes ?? []).some((v) => v.slug === viz.slug))) continue;
      had = true;
      for (const t of targets) t.vizzes = (t.vizzes ?? []).filter((v) => v.slug !== viz.slug);
    }
    if (had) tidyRaw(raw);
    rmSync(viz.dir, { recursive: true, force: true });
    if (had) {
      writeMirrors(file, raw, viz.container); // validates after the dir is gone
      touched.push(file);
    }
  } else {
    rmSync(viz.dir, { recursive: true, force: true });
  }
  console.log(`Deleted ${viz.id} (${viz.dir})`);
  return touched;
}

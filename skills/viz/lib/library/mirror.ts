// lib/library/mirror.ts — Declaring where a viz is projected to.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- mirror ----
import { die } from "../../cli.ts";
import path from "node:path";
import { loadMirrorsRaw, writeMirrors } from "./mirrors-file.ts";
import { Viz } from "./viz.ts";

export function cmdMirror(sub: string, viz: Viz, flags: Record<string, string | boolean>): string[] | null {
  const file = path.join(viz.container, "mirrors.json");
  const raw = loadMirrorsRaw(file);

  if (sub === "ls") {
    const rows = raw.mirrors.flatMap((m) => (m.vizzes || []).filter((v) => v.slug === viz.slug).map((v) => ({ to: m.path, ...v })));
    if (rows.length === 0) console.log(`${viz.slug}: no mirror declarations.`);
    for (const r of rows) {
      console.log(`→ ${r.to}  [${r.access}]${r.listed === false ? "  unlisted" : ""}`);
      if (r.overrides) console.log(`    overrides: ${JSON.stringify(r.overrides)}`);
    }
    return null; // read-only — nothing to commit
  }

  const to = flags.to;
  if (typeof to !== "string") die(`ERROR: mirror ${sub} needs --to <sink-container-path>.`, 2);
  const absSink = path.resolve(to);
  const relPath = path.relative(viz.container, absSink);
  let tgt = raw.mirrors.find((m) => path.resolve(viz.container, m.path) === absSink);

  if (sub === "add") {
    const access = flags.access;
    if (access !== "public" && access !== "private") die(`ERROR: mirror add needs --access public|private (never inherited — it's the trust boundary).`, 2);
    if (tgt && tgt.vizzes.some((v) => v.slug === viz.slug)) die(`ERROR: ${viz.slug} is already mirrored → ${relPath}. Use 'mirror update' to change it.`, 2);
    if (!tgt) {
      tgt = { path: relPath, vizzes: [] };
      raw.mirrors.push(tgt);
    }
    tgt.vizzes.push({ slug: viz.slug, access }); // everything else inherits the viz's meta
    console.log(`Mirrored ${viz.slug} → ${relPath} [${access}]`);
  } else if (sub === "update") {
    const entry = tgt?.vizzes.find((v) => v.slug === viz.slug);
    if (!entry) die(`ERROR: ${viz.slug} is not mirrored → ${relPath}. Use 'mirror add' first.`, 2);
    let changed = false;
    if (flags.access !== undefined) {
      if (flags.access !== "public" && flags.access !== "private") die(`ERROR: --access must be public|private.`, 2);
      entry.access = flags.access;
      changed = true;
    }
    if (flags.listed !== undefined) {
      entry.listed = flags.listed === "listed" || flags.listed === "true";
      changed = true;
    }
    const ov = entry.overrides ?? {};
    if (typeof flags.title === "string") (ov.title = flags.title), (changed = true);
    if (typeof flags.description === "string") (ov.description = flags.description), (changed = true);
    if (typeof flags.tags === "string") (ov.tags = flags.tags.split(",").map((s) => s.trim()).filter(Boolean)), (changed = true);
    if (Object.keys(ov).length) entry.overrides = ov;
    if (!changed) die(`ERROR: mirror update needs a field to change (--access / --listed / --title / --description / --tags).`, 2);
    console.log(`Updated mirror ${viz.slug} → ${relPath}`);
  } else if (sub === "rm") {
    const before = tgt?.vizzes.length ?? 0;
    if (tgt) tgt.vizzes = tgt.vizzes.filter((v) => v.slug !== viz.slug);
    if (!tgt || tgt.vizzes.length === before) die(`ERROR: ${viz.slug} is not mirrored → ${relPath}.`, 2);
    raw.mirrors = raw.mirrors.filter((m) => m.vizzes.length);
    console.log(`Removed mirror ${viz.slug} → ${relPath}`);
  } else {
    die(`ERROR: unknown mirror subcommand "${sub}" — use ls|add|update|rm.`, 2);
  }

  writeMirrors(file, raw, viz.container);
  return [file];
}

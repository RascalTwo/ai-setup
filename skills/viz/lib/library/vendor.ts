// lib/library/vendor.ts — Materialized mirrors: full standalone copies of a viz in another container.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- vendor (materialized mirror) ----
// Copy the ENTIRE viz dir into another container as a self-contained, runnable copy —
// unlike a publish mirror (build-time, single-file, dist-only), a vendored copy is a
// real native viz in the sink: it serves live, publishes on its own, and RUNS from the
// sink repo alone even with no access to the origin. A .vendored.json marker records the
// origin so the copy can be re-synced and shown as a copy (not mistaken for an original).
import { grabMeta } from "../publish/meta.ts";
import { die } from "../../cli.ts";
import { HOME, idFor } from "../../discovery.ts";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gitRoot } from "./git.ts";
import { loadMirrorsRaw, tidyRaw, writeMirrors } from "./mirrors-file.ts";
import { installVendorGuard, walkFiles } from "./vendor-guard.ts";
import { Viz, isContainerName, resolveViz } from "./viz.ts";

export const VENDOR_MARKER = ".vendored.json";
export function stripLocal(dir: string): void {
  // Don't carry review comments (local-only), stale copy/sink markers, or machine-local
  // working dirs into the copy. The dotdirs matter: cpSync copies them and walkFiles
  // skips dotfiles, so a stray .runtime/ would ride into a sink INVISIBLE to vendor-check.
  for (const junk of ["comments.json", VENDOR_MARKER, ".mirror.json", ".DS_Store", ".runtime", ".verify"])
    rmSync(path.join(dir, junk), { recursive: true, force: true });
}

// The receipt (ADR 0010). `origin` is the $HOME-relative id of the ORIGIN VIZ — that is
// the ONLY locator stored, and `path.join(HOME, origin)` reconstructs the absolute path
// on any machine. The old absolute `originDir` was redundant with it and leaked the
// author's home directory into files committed in other people's repos.
export function writeReceipt(dir: string, originId: string, access: string): void {
  writeFileSync(path.join(dir, VENDOR_MARKER),
    JSON.stringify({ origin: originId, access, vendoredAt: new Date().toISOString() }, null, 2) + "\n");
}
export function receiptOriginDir(copyDir: string): string {
  try {
    const origin = JSON.parse(readFileSync(path.join(copyDir, VENDOR_MARKER), "utf8")).origin ?? "";
    return origin ? path.join(HOME, origin) : "";
  } catch {
    return "";
  }
}

// `vendor` both DECLARES the edge at the origin and materializes the copy. Declaring is
// what makes the copy refreshable (build.ts --push-vendors) and rename-safe; the copy
// alone would drift exactly as it did before ADR 0010.
export function cmdVendor(viz: Viz, sinkInput: string, flags: Record<string, string | boolean>): string[] {
  const sinkContainer = path.resolve(sinkInput);
  if (!isContainerName(sinkContainer)) die(`ERROR: --to ${sinkContainer} is not a viz-pages container.`, 2);
  if (!existsSync(sinkContainer)) die(`ERROR: sink container ${sinkContainer} does not exist.`, 2);
  const destDir = path.join(sinkContainer, viz.slug);
  if (path.resolve(destDir) === viz.dir) die(`ERROR: --to is the origin's own container — nothing to vendor.`, 2);
  if (existsSync(destDir) && !existsSync(path.join(destDir, VENDOR_MARKER)))
    die(`ERROR: ${destDir} already exists and is NOT a vendored copy — refusing to clobber a real viz. (Use 'move' to relocate, or vendor a fresh slug.)`, 2);

  // access is an ACKNOWLEDGEMENT, not a re-framing: the copy is byte-identical, so the
  // only honest value is the origin's own posture. Requiring you to state it means a
  // posture that changed since you last looked fails loudly instead of shipping quietly.
  const posture = grabMeta(readFileSync(path.join(viz.dir, "index.html"), "utf8"), "viz:posture");
  const access = flags.access;
  if (access !== "public" && access !== "private")
    die(`ERROR: vendor needs --access public|private — it records the posture you're sending across a trust boundary (this viz is "${posture ?? "undeclared"}").`, 2);
  if (access !== posture)
    die(`ERROR: --access ${access} but ${viz.slug}'s viz:posture is "${posture ?? "undeclared"}". A vendored copy is byte-identical to its origin, so these must agree — change the origin's posture, or vendor it as "${posture}".`, 2);

  const file = path.join(viz.container, "mirrors.json");
  const raw = loadMirrorsRaw(file);
  const vendors = (raw.vendors ??= []);
  let tgt = vendors.find((t) => path.resolve(viz.container, t.path) === sinkContainer);
  if (!tgt) {
    tgt = { path: path.relative(viz.container, sinkContainer), vizzes: [] };
    vendors.push(tgt);
  }
  const existing = tgt.vizzes.find((v) => v.slug === viz.slug);
  if (existing) existing.access = access;
  else tgt.vizzes.push({ slug: viz.slug, access });

  rmSync(destDir, { recursive: true, force: true });
  cpSync(viz.dir, destDir, { recursive: true });
  stripLocal(destDir);
  writeReceipt(destDir, viz.id, access);
  writeMirrors(file, tidyRaw(raw), viz.container);
  console.log(`Vendored ${viz.id} → ${idFor(destDir) ?? path.basename(destDir)} [${access}] — full copy, runnable standalone.`);
  console.log(`  declared in ${path.relative(viz.container, file)} — refresh copies with: build.ts ${viz.container} --push-vendors`);
  installVendorGuard(gitRoot(destDir));
  return [destDir, file];
}

// Undeclare an edge. The copy is NOT deleted here — the next --push-vendors prunes it,
// origin-scoped, so removal happens through the same path that created it.
export function cmdVendorRm(viz: Viz, sinkInput: string): string[] {
  const sinkContainer = path.resolve(sinkInput);
  const file = path.join(viz.container, "mirrors.json");
  const raw = loadMirrorsRaw(file);
  const tgt = (raw.vendors ?? []).find((t) => path.resolve(viz.container, t.path) === sinkContainer);
  const before = tgt?.vizzes.length ?? 0;
  if (tgt) tgt.vizzes = tgt.vizzes.filter((v) => v.slug !== viz.slug);
  if (!tgt || tgt.vizzes.length === before)
    die(`ERROR: ${viz.slug} is not vendored → ${path.relative(viz.container, sinkContainer)}.`, 2);
  writeMirrors(file, tidyRaw(raw), viz.container);
  console.log(`Removed vendor declaration ${viz.slug} → ${path.relative(viz.container, sinkContainer)}`);
  console.log(`  the copy still exists — it is pruned on the next: build.ts ${viz.container} --push-vendors`);
  return [file];
}

export function cmdVendorLs(viz: Viz): null {
  const raw = loadMirrorsRaw(path.join(viz.container, "mirrors.json"));
  const rows = (raw.vendors ?? []).flatMap((t) => (t.vizzes || []).filter((v) => v.slug === viz.slug).map((v) => ({ to: t.path, ...v })));
  if (rows.length === 0) console.log(`${viz.slug}: no vendor declarations.`);
  for (const r of rows) console.log(`→ ${r.to}  [${r.access}]`);
  return null; // read-only — nothing to commit
}

export function cmdVendorSync(viz: Viz): string[] {
  const marker = path.join(viz.dir, VENDOR_MARKER);
  if (!existsSync(marker)) die(`ERROR: ${viz.slug} has no ${VENDOR_MARKER} — it isn't a vendored copy.`, 2);
  let access = "public";
  try { access = JSON.parse(readFileSync(marker, "utf8")).access ?? "public"; } catch { /* keep default */ }
  const originDir = receiptOriginDir(viz.dir);
  if (!originDir || !existsSync(path.join(originDir, "index.html")))
    die(`ERROR: origin not available at ${originDir || "<unknown>"} — can't re-sync (this may be a standalone repo). The copy still runs as-is.`, 2);
  const origin = resolveViz(originDir);
  rmSync(viz.dir, { recursive: true, force: true });
  cpSync(origin.dir, viz.dir, { recursive: true });
  stripLocal(viz.dir);
  writeReceipt(viz.dir, origin.id, access);
  console.log(`Re-synced ${viz.slug} ← ${origin.id}.`);
  return [viz.dir];
}

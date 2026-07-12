#!/usr/bin/env bun
// manage.ts — deterministic author-side mutation of EXISTING vizzes (ADR 0008).
//
// The third entrypoint, parallel to bootstrap.ts (create) and build.ts
// (build). Three subcommands, all naming a viz by its FOLDER PATH:
//
//   bun manage.ts move   <viz-folder> <dest-folder>
//   bun manage.ts update <viz-folder> [--posture …] [--listed …] [--kind …]
//   bun manage.ts mirror <ls|add|update|rm> <viz-folder> …
//
// All are fail-closed, REFUSE a mirrored-in dir (.mirror.json present — edit the
// origin), and auto-commit with SURGICAL staging (only the paths touched, never
// `git add .`; fail-soft if not a repo; --no-commit to opt out). It never builds
// or deploys — building stays build.ts; deploy is a separate human-gated step.

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, rmSync, cpSync } from "node:fs";
import path from "node:path";
import { idFor } from "./discovery.ts";
import { grabMeta, validateMirrors } from "./build.ts";

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

// ---- meta upsert/remove (reference impl: viz-self-portrait/api.ts) ----
// Targets the real <meta name content> tag; replaces content if present, else
// inserts just after <head>.
function upsertMeta(html: string, name: string, content: string): string {
  // (content=)(quote)(.*?)\2 — match up to the SAME delimiter via backreference.
  // A plain [^"'] class stops at the first apostrophe inside a double-quoted value
  // (e.g. "Claude Code's ..."), which would truncate-and-corrupt on replace.
  const re = new RegExp(`(<meta\\s+name=["']${name}["']\\s+content=)(["'])(.*?)\\2`, "i");
  // Function replacers throughout: free-text content (title/description/tags) may
  // contain `$`, which a string replacement would mangle as a capture reference.
  if (re.test(html)) return html.replace(re, (_m, p1, q) => `${p1}${q}${content}${q}`);
  const tag = `  <meta name="${name}" content="${content}">\n`;
  return /<head[^>]*>/i.test(html) ? html.replace(/(<head[^>]*>\s*)/i, (m) => `${m}${tag}`) : tag + html;
}

// Meta content lives HTML-escaped (same convention as inline.ts mirror overrides).
function escAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ---- viz resolution ----
type Viz = { dir: string; slug: string; container: string; id: string };

// A container dir is named "viz-pages" (repo-local / legacy central) OR ".viz-pages"
// (the neutral central default from resolveVizRoot on fresh installs/clones). The guard
// used to hardcode only "viz-pages", so Save silently rejected real vizzes living under
// ~/.viz-pages on any machine without the legacy ~/.claude/viz-pages dir.
function isContainerName(container: string): boolean {
  const b = path.basename(container);
  return b === "viz-pages" || b === ".viz-pages";
}

function resolveViz(input: string | undefined): Viz {
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
function nativeSlugsOf(container: string): Set<string> {
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

// ---- mirrors.json raw read/write (fail-closed on write via publish's validator) ----
type RawMirrors = { mirrors: { path: string; vizzes: any[] }[] };

function loadMirrorsRaw(file: string): RawMirrors {
  if (!existsSync(file)) return { mirrors: [] };
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return j && Array.isArray(j.mirrors) ? j : { mirrors: [] };
  } catch (e) {
    die(`ERROR: ${file} is not valid JSON: ${(e as Error).message}`, 2);
  }
}

function writeMirrors(file: string, raw: RawMirrors, container: string): void {
  const { errors } = validateMirrors(raw, container, nativeSlugsOf(container));
  if (errors.length) die(`ERROR: refusing to write invalid ${file} — NOTHING written:\n  - ${errors.join("\n  - ")}`, 2);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
}

// ---- git: surgical staging, fail-soft, per-repo (a cross-repo move spans two) ----
function gitRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function commitPaths(paths: string[], msg: string): void {
  const byRepo = new Map<string, string[]>();
  for (const p of paths) {
    const root = gitRoot(path.dirname(p));
    if (!root) continue;
    const list = byRepo.get(root) ?? [];
    list.push(p);
    byRepo.set(root, list);
  }
  if (byRepo.size === 0) {
    console.error("  ⚠️  not a git repo — change saved, not committed.");
    return;
  }
  for (const [root, ps] of byRepo) {
    try {
      // Drop gitignored paths (mirrors.json is local-only by policy) so we never
      // try to commit something git refuses to track.
      const rels = ps
        .map((p) => path.relative(root, p))
        .filter((rel) => Bun.spawnSync(["git", "-C", root, "check-ignore", "-q", "--", rel]).exitCode !== 0);
      if (rels.length === 0) continue;
      if (Bun.spawnSync(["git", "-C", root, "add", "--", ...rels]).exitCode !== 0) {
        console.error(`  ⚠️  git add failed in ${root} — change saved, not committed.`);
        continue;
      }
      const commit = Bun.spawnSync(["git", "-C", root, "commit", "-m", msg, "--", ...rels]);
      if (commit.exitCode !== 0) {
        console.error(`  ⚠️  git commit: ${commit.stderr.toString().trim() || "nothing committed"}`);
      } else {
        console.log(`  ✓ committed in ${path.basename(root)}: ${msg}`);
      }
    } catch (e) {
      console.error(`  ⚠️  git error (${(e as Error).message}) — change saved, not committed.`);
    }
  }
}

function maybeCommit(paths: string[], noCommit: boolean, msg: string): void {
  if (noCommit) {
    console.log("  (--no-commit: filesystem change kept, not committed)");
    return;
  }
  commitPaths(paths, msg);
}

// ---- move ----
// Relocate/rename a viz (rename = same-parent move). Migrates any mirror
// declarations across containers, re-resolving each container-relative path so it
// still points at the same sink.
function cmdMove(viz: Viz, destInput: string): string[] {
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

// Pull a moved viz's mirror entries out of the source container's mirrors.json and
// into the destination's, re-resolving each target path. Same-container rename just
// rewrites the slug in place. No-op if the source has no mirrors.json.
function migrateMirrors(srcContainer: string, dstContainer: string, oldSlug: string, newSlug: string, touched: string[]): void {
  const srcFile = path.join(srcContainer, "mirrors.json");
  if (!existsSync(srcFile)) return;
  const src = loadMirrorsRaw(srcFile);

  const moved: { absSink: string; entry: any }[] = [];
  for (const m of src.mirrors) {
    if (!Array.isArray(m.vizzes)) continue;
    const keep: any[] = [];
    for (const v of m.vizzes) {
      if (v && v.slug === oldSlug) moved.push({ absSink: path.resolve(srcContainer, m.path), entry: { ...v, slug: newSlug } });
      else keep.push(v);
    }
    m.vizzes = keep;
  }
  if (moved.length === 0) return;
  src.mirrors = src.mirrors.filter((m) => m.vizzes.length);

  // Where the migrated entries land: same file on a rename, the dest's file on a move.
  const dst = srcContainer === dstContainer ? src : loadMirrorsRaw(path.join(dstContainer, "mirrors.json"));
  for (const { absSink, entry } of moved) {
    let tgt = dst.mirrors.find((m) => path.resolve(dstContainer, m.path) === absSink);
    if (!tgt) {
      tgt = { path: path.relative(dstContainer, absSink), vizzes: [] };
      dst.mirrors.push(tgt);
    }
    tgt.vizzes.push(entry);
  }

  if (srcContainer === dstContainer) {
    writeMirrors(srcFile, src, dstContainer);
    touched.push(srcFile);
  } else {
    writeMirrors(srcFile, src, srcContainer);
    const dstFile = path.join(dstContainer, "mirrors.json");
    writeMirrors(dstFile, dst, dstContainer);
    touched.push(srcFile, dstFile);
  }
}

// ---- delete ----
// Remove a viz folder and drop any mirror declarations that pointed at it, so the
// container's mirrors.json keeps no dangling slug. resolveViz already refuses a
// mirrored-in sink (.mirror.json), so this only ever deletes an origin viz.
function cmdDelete(viz: Viz): string[] {
  const touched = [viz.dir];
  const file = path.join(viz.container, "mirrors.json");
  if (existsSync(file)) {
    const raw = loadMirrorsRaw(file);
    const had = raw.mirrors.some((m) => (m.vizzes ?? []).some((v) => v.slug === viz.slug));
    if (had) {
      for (const m of raw.mirrors) m.vizzes = (m.vizzes ?? []).filter((v) => v.slug !== viz.slug);
      raw.mirrors = raw.mirrors.filter((m) => m.vizzes.length);
    }
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

// ---- update ----
const AXES: Record<string, string[]> = {
  posture: ["public", "private", "local"],
  listed: ["listed", "unlisted"],
  kind: ["explanatory", "operational"],
  // Audit-bookkeeping axis (ADR 0009): always-present true|false meta, set by the
  // self-portrait's triage flow. Orthogonal to posture; no auto-stamp on the CLI side.
  triaged: ["true", "false"],
};

function cmdUpdate(viz: Viz, flags: Record<string, string | boolean>): string[] {
  const indexPath = path.join(viz.dir, "index.html");
  let html = readFileSync(indexPath, "utf8");
  const changes: string[] = [];

  for (const axis of Object.keys(AXES)) {
    const v = flags[axis];
    if (v === undefined) continue;
    if (typeof v !== "string" || !AXES[axis].includes(v)) die(`ERROR: --${axis} must be one of ${AXES[axis].join("|")} (got "${v}").`, 2);
    html = upsertMeta(html, `viz:${axis}`, v);
    changes.push(`${axis}=${v}`);
  }

  // Free-text frame metadata — the same viz:title / viz:description metas a mirror
  // can override (inline.ts), here edited on the source. Empty value clears.
  for (const field of ["title", "description"]) {
    const v = flags[field];
    if (v === undefined) continue;
    if (typeof v !== "string") die(`ERROR: --${field} needs a value.`, 2);
    html = upsertMeta(html, `viz:${field}`, escAttr(v));
    // Keep the visible <title> in sync with viz:title for the standalone artifact.
    if (field === "title" && /<title[^>]*>[\s\S]*?<\/title>/i.test(html))
      html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => `<title>${escAttr(v)}</title>`);
    changes.push(`${field} set`);
  }

  // tags: multi viz:tag — clear all, re-add the comma-split set.
  if (flags.tags !== undefined) {
    if (typeof flags.tags !== "string") die("ERROR: --tags needs a comma-separated value.", 2);
    const tags = flags.tags.split(",").map((t) => t.trim()).filter(Boolean);
    html = html.replace(/[ \t]*<meta\s+name=["']viz:tag["'][^>]*>\s*\n?/gi, "");
    if (tags.length) {
      const block = tags.map((t) => `  <meta name="viz:tag" content="${escAttr(t)}">`).join("\n") + "\n";
      html = /<head[^>]*>/i.test(html) ? html.replace(/(<head[^>]*>\s*)/i, (m) => `${m}${block}`) : block + html;
    }
    changes.push(`tags=${tags.join("·") || "(cleared)"}`);
  }

  if (changes.length === 0) die("ERROR: update needs at least one of --posture / --listed / --kind / --triaged / --title / --description / --tags.", 2);
  writeFileSync(indexPath, html);
  console.log(`Updated ${viz.slug}: ${changes.join(", ")}`);
  return [indexPath];
}

// ---- mirror ----
function cmdMirror(sub: string, viz: Viz, flags: Record<string, string | boolean>): string[] | null {
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

// ---- vendor (materialized mirror) ----
// Copy the ENTIRE viz dir into another container as a self-contained, runnable copy —
// unlike a publish mirror (build-time, single-file, dist-only), a vendored copy is a
// real native viz in the sink: it serves live, publishes on its own, and RUNS from the
// sink repo alone even with no access to the origin. A .vendored.json marker records the
// origin so the copy can be re-synced and shown as a copy (not mistaken for an original).
const VENDOR_MARKER = ".vendored.json";
function stripLocal(dir: string): void {
  // Don't carry review comments (local-only) or stale copy/sink markers into the copy.
  for (const junk of ["comments.json", VENDOR_MARKER, ".mirror.json", ".DS_Store"]) rmSync(path.join(dir, junk), { force: true });
}
function cmdVendor(viz: Viz, sinkInput: string): string[] {
  const sinkContainer = path.resolve(sinkInput);
  if (!isContainerName(sinkContainer)) die(`ERROR: --to ${sinkContainer} is not a viz-pages container.`, 2);
  if (!existsSync(sinkContainer)) die(`ERROR: sink container ${sinkContainer} does not exist.`, 2);
  const destDir = path.join(sinkContainer, viz.slug);
  if (path.resolve(destDir) === viz.dir) die(`ERROR: --to is the origin's own container — nothing to vendor.`, 2);
  if (existsSync(destDir) && !existsSync(path.join(destDir, VENDOR_MARKER)))
    die(`ERROR: ${destDir} already exists and is NOT a vendored copy — refusing to clobber a real viz. (Use 'move' to relocate, or vendor a fresh slug.)`, 2);
  rmSync(destDir, { recursive: true, force: true });
  cpSync(viz.dir, destDir, { recursive: true });
  stripLocal(destDir);
  writeFileSync(path.join(destDir, VENDOR_MARKER),
    JSON.stringify({ origin: viz.id, originDir: viz.dir, vendoredAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`Vendored ${viz.id} → ${idFor(destDir) ?? path.basename(destDir)} — full copy, runnable standalone.`);
  installVendorGuard(gitRoot(destDir));
  return [destDir];
}
function cmdVendorSync(viz: Viz): string[] {
  const marker = path.join(viz.dir, VENDOR_MARKER);
  if (!existsSync(marker)) die(`ERROR: ${viz.slug} has no ${VENDOR_MARKER} — it isn't a vendored copy.`, 2);
  let originDir = "";
  try { originDir = JSON.parse(readFileSync(marker, "utf8")).originDir ?? ""; } catch { /* fall through to the guard */ }
  if (!originDir || !existsSync(path.join(originDir, "index.html")))
    die(`ERROR: origin not available at ${originDir || "<unknown>"} — can't re-sync (this may be a standalone repo). The copy still runs as-is.`, 2);
  const origin = resolveViz(originDir);
  rmSync(viz.dir, { recursive: true, force: true });
  cpSync(origin.dir, viz.dir, { recursive: true });
  stripLocal(viz.dir);
  writeFileSync(path.join(viz.dir, VENDOR_MARKER),
    JSON.stringify({ origin: origin.id, originDir: origin.dir, vendoredAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`Re-synced ${viz.slug} ← ${origin.id}.`);
  return [viz.dir];
}

// ---- vendor drift guard ----
// Invariant: a vendored copy byte-matches its origin (minus the marker + local-only
// files). vendor-check reports drift; the pre-commit hook (installed by vendor) calls it
// with --staged so ONLY copies touched by THIS commit are gated — editing an origin never
// blocks unrelated commits in the sink repo.
function walkFiles(root: string, base = root, out = new Map<string, string>()): Map<string, string> {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "comments.json") continue; // markers, dotfiles, local-only review
    const abs = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(abs, base, out);
    else out.set(path.relative(base, abs), abs);
  }
  return out;
}
function filesEqual(a: string, b: string): boolean {
  try { const fa = readFileSync(a), fb = readFileSync(b); return fa.length === fb.length && fa.equals(fb); } catch { return false; }
}
function copyState(copyDir: string): "match" | "drift" | "no-origin" {
  let originDir = "";
  try { originDir = JSON.parse(readFileSync(path.join(copyDir, VENDOR_MARKER), "utf8")).originDir ?? ""; } catch { return "no-origin"; }
  if (!originDir || !existsSync(path.join(originDir, "index.html"))) return "no-origin";
  const c = walkFiles(copyDir), o = walkFiles(originDir);
  if (c.size !== o.size) return "drift";
  for (const [rel, ca] of c) { const oa = o.get(rel); if (!oa || !filesEqual(ca, oa)) return "drift"; }
  return "match";
}
function findVendoredCopies(root: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  if (entries.some((e) => e.name === VENDOR_MARKER)) out.push(root);
  for (const e of entries) if (e.isDirectory() && e.name !== ".git" && e.name !== "node_modules") findVendoredCopies(path.join(root, e.name), out);
  return out;
}
function stagedVendoredCopies(repoRoot: string): string[] {
  const res = Bun.spawnSync(["git", "-C", repoRoot, "diff", "--cached", "--name-only"]);
  const dirs = new Set<string>();
  for (const rel of res.stdout.toString().split("\n").filter(Boolean)) {
    let d = path.dirname(path.join(repoRoot, rel));
    while (d.length >= repoRoot.length) {
      if (existsSync(path.join(d, VENDOR_MARKER))) { dirs.add(d); break; }
      const up = path.dirname(d); if (up === d) break; d = up;
    }
  }
  return [...dirs];
}
function cmdVendorCheck(scan: string, staged: boolean): number {
  const copies = staged ? stagedVendoredCopies(gitRoot(scan) ?? scan) : findVendoredCopies(scan);
  let drift = 0;
  for (const dir of copies) {
    const state = copyState(dir);
    if (state === "drift") { drift++; console.error(`  ✗ DRIFT: ${idFor(dir) ?? dir} differs from its origin.`); }
    else if (state === "no-origin") console.error(`  ⚠️  ${idFor(dir) ?? dir}: origin unavailable — can't verify (allowed).`);
  }
  if (drift === 0) console.log(`✓ vendor-check: no drift (${copies.length} vendored ${copies.length === 1 ? "copy" : "copies"} checked).`);
  return drift;
}
// Install (or refresh) a pre-commit hook in a sink repo that runs vendor-check --staged.
// Uses absolute bun + manage.ts paths so it works even when git hooks run without PATH.
function installVendorGuard(repoRoot: string | null): void {
  if (!repoRoot) return;
  const hookDir = path.join(repoRoot, ".git", "hooks");
  if (!existsSync(hookDir)) return;
  const hookPath = path.join(hookDir, "pre-commit");
  const MARK = "viz-vendor-guard";
  const body = `#!/bin/sh
# ${MARK} (auto-installed by manage.ts vendor) — block committing a drifted vendored copy.
"${process.execPath}" "${import.meta.path}" vendor-check --staged || {
  echo "" >&2
  echo "✗ commit blocked: a vendored viz copy has drifted from its origin." >&2
  echo "  Edit the ORIGIN, then re-sync: manage.ts vendor-sync <copy-dir>  (or: git commit --no-verify)" >&2
  exit 1
}
`;
  if (existsSync(hookPath)) {
    if (readFileSync(hookPath, "utf8").includes(MARK)) { writeFileSync(hookPath, body); return; } // refresh ours
    console.error(`  ⚠️  ${hookPath} exists (not ours) — add this to it to guard vendored copies:\n      "${process.execPath}" "${import.meta.path}" vendor-check --staged || exit 1`);
    return;
  }
  writeFileSync(hookPath, body);
  Bun.spawnSync(["chmod", "+x", hookPath]);
  console.log(`  ✓ installed vendor-guard pre-commit hook in ${path.basename(repoRoot)}`);
}

// ---- arg parsing ----
const VALUE_FLAGS = new Set(["posture", "listed", "kind", "triaged", "to", "access", "title", "description", "tags"]);

function parseFlags(args: string[]): { flags: Record<string, string | boolean>; pos: string[] } {
  const flags: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq >= 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const name = a.slice(2);
      if (VALUE_FLAGS.has(name)) flags[name] = args[++i];
      else flags[name] = true; // boolean flag (e.g. --no-commit)
    }
  }
  return { flags, pos };
}

// ---- dispatch ----
const argv = process.argv.slice(2);
const verb = argv[0];
const { flags, pos } = parseFlags(argv.slice(1));
const noCommit = flags["no-commit"] === true;
const USAGE =
  "usage:\n" +
  "  bun manage.ts move   <viz-folder> <dest-folder>\n" +
  "  bun manage.ts delete <viz-folder>\n" +
  "  bun manage.ts update <viz-folder> [--posture …] [--listed …] [--kind …] [--triaged …] [--title …] [--description …] [--tags a,b,c]\n" +
  "  bun manage.ts mirror <ls|add|update|rm> <viz-folder> [--to …] [--access …] …\n" +
  "  bun manage.ts vendor <viz-folder> --to <sink-viz-pages>   (full self-contained copy, runnable standalone)\n" +
  "  bun manage.ts vendor-sync <vendored-viz-folder>           (re-pull the copy from its origin)\n" +
  "  bun manage.ts vendor-check [<dir>] [--staged]             (fail if a vendored copy drifted from its origin)\n" +
  "  bun manage.ts vendor-guard [<repo>]                       (install the drift-blocking pre-commit hook)\n" +
  "  (any: --no-commit to skip the auto-commit)";

if (verb === "move") {
  if (!pos[0] || !pos[1]) die(USAGE, 2);
  maybeCommit(cmdMove(resolveViz(pos[0]), pos[1]), noCommit, `viz: move ${path.basename(path.resolve(pos[0]))} → ${path.basename(path.resolve(pos[1]))}`);
} else if (verb === "delete") {
  const viz = resolveViz(pos[0]);
  maybeCommit(cmdDelete(viz), noCommit, `viz: delete ${viz.slug}`);
} else if (verb === "update") {
  const viz = resolveViz(pos[0]);
  maybeCommit(cmdUpdate(viz, flags), noCommit, `viz: update ${viz.slug}`);
} else if (verb === "mirror") {
  const sub = pos[0];
  if (!sub) die(USAGE, 2);
  const viz = resolveViz(pos[1]);
  const touched = cmdMirror(sub, viz, flags);
  if (touched) maybeCommit(touched, noCommit, `viz: mirror ${sub} ${viz.slug}`);
} else if (verb === "vendor") {
  if (!pos[0] || typeof flags.to !== "string") die(USAGE, 2);
  const viz = resolveViz(pos[0]);
  maybeCommit(cmdVendor(viz, flags.to), noCommit, `viz: vendor ${viz.slug} (full self-contained copy)`);
} else if (verb === "vendor-sync") {
  const viz = resolveViz(pos[0]);
  maybeCommit(cmdVendorSync(viz), noCommit, `viz: vendor-sync ${viz.slug}`);
} else if (verb === "vendor-check") {
  process.exit(cmdVendorCheck(pos[0] ? path.resolve(pos[0]) : process.cwd(), flags.staged === true) > 0 ? 1 : 0);
} else if (verb === "vendor-guard") {
  installVendorGuard(gitRoot(path.resolve(pos[0] ?? process.cwd())));
} else {
  die(USAGE, 2);
}

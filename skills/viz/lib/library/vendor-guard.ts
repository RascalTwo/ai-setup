// lib/library/vendor-guard.ts — Detecting and blocking drift between a vendored copy and its origin.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- vendor drift guard ----
// Invariant: a vendored copy byte-matches its origin (minus the marker + local-only
// files). vendor-check reports drift; the pre-commit hook (installed by vendor) calls it
// with --staged so ONLY copies touched by THIS commit are gated — editing an origin never
// blocks unrelated commits in the sink repo.
import { idFor } from "../../discovery.ts";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gitRoot } from "./git.ts";
import { VENDOR_MARKER, receiptOriginDir } from "./vendor.ts";

export function walkFiles(root: string, base = root, out = new Map<string, string>()): Map<string, string> {
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
export function filesEqual(a: string, b: string): boolean {
  try { const fa = readFileSync(a), fb = readFileSync(b); return fa.length === fb.length && fa.equals(fb); } catch { return false; }
}
export function copyState(copyDir: string): "match" | "drift" | "no-origin" {
  // Compares against the LIVE origin tree, not a recorded hash — that is deliberate and
  // load-bearing: a self-recorded digest could only prove the copy hadn't changed, and
  // would be blind to the origin moving forward, which is the drift that actually bites.
  const originDir = receiptOriginDir(copyDir);
  if (!originDir || !existsSync(path.join(originDir, "index.html"))) return "no-origin";
  const c = walkFiles(copyDir), o = walkFiles(originDir);
  if (c.size !== o.size) return "drift";
  for (const [rel, ca] of c) { const oa = o.get(rel); if (!oa || !filesEqual(ca, oa)) return "drift"; }
  return "match";
}
export function findVendoredCopies(root: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  if (entries.some((e) => e.name === VENDOR_MARKER)) out.push(root);
  for (const e of entries) if (e.isDirectory() && e.name !== ".git" && e.name !== "node_modules") findVendoredCopies(path.join(root, e.name), out);
  return out;
}
export function stagedVendoredCopies(repoRoot: string): string[] {
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
export function cmdVendorCheck(scan: string, staged: boolean): number {
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
export function installVendorGuard(repoRoot: string | null): void {
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

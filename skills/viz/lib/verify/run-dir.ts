// lib/verify/run-dir.ts — where one verify run writes, and which interactions script drives its page.
import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { vizDirFor } from "../../discovery.ts";
import { verifyDir } from "./state.ts";

const SKILL_DIR = path.resolve(import.meta.dir, "../..");

/**
 * Resolve the interactions file: explicit --interactions wins; otherwise look for
 * the conventional <vizdir>/verify.interactions.{ts,js}. The viz dir is homedir +
 * the URL pathname, because a viz's URL path is exactly its path under $HOME. Only
 * works for a localhost target; an external/file:// URL has no viz dir → none.
 */
export function resolveInteractions(url: string, interactions: string | undefined): string | null {
  if (interactions) return path.resolve(interactions);
  if (new URL(url).protocol === "file:") return null; // only a served viz has its own interactions file
  const vizDir = vizDirFor(url);
  if (!vizDir) return null;
  for (const f of ["verify.interactions.ts", "verify.interactions.js"]) {
    const p = path.join(vizDir, f);
    if (existsSync(p)) return p;
  }
  return null;
}

/** The folder this run writes its report, shots and test output to; created, and swept of last run's PNGs when `audit` will shoot new ones. */
export function prepareOutDir(url: string, audit: boolean): string {
  // One folder per viz (a shared one let two verifies at once overwrite each other's report). An external URL's key is its host and path, `/` and `.` as `_`.
  const ownDir = vizDirFor(url);
  const outKey = ownDir
    ? path.relative(os.homedir(), ownDir)
    : new URL(url).host + new URL(url).pathname;
  // Output is the viz's own `.verify/`; a page that is not a folder of ours (an external URL) keeps one under the skill.
  const outDir = ownDir
    ? verifyDir(ownDir)
    : path.join(SKILL_DIR, ".verify", outKey.replaceAll(/[^\w-]+/gu, "_"));
  mkdirSync(outDir, { recursive: true });
  // Fresh slate for shots. latest.png + the canonical text files are overwritten by name,
  // but ad-hoc shots from interactions (step1.png, …) have unique names — nothing would ever
  // remove them, so they'd pile up and a stale one could masquerade as current. Sweep all PNGs.
  if (audit)
    for (const f of readdirSync(outDir)) if (f.endsWith(".png")) rmSync(path.join(outDir, f));
  return outDir;
}

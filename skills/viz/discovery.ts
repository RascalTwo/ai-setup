// Shared discovery layer for the viz skill.
//
// The viz server is no longer pinned to a single directory. A viz can live in
// the central library (~/.viz-pages or ~/.claude/viz-pages) OR inside any repo,
// in a `viz-pages/` folder. This module owns the three concepts that make that
// work, so server.ts and bootstrap.ts share one source of truth:
//
//   - container   an absolute path to a `viz-pages/` directory whose immediate
//                 children are slugs. The central library is itself a container.
//   - id          a viz's globally-unique identity = its path relative to $HOME
//                 (a real filesystem path, so it can never collide). Also the URL.
//   - registry    .discovered.json in the central dir — an uncommitted, machine
//                 -local cache of discovered external containers. The central
//                 container is always seeded in code, never written to the file
//                 (and the deep scan skips it anyway, since it's a dot-folder).

import { existsSync, realpathSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const HOME = os.homedir();

// Resolve the central viz dir without hardcoding a vendor path. Order:
//   1. $VIZ_PAGES_DIR      — explicit override
//   2. ~/.viz-pages        — vendor-neutral default for fresh installs
//   3. ~/.claude/viz-pages — legacy location, kept so existing libraries aren't orphaned
export function resolveVizRoot(): string {
  if (process.env.VIZ_PAGES_DIR) return process.env.VIZ_PAGES_DIR;
  const neutral = path.join(HOME, ".viz-pages");
  const legacy = path.join(HOME, ".claude", "viz-pages");
  if (existsSync(neutral)) return neutral;
  if (existsSync(legacy)) return legacy;
  return neutral;
}

export const CENTRAL = resolveVizRoot();
export const REGISTRY_PATH = path.join(CENTRAL, ".discovered.json");

// The skill ships its own home page (the self-portrait) in a bundled `viz-pages/`
// container right next to this file, so a fresh clone serves it without copying
// anything into CENTRAL. Seeded in code like CENTRAL, never written to the registry.
// realpath-normalized (the skill is reached via a symlink): keeps this path equal to
// the one deepScan finds, so the container can't show up twice under two spellings.
export const BUNDLED = path.join(realpathSync(import.meta.dir), "viz-pages");

// A viz's identity / URL path = its location relative to a base, POSIX-separated.
// Base is $HOME in central mode; a standalone runtime swaps in its own repo root
// (see server.ts) so vendored vizzes get clean repo-relative URLs.
// Returns null if the dir escapes the base (we refuse to create those — see bootstrap).
export function idFor(absDir: string, base: string = HOME): string | null {
  const rel = path.relative(base, absDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

// Dirs the deep scan never descends into. `Library` and the dot-folders are the
// macOS/cross-platform landmines (huge, app-managed, zero vizzes); node_modules
// is the npm tar pit. Any folder beginning with "." is also skipped wholesale.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".Trash",
  ".cache",
  "Library",
]);
const MAX_DEPTH = 12;

// Read the persisted external containers, keeping only ones that still exist.
// The central container is intentionally NOT stored here; it's prepended in code.
export function readRegistry(): string[] {
  try {
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter((p) => typeof p === "string" && existsSync(p));
  } catch {
    return [];
  }
}

export async function writeRegistry(containers: string[]): Promise<void> {
  // Persist only the external ones; central + bundled are seeded in code.
  const external = [...new Set(containers)].filter((c) => c !== CENTRAL && c !== BUNDLED).sort();
  await Bun.write(REGISTRY_PATH, JSON.stringify(external, null, 2) + "\n");
}

// Idempotently register one container (used by bootstrap on local creation, so a
// freshly-made viz is visible immediately without waiting for the next deep scan).
export async function addContainer(container: string): Promise<void> {
  const current = readRegistry();
  if (current.includes(container)) return;
  await writeRegistry([...current, container]);
}

// The full ordered, de-duplicated container list: central first (so it wins any
// id tie), then the verified registry entries.
export function allContainers(): string[] {
  return [...new Set([CENTRAL, BUNDLED, ...readRegistry()])].filter((c) => existsSync(c));
}

export type SlugEntry = {
  id: string; // relative-to-home path = URL
  dir: string; // absolute slug dir
  container: string; // absolute viz-pages dir it lives in
  isCentral: boolean;
};

// Build the id -> entry map by reading each container's immediate child dirs.
// First container to claim an id wins (central is first), so collisions are
// deterministic — though real collisions are near-impossible since ids are paths.
export function buildSlugMap(
  containers = allContainers(),
  base: string = HOME,
): Map<string, SlugEntry> {
  const map = new Map<string, SlugEntry>();
  for (const container of containers) {
    let names: string[];
    try {
      names = readdirSync(container, { withFileTypes: true })
        // "_"-prefixed dirs are build infra (_thumbs), never vizzes — same intent as "."
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_"))
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = path.join(container, name);
      const id = idFor(dir, base);
      if (!id || map.has(id)) continue;
      map.set(id, { id, dir, container, isCentral: container === CENTRAL });
    }
  }
  return map;
}

// Walk `root` (default $HOME) looking for `viz-pages/` directories. Background-only
// (slow is fine). A standalone runtime passes its own repo root instead, so the
// scan stays bound to the repo and never crawls a cloner's home dir.
// Rules: skip the skip-list + any dot-folder; follow symlinks but guard against
// loops with a resolved-path visited set; on finding a viz-pages dir, record it
// and do NOT descend (no nested viz-pages); stop at MAX_DEPTH as a backstop.
export async function deepScan(root: string = HOME): Promise<string[]> {
  const found: string[] = [];
  const visited = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;

      let isDir = e.isDirectory();
      const full = path.join(dir, name);
      if (e.isSymbolicLink()) {
        try {
          isDir = (await stat(full)).isDirectory();
        } catch {
          continue;
        }
      }
      if (!isDir) continue;

      if (name === "viz-pages") {
        found.push(full); // prune: don't recurse into a viz-pages container
        continue;
      }
      await walk(full, depth + 1);
    }
  }

  await walk(root, 0);
  return found;
}

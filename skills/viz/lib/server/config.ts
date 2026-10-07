// lib/server/config.ts — Which server this process is: the central one, or a vendored standalone.
//
// Extracted from server.ts, which was 522 lines.

import { HOME, allContainers } from "../../discovery.ts";
import path from "node:path";
// Every path below is relative to the SKILL ROOT, not to this module. These moved two
// levels down during the decomposition and import.meta.dir moved with them — which is
// how /_kit/* started 404ing, and why the standalone-runtime detection would have
// mis-fired in a vendored copy.
const SKILL_DIR = path.resolve(import.meta.dir, "../..");
/**
 * Tape-recorder mode. Owned here so every handler reads one value, but SET by
 * server.ts once it has parsed its flags — a config module cannot parse argv without
 * becoming an entry point, which is the thing this split exists to stop.
 */
export let MODE: "live" | "record" | "frozen" = "live";
export function setMode(m: "live" | "record" | "frozen"): void {
  MODE = m;
}

// ---- Mode: one server, two configs ----
// A vendored runtime lives at <repo>/viz-pages/.runtime/. If we're running from
// there, we're STANDALONE: serve only that repo, id-base = the dir above
// viz-pages/, no $HOME scan, no central seed. Otherwise we're the CENTRAL server
// running from the skill dir: $HOME-based ids, deep scan, multi-root discovery.
export const STANDALONE =
  path.basename(SKILL_DIR) === ".runtime" && path.basename(path.dirname(SKILL_DIR)) === "viz-pages";
export const STANDALONE_CONTAINER = path.dirname(SKILL_DIR); // <repo>/viz-pages
export const BASE = STANDALONE ? path.dirname(STANDALONE_CONTAINER) : HOME;

// Hand the skill dir down to any viz api.ts we hot-load (ADR 0009): the self-portrait
// shells out to viz.ts for mutations. Central only — a standalone .runtime has no
// viz.ts, and doesn't seed the bundled self-portrait container.
if (!STANDALONE) process.env.VIZ_SKILL_DIR = SKILL_DIR;

// A launchd job starts with PATH=/usr/bin:/bin:/usr/sbin:/sbin, so an api.ts backend that
// shells out to podman, gh, kubectl, aws or claude fails with "Executable not found in
// $PATH" (and a manual start from a login shell hides it). Append the usual tool dirs to
// PATH here, in the process the backends run in, so it holds however the server was
// launched. Appended, not prepended: a PATH the user already set keeps its precedence.
// Assigning process.env.PATH alone is NOT enough: Bun resolves a spawned command (and
// Bun.which) against the PATH it captured at startup, so the Bun entry points below are
// re-pointed at the live env. (node:child_process spawns inherit process.env, so they already
// see it. The launchd plist is left alone on purpose: see launchd/README.md.)
export function withToolPath(current: string | undefined, home: string, execPath: string): string {
  const have = (current ?? "").split(path.delimiter).filter(Boolean);
  const extra = new Set([
    path.dirname(execPath),
    path.join(home, ".bun/bin"),
    path.join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/opt/podman/bin",
  ]);
  return [...have, ...[...extra].filter((d) => !have.includes(d))].join(path.delimiter);
}
process.env.PATH = withToolPath(process.env.PATH, HOME, process.execPath);
{
  const { spawn, spawnSync, which } = Bun;
  const asObj = (x: unknown): object => (typeof x === "object" && x !== null ? x : {});
  // Reflect.apply because spawn/spawnSync are overloaded: one wrapper has to take either call shape.
  const live =
    (run: typeof spawn | typeof spawnSync) =>
    (cmd: unknown, opts?: object): unknown =>
      Array.isArray(cmd)
        ? (Reflect.apply(run, undefined, [cmd, { env: process.env, ...opts }]) as unknown)
        : (Reflect.apply(run, undefined, [{ env: process.env, ...asObj(cmd) }]) as unknown);
  Object.assign(Bun, {
    spawn: live(spawn),
    spawnSync: live(spawnSync),
    which: (cmd: string, opts?: object) => which(cmd, { PATH: process.env.PATH ?? "", ...opts }),
  });
}

// The containers this process serves: the one repo container when standalone,
// the discovered set (central library + registry) when central.
export function currentContainers(): string[] {
  return STANDALONE ? [STANDALONE_CONTAINER] : allContainers();
}

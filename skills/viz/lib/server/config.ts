// lib/server/config.ts — Which server this process is: the central one, or a vendored standalone.
//
// Extracted from server.ts, which was 522 lines.

import { CENTRAL, HOME, allContainers } from "../../discovery.ts";
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
  path.basename(SKILL_DIR) === ".runtime" &&
  path.basename(path.dirname(SKILL_DIR)) === "viz-pages";
export const STANDALONE_CONTAINER = path.dirname(SKILL_DIR); // <repo>/viz-pages
export const BASE = STANDALONE ? path.dirname(STANDALONE_CONTAINER) : HOME;

// Hand the skill dir down to any viz api.ts we hot-load (ADR 0009): the self-portrait
// shells out to manage.ts for mutations. Central only — a standalone .runtime has no
// manage.ts, and doesn't seed the bundled self-portrait container.
if (!STANDALONE) process.env.VIZ_SKILL_DIR = SKILL_DIR;

// The containers this process serves: the one repo container when standalone,
// the discovered set (central library + registry) when central.
export function currentContainers(): string[] {
  return STANDALONE ? [STANDALONE_CONTAINER] : allContainers();
}

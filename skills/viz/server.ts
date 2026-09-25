#!/usr/bin/env bun
// server.ts — the daemon's entry point.
//
// Was 522 lines of everything: mode detection, the live slug map, fs watchers, the
// reload pub/sub, api backends, the tape recorder, the comment layer, static serving
// and the routing table. That all lives in lib/server/ now; this file parses flags,
// boots, binds the port, and keeps vendored runtimes current.
//
// Unlike the other entry points this one is a genuine long-running process, not a
// script pretending to be a library — so it keeps its boot sequence rather than being
// reduced to a shim.

import { BASE, MODE, STANDALONE, currentContainers, setMode } from "./lib/server/config.ts";
import { handleRequest } from "./lib/server/routes.ts";
import { onFsEvent, rebuild, runScan, setHttpServer, syncWatchers } from "./lib/server/state.ts";
import type { Server } from "bun";
import { watch, existsSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { publishReload, reloadSnippet, reloadWebSocket, upgradeReload } from "./kit/reload.ts";
import {
  BUNDLED,
  CENTRAL,
  HOME,
  allContainers,
  buildSlugMap,
  deepScan,
  idFor,
  readRegistry,
  writeRegistry,
  type SlugEntry,
} from "./discovery.ts";
import { PORT } from "./server-control.ts";
import { parseFlags, bool } from "./cli.ts";
import {
  recordKey,
  lookup,
  replay,
  writeEntry,
  envelopeFrom,
  hasTape,
  readTape,
  frozenBanner,
} from "./recordings.ts";

const USAGE =
  "usage: bun server.ts [--record | --frozen]\n" +
  "\n" +
  "  (no flags)  serve live; api.ts backends run for real\n" +
  "  --record    serve live AND tee every api response into the viz's recordings.json\n" +
  "  --frozen    serve the recorded tape for every api call; the live backend is untouched\n" +
  "\n" +
  "Normally you do not run this by hand — bootstrap.ts starts it, and\n" +
  "`bun manage.ts start|stop|status` controls it.";

// Previously this read process.argv.includes() directly, with no usage string and no
// rejection, so `--frozn` was silently ignored: the server came up in live mode and
// quietly served real data to something expecting a frozen tape. Parsed properly now.
const { flags: serverFlags } = parseFlags(process.argv.slice(2), {
  known: ["record", "frozen", "help"],
  usage: USAGE,
});
if (bool(serverFlags, "help")) {
  console.log(USAGE);
  process.exit(0);
}

// Tape recorder mode, a process-level flag. frozen wins if both given.
setMode(bool(serverFlags, "frozen") ? "frozen" : bool(serverFlags, "record") ? "record" : "live");

// ---- Boot: serve immediately from the registry fast-path, then scan in bg ----
rebuild();
runScan().catch((e) => console.error("initial scan failed:", e));

// Request handler, shared by both modes. Named (not an inline server method) so
// the listen loop below can retry it on a higher port in standalone mode.
// Returns undefined only when the request was consumed by a websocket upgrade.
// ---- Listen. Central is pinned to 5180 (bootstrap probes that exact port).
// Standalone tries 5180 and walks up to the next free port, so a standalone
// spot-check can coexist with a running central server. ----
let boundPort = PORT;
const maxPort = STANDALONE ? PORT + 50 : PORT;
for (;;) {
  try {
    // idleTimeout maxed (255s, Bun's ceiling): a streaming api.ts response can
    // pause for many seconds (model inference, slow command) without Bun closing
    // the idle connection, so backends needn't hand-roll keep-alive heartbeats.
    // idleTimeout here is the HTTP one; the websocket channel carries its own
    // (and needs a much longer one — see kit/reload.ts).
    const bound = Bun.serve({
      hostname: "127.0.0.1",
      port: boundPort,
      idleTimeout: 255,
      fetch: handleRequest,
      websocket: reloadWebSocket,
    });
    // state.ts owns it: an imported `let` is read-only in the importer, and the fs
    // watcher needs the bound server to publish reloads.
    setHttpServer(bound);
    break;
  } catch (e) {
    const inUse =
      (e as { code?: string })?.code === "EADDRINUSE" || /EADDRINUSE|in use/i.test(String(e));
    if (inUse && boundPort < maxPort) {
      boundPort++;
      continue;
    }
    throw e;
  }
}

console.log(
  `viz server running at http://127.0.0.1:${boundPort}  ` +
    `(mode=${STANDALONE ? "standalone" : "central"}, base=${BASE}` +
    `${MODE === "live" ? "" : ", tape=" + MODE})`,
);

// ---- Keep vendored runtimes current ----
// A vendored .runtime/ is a COPY of this file, so it goes stale the moment this file
// changes and nothing announces it. Copies were found up to two months behind, still
// serving a hot-reload client with a known bug.
//
// The sweep is hung off server startup rather than a scheduled job on purpose. ADR 0010
// already established that a fix requiring a human to remember to run it doesn't get run
// ("push collapses noticing and fixing into a step the author already runs"), and today
// showed the other half: com.rascaltwo.viz-server sat dead for weeks on exit 78 while its
// 04:00 restart job dutifully kickstarted a corpse — a scheduled job fails SILENTLY. This
// server failing is loud: vizzes stop loading and you know in seconds. So the sweep rides
// the process whose breakage you cannot miss, and which is by definition the new code.
//
// Central only. A standalone runtime has no sync-runtimes.ts beside it, and must never
// reach outside its own repo (ADR 0002).
//
// Spawned, not imported: a sweep that throws can never take the server down with it, and
// server.ts gains no import that would then have to be vendored into every .runtime/.
// Not awaited — serving starts immediately, the sweep catches up behind it.
//
// Writing into <container>/.runtime/ does not cause a reload storm: onFsEvent ignores any
// path whose first segment is dot-prefixed, which is exactly what .runtime is.
if (!STANDALONE) {
  Bun.spawn([process.execPath, path.join(import.meta.dir, "sync-runtimes.ts")], {
    stdout: "inherit",
    stderr: "inherit",
  });
}

#!/usr/bin/env node
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

import { BASE, MODE, STANDALONE, setMode } from "./lib/server/config.ts";
import { handleRequest } from "./lib/server/routes.ts";
import { rebuild, runScan } from "./lib/server/state.ts";
import path from "node:path";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { serve } from "./lib/server/serve.ts";
import { spawn } from "node:child_process";
import { PORT } from "./server-control.ts";
import { parseFlags, bool } from "./cli.ts";

const USAGE =
  "usage: node server.ts [--record | --frozen]\n" +
  "\n" +
  "  (no flags)  serve live; api.ts backends run for real\n" +
  "  --record    serve live AND tee every api response into the viz's recordings.json\n" +
  "  --frozen    serve the recorded tape for every api call; the live backend is untouched\n" +
  "\n" +
  "Normally you do not run this by hand — `viz create` starts it, and\n" +
  "`viz server start|stop|status` controls it.";

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
// oxlint-disable-next-line prefer-top-level-await -- the scan must run in the background: awaiting it would hold off listening
runScan().catch((e: unknown) => console.error("initial scan failed:", e));

// ---- Listen. Central is pinned to 5180 (bootstrap probes that exact port).
// Standalone tries 5180 and walks up to the next free port, so a standalone
// spot-check can coexist with a running central server. ----
let boundPort = PORT;
const maxPort = STANDALONE ? PORT + 50 : PORT;
for (;;) {
  try {
    // No idle timeout to raise: node:http never closes a response that pauses, so a streaming
    // api.ts response can stall for model inference or a slow command without keep-alive
    // heartbeats.
    // oxlint-disable-next-line no-await-in-loop -- one bind attempt at a time, the next only after this one fails
    await serve({ hostname: "127.0.0.1", port: boundPort, fetch: handleRequest });
    break;
  } catch (e) {
    const inUse = typeof e === "object" && e !== null && "code" in e && e.code === "EADDRINUSE";
    if (inUse && boundPort < maxPort) {
      boundPort++;
      // 5190 is Timeline Studio's web UI; a viz server squatting there makes it refuse to start.
      if (boundPort === 5190) boundPort++;
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
//
// And only from the installed skill. The sweep writes into other repos, so a server started from
// any other checkout (a worktree, a clone being worked on) must not do it: its half-edited code
// would be stamped into every vendored runtime.
const fromInstalled = [".agents", ".claude"].some((agent) => {
  try {
    return (
      realpathSync(path.join(homedir(), agent, "skills", "viz")) ===
      realpathSync(import.meta.dirname)
    );
  } catch {
    return false; // no such install
  }
});
// A private server (its own port or pages dir, as an agent starts to verify a worktree) is not the
// central one either: it must not write into other repos.
const isPrivate = Boolean(process.env["VIZ_PORT"] ?? process.env["VIZ_PAGES_DIR"]);
if (!STANDALONE && fromInstalled && !isPrivate) {
  spawn(process.execPath, [path.join(import.meta.dirname, "sync-runtimes.ts")], {
    stdio: "inherit",
  });
} else if (!STANDALONE)
  console.log("sync-runtimes: skipped, only the central installed server re-stamps runtimes");

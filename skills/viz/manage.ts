#!/usr/bin/env bun
// manage.ts — BACK-COMPAT ENTRY POINT.
//
// This was 878 lines of everything: viz resolution, git staging, ls/search, move,
// delete, update, mirrors, vendoring, drift detection, history, server control. All of
// it now lives in lib/library/ as focused modules that `viz` calls directly, and this
// file is only the old CLI's verb dispatch, kept so existing invocations and anything
// scripted against `bun manage.ts` keep working.
//
// New work goes through `viz <verb>` and lib/library/. Nothing should be added here.

import path from "node:path";
import { parseFlags, die } from "./cli.ts";
import { cmdDelete } from "./lib/library/delete.ts";
import { gitRoot, maybeCommit } from "./lib/library/git.ts";
import { cmdHistory, cmdRollback } from "./lib/library/history.ts";
import { cmdLs, cmdSearch } from "./lib/library/list.ts";
import { cmdMirror } from "./lib/library/mirror.ts";
import { cmdMove } from "./lib/library/move.ts";
import { cmdRescan, cmdServerStart, cmdServerStatus, cmdStop } from "./lib/library/server-cmds.ts";
import { cmdUpdate } from "./lib/library/update.ts";
import { cmdVendorCheck, installVendorGuard } from "./lib/library/vendor-guard.ts";
import { cmdVendor, cmdVendorLs, cmdVendorRm, cmdVendorSync } from "./lib/library/vendor.ts";
import { resolveViz } from "./lib/library/viz.ts";

const VALUE_FLAGS = new Set(["posture", "listed", "triaged", "to", "access", "title", "description", "tags", "n"]);

// ---- dispatch ----
const argv = process.argv.slice(2);
const verb = argv[0];
const { flags, pos } = parseFlags(argv.slice(1), { value: VALUE_FLAGS });
const noCommit = flags["no-commit"] === true;
const USAGE =
  "usage:\n" +
  "  bun manage.ts ls     [--posture …] [--listed …] [--central|--local] [--json]\n" +
  "  bun manage.ts search <term> [--json]      (matches path/title/description/tags AND page source)\n" +
  "  bun manage.ts move   <viz-folder> <dest-folder>\n" +
  "  bun manage.ts delete <viz-folder>\n" +
  "  bun manage.ts update <viz-folder> [--posture …] [--listed …] [--triaged …] [--title …] [--description …] [--tags a,b,c]\n" +
  "  bun manage.ts mirror <ls|add|update|rm> <viz-folder> [--to …] [--access …] …\n" +
  "  bun manage.ts vendor <viz-folder> --to <sink-viz-pages> --access public|private\n" +
  "                                                            (declare the edge + write a full standalone copy)\n" +
  "  bun manage.ts vendor-rm <viz-folder> --to <sink-viz-pages> (undeclare; copy pruned on next --push-vendors)\n" +
  "  bun manage.ts vendor-ls <viz-folder>                      (show this viz's vendor declarations)\n" +
  "  bun manage.ts vendor-sync <vendored-viz-folder>           (re-pull the copy from its origin)\n" +
  "  bun manage.ts vendor-check [<dir>] [--staged]             (fail if a vendored copy drifted from its origin)\n" +
  "  bun manage.ts vendor-guard [<repo>]                       (install the drift-blocking pre-commit hook)\n" +
  "  bun manage.ts history  <viz-folder> [--n <count>]        (per-viz git log, central or repo-local)\n" +
  "  bun manage.ts rollback <viz-folder> <commit-hash>        (restore that viz to an earlier commit)\n" +
  
  "  bun manage.ts start | stop | status | rescan             (the viz server)\n" +
  "  (any: --no-commit to skip the auto-commit)";

if (verb === "ls") {
  cmdLs(flags); // read-only: never commits, never mutates
} else if (verb === "search") {
  if (!pos[0]) die(USAGE, 2);
  cmdSearch(pos[0], flags);
} else if (verb === "move") {
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
  maybeCommit(cmdVendor(viz, flags.to, flags), noCommit, `viz: vendor ${viz.slug} (full self-contained copy)`);
} else if (verb === "vendor-rm") {
  if (!pos[0] || typeof flags.to !== "string") die(USAGE, 2);
  const viz = resolveViz(pos[0]);
  maybeCommit(cmdVendorRm(viz, flags.to), noCommit, `viz: vendor-rm ${viz.slug}`);
} else if (verb === "history") {
  cmdHistory(resolveViz(pos[0]), flags); // read-only
} else if (verb === "rollback") {
  const viz = resolveViz(pos[0]);
  maybeCommit(cmdRollback(viz, pos[1]), noCommit, `viz: rollback ${viz.slug} to ${pos[1]}`);
} else if (verb === "rescan") {
  await cmdRescan(flags);
} else if (verb === "stop") {
  await cmdStop(flags);
} else if (verb === "start") {
  await cmdServerStart(flags);
} else if (verb === "status") {
  await cmdServerStatus(flags);
} else if (verb === "vendor-ls") {
  cmdVendorLs(resolveViz(pos[0])); // read-only
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

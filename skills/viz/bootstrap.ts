#!/usr/bin/env bun
// bootstrap.ts — BACK-COMPAT ENTRY POINT for `viz create`.
//
// Parses the old flag surface and calls lib/create/createViz(). The scaffolding itself,
// the page templates, the fork logic and the central-repo git handling all live in
// lib/create/ now, so `viz create` can call them without spawning a process.
//
// New work goes through `viz create` and lib/create/. Nothing should be added here.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CENTRAL, HOME, addContainer, idFor } from "./discovery.ts";
// Only called under --runtime (opt-in since 2026-08-17) — see that flag's comment.
// Shared with sync-runtimes.ts so the two can't disagree about what a runtime contains.
import { vendorRuntime } from "./vendor-runtime.ts";
import { parseFlags, str, bool, die } from "./cli.ts";
import { createViz } from "./lib/create/create.ts";
import { PORT, refresh, start as serverStart } from "./server-control.ts";

const VIZ_ROOT = CENTRAL;


// ---- Argument parsing ----
// usage: bootstrap.ts <slug> [--local [dir]] [--global]
// `--local` consumes the next arg as a target dir only if it looks like a path
// (so `/viz --local my-chart` reads my-chart as the slug, not the dir).
function looksLikePath(s: string): boolean {
  return s === "." || s.startsWith("~") || s.startsWith("/") || s.startsWith(".") || s.includes("/");
}

let slug: string | undefined;
let local = false;
let localDir: string | undefined;
let global = false;
let hero = false;
// Dump the new index.html to stdout. ON by default (--no-print opts out),
// because the agent has to see this file before it can edit it, and printing it
// here is strictly cheaper than the round trip: same bytes, one fewer tool call.
// Verified that stdout satisfies the read-before-write guard — an Edit lands
// without a separate Read once the content has been shown.
// Suppressed for a big page (over 8KB), which the agent almost never needs verbatim.
let print = true;
// --from <template|viz-folder>: start from a template (by name, when exactly one has it —
// `viz templates`) or fork any viz by PATH (a slug isn't unique across containers, a
// path is; ADR 0008).
let from: string | undefined;
// --quick: the ONLY thing that lowers the ambition bar (see SKILL.md § Ambition). It
// changes nothing on disk — it only swaps the closing banner — because the bar is a
// behavioural contract with the author, not a property of the page.
let quick = false;

// --runtime: vendor a standalone server into <container>/.runtime/ (ADR 0002). OPT-IN
// since 2026-08-17. It used to be stamped on every --local run, which put a committed
// copy of the whole serve runtime into ten repos; an audit found exactly two where the
// standalone property is actually used, and the other eight carried 84 tracked files
// that nothing read and that silently drifted from canonical. Ask for it when a cloner
// really will run the vizzes without the skill installed; otherwise the central server
// already serves them.
let runtime = false;

const USAGE =
  "usage: bootstrap.ts <slug> [--local [dir]] [--global] [--hero] [--from <template|viz-folder>]\n" +
  "                           [--runtime] [--quick] [--no-print] [--json]";
const KNOWN = [
  "quick", "runtime", "global", "central", "hero", "no-print", "print", "from", "local", "json",
];
const { flags, pos } = parseFlags(process.argv.slice(2), {
  value: ["from"],
  // --local takes an OPTIONAL dir; a bare word after it is the slug, not a path.
  optional: { local: looksLikePath },
  known: KNOWN,
  usage: USAGE,
});


quick = bool(flags, "quick");
runtime = bool(flags, "runtime");
global = bool(flags, "global") || bool(flags, "central");
hero = bool(flags, "hero");
if (bool(flags, "no-print")) print = false;
if (bool(flags, "print")) print = true;
from = str(flags, "from");
local = flags["local"] !== undefined;
localDir = str(flags, "local");
slug = pos[0];

if (!slug) die(USAGE, 2);
const jsonMode = bool(flags, "json");

// The work lives in lib/create/. This file is the CLI shim that fills in the options.
await createViz({
  slug, local, localDir, hero, from, runtime, quick, print, jsonMode, flags,
});

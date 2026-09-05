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
let deck = false;
let poster = false;
let dive = false;
let hero = false;
// --exchange: an animated diagram of something being presented, passed or proven
// between parties (actors in phase bands, packets riding declared wires, stepped
// narration). Promoted into the kit after 11 variants across 2 repos hand-copied
// the same runtime; see kit/EXCHANGE.md.
let exchange = false;
// Dump the scaffolded index.html to stdout. ON by default (--no-print opts out),
// because the agent has to see this file before it can edit it, and printing it
// here is strictly cheaper than the round trip: same bytes, one fewer tool call.
// Verified that stdout satisfies the read-before-write guard — an Edit lands
// without a separate Read once the content has been shown.
// Suppressed for --deck, whose template is ~4k tokens of scaffolding the agent
// almost never needs verbatim.
let print = true;
// --from <existing-viz-folder>: fork that viz as the starting point instead of the
// blank starter. Named by PATH, not slug — a slug isn't unique across containers,
// a path is (ADR 0008). Find one with `manage.ts ls` / `manage.ts search <term>`.
let from: string | undefined;
// --quick: the ONLY thing that lowers the ambition bar (see SKILL.md § Ambition). It
// changes nothing on disk — it only swaps the closing banner — because the bar is a
// behavioural contract with the author, not a property of the scaffold.
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
  "usage: bootstrap.ts <slug> [--local [dir]] [--global] [--deck] [--poster] [--poster-dive]\n" +
  "                           [--exchange] [--hero] [--from <viz-folder>] [--runtime] [--quick]\n" +
  "                           [--no-print] [--json]";
const KNOWN = [
  "quick", "runtime", "global", "central", "deck", "poster", "poster-dive", "dive",
  "hero", "exchange", "no-print", "print", "from", "local", "json",
];
const { flags, pos } = parseFlags(process.argv.slice(2), {
  value: ["from"],
  // --local takes an OPTIONAL dir; a bare word after it is the slug, not a path.
  optional: { local: looksLikePath },
  known: KNOWN,
  usage: USAGE,
});

// Renamed 2026-08-19. Kept in KNOWN purely so this message fires instead of the
// generic unknown-flag error — `--poster --dive` used to quietly scaffold a plain
// poster, which is wrong output with no complaint.
if (flags["dive"]) die("--dive was renamed --poster-dive (it still implies --poster). Re-run with --poster-dive.", 2);

quick = bool(flags, "quick");
runtime = bool(flags, "runtime");
global = bool(flags, "global") || bool(flags, "central");
deck = bool(flags, "deck");
hero = bool(flags, "hero");
exchange = bool(flags, "exchange");
// --poster-dive is a variant of --poster and implies it: a dive with no card on top is
// just a page. It still stamps its OWN viz:scaffold=poster-dive — that meta records
// which scaffold ran, and dive-ness is derivable from it but not back out of it.
dive = bool(flags, "poster-dive");
poster = bool(flags, "poster") || dive;
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
  slug, local, localDir, deck, poster, dive, hero, exchange,
  from, runtime, quick, print, jsonMode, flags,
});

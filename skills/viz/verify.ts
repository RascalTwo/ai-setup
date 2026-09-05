#!/usr/bin/env bun
// verify.ts — BACK-COMPAT ENTRY POINT for `viz verify`.
//
// Parses the old flag surface and calls lib/verify/verifyViz(). The Chrome driving,
// layout probe, artifact writing and verdict all live in lib/verify/ now.
//
// New work goes through `viz verify` and lib/verify/. Nothing should be added here.

import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CENTRAL } from "./discovery.ts";
import { parseFlags, str, bool, die } from "./cli.ts";
import { verifyViz } from "./lib/verify/verify.ts";

const PORT = 5180;


// ---- args ----
const USAGE =
  "usage: bun verify.ts <url|id> [--wait <selector|ms>] [--full] [--size WxH] [--og]\n" +
  "                              [--interactions <file>] [--commit <msg>] [--json]";
const VALUE_FLAGS = ["wait", "size", "interactions", "commit"];
// Previously a local closure that split only on "=", so `--size 800x600` was silently
// ignored here while working in every other script. The shared parser takes both forms.
const { flags, pos } = parseFlags(process.argv.slice(2), {
  value: VALUE_FLAGS,
  known: [...VALUE_FLAGS, "full", "og", "json"],
  usage: USAGE,
});
const flag = (name: string) => str(flags, name);
const target = pos[0];
if (!target) die(USAGE, 2);
const url = target.includes("://")
  ? target
  : `http://127.0.0.1:${PORT}/${target.replace(/^\/+|\/+$/g, "")}/`;
const wait = flag("wait");
const interactions = flag("interactions");
const full = bool(flags, "full");
const og = bool(flags, "og");
// --og shoots at the 1200×630 card aspect by default so the auto image needs no cropping
// (a viewport screenshot at WxH is exactly WxH px — no image lib, stays cross-platform).

await verifyViz({
  target,
  wait: flag("wait"),
  full: bool(flags, "full"),
  og: bool(flags, "og"),
  size: flag("size"),
  interactions: flag("interactions"),
  commit: flag("commit"),
  json: bool(flags, "json"),
});

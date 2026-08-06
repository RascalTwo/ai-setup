#!/usr/bin/env bun
// Mint a new viz slug, ensure the server is running, and print + open the URL.
//
// Two modes:
//   central (default)  -> CENTRAL/<slug>/, committed to the central viz git repo
//   local  (--local)   -> <repo-or-dir>/viz-pages/<slug>/, registered for discovery,
//                         committed by YOU in the host repo (we don't touch git)
//
// Cross-platform (macOS / Linux / Windows): pure Bun, no shell utilities beyond git.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CENTRAL, HOME, addContainer, idFor } from "./discovery.ts";

const VIZ_ROOT = CENTRAL;
const PORT = 5180;
const SERVER_TS = path.join(import.meta.dir, "server.ts");
const PID_FILE = path.join(VIZ_ROOT, ".server.pid");
const LOG_FILE = path.join(VIZ_ROOT, ".server.log");
const HEALTH_URL = `http://127.0.0.1:${PORT}/_health`;

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

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

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--global" || a === "--central") global = true;
  else if (a === "--deck") deck = true;
  else if (a === "--poster") poster = true;
  // --dive is a modifier on --poster, and implies it: a dive with no card on top is
  // just a page, so there's nothing sensible to do with it alone.
  else if (a === "--dive") (dive = true), (poster = true);
  else if (a === "--hero") hero = true;
  else if (a === "--no-print") print = false;
  else if (a === "--print") print = true;
  else if (a === "--from") {
    from = args[i + 1];
    i++;
  } else if (a.startsWith("--from=")) {
    from = a.slice("--from=".length);
  }
  else if (a === "--local") {
    local = true;
    const next = args[i + 1];
    if (next && looksLikePath(next)) {
      localDir = next;
      i++;
    }
  } else if (a.startsWith("--local=")) {
    local = true;
    localDir = a.slice("--local=".length);
  } else if (!a.startsWith("-") && !slug) {
    slug = a;
  }
}

if (!slug) die("usage: bootstrap.ts <slug> [--local [dir]] [--global] [--deck] [--poster [--dive]] [--hero] [--from <viz-folder>] [--no-print]", 2);
if (global) local = false;

// ---- Helpers ----
function expandHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  return p;
}

async function gitOut(args: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const out = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 ? out : null;
  } catch {
    return null;
  }
}

async function gitCentral(args: string[]): Promise<void> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: VIZ_ROOT,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    die("ERROR: git not found on PATH. Install git and retry.");
  }
}

function detectSessionId(): string {
  const envId = process.env.CLAUDE_CODE_SESSION_ID;
  if (envId) return envId;
  const projSlug = process.cwd().replace(/[/\\:]/g, "-");
  const projDir = path.join(HOME, ".claude", "projects", projSlug);
  try {
    if (existsSync(projDir)) {
      const latest = readdirSync(projDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({ f, m: statSync(path.join(projDir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)[0];
      if (latest) return path.basename(latest.f, ".jsonl");
    }
  } catch {
    // best-effort — fall through to timestamp
  }
  return "ts-" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

async function probePort(): Promise<"ours" | "foreign" | "free"> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(500) });
    return res.ok && (await res.text()) === "OK" ? "ours" : "foreign";
  } catch {
    return "free";
  }
}

// Tell the running server to rebuild its slug map so this new viz routes right
// away (a cheap map refresh, not a full deep scan of $HOME).
async function pingRefresh(): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${PORT}/_refresh`, { signal: AbortSignal.timeout(1500) });
  } catch {
    // best-effort — the next scan/restart will pick it up anyway
  }
}

// Vendor a verbatim copy of the serve runtime into <container>/.runtime/ so the
// host repo runs standalone with no skill installed. The server self
// -detects standalone mode from this location. cpSync overwrites, so every
// --local run re-stamps from the skill's canonical copy. The dot-prefix keeps the
// central server's discovery from ever mistaking .runtime/ for a viz.
function vendorRuntime(skillDir: string, runtimeDir: string): void {
  mkdirSync(runtimeDir, { recursive: true });
  for (const f of ["server.ts", "discovery.ts", "recordings.ts", "tape-key.js"]) {
    cpSync(path.join(skillDir, f), path.join(runtimeDir, f));
  }
  cpSync(path.join(skillDir, "kit"), path.join(runtimeDir, "kit"), { recursive: true });
}

// Keep transient/generated per-viz files out of git in every viz container — central and
// repo-local alike: `comments.json` (review scratch) and `og.auto.png` (the auto-rendered OG
// card, regenerated from hero.html / the live page on every build — an artifact, not source).
// Idempotent: appends only the entries that are missing. A .gitignore takes effect on disk
// whether or not it's itself committed.
const VIZ_IGNORES = ["comments.json", "og.auto.png"];
function ensureVizIgnored(dir: string): void {
  const gi = path.join(dir, ".gitignore");
  const existing = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const have = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = VIZ_IGNORES.filter((e) => !have.has(e));
  if (!missing.length) return;
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gi, existing + sep + missing.join("\n") + "\n");
}

function openBrowser(url: string): void {
  try {
    let cmd: string[];
    if (process.platform === "darwin") cmd = ["open", url];
    else if (process.platform === "win32") cmd = ["cmd", "/c", "start", "", url];
    else cmd = ["xdg-open", url];
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", windowsHide: true }).unref();
  } catch {
    // best-effort — never fatal if no browser opener exists
  }
}

// Minimal starter page dropped into a fresh slug dir. It renders immediately (so the
// URL isn't a 404 before you write anything) and — crucially — declares
// viz:posture=local, the safe default: a brand-new viz NEVER publishes until you
// consciously flip it to public/private. Build the viz by EDITING this file; keep the
// viz:posture line (change it only when you mean to share — see SKILL.md Step 4).
function starterHtml(slug: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${slug}</title>
<!-- Publish posture — the SOLE source of truth for build.ts. Default "local" = stays
     on this machine, never published. Change to "public" (open web) or "private"
     (magic-link sealed) ONLY when you intend to share this viz. -->
<meta name="viz:posture" content="local">
<meta name="viz:listed" content="unlisted">
<!-- Kind — what sort of viz this is. "explanatory" (default) = a timeless diagram/illustration;
     freezing it loses nothing. "operational" = a live-monitoring tool whose truth has a shelf
     life (queues, run status, live metrics); a frozen copy is an illustration, NOT current state.
     The only effect: an "operational" viz shows a louder banner when viewed frozen, and an
     "Operational" badge on the published index. Set it to "operational" by hand when it fits. -->
<meta name="viz:kind" content="explanatory">
<meta name="viz:title" content="${slug}">
<meta name="viz:description" content="">
<!-- Spoilers — opt-in. Uncomment to blur this viz's hero image AND blurb on the public
     index until a viewer clicks the card to reveal (the title stays visible). Lets you write
     an honest, spoiler-full hero/description without spoiling anyone browsing the lobby.
     (Does NOT affect the OG unfurl — a shared link still previews the full hero.) -->
<!-- <meta name="viz:spoiler" content="true"> -->
<!-- Safe defaults on BOTH axes: local = never published; unlisted = off the index even once
     published (still reachable by direct URL). When you publish, set posture to public/private,
     and set listed to "listed" to advertise it on the public index. -->
<link rel="stylesheet" href="/_kit/viz-kit.css">
</head>
<body>
  <div class="viz-header">
    <h1>${slug}</h1>
    <div class="sub">Scaffolded by /viz — replace this with your visualization.</div>
  </div>

  <script type="module">
    // The kit's helpers. Delete what you don't use — but SKIM THIS LIST FIRST: if a
    // name here sounds like what you're about to hand-roll, it is, and the kit
    // version already handles the edge cases yours won't.
    import {
      arrowMarkers, connect, center, side, labelBox, vizAudit, // SVG diagrams
      stepper, twoAxis, figureLifecycle,                       // interaction
      $, $$, esc, saveHash, loadHash,                          // utilities
    } from "/_kit/viz.js";
    // Full reference: /_kit/README.md
  </script>
</body>
</html>
`;
}

// Self-contained arrow-key slide deck starter (--deck): scale-to-fit 16:9 canvas,
// keyboard nav, reversible per-slide fragments, auto progress bar. Zero external
// assets (fonts via CDN). Lives as an editable HTML file alongside this script.
function deckHtml(slug: string): string {
  return readFileSync(path.join(import.meta.dir, "deck-template.html"), "utf8").replaceAll("__SLUG__", slug);
}

// Self-hero poster starter (--poster): a fixed 1200×630 (1.91:1) .og-card that scales to fit
// the browser and IS its own OG card (viz:card=self) — verify.ts --og clips it straight to
// og.auto.png, no separate hero.html. 1200×630 is the verified cross-platform-safe unfurl size.
// `--poster --dive` swaps in the variant where the card is the TOP of a scrollable
// page rather than the whole of it. Promoted after 6 vizzes hand-copied it
// byte-identically; the layout-box trap it avoids is documented in the template.
function posterHtml(slug: string): string {
  const tpl = dive ? "poster-dive-template.html" : "poster-template.html";
  return readFileSync(path.join(import.meta.dir, tpl), "utf8").replaceAll("__SLUG__", slug);
}

// Hero card starter (--hero): a separate hero.html beside index.html, holding the
// 1200×630 .og-card that verify.ts --og renders and clips into og.auto.png.
//
// This exists because nothing scaffolded a hero before it: 94 hero.html files were
// authored, NONE loaded the kit, and every one was copy-pasted from a sibling —
// which is why the same ~90 lines of card CSS drifted into six variants. Reuse that
// lives in the scaffold gets used; reuse that lives in documentation doesn't.
//
// Not for a --poster viz: that page IS its own card (viz:card=self), so it needs no
// hero.html at all.
function heroHtml(slug: string): string {
  return readFileSync(path.join(import.meta.dir, "hero-template.html"), "utf8").replaceAll("__SLUG__", slug);
}

// ---- --from: fork an existing viz ----

// Minimal meta upsert. Deliberately NOT imported from manage.ts: that would drag in
// build.ts (1700 lines) on every bootstrap just to rewrite three tags.
function setMeta(html: string, name: string, content: string): string {
  const esc = content.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const re = new RegExp(`<meta\\s+name=["']${name}["'][^>]*>`, "i");
  const tag = `<meta name="${name}" content="${esc}">`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace(/<\/head>/i, `${tag}\n</head>`); // no existing tag → add one
}

// Files that belong to the SOURCE viz's identity or are regenerated artifacts —
// never inherited by a fork.
const FORK_SKIP = new Set([
  "comments.json", // review scratch, tied to the original's elements
  "og.auto.png", // regenerated by verify.ts --og
  ".mirror.json", // marks a mirrored-in copy; a fork is not a mirror
  "recordings.json", // the source's captured API tape, possibly with secrets
]);

// Copy a viz dir, then RE-STAMP the copy's identity. The posture reset is the
// load-bearing part: a fork must never inherit `public`. ADR 0006 makes posture the
// one field that never crosses a boundary by inheritance, because access posture is
// a trust decision — the same logic applies to a copy. You opt back in deliberately.
function forkFrom(srcDir: string, destDir: string, newSlug: string): void {
  if (!existsSync(path.join(srcDir, "index.html"))) {
    die(`ERROR: --from ${srcDir} has no index.html — that's not a viz.`);
  }
  if (existsSync(path.join(srcDir, ".mirror.json"))) {
    die(`ERROR: --from ${srcDir} is a mirrored-in copy, not an origin. Fork the origin instead.`);
  }
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (s) => {
      const b = path.basename(s);
      return !FORK_SKIP.has(b) && b !== ".git" && b !== "node_modules";
    },
  });
  const idx = path.join(destDir, "index.html");
  let html = readFileSync(idx, "utf8");
  html = setMeta(html, "viz:posture", "local"); // NEVER inherit public/private
  html = setMeta(html, "viz:listed", "unlisted");
  html = setMeta(html, "viz:title", newSlug);
  html = setMeta(html, "viz:description", "");
  writeFileSync(idx, html);
}

// ---- Resolve where this viz lives ----
let container: string;
let hostRepoRoot: string | null = null; // for the local git-add hint

if (local) {
  let base: string;
  if (localDir) {
    base = path.resolve(expandHome(localDir));
    if (!existsSync(base)) die(`ERROR: --local dir does not exist: ${base}`);
    hostRepoRoot = await gitOut(["rev-parse", "--show-toplevel"], base);
  } else {
    const top = await gitOut(["rev-parse", "--show-toplevel"], process.cwd());
    if (!top) {
      die(
        "ERROR: --local with no dir must be run inside a git repo.\n" +
          "Pass a target dir (`--local <dir>`), or drop --local for a central viz.",
      );
    }
    base = top;
    hostRepoRoot = top;
  }
  container = path.join(base, "viz-pages");
} else {
  container = VIZ_ROOT;
}

const slugDir = path.join(container, slug);
const id = idFor(slugDir);
if (!id) {
  die(
    `ERROR: a viz must live under your home directory (${HOME}).\n` +
      `Target was: ${slugDir}`,
  );
}
const url = `http://127.0.0.1:${PORT}/${id}/`;

// ---- Initialize the central viz repo on first ever run (always — registry lives here) ----
mkdirSync(VIZ_ROOT, { recursive: true });
if (!existsSync(path.join(VIZ_ROOT, ".git"))) {
  await gitCentral(["init", "-q", "-b", "main"]);
  await gitCentral(["commit", "-q", "--allow-empty", "-m", "init viz repo"]);
}
ensureVizIgnored(VIZ_ROOT);

// ---- Ensure the server is running ----
const state = await probePort();
if (state === "foreign") {
  die(
    `ERROR: port ${PORT} is occupied by another process (it isn't the viz server).\n` +
      `Free that port and retry.`,
  );
}
if (state === "free") {
  const proc = Bun.spawn([process.execPath, SERVER_TS], {
    stdin: "ignore",
    stdout: Bun.file(LOG_FILE),
    stderr: Bun.file(LOG_FILE),
    windowsHide: true,
  });
  proc.unref();
  await Bun.write(PID_FILE, String(proc.pid));

  let up = false;
  for (let i = 0; i < 30; i++) {
    if ((await probePort()) === "ours") {
      up = true;
      break;
    }
    await Bun.sleep(100);
  }
  if (!up) die(`ERROR: server failed to start within 3s. See ${LOG_FILE}`);
}

// ---- Create the slug dir; fail loud if it already exists ----
if (existsSync(slugDir)) {
  die(
    `ERROR: viz '${id}' already exists at ${slugDir}\n` +
      `Pick a different name, or delete it to clobber.`,
  );
}
if (from) {
  const srcDir = path.resolve(expandHome(from));
  if (!existsSync(srcDir)) die(`ERROR: --from ${srcDir} does not exist.`);
  if (path.resolve(srcDir) === path.resolve(slugDir)) die(`ERROR: --from source and destination are the same dir.`);
  forkFrom(srcDir, slugDir, slug);
  console.log(`Forked:  ${srcDir}`);
  console.log(`         posture reset to local/unlisted — a fork never inherits public.`);
} else {
  mkdirSync(slugDir, { recursive: true });
  await Bun.write(path.join(slugDir, "index.html"), (deck ? deckHtml : poster ? posterHtml : starterHtml)(slug));
}

// --hero writes a starter hero.html beside it. Meaningless for --poster, whose page
// is already its own card — say so rather than quietly writing a file that would be
// ignored (verify.ts --og prefers hero.html, so it would actually shadow the poster).
if (hero) {
  if (poster) {
    console.log(`Note:    --hero ignored — a --poster viz IS its own OG card (viz:card=self).`);
  } else {
    await Bun.write(path.join(slugDir, "hero.html"), heroHtml(slug));
  }
}

if (local) {
  // Vendor the runtime so the host repo runs standalone, then register the
  // container so it's discoverable without waiting for the next scan.
  const runtimeDir = path.join(container, ".runtime");
  vendorRuntime(import.meta.dir, runtimeDir);
  ensureVizIgnored(container);
  await addContainer(container);
  await pingRefresh();

  const runHint = hostRepoRoot
    ? `bun "${path.join(path.relative(hostRepoRoot, runtimeDir), "server.ts")}"  (run from ${hostRepoRoot})`
    : `bun "${path.join(runtimeDir, "server.ts")}"`;

  console.log(`URL:     ${url}`);
  console.log(`Dir:     ${slugDir}`);
  console.log(`Edit:    index.html is ALREADY scaffolded (posture metas pre-stamped) and printed below — edit it directly; keep the viz:* metas.`);
  console.log(`Run:     ${runHint}  # standalone, no skill needed`);
  console.log(`Mode:    local (host repo owns the git history — we did NOT commit)`);
  if (hostRepoRoot) {
    const relViz = path.relative(hostRepoRoot, slugDir);
    const relRt = path.relative(hostRepoRoot, runtimeDir);
    console.log(`Commit:  cd "${hostRepoRoot}" && git add "${relViz}" "${relRt}"`);
  } else {
    console.log(`Commit:  this dir isn't inside a git repo — commit it (and .runtime/) wherever it belongs.`);
  }
} else {
  // Central viz: record the creation commit in the central repo, as before.
  const sessionId = detectSessionId();
  await gitCentral(["add", slug]);
  await gitCentral([
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    `create viz: ${slug}\n\nSession: ${sessionId}`,
  ]);
  await pingRefresh();
  console.log(`URL:     ${url}`);
  console.log(`Dir:     ${slugDir}`);
  console.log(`Edit:    index.html is ALREADY scaffolded (posture metas pre-stamped) and printed below — edit it directly; keep the viz:* metas.`);
  console.log(`Session: ${sessionId}`);
}

// Dump the starter so the agent can edit it straight away. Printing the bytes here
// costs the same as reading them and saves the round trip; it also means a viz
// scaffolded under a non-Claude-Code agent (no read-before-write guard at all) still
// gets the contract — the posture metas — in front of the author.
if (print && !deck) {
  const body = readFileSync(path.join(slugDir, "index.html"), "utf8");
  console.log(`\n${"─".repeat(70)}\nindex.html (already written — edit it, keep the viz:* metas)\n${"─".repeat(70)}`);
  console.log(body);
  console.log("─".repeat(70));
  if (hero && !poster) console.log(`hero.html also scaffolded — see it with: cat "${path.join(slugDir, "hero.html")}"`);
} else if (deck) {
  console.log(`Print:   deck template not dumped (~4k tokens) — read index.html if you need it verbatim.`);
}

openBrowser(url);

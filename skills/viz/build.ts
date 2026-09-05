#!/usr/bin/env bun
// build.ts — BACK-COMPAT ENTRY POINT for `viz publish` / `preview` / `export` / `rotate`.
//
// This was 1993 lines: StatiCrypt sealing, OG card generation, per-viz publishing, the
// lobby index, mirrors.json validation and push, vendor push, the publishable tree, and
// a static preview server. All of it lives in lib/publish/ now as focused modules, and
// this file is the old CLI's dispatch kept so existing invocations keep working.
//
// It still exports grabMeta and validateMirrors, because manage.ts and server.ts import
// them from here; those now re-export from lib/publish/.
//
// New work goes through `viz <verb>` and lib/publish/. Nothing should be added here.

import { MIRROR_SIDECAR, PLACEHOLDER_HOST } from "./lib/publish/constants.ts";
import { LOBBY_MARKER } from "./lib/publish/lobby.ts";
import { readPosture } from "./lib/publish/meta.ts";
import { pushMirrors, readMirrors } from "./lib/publish/mirrors.ts";
import { openInBrowser, servePreview } from "./lib/publish/preview.ts";
import { publishOne, vizzesIn } from "./lib/publish/publish-one.ts";
import { seal, staticrypt } from "./lib/publish/seal.ts";
import { buildPublishableTree } from "./lib/publish/tree.ts";
import { pushVendors } from "./lib/publish/vendors.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync, renameSync, statSync, watch } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";
import { buildSelfContained, inlineKitCss, type HeadOverrides } from "./inline.ts";
import { getOrCreate, rotate, type KeyEntry } from "./keystore.ts";
import { idFor } from "./discovery.ts";
import { publishReload, reloadSnippet, reloadWebSocket, upgradeReload } from "./kit/reload.ts";
import { parseFlags, str, bool, num, die, emit } from "./cli.ts";

const MIRROR_SIDECAR = ".mirror.json";

const PLACEHOLDER_HOST = "https://YOUR-PAGES-HOST/";


// ---- Argument parsing ----
const argv = process.argv.slice(2);
let out: string | undefined;
let baseUrl: string | undefined;
let noIndex = false;
let indexTitle: string | undefined;
let indexDescription: string | undefined; // lobby OG/unfurl blurb (default: an auto count)
let port: number | undefined; // preview: explicit port (default: an OS-assigned free one)
let open = false; // preview: also open the URL in the OS default browser
let lobbyFlag = false; // rotate: target the container's lobby key (id + "#lobby")
let pushVendorsFlag = false; // publish: also refresh declared vendored copies (ADR 0010)
let noDeployNotice = false; // set by a wrapper (deploy.sh) that pushes right after — its
                            // "NOT DEPLOYED" reminder would be a lie, and reads as a failure.
const BUILD_VALUE_FLAGS = ["out", "base-url", "index-title", "index-description", "port"];
// Only parse argv when we ARE the command. build.ts is also a library — manage.ts and
// server.ts import its helpers — and a library that reads process.argv at module scope
// parses ITS importer's flags. That was invisible while unknown flags fell harmlessly
// into `positional`; adding rejection turned it into `manage.ts update --title` dying
// with "unknown flag --title" from a parser that had no business looking.
const { flags: buildFlags, pos: positional } = import.meta.main
  ? parseFlags(argv, {
      value: BUILD_VALUE_FLAGS,
      known: [...BUILD_VALUE_FLAGS, "no-index", "open", "lobby", "push-vendors", "no-deploy-notice", "json"],
    })
  : { flags: {}, pos: [] as string[] };
out = str(buildFlags, "out") ?? out;
baseUrl = str(buildFlags, "base-url") ?? baseUrl;
indexTitle = str(buildFlags, "index-title") ?? indexTitle;
indexDescription = str(buildFlags, "index-description") ?? indexDescription;
port = num(buildFlags, "port") ?? port;
noIndex = bool(buildFlags, "no-index");
open = bool(buildFlags, "open");
lobbyFlag = bool(buildFlags, "lobby");
pushVendorsFlag = bool(buildFlags, "push-vendors");
noDeployNotice = bool(buildFlags, "no-deploy-notice");


// Re-exported for importers that predate the split (manage.ts, server.ts).
export { grabMeta } from "./lib/publish/meta.ts";
export { validateMirrors } from "./lib/publish/mirrors.ts";
export type { MirrorTarget, MirrorVizEntry, MirrorOverrides, VendorTarget, VendorVizEntry } from "./lib/publish/mirrors.ts";

// ---- Dispatch ----
// Guarded so other tools (manage.ts) can `import` the helpers above without
// triggering the CLI. Runs only when build.ts is the invoked entrypoint.
if (import.meta.main) {
const cmd = positional[0];

if (cmd === "rotate") {
  const target = positional[1];
  if (!target) die("usage: bun build.ts rotate <vizDir>   |   bun build.ts rotate <container> --lobby", 2);
  const abs = path.resolve(target);
  const base = idFor(abs);
  if (!base) die(`ERROR: ${lobbyFlag ? "container" : "viz"} must live under your home directory to be keyed.`);
  if (lobbyFlag) {
    // Rotate the CONTAINER's lobby key (keyed <container>#lobby). Warn — don't refuse —
    // if the container has no _private-lobby marker: the new key is minted but unused
    // until the marker exists, so this is almost always a wrong target.
    if (!existsSync(path.join(abs, LOBBY_MARKER))) {
      console.log(`⚠️  ${abs} has no ${LOBBY_MARKER} marker — it isn't lobby-sealed, so this key won't be used until you add one.`);
    }
    const key = await rotate(base + "#lobby");
    console.log(`Rotated the LOBBY key for '${base}' to version ${key.version}.`);
    console.log(`The previous lobby link AND passphrase are now DEAD. Re-publish + redeploy to mint the new one, then redistribute it.`);
  } else {
    const key = await rotate(base);
    console.log(`Rotated '${base}' to version ${key.version}.`);
    console.log(`The previous share link (and its shim) is now DEAD. Re-publish to mint the new one.`);
  }
  process.exit(0);
}

if (cmd === "preview") {
  // `preview <container>` — build the publishable tree to a THROWAWAY temp dir and serve
  // it locally, so you can see EXACTLY what would publish, right now, on your machine.
  // Side-effect-free: never pushes mirrors into other containers, never deploys.
  const container = path.resolve(positional[1] ?? "");
  if (!positional[1] || !existsSync(container)) {
    die("usage: bun build.ts preview <container> [--port <n>] [--open]", 2);
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    die(`ERROR: --port must be an integer 0–65535 (got "${port}"). Omit it to let the OS pick a free port.`, 2);
  }
  const previewRoot = path.join(os.tmpdir(), "viz-preview", (idFor(container) ?? "site").replace(/[\\/]/g, "_"));
  rmSync(previewRoot, { recursive: true, force: true });
  // Bind BEFORE building so the preview knows its own origin and can seal against it —
  // otherwise `haveHost` is false and no share shim is emitted at all. The server 404s for
  // the few hundred ms until the tree exists, which nothing is watching yet.
  const { server, shareHost, buildDone } = servePreview(container, previewRoot, baseUrl, { noIndex, indexTitle, indexDescription }, port);
  const summary = await buildPublishableTree(container, previewRoot, shareHost, { noIndex, indexTitle, indexDescription });
  buildDone(); // the initial build is finished writing into the container — watch for edits now
  if (summary.empty) {
    server.stop(true);
    console.log("Nothing to preview — every viz in scope is local (or none were found).");
    process.exit(0);
  }
  const url = `http://127.0.0.1:${server.port}/`;
  // Printed LAST on purpose: the self-portrait's /preview endpoint treats this line as
  // "build finished", and parses the lobby key out of everything printed above it.
  console.log(`\n👀 Preview — this is exactly what would publish, served locally (live-reloading):\n\n    ${url}\n`);
  console.log(`Built from: ${container}`);
  console.log(`Temp tree:  ${previewRoot}`);
  console.log(`(throwaway build — nothing committed, no mirrors pushed, NOT deployed)`);
  console.log(`Edits to the container rebuild the publishable tree and reload open tabs.`);
  if (open) {
    openInBrowser(url);
    console.log(`\nOpened in your default browser. Ctrl-C to stop the server.`);
  } else {
    console.log(`\nOpen the URL above (or re-run with --open). Ctrl-C to stop the server.`);
  }
  // Bun.serve keeps the process alive — intentionally no exit, no fall-through.
} else if (cmd === "export") {
  // `export <vizDir>` — build ONE viz (a dev/test primitive); no lobby index, no mirrors.
  const vizDir = path.resolve(positional[1] ?? "");
  if (!positional[1] || !existsSync(path.join(vizDir, "index.html"))) {
    die("usage: bun build.ts export <vizDir>   (vizDir must contain index.html)", 2);
  }
  const posture = readPosture(vizDir);
  if (!posture) {
    die(`ERROR: no viz:posture declared for ${path.basename(vizDir)} — add <meta name="viz:posture" content="public"> (or "private"/"local").`, 2);
  }
  if (posture === "local") {
    console.log(`Skipping ${path.basename(vizDir)} — viz:posture=local, never published.`);
    process.exit(0);
  }
  const outRoot = path.resolve(out ?? path.join(process.cwd(), ".viz-dist"));
  mkdirSync(outRoot, { recursive: true });
  const shareHost = baseUrl ?? PLACEHOLDER_HOST;
  const r = await publishOne(vizDir, outRoot, posture === "private", shareHost);
  console.log(`• ${r.slug} — ${posture === "private" ? "private (sealed)" : "public"}`);
  for (const w of r.warnings) console.log(`    ⚠️  ${w}`);
  if (r.link) console.log(`    🔗 ${r.link}`);
  if (bool(buildFlags, "json")) {
    console.log(JSON.stringify({ mode: "export", outRoot, viz: r.slug, posture, link: r.link ?? null, warnings: r.warnings }, null, 2));
  } else {
    console.log(`\nBuilt to: ${outRoot}`);
    console.log(`\nNOT DEPLOYED. This only built one local artifact.`);
  }
} else {
  // `<container>` — orchestrate the whole container: build the publishable tree, then
  // push mirrors (the only OUTBOUND write) and print the deploy reminder.
  const container = path.resolve(cmd ?? "");
  if (!cmd || !existsSync(container)) {
    die(
      "usage: bun build.ts <container> [--out <dir>] [--base-url <url>] [--no-index] [--index-title <t>] [--index-description <t>]\n" +
        "                                  [--push-vendors]   (also refresh this container's declared vendored copies)\n" +
        "   or: bun build.ts preview <container> [--port <n>] [--open]\n" +
        "   or: bun build.ts export <vizDir>\n" +
        "   or: bun build.ts rotate <vizDir>   (or: rotate <container> --lobby)",
      2,
    );
  }
  const outRoot = path.resolve(out ?? path.join(process.cwd(), ".viz-dist"));
  const shareHost = baseUrl ?? PLACEHOLDER_HOST;

  // Validate mirrors.json NOW — fail-closed (naming offenders) BEFORE any artifact is
  // written, exactly like the undeclared-posture refusal inside buildPublishableTree.
  const children = vizzesIn(container);
  if (children.length === 0) die(`ERROR: no vizzes (child dirs with index.html) in ${container}`);
  const nativeSlugs = new Set(children.filter((d) => !existsSync(path.join(d, MIRROR_SIDECAR))).map((d) => path.basename(d)));
  const { mirrors, vendors } = readMirrors(container, nativeSlugs);

  const summary = await buildPublishableTree(container, outRoot, shareHost, { noIndex, indexTitle, indexDescription });
  if (summary.empty && mirrors.length === 0 && vendors.length === 0) {
    console.log("Nothing to publish — every viz in scope is local (or none were found).");
    process.exit(0);
  }

  if (mirrors.length) await pushMirrors(container, mirrors, shareHost);

  // Vendor push is gated twice over (ADR 0010 §5). Unlike a mirror it writes recursive
  // SOURCE trees — and prunes with rm -rf — into another repo's working tree, so it must
  // never be a side effect of "I ran a build". Opt in explicitly, and never when --out
  // says this run is a throwaway dist someone is inspecting.
  if (vendors.length) {
    if (!pushVendorsFlag) {
      const n = vendors.reduce((a, t) => a + t.vizzes.length, 0);
      console.log(`\n${n} vendored ${n === 1 ? "copy is" : "copies are"} declared but NOT refreshed — re-run with --push-vendors to write them.`);
    } else if (out) {
      console.log(`\nSkipped vendor push: --out is set, so this run is a throwaway dist. Re-run without --out to refresh copies.`);
    } else {
      await pushVendors(container, vendors);
    }
  }

  // --json short-circuits the prose tail (share-link notes, deploy reminders): a
  // program wants the paths and the summary, not the paragraph explaining them.
  if (bool(buildFlags, "json")) {
    console.log(JSON.stringify({ mode: "container", outRoot, container, summary }, null, 2));
    process.exit(0);
  }
  console.log(`\nBuilt to: ${outRoot}`);
  if (summary.anyPrivate) {
    if (baseUrl) {
      console.log(`Share links use base ${shareHost} — the 🔗 above unfurls a preview card and auto-decrypts; share it with the people you want to have access.`);
    } else {
      console.log(
        `NOTE: no --base-url, so private vizzes fell back to a raw #staticrypt_pwd magic link (no\n` +
          `preview-card shim — that needs an absolute host). Re-run with --base-url <url> for shareable shim links.`,
      );
    }
  }
  if (!noDeployNotice) {
    console.log(
      `\nNOT DEPLOYED. This only built local artifacts. Review them, then deploy as a separate,\n` +
        `explicit step (force-push the sealed set to the Pages branch) once you've confirmed.`,
    );
  }
}
} // end import.meta.main

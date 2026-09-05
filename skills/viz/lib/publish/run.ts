// lib/publish/run.ts — the four publish flows, as functions.
//
// These were the four branches of build.ts's `if (import.meta.main)` dispatch: bodies
// that read a dozen module-scope flag variables and could only be reached by running
// the script. As functions `viz publish|preview|export|rotate` calls them in-process.
//
// The bodies are verbatim; bind() re-creates exactly the variable names they used, so
// the move could not change behaviour. Verified by byte-comparing the published output
// of a real container against the pre-decomposition build.

import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { CENTRAL, idFor, allContainers } from "../../discovery.ts";
import { die, bool } from "../../cli.ts";
import { getOrCreate, rotate, peek } from "../../keystore.ts";
import { MIRROR_SIDECAR, PLACEHOLDER_HOST } from "./constants.ts";
import { LOBBY_MARKER, readLobby } from "./lobby.ts";
import { readPosture, readListed } from "./meta.ts";
import { publishOne, vizzesIn } from "./publish-one.ts";
import { buildPublishableTree } from "./tree.ts";
import { servePreview, openInBrowser } from "./preview.ts";
import { readMirrors, pushMirrors } from "./mirrors.ts";
import { pushVendors } from "./vendors.ts";
import { writeLobby } from "./lobby-write.ts";

export type PublishOptions = {
  out?: string;
  baseUrl?: string;
  noIndex?: boolean;
  indexTitle?: string;
  indexDescription?: string;
  pushVendors?: boolean;
  noDeployNotice?: boolean;
  port?: number;
  open?: boolean;
  lobby?: boolean;
  json?: boolean;
};

/** Rebinds exactly the variable names the extracted bodies already used. */
function bind(o: PublishOptions) {
  return {
    out: o.out,
    baseUrl: o.baseUrl,
    noIndex: o.noIndex === true,
    indexTitle: o.indexTitle,
    indexDescription: o.indexDescription,
    pushVendorsFlag: o.pushVendors === true,
    noDeployNotice: o.noDeployNotice === true,
    port: o.port,
    open: o.open === true,
    lobbyFlag: o.lobby === true,
    buildFlags: (o.json ? { json: true } : {}) as Record<string, string | boolean>,
  };
}

export async function rotateKey(arg: string, o: PublishOptions = {}): Promise<void> {
  const { out, baseUrl, noIndex, indexTitle, indexDescription, pushVendorsFlag, noDeployNotice, port, open, lobbyFlag, buildFlags } = bind(o);
  // The dispatch read its target from `positional[1]` for the named verbs, and from
  // `cmd` (positional[0]) for the bare `<container>` form. Bind both to the argument.
  const cmd = arg;
  const positional = ["", arg];
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

export async function previewContainer(arg: string, o: PublishOptions = {}): Promise<void> {
  const { out, baseUrl, noIndex, indexTitle, indexDescription, pushVendorsFlag, noDeployNotice, port, open, lobbyFlag, buildFlags } = bind(o);
  // The dispatch read its target from `positional[1]` for the named verbs, and from
  // `cmd` (positional[0]) for the bare `<container>` form. Bind both to the argument.
  const cmd = arg;
  const positional = ["", arg];
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
}

export async function exportViz(arg: string, o: PublishOptions = {}): Promise<void> {
  const { out, baseUrl, noIndex, indexTitle, indexDescription, pushVendorsFlag, noDeployNotice, port, open, lobbyFlag, buildFlags } = bind(o);
  // The dispatch read its target from `positional[1]` for the named verbs, and from
  // `cmd` (positional[0]) for the bare `<container>` form. Bind both to the argument.
  const cmd = arg;
  const positional = ["", arg];
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
    // Under --json these go to stderr: the warnings still matter to a human watching,
    // but stdout has to stay parseable. The same discipline bootstrap needed.
    const say = bool(buildFlags, "json") ? (s: string) => console.error(s) : (s: string) => console.log(s);
    say(`• ${r.slug} — ${posture === "private" ? "private (sealed)" : "public"}`);
    for (const w of r.warnings) say(`    ⚠️  ${w}`);
    if (r.link) say(`    🔗 ${r.link}`);
    if (bool(buildFlags, "json")) {
      console.log(JSON.stringify({ mode: "export", outRoot, viz: r.slug, posture, link: r.link ?? null, warnings: r.warnings }, null, 2));
    } else {
      console.log(`\nBuilt to: ${outRoot}`);
      console.log(`\nNOT DEPLOYED. This only built one local artifact.`);
    }
}

export async function publishContainer(arg: string, o: PublishOptions = {}): Promise<void> {
  const { out, baseUrl, noIndex, indexTitle, indexDescription, pushVendorsFlag, noDeployNotice, port, open, lobbyFlag, buildFlags } = bind(o);
  // The dispatch read its target from `positional[1]` for the named verbs, and from
  // `cmd` (positional[0]) for the bare `<container>` form. Bind both to the argument.
  const cmd = arg;
  const positional = ["", arg];
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

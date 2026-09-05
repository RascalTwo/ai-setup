// commands/publish.ts — getting a viz off localhost.
//
// EXTRACTED: calls lib/publish/run.ts directly. deploy-all and sync-runtimes still
// bridge — both are standalone single-purpose scripts with nothing to gain from being
// imported, and neither is called mid-task by an agent.

import type { Command } from "commander";
import { meta } from "../lib/cli-meta.ts";
import { bridge, toArgv } from "../lib/bridge.ts";
import { publishContainer, previewContainer, exportViz, rotateKey } from "../lib/publish/run.ts";

export function registerPublish(program: Command): void {
  program
    .command("publish <container>")
    .description("build a container's vizzes as self-contained HTML any static host can serve")
    .addHelpText("after", `
Posture decides what ships: 'local' vizzes are skipped, 'private' ones are sealed with
StatiCrypt. An api-backed viz needs a recorded tape first, or it ships frozen behind a
snapshot banner. This BUILDS — it does not deploy.`)
    .option("--out <dir>", "output directory")
    .option("--base-url <url>", "absolute host the site will be served from")
    .option("--no-index", "skip generating the lobby index")
    .option("--index-title <title>", "lobby title")
    .option("--index-description <desc>", "lobby description")
    .option("--push-vendors", "also refresh declared vendored copies")
    .option("--no-deploy-notice", "suppress the NOT DEPLOYED reminder (for deploy.sh wrappers)")
    .option("--json", "machine-readable output")
    .action(async (container, o) =>
      publishContainer(container, {
        out: o.out, baseUrl: o.baseUrl, noIndex: o.index === false,
        indexTitle: o.indexTitle, indexDescription: o.indexDescription,
        pushVendors: o.pushVendors === true, noDeployNotice: o.deployNotice === false,
        json: o.json === true,
      }));
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" },
    examples: `
  viz publish ~/.claude/viz-pages --base-url https://you.github.io/site/
      Posture decides what ships: 'local' vizzes are skipped, 'private' ones are
      sealed. This BUILDS — it does not deploy.

  viz publish <container> --push-vendors
      Also refresh declared vendored copies in other repos.`,
  });

  program
    .command("preview <container>")
    .description("serve a built container locally to check it before deploying")
    .option("--port <n>", "port to serve on", (v) => Number(v))
    .option("--open", "open a browser")
    .option("--base-url <url>", "absolute host for share links")
    .option("--no-index", "skip the lobby index")
    .action(async (container, o) =>
      previewContainer(container, { port: o.port, open: o.open === true, baseUrl: o.baseUrl, noIndex: o.index === false }));
  meta(program.commands.at(-1)!, {
    mcp: { kind: "hidden", why: "starts a server and never returns — an MCP tool call would hang until timeout" },
  });

  program
    .command("export <viz-dir>")
    .description("build ONE viz to a standalone HTML file")
    .option("--out <dir>", "output directory")
    .option("--base-url <url>", "absolute host for share links")
    .option("--json", "machine-readable output")
    .action(async (dir, o) => exportViz(dir, { out: o.out, baseUrl: o.baseUrl, json: o.json === true }));
  meta(program.commands.at(-1)!, { mcp: { kind: "tool" } });

  program
    .command("rotate <target>")
    .description("rotate a private viz's key — kills every existing share link")
    .addHelpText("after", `
The previous link AND passphrase die immediately. Re-publish and redeploy to mint the
new one, then redistribute it. --lobby rotates a container's lobby key instead.`)
    .option("--lobby", "rotate the container's lobby key")
    .action(async (target, o) => rotateKey(target, { lobby: o.lobby === true }));
  meta(program.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" },
    examples: `
  viz rotate <viz-dir>
      The previous share link AND passphrase die immediately. Re-publish and
      redeploy to mint the new one, then redistribute it.

  viz rotate <container> --lobby
      Rotates the container's LOBBY key instead — revokes access to the whole site.`,
  });

  program
    .command("deploy-all")
    .description("run every discovered container's own deploy.sh")
    .action(async () => bridge("deploy-all.ts", []));
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" } });

  program
    .command("sync-runtimes")
    .description("re-stamp vendored viz-pages/.runtime/ copies from this skill")
    .option("--dry-run", "report what would change, write nothing")
    .action(async (opts) => bridge("sync-runtimes.ts", toArgv([], opts)));
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" } });
}

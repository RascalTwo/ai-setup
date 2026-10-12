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
    .addHelpText(
      "after",
      `
Posture decides what ships: 'local' vizzes are skipped, 'private' ones are sealed with
StatiCrypt. An api-backed viz needs a recorded tape first, or it ships frozen behind a
snapshot banner. This BUILDS — it does not deploy.`,
    )
    .option("--out <dir>", "output directory")
    .option("--base-url <url>", "absolute host the site will be served from")
    .option("--no-index", "skip generating the lobby index")
    .option("--index-title <title>", "lobby title")
    .option("--index-description <desc>", "lobby description")
    .option("--push-vendors", "also refresh declared vendored copies")
    .option("--no-deploy-notice", "suppress the NOT DEPLOYED reminder (for deploy.sh wrappers)")
    .option(
      "--no-og",
      "skip auto-rendering missing/stale og.auto.png cards (launches headless Chrome per viz)",
    )
    .option("--json", "machine-readable output")
    .action(
      async (
        container: string,
        o: {
          out?: string;
          baseUrl?: string;
          index?: boolean;
          indexTitle?: string;
          indexDescription?: string;
          pushVendors?: boolean;
          deployNotice?: boolean;
          json?: boolean;
          og?: boolean;
        },
      ) => {
        await publishContainer(container, {
          ...(o.out !== undefined && { out: o.out }),
          ...(o.baseUrl !== undefined && { baseUrl: o.baseUrl }),
          noIndex: o.index === false,
          ...(o.indexTitle !== undefined && { indexTitle: o.indexTitle }),
          ...(o.indexDescription !== undefined && { indexDescription: o.indexDescription }),
          pushVendors: o.pushVendors === true,
          noDeployNotice: o.deployNotice === false,
          json: o.json === true,
          noOg: o.og === false,
        });
      },
    );
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" },
    ui: {
      kind: "cli-only",
      why: "builds artifacts to a dist dir the author then inspects; the UI covers look-before-you-ship with preview",
    },
    examples: `
  viz publish ~/.agents/state/viz --base-url https://you.github.io/site/
      Posture decides what ships: 'local' vizzes are skipped, 'private' ones are
      sealed. This BUILDS — it does not deploy.

  viz publish <container> --push-vendors
      Also refresh declared vendored copies in other repos.`,
  });

  program
    .command("preview <container>")
    .description("serve a built container locally to check it before deploying")
    .option("--port <n>", "port to serve on", Number)
    .option("--open", "open a browser")
    .option("--base-url <url>", "absolute host for share links")
    .option("--no-index", "skip the lobby index")
    .option(
      "--no-og",
      "skip auto-rendering missing/stale og.auto.png cards (launches headless Chrome per viz)",
    )
    .action(
      async (
        container: string,
        o: { port?: number; open?: boolean; baseUrl?: string; index?: boolean; og?: boolean },
      ) => {
        await previewContainer(container, {
          ...(o.port !== undefined && { port: o.port }),
          open: o.open === true,
          ...(o.baseUrl !== undefined && { baseUrl: o.baseUrl }),
          noIndex: o.index === false,
          noOg: o.og === false,
        });
      },
    );
  meta(program.commands.at(-1)!, {
    mcp: {
      kind: "hidden",
      why: "starts a server and never returns — an MCP tool call would hang until timeout",
    },
    ui: { kind: "drawer" },
  });

  program
    .command("export <viz-dir>")
    .description("build ONE viz to a standalone HTML file")
    .option("--out <dir>", "output directory")
    .option("--base-url <url>", "absolute host for share links")
    .option("--json", "machine-readable output")
    .option(
      "--no-og",
      "skip auto-rendering missing/stale og.auto.png cards (launches headless Chrome per viz)",
    )
    .action(
      async (dir: string, o: { out?: string; baseUrl?: string; json?: boolean; og?: boolean }) => {
        await exportViz(dir, {
          ...(o.out !== undefined && { out: o.out }),
          ...(o.baseUrl !== undefined && { baseUrl: o.baseUrl }),
          json: o.json === true,
          noOg: o.og === false,
        });
      },
    );
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" },
    ui: {
      kind: "cli-only",
      why: "builds one viz to a file the author then inspects; the UI covers look-before-you-ship with preview",
    },
    examples: `
  viz export viz-pages/q3-report --out /tmp/q3
      One viz as self-contained HTML, sealed if its posture is private. No lobby,
      no mirrors, not deployed — a local artifact to inspect or hand over.`,
  });

  program
    .command("rotate <target>")
    .description("rotate a private viz's key — kills every existing share link")
    .addHelpText(
      "after",
      `
The previous link AND passphrase die immediately. Re-publish and redeploy to mint the
new one, then redistribute it. --lobby rotates a container's lobby key instead.`,
    )
    .option("--lobby", "rotate the container's lobby key")
    .option("--break-links", "go ahead even though a linked viz's magic link will die (ADR 0016)")
    .action(async (target: string, o: { lobby?: boolean; breakLinks?: boolean }) => {
      await rotateKey(target, { lobby: o.lobby === true, breakLinks: o.breakLinks === true });
    });
  meta(program.commands.at(-1)!, {
    // Only `--lobby` is in the UI (the lobby-key panel); rotating one viz's key stays in the terminal.
    mcp: { kind: "grouped", group: "manage" },
    ui: { kind: "drawer" },
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
    .action(async () => {
      await bridge("deploy-all.ts", []);
    });
  meta(program.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" },
    ui: {
      kind: "cli-only",
      why: "pushes to the open internet across every container — a deliberate, typed, human-confirmed act; one click is too cheap",
    },
  });

  program
    .command("sync-runtimes")
    .description("re-stamp vendored viz-pages/.runtime/ copies from this skill")
    .option("--dry-run", "report what would change, write nothing")
    .action(async (opts: { dryRun?: boolean }) => {
      await bridge("sync-runtimes.ts", toArgv([], opts));
    });
  meta(program.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" },
    ui: {
      kind: "cli-only",
      why: "writes into other people's repos and leaves diffs to review there; the server already runs it on every start",
    },
  });
}

// commands/library.ts — the verbs that operate on the corpus of vizzes.
//
// EXTRACTED: these call lib/library/ directly. No subprocess, no bridge. A command's
// job here is to declare the interface, resolve the target, and hand the result to the
// commit helper — the work itself lives in the lib module named for it.

import type { Command } from "commander";
import { meta } from "../lib/cli-meta.ts";
import path from "node:path";
import { resolveViz } from "../lib/library/viz.ts";
import { maybeCommit } from "../lib/library/git.ts";
import { cmdLs, cmdSearch } from "../lib/library/list.ts";
import { cmdMove } from "../lib/library/move.ts";
import { cmdDelete } from "../lib/library/delete.ts";
import { cmdUpdate } from "../lib/library/update.ts";
import { cmdHistory, cmdRollback } from "../lib/library/history.ts";
import { cmdMirror } from "../lib/library/mirror.ts";
import { cmdVendor, cmdVendorRm, cmdVendorLs, cmdVendorSync } from "../lib/library/vendor.ts";
import { cmdVendorCheck, installVendorGuard } from "../lib/library/vendor-guard.ts";

/** Commander models `--no-commit` as `commit: false`; the lib takes a boolean. */
const noCommit = (opts: Record<string, unknown>) => opts.commit === false;

/** The lib functions predate Commander and take a flags record. Adapt, don't rewrite. */
const asFlags = (opts: Record<string, unknown>): Record<string, string | boolean> => {
  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (k === "commit") continue;
    if (typeof v === "string" || typeof v === "boolean") out[k] = v;
  }
  return out;
};

export function registerLibrary(program: Command): void {
  program
    .command("ls")
    .description("list vizzes, newest first")
    .option("--posture <posture>", "filter by posture (local, public, private)")
    .option("--listed <listed>", "filter by listing state")
    .option("--central", "central library only")
    .option("--local", "repo-local vizzes only")
    .option("--json", "machine-readable output")
    .action((opts) => cmdLs(asFlags(opts)));
  meta(program.commands.at(-1)!, { mcp: { kind: "tool" } });

  program
    .command("search <term>")
    .description("search path, title, description, tags AND page source")
    .addHelpText("after", `
Searches page source, not just metadata — it finds the viz that DREW a Sankey even if
its title never says so. Worth running before creating something new.`)
    .option("--json", "machine-readable output")
    .action((term, opts) => cmdSearch(term, asFlags(opts)));
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" },
    examples: `
  viz search sankey
      Searches page SOURCE, not just metadata — finds the viz that DREW a Sankey
      even if its title never says so. Worth running before creating something new;
      forking a solved layout beats rebuilding one.`,
  });

  program
    .command("move <viz-dir> <dest>")
    .description("rename a viz or move it to another container")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, dest, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdMove(viz, dest), noCommit(opts), `viz: move ${viz.slug} → ${path.basename(path.resolve(dest))}`);
    });
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" } });

  program
    .command("delete <viz-dir>")
    .description("remove a viz")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdDelete(viz), noCommit(opts), `viz: delete ${viz.slug}`);
    });
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" } });

  program
    .command("update <viz-dir>")
    .description("set posture, listing, triage, title, description or tags")
    .addHelpText("after", `
Posture is a trust decision: 'local' never publishes, 'public' does, 'private' publishes
sealed. A fork always resets to local/unlisted — posture is never inherited.`)
    .option("--posture <posture>", "local | public | private")
    .option("--listed <listed>", "listed | unlisted")
    .option("--triaged <triaged>", "triage state")
    .option("--title <title>", "human title")
    .option("--description <description>", "one-line description")
    .option("--tags <tags>", "comma-separated tags")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdUpdate(viz, asFlags(opts)), noCommit(opts), `viz: update ${viz.slug}`);
    });
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" } });

  program
    .command("history <viz-dir>")
    .description("per-viz git log, central or repo-local")
    .option("--n <count>", "how many commits to show", "20")
    .action((dir, opts) => cmdHistory(resolveViz(dir), asFlags(opts)));
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" } });

  program
    .command("rollback <viz-dir> <commit-hash>")
    .description("restore a viz to an earlier commit")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, hash, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdRollback(viz, hash), noCommit(opts), `viz: rollback ${viz.slug} to ${hash}`);
    });
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" } });
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" } });

  const mirror = program.command("mirror").description("declare where a viz is projected to");
  meta(mirror, { mcp: { kind: "grouped", group: "manage" } });
  for (const sub of ["ls", "add", "update", "rm"] as const) {
    mirror
      .command(`${sub} <viz-dir>`)
      .description(`${sub} a mirror declaration`)
      .option("--to <container>", "target viz-pages container")
      .option("--access <access>", "public | private")
      .option("--no-commit", "keep the filesystem change, skip the auto-commit")
      .action((dir, opts) => {
        const viz = resolveViz(dir);
        const touched = cmdMirror(sub, viz, asFlags(opts));
        if (touched) maybeCommit(touched, noCommit(opts), `viz: mirror ${sub} ${viz.slug}`);
      });
  }

  const vendor = program.command("vendor").description("full standalone copies of a viz in another container");
  meta(vendor, { mcp: { kind: "grouped", group: "manage" } });
  vendor
    .command("add <viz-dir>")
    .description("declare the edge and write a self-contained copy")
    .requiredOption("--to <container>", "target viz-pages container")
    .option("--access <access>", "public | private")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdVendor(viz, opts.to, asFlags(opts)), noCommit(opts), `viz: vendor ${viz.slug} (full self-contained copy)`);
    });
  vendor
    .command("rm <viz-dir>")
    .description("undeclare; the copy is pruned on the next --push-vendors")
    .requiredOption("--to <container>", "target viz-pages container")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdVendorRm(viz, opts.to), noCommit(opts), `viz: vendor-rm ${viz.slug}`);
    });
  vendor.command("ls <viz-dir>").description("show this viz's vendor declarations").action((dir) => cmdVendorLs(resolveViz(dir)));
  vendor
    .command("sync <vendored-viz-dir>")
    .description("re-pull a vendored copy from its origin")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdVendorSync(viz), noCommit(opts), `viz: vendor-sync ${viz.slug}`);
    });
  vendor
    .command("check [dir]")
    .description("fail if a vendored copy has drifted from its origin")
    .option("--staged", "check only staged files")
    .action((dir, opts) => process.exit(cmdVendorCheck(dir ? path.resolve(dir) : process.cwd(), opts.staged === true) > 0 ? 1 : 0));
  vendor
    .command("guard [repo]")
    .description("install the drift-blocking pre-commit hook")
    .action((repo) => installVendorGuard(repo ? path.resolve(repo) : null));
}

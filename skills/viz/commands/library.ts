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
import { cmdTemplates } from "../lib/library/templates.ts";
import { cmdMove } from "../lib/library/move.ts";
import { cmdDelete } from "../lib/library/delete.ts";
import { cmdUpdate } from "../lib/library/update.ts";
import { cmdHistory, cmdRollback } from "../lib/library/history.ts";
import { cmdFeedback } from "../lib/library/feedback.ts";
import { cmdMirror } from "../lib/library/mirror.ts";
import { cmdVendor, cmdVendorRm, cmdVendorLs, cmdVendorSync } from "../lib/library/vendor.ts";
import { cmdVendorCheck, installVendorGuard } from "../lib/library/vendor-guard.ts";

/** Commander models `--no-commit` as `commit: false`; the lib takes a boolean. */
const noCommit = (opts: Record<string, unknown>) => opts.commit === false;

/** The lib functions predate Commander and take a flags record. Adapt, don't rewrite. */
const asFlags = (opts: Record<string, unknown>): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (k === "commit") continue;
    // Commander camelCases `--break-links` → breakLinks; the lib reads the flag as typed.
    const flag = k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    if (typeof v === "string" || typeof v === "boolean" || Array.isArray(v)) out[flag] = v;
  }
  return out;
};

const BREAK_LINKS = "go ahead even though the viz is linked and its URL will break (ADR 0016)";
/** A repeatable value flag: each occurrence appends. */
const collect = (v: string, prev: string[] = []) => [...prev, v];

export function registerLibrary(program: Command): void {
  program
    .command("ls")
    .description("list vizzes, newest first")
    .option("--posture <posture>", "filter by posture (local, public, private)")
    .option("--listed <listed>", "filter by listing state")
    .option("--approved <state>", "filter by approval: approved | stale | never (ADR 0015)")
    .option("--card-public <state>", "filter by card review: public | not-public | stale | unreviewed (ADR 0018)")
    .option("--central", "central library only")
    .option("--local", "repo-local vizzes only")
    .option("--all", "include vizzes with a hidden tag (viz.config.json hiddenTags, ADR 0020)")
    .option("--json", "machine-readable output")
    .action((opts) => cmdLs(asFlags(opts)));
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" }, ui: { kind: "shown", how: "the dashboard IS this listing — it reads /slugs" },
    examples: `
  viz ls --posture public --approved stale
      Public vizzes edited since they were approved — the deploy gate will refuse
      these until a human re-approves (viz update <dir> --approved true).

  viz ls --card-public stale --json
      Cards whose title, description or hero changed since review; they get no
      /share/ page until re-reviewed.`,
  });

  program
    .command("search <term>")
    .description("search path, title, description, tags AND page source")
    .addHelpText("after", `
Searches page source, not just metadata — it finds the viz that DREW a Sankey even if
its title never says so. Worth running before creating something new.`)
    .option("--all", "include vizzes with a hidden tag (viz.config.json hiddenTags, ADR 0020)")
    .option("--json", "machine-readable output")
    .action((term, opts) => cmdSearch(term, asFlags(opts)));
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" }, ui: { kind: "shown", how: "the dashboard search box filters /slugs client-side (metadata only — the CLI also greps page source)" },
    examples: `
  viz search sankey
      Searches page SOURCE, not just metadata — finds the viz that DREW a Sankey
      even if its title never says so. Worth running before creating something new;
      forking a solved layout beats rebuilding one.`,
  });

  program
    .command("templates [kind]")
    .description("list templates — vizzes a new one can start from (viz create --from <name>)")
    .addHelpText("after", `
A template is any viz with <meta name="viz:template" content="<kind>">. The built-ins
(deck, poster, poster-dive, exchange) ship with the skill; more can live in the central
library or any repo's viz-pages/. More than one of the kind you need? Ask which.`)
    .option("--json", "machine-readable output")
    .action(async (kind, opts) => await cmdTemplates(kind, asFlags(opts)));
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" }, ui: { kind: "shown", how: "/slugs carries each viz's template kind; the badge offers new-from-this (create --from)" },
    examples: `
  viz templates deck
      Every deck template. Then: viz create q3-talk --from <name>`,
  });

  program
    .command("move <viz-dir> <dest>")
    .description("rename a viz or move it to another container")
    .option("--break-links", BREAK_LINKS)
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, dest, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdMove(viz, dest, opts.breakLinks === true), noCommit(opts), `viz: move ${viz.slug} → ${path.basename(path.resolve(dest))}`);
    });
  meta(program.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" },
    examples: `
  viz move viz-pages/q3-report viz-pages/q3-revenue
      Rename in place. A linked viz (viz update --linked-from) refuses: its URL
      would break. Add --break-links once whoever links to it has been told.`,
  });

  program
    .command("delete <viz-dir>")
    .description("remove a viz")
    .option("--break-links", BREAK_LINKS)
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdDelete(viz, opts.breakLinks === true), noCommit(opts), `viz: delete ${viz.slug}`);
    });
  meta(program.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" },
    examples: `
  viz delete viz-pages/old-draft
      Removed, and auto-committed when its container is a git repo (--no-commit to skip).

  viz delete viz-pages/q3-report --break-links
      It is linked from somewhere; delete anyway, knowing that link will 404.`,
  });

  program
    .command("update <viz-dir>")
    .description("set posture, listing, triage, title, description, tags, linked-from or card-public")
    .addHelpText("after", `
Posture is a trust decision: 'local' never publishes, 'public' does, 'private' publishes
sealed. A fork always resets to local/unlisted — posture is never inherited.

A viz with any --linked-from entry is LINKED: move, delete, rotate and posture changes
refuse without --break-links, because something outside points at its URL (ADR 0016).

--card-public true marks this viz's CARD (slug, title, description, hero image) safe for
the open internet: a public-posture viz then gets an unfurlable share page at
/share/<slug>/ when built with --base-url. --card-public false records "reviewed,
not public". Both store a fingerprint of the card, so any change to it makes it stale until re-reviewed. Needs a designed hero (og.png/og.jpg, or
og.auto.png rendered from hero.html); a page screenshot refuses (ADR 0018).`)
    .option("--posture <posture>", "local | public | private")
    .option("--listed <listed>", "listed | unlisted")
    .option("--approved <approved>", "true|false — true stamps a hash of THIS version (ADR 0015)")
    .option("--card-public <bool>", "true|false — records a review of THIS card (fingerprinted); true gives a public viz /share/<slug>/ (ADR 0018)")
    .option("--title <title>", "human title")
    .option("--description <description>", "one-line description")
    .option("--tags <tags>", "comma-separated tags")
    .option("--linked-from <text>", "add where this viz's URL is linked from (free text, repeatable)", collect)
    .option("--unlinked-from <text>", "remove one linked-from entry (exact text, repeatable)", collect)
    .option("--break-links", BREAK_LINKS)
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdUpdate(viz, asFlags(opts)), noCommit(opts), `viz: update ${viz.slug}`);
    });
  meta(program.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" },
    examples: `
  viz update viz-pages/q3-report --approved true
      Approve THIS version for publishing. Any later edit makes it stale.

  viz update viz-pages/q3-report --card-public true
      The card (title, description, hero) is safe on the open internet; a public
      viz then gets /share/q3-report/ when published with --base-url. Refuses
      without a designed hero (og.png, or hero.html + viz verify --og).

  viz update viz-pages/q3-report --linked-from "Q3 all-hands deck, slide 4"
      Record where its URL lives. Move/delete/rotate now refuse without --break-links.

  viz update viz-pages/q3-report --title "Q3 revenue" --tags finance,quarterly`,
  });

  program
    .command("history <viz-dir>")
    .description("per-viz git log, central or repo-local")
    .option("--n <count>", "how many commits to show", "20")
    .option("--json", "machine-readable output: [{hash, date (ISO 8601), subject}]")
    .action((dir, opts) => cmdHistory(resolveViz(dir), asFlags(opts)));
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" } });

  program
    .command("feedback <viz-dir>")
    .description("what the user said or typed on a live viz (the feedback widget), and mark it done")
    .option("--detail", "add pointer position, window size, scroll, #hash and selectors per line")
    .option("--resolve <ids>", "mark lines done (comma-separated ids, or \"all\"); they turn green on the page")
    .option("--note <text>", "with --resolve: one line on what you changed, shown under each line")
    .option("--clear", "remove every line from the page (the log keeps them) — grill-me-viz, after reading a round")
    .option("--json", "machine-readable output: {lines: [{id, type, text, anchor, where, at, done, note}], picks, sends}")
    .action((dir, opts) => cmdFeedback(resolveViz(dir), asFlags(opts)));
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" },
    ui: { kind: "cli-only", why: "the widget on the viz page itself is where feedback is shown and given; the self-portrait lists vizzes, not what was said about them" },
    examples: `
  viz feedback ~/.agents/state/viz/grill-my-topic
      The lines on the page, grouped by what they're anchored to, with their ids.

  viz feedback ~/.agents/state/viz/grill-my-topic --detail
      Also where the pointer was: position, window size, scroll, #hash, exact element.

  viz feedback viz-pages/q3-report --resolve a1b2c3d4,e5f6g7h8 --note "axis starts at zero now"

  until grep -q '"type":"send"' <viz-dir>/.viz-data/feedback.jsonl; do sleep 1; done
      Wait for the user's Send (run it in the background).`,
  });

  program
    .command("rollback <viz-dir> <commit-hash>")
    .description("restore a viz to an earlier commit")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, hash, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdRollback(viz, hash), noCommit(opts), `viz: rollback ${viz.slug} to ${hash}`);
    });
  meta(program.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" } });

  const mirror = program.command("mirror").description("declare where a viz is projected to");
  meta(mirror, { mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" } });
  // Each sub gets only the flags lib/library/mirror.ts actually reads for it. They used to
  // share one stamped set, so `ls` advertised --access/--no-commit it ignored and `update`
  // could not reach the per-mirror overrides the legacy `manage.ts mirror` accepted.
  const mirrorAction = (sub: string) => (dir: string, opts: Record<string, unknown>) => {
    const viz = resolveViz(dir);
    const touched = cmdMirror(sub, viz, asFlags(opts));
    if (touched) maybeCommit(touched, noCommit(opts), `viz: mirror ${sub} ${viz.slug}`);
  };
  const NO_COMMIT = "keep the filesystem change, skip the auto-commit";
  mirror.command("ls <viz-dir>").description("show this viz's mirror declarations").action(mirrorAction("ls"));
  // The UI shows declarations by reading mirrors.json itself; only writes cross into the CLI.
  meta(mirror.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" }, ui: { kind: "shown", how: "the drawer's mirror chips read /mirrors (mirrors.json, directly — ADR 0009)" } });
  mirror
    .command("add <viz-dir>")
    .description("mirror this viz into another container (everything but access inherits its meta)")
    .requiredOption("--to <container>", "target viz-pages container")
    .requiredOption("--access <access>", "public | private — never inherited, it's the trust boundary")
    .option("--no-commit", NO_COMMIT)
    .action(mirrorAction("add"));
  meta(mirror.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" },
    examples: `
  viz mirror add viz-pages/q3-report --to ~/code/team-site/viz-pages --access private
      Publish a copy of q3-report from the team site too, sealed there. Access is
      never inherited — it's the trust boundary, so it is always stated.`,
  });
  mirror
    .command("update <viz-dir>")
    .description("change one mirror's access, listing, or card overrides")
    .requiredOption("--to <container>", "which mirror (its target container)")
    .option("--access <access>", "public | private")
    .option("--listed <listed>", "listed | unlisted on the target's lobby")
    .option("--title <title>", "override the title on this mirror only (\"\" clears it)")
    .option("--description <description>", "override the description on this mirror only (\"\" clears it)")
    .option("--tags <tags>", "override the tags on this mirror only (comma-separated; \"\" clears)")
    .option("--no-commit", NO_COMMIT)
    .action(mirrorAction("update"));
  mirror
    .command("rm <viz-dir>")
    .description("remove one mirror declaration")
    .requiredOption("--to <container>", "which mirror (its target container)")
    .option("--no-commit", NO_COMMIT)
    .action(mirrorAction("rm"));

  const vendor = program.command("vendor").description("full standalone copies of a viz in another container");
  meta(vendor, { mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" } });
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
  meta(vendor.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" }, ui: { kind: "drawer" },
    examples: `
  viz vendor add viz-pages/q3-report --to ~/code/team-site/viz-pages --access public
      Write a full standalone copy into the team site's repo, so it builds without
      this one. Refresh later copies with \`viz publish <container> --push-vendors\`.`,
  });
  vendor
    .command("rm <viz-dir>")
    .description("undeclare; the copy is pruned on the next --push-vendors")
    .requiredOption("--to <container>", "target viz-pages container")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdVendorRm(viz, opts.to), noCommit(opts), `viz: vendor rm ${viz.slug}`);
    });
  vendor.command("ls <viz-dir>").description("show this viz's vendor declarations").action((dir) => { cmdVendorLs(resolveViz(dir)); });
  meta(vendor.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" }, ui: { kind: "shown", how: "the drawer's vendored chips read /vendors (mirrors.json, directly — ADR 0009)" } });
  vendor
    .command("sync <vendored-viz-dir>")
    .description("re-pull a vendored copy from its origin")
    .option("--no-commit", "keep the filesystem change, skip the auto-commit")
    .action((dir, opts) => {
      const viz = resolveViz(dir);
      maybeCommit(cmdVendorSync(viz), noCommit(opts), `viz: vendor sync ${viz.slug}`);
    });
  vendor
    .command("check [dir]")
    .description("fail if a vendored copy has drifted from its origin")
    .option("--staged", "check only staged files")
    .action((dir, opts) => process.exit(cmdVendorCheck(dir ? path.resolve(dir) : process.cwd(), opts.staged === true) > 0 ? 1 : 0));
  const SINK_TOOLING = "drift-guard tooling that runs in the SINK repo's pre-commit hook and CI — nothing for the author to click";
  meta(vendor.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" }, ui: { kind: "cli-only", why: SINK_TOOLING } });
  vendor
    .command("guard [repo]")
    .description("install the drift-blocking pre-commit hook")
    .action((repo) => installVendorGuard(repo ? path.resolve(repo) : null));
  meta(vendor.commands.at(-1)!, { mcp: { kind: "grouped", group: "manage" }, ui: { kind: "cli-only", why: SINK_TOOLING } });
}

// commands/create.ts — `viz create <slug>`.

import type { Command } from "commander";
import { createViz } from "../lib/create/create.ts";
import { meta } from "../lib/cli-meta.ts";

export function registerCreate(program: Command): void {
  const cmd = program
    .command("create <slug>")
    .description("scaffold a new viz and make sure the server is up")
    .option("--local [dir]", "create inside a repo's viz-pages/ instead of the central library")
    .option("--global", "force the central library even when run inside a repo")
    .option("--deck", "arrow-key presentation deck")
    .option("--poster", "a page that IS its own 1200x630 share card")
    .option("--poster-dive", "that card on top of a scrollable deep dive (implies --poster)")
    .option("--exchange", "animated actors-and-packets diagram")
    .option("--hero", "add a separate hero.html share card")
    .option("--from <viz-dir>", "fork an existing viz as the starting point")
    .option("--runtime", "also vendor a standalone server into the host repo")
    .option("--quick", "lower the ambition bar for this one")
    .option("--no-print", "do not dump the scaffolded index.html")
    .option("--json", "machine-readable output")
    .action(async (slug: string, opts: Record<string, unknown>) => {
      const dive = opts.posterDive === true;
      await createViz({
        slug,
        local: opts.global === true ? false : opts.local !== undefined,
        localDir: typeof opts.local === "string" ? opts.local : undefined,
        deck: opts.deck === true,
        poster: opts.poster === true || dive,
        dive,
        hero: opts.hero === true,
        exchange: opts.exchange === true,
        from: typeof opts.from === "string" ? opts.from : undefined,
        runtime: opts.runtime === true,
        quick: opts.quick === true,
        print: opts.print !== false,
        jsonMode: opts.json === true,
        flags: opts.json === true ? { json: true } : {},
      });
    });

  meta(cmd, {
    mcp: { kind: "tool" },
    examples: `
  viz create repo-import-graph
      Slug names the THING, not the technology. 'd3-chart' is a bad slug.

  viz create onboarding --deck
      Arrow-key presentation. --poster makes the page its own share card;
      --poster-dive puts that card atop a scrollable deep dive.

  viz create dashboard --local ~/Code/app
      Lives in that repo's viz-pages/ and is committed by you, in that repo.

  viz create v2 --from ~/.claude/viz-pages/v1
      Forks it. A fork ALWAYS resets to local/unlisted — posture is never inherited.`,
  });
}

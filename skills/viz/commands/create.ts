// commands/create.ts — `viz create <slug>`.

import type { Command } from "commander";
import { createViz } from "../lib/create/create.ts";
import { meta } from "../lib/cli-meta.ts";

export function registerCreate(program: Command): void {
  const cmd = program
    .command("create <slug>")
    .description("create a new viz — blank, or a copy of a template — and make sure the server is up")
    .option("--local [dir]", "create inside a repo's viz-pages/ instead of the central library")
    .option("--global", "force the central library even when run inside a repo")
    .option("--hero", "add a separate hero.html share card")
    .option("--from <template|viz-dir>", "start from a template (see `viz templates`) or fork any viz by path")
    .option("--runtime", "also vendor a standalone server into the host repo")
    .option("--quick", "lower the ambition bar for this one")
    .option("--no-print", "do not dump the new index.html")
    .option("--json", "machine-readable output")
    .action(async (slug: string, opts: Record<string, unknown>) => {
      await createViz({
        slug,
        local: opts.global === true ? false : opts.local !== undefined,
        localDir: typeof opts.local === "string" ? opts.local : undefined,
        hero: opts.hero === true,
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

  viz templates deck  →  viz create onboarding --from deck
      Start from a template. \`viz templates\` lists every kind (deck, poster,
      poster-dive, exchange, and any others installed); more than one fits? Ask.

  viz create dashboard --local ~/Code/app
      Lives in that repo's viz-pages/ and is committed by you, in that repo.

  viz create v2 --from ~/.agents/state/viz/v1
      Forks it. A fork ALWAYS resets to local/unlisted — posture is never inherited.`,
  });
}

// commands/insight.ts — read-only views the self-portrait had and the CLI didn't.
//
// Both call the same lib modules the self-portrait's api.ts imports, so the page and the
// terminal cannot disagree about the ranking or about where a container deploys.

import type { Command } from "commander";
import path from "node:path";
import { meta } from "../lib/cli-meta.ts";
import { output, fail } from "../lib/output.ts";
import { currentRanking } from "../lib/library/ranking.ts";
import { deployedBaseUrl, shareLinks } from "../lib/publish/base-url.ts";

export function registerInsight(program: Command): void {
  program
    .command("ranking")
    .description("print the pairwise ranking so far (answered in the self-portrait's Rank tab)")
    .option("--list <id>", "which dimension (default: the current one)")
    .option("--json", "machine-readable output")
    .action(async (opts: { list?: string; json?: boolean }) => {
      const r = await currentRanking(opts.list).catch((e: unknown) =>
        fail(`ERROR: ${e instanceof Error ? e.message : String(e)}`, 2),
      );
      output(opts.json === true, r, () => {
        console.log(
          `${r.name} — ${r.answered} answers, ${r.ranked.length}/${r.total} ranked${r.complete ? "" : " (incomplete — keep answering in the Rank tab)"}\n`,
        );
        for (const x of r.ranked)
          console.log(`${String(x.rank).padStart(4)}. ${x.title}   ${x.vizId}`);
      });
    });
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" },
    ui: { kind: "shown", how: "the Rank tab reads /ranking, which imports lib/library/ranking.ts" },
  });

  program
    .command("urls <container>")
    .description("where a container deploys (its base-url.sh) and its card-public share links")
    .addHelpText(
      "after",
      `
Runs <container>/base-url.sh. Fails closed: a non-zero exit, or stdout that isn't a URL,
is an error — never a link to nowhere.`,
    )
    .option("--json", "machine-readable output")
    .action(async (container: string, opts: { json?: boolean }) => {
      const abs = path.resolve(container);
      const r = await deployedBaseUrl(abs);
      if (!r.ok) {
        if (opts.json === true) console.log(JSON.stringify(r, null, 2));
        fail(`ERROR: ${r.err}`, 1);
      }
      const shares = shareLinks(abs, r.url);
      output(opts.json === true, { url: r.url, shares }, () => {
        console.log(`deploys to → ${r.url}`);
        for (const u of shares) console.log(`🪪 share → ${u}`);
      });
    });
  meta(program.commands.at(-1)!, {
    mcp: { kind: "tool" },
    ui: {
      kind: "shown",
      how: "the deployed-url button reads /base-url, which imports lib/publish/base-url.ts",
    },
  });
}

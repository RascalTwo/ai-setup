// commands/author.ts — `viz verify` and `viz check`, the two "is it right?" commands.

import type { Command } from "commander";
import { bridge } from "../lib/bridge.ts";
import { verifyViz } from "../lib/verify/verify.ts";
import { meta } from "../lib/cli-meta.ts";

export function registerAuthor(program: Command): void {
  const verify = program
    .command("verify <target>")
    .description("render in headless Chrome; report errors, layout problems and density")
    .option("--wait <selector|ms>", "wait for a selector or a delay before capturing")
    .option("--full", "full-page capture rather than viewport")
    .option("--size <WxH>", "viewport size, e.g. 1440x900")
    .option("--og", "also clip the 1200x630 share card to og.auto.png")
    .option("--interactions <file>", "drive a script of interactions and snap extra frames")
    .option("--commit <msg>", "commit the viz if it verifies clean")
    .option("--json", "machine-readable output")
    .action(async (target: string, opts: Record<string, unknown>) => {
      await verifyViz({
        target,
        wait: opts.wait as string | undefined,
        full: opts.full === true,
        og: opts.og === true,
        size: opts.size as string | undefined,
        interactions: opts.interactions as string | undefined,
        commit: opts.commit as string | undefined,
        json: opts.json === true,
      });
    });

  meta(verify, {
    mcp: { kind: "tool" },
    examples: `
  viz verify <url>
      "Done" means this passed, not that the code was written.

  viz verify <url> --wait '.chart' --full
      Wait for a selector, then shoot the whole page rather than the viewport.

  viz verify <url> --interactions verify.interactions.ts
      A plain run only ever sees state 1. If the viz has steps, tabs, drawers or
      hover, drive them — otherwise you have verified its opening frame and
      nothing else.

  viz verify <url> --og
      Clips the 1200x630 share card to og.auto.png.`,
  });

  const check = program
    .command("check <viz-dir>")
    .description("structural check of an exchange viz's content.js")
    .action(async (dir: string) => {
      await bridge("check-exchange.ts", [dir]);
    });

  meta(check, {
    mcp: { kind: "tool" },
    examples: `
  viz check ~/.claude/viz-pages/my-exchange
      Catches what otherwise shows up as a blank page or a stranded arrow: a wire
      pointing at a node that does not exist, a step animating along an undeclared
      wire, a step filling a panel id nobody defined.

      Also the regression gate for /_kit/exchange.js itself — every exchange in the
      corpus shares that runtime, so a change to it must keep this green on all of them.`,
  });
}

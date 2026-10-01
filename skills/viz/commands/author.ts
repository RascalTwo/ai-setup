// commands/author.ts — `viz verify` and `viz check`, the two "is it right?" commands.

import type { Command } from "commander";
import { bridge } from "../lib/bridge.ts";
import { verifyViz } from "../lib/verify/verify.ts";
import { meta } from "../lib/cli-meta.ts";
import { vizDirFor } from "../discovery.ts";
import { PORT } from "../server-control.ts";
import { listPending, decide, serveReview } from "../lib/testing/shots.ts";
import { openBrowser } from "../lib/create/create.ts";

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
    .option("--update-snapshots", "take each changed screenshot as its new baseline")
    .action(async (target: string, opts: Record<string, unknown>) => {
      await verifyViz({
        target,
        ...(opts.wait !== undefined && { wait: opts.wait as string }),
        full: opts.full === true,
        og: opts.og === true,
        ...(opts.size !== undefined && { size: opts.size as string }),
        ...(opts.interactions !== undefined && { interactions: opts.interactions as string }),
        ...(opts.commit !== undefined && { commit: opts.commit as string }),
        json: opts.json === true,
        updateSnapshots: opts.updateSnapshots === true,
      });
    });

  meta(verify, {
    mcp: { kind: "tool" }, ui: { kind: "cli-only", why: "an authoring gate run while writing a viz; screenshots and audit lines belong in the agent's loop, not a dashboard button" },
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

  const shots = program
    .command("shots <target>")
    .description("screenshots waiting for a person: list them, open the review page, approve or reject")
    .option("--open", "serve the review page (side by side, swipe, blend, flicker, diff) until Ctrl-C")
    .option("--approve <name>", "make the pending picture the baseline (a name, or all)")
    .option("--reject <name>", "discard the pending picture (a name, or all)")
    .option("--json", "machine-readable output")
    .action(async (target: string, opts: Record<string, unknown>) => {
      const url = target.includes("://") ? target : `http://127.0.0.1:${PORT}/${target.replace(/^\/+|\/+$/g, "")}/`;
      const dir = vizDirFor(url);
      if (!dir) { console.error(`✗ no viz folder for ${target}`); process.exit(2); }
      for (const [flag, approve] of [["approve", true], ["reject", false]] as const) {
        if (typeof opts[flag] !== "string") continue;
        const done = decide(dir, opts[flag] as string, approve);
        console.log(done.length ? `✓ ${approve ? "approved" : "rejected"}: ${done.join(", ")}` : `· nothing pending matches "${opts[flag]}"`);
        return;
      }
      if (opts.open) {
        const page = serveReview(dir);
        console.log(`review ${listPending(dir).length} screenshot(s): ${page}   (Ctrl-C when done)`);
        if (process.env.VIZ_NO_OPEN !== "1") openBrowser(page);
        return new Promise(() => {}); // the server lives until the process is stopped
      }
      const pending = listPending(dir);
      if (opts.json) return void console.log(JSON.stringify(pending));
      if (!pending.length) return void console.log("· no screenshots waiting");
      for (const p of pending) console.log(`  ${p.kind === "new" ? "new    " : "changed"}  ${p.name}`);
      console.log(`look first: viz shots ${target} --open`);
    });

  meta(shots, {
    mcp: { kind: "tool" },
    ui: { kind: "cli-only", why: "per-viz and per-test-run: the review page it opens is its own UI, reached from verify's failure message" },
    examples: `
  viz shots <viz>
      What's waiting: new pictures and changed ones.

  viz shots <viz> --open
      Look before approving: side by side, swipe at any angle, blend, flicker, and a diff
      that's redder where pixels differ more. A approves, R rejects.

  viz shots <viz> --approve all
      Only after a person has looked — approving is what makes a picture the truth.`,
  });

  const check = program
    .command("check <viz-dir>")
    .description("structural check of an exchange viz's content.ts (or content.js)")
    .action(async (dir: string) => {
      await bridge("check-exchange.ts", [dir]);
    });

  meta(check, {
    mcp: { kind: "tool" }, ui: { kind: "cli-only", why: "an authoring gate run while writing a viz; screenshots and audit lines belong in the agent's loop, not a dashboard button" },
    examples: `
  viz check ~/.agents/state/viz/my-exchange
      Catches what otherwise shows up as a blank page or a stranded arrow: a wire
      pointing at a node that does not exist, a step animating along an undeclared
      wire, a step filling a panel id nobody defined.

      Also the regression gate for /_kit/exchange.js itself — every exchange in the
      corpus shares that runtime, so a change to it must keep this green on all of them.`,
  });
}

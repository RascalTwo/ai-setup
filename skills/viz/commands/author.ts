// commands/author.ts — `viz verify` and `viz check`, the two "is it right?" commands.

import type { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { die } from "../cli.ts";
import { bridge } from "../lib/bridge.ts";
import { targetProblem, targetUrl, verifyViz, type VerifyPart } from "../lib/verify/verify.ts";
import { meta } from "../lib/cli-meta.ts";
import { buildSlugMap, vizDirFor } from "../discovery.ts";
import { PORT } from "../server-control.ts";
import { listPending, decide, serveReview } from "../lib/testing/shots.ts";
// oxlint-disable-next-line import/max-dependencies -- the file that registers the authoring verbs (verify, its jobs, shots, spec, check); each import is one of them
import { openBrowser } from "../lib/create/create.ts";
import { fixViz } from "../lib/lint/fix.ts";
import { writeSpec } from "../lib/testing/spec.ts";
import { verifyDir } from "../lib/verify/state.ts";

const hasTests = (dir: string) =>
  existsSync(path.join(dir, "tests")) &&
  readdirSync(path.join(dir, "tests")).some((f) => /\.test\.(ts|js|mjs|tsx)$/u.test(f));

// Flags are declared once: `verify` takes all of them, and each of its jobs takes the ones it uses.
const OPT = {
  wait: ["--wait <selector|ms>", "wait for a selector or a delay before capturing"],
  full: ["--full", "full-page capture rather than viewport"],
  size: ["--size <WxH>", "viewport size, e.g. 1440x900"],
  og: ["--og", "also clip the 1200x630 share card to og.auto.png"],
  interactions: ["--interactions <file>", "drive a script of interactions and snap extra frames"],
  commit: ["--commit <msg>", "commit the viz if it verifies clean"],
  json: ["--json", "machine-readable output"],
  snapshots: ["--update-snapshots", "take each changed screenshot as its new baseline"],
  fix: [
    "--fix",
    "first move inline <script> code into .ts files, apply Oxlint's safe fixes, then format",
  ],
} as const;
const withOptions = (cmd: Command, ...names: (keyof typeof OPT)[]) => {
  for (const n of names) cmd.option(OPT[n][0], OPT[n][1]);
  return cmd;
};

/** The flags a verify verb can receive (OPT above), as Commander parses them. */
type VerifyOpts = {
  wait?: string;
  full?: boolean;
  og?: boolean;
  size?: string;
  interactions?: string;
  commit?: string;
  json?: boolean;
  updateSnapshots?: boolean;
  fix?: boolean;
};

/** What every verify verb does: run `parts` (all of them, for `verify`). */
const run = (parts?: readonly VerifyPart[]) => async (target: string, opts: VerifyOpts) => {
  const problem = targetProblem(target, parts);
  if (problem) die(problem, 2);
  const dir = opts.fix === true ? vizDirFor(targetUrl(target)) : null;
  if (dir) fixViz(dir);
  await verifyViz({
    target,
    ...(parts && { parts }),
    ...(opts.wait !== undefined && { wait: opts.wait }),
    full: opts.full === true,
    og: opts.og === true,
    ...(opts.size !== undefined && { size: opts.size }),
    ...(opts.interactions !== undefined && { interactions: opts.interactions }),
    ...(opts.commit !== undefined && { commit: opts.commit }),
    json: opts.json === true,
    updateSnapshots: opts.updateSnapshots === true,
  });
};

/** An id, URL or bare slug (`demo-app`) to the viz's folder; exits 2 when there is none or the slug is ambiguous. */
function vizFolder(target: string): string {
  if (!target.includes("/")) {
    const same = [...buildSlugMap().values()].filter((e) => path.basename(e.dir) === target);
    if (same.length > 1) {
      console.error(
        `✗ ${target} is more than one viz; say which:\n  ${same.map((e) => e.id).join("\n  ")}`,
      );
      // oxlint-disable-next-line unicorn/no-process-exit -- CLI verb: exit 2 on an ambiguous target
      process.exit(2);
    }
    if (same[0]) return same[0].dir;
  }
  const url = target.includes("://")
    ? target
    : `http://127.0.0.1:${PORT}/${target.replaceAll(/^\/+|\/+$/gu, "")}/`;
  const dir = vizDirFor(url);
  if (!dir) {
    console.error(`✗ no viz folder for ${target}`);
    // oxlint-disable-next-line unicorn/no-process-exit -- CLI verb: exit 2 on a bad target
    process.exit(2);
  }
  return dir;
}

export function registerAuthor(program: Command): void {
  const verify = withOptions(
    program
      .command("verify <target>")
      .description(
        "run audit, types, test, lint and format: render in headless Chrome and report errors, layout problems and density; check the types; run the viz's tests; lint it; check its formatting",
      ),
    "wait",
    "full",
    "size",
    "og",
    "interactions",
    "commit",
    "json",
    "snapshots",
  ).action(run());

  meta(verify, {
    mcp: { kind: "tool" },
    ui: {
      kind: "cli-only",
      why: "an authoring gate run while writing a viz; screenshots and audit lines belong in the agent's loop, not a dashboard button",
    },
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

  // The jobs verify does in one run, each alone (ADR 0024).
  const cliOnly = {
    kind: "cli-only",
    why: "a part of the verify authoring gate: its output belongs in the agent's loop, not a dashboard button",
  } as const;
  const piece = (
    part: VerifyPart,
    description: string,
    flags: (keyof typeof OPT)[],
    examples: string,
  ) =>
    meta(
      withOptions(
        program.command(`${part} <target>`).description(description),
        ...flags,
        "json",
      ).action(run([part])),
      {
        mcp: { kind: "grouped", group: "manage" },
        ui: cliOnly,
        examples,
      },
    );
  piece(
    "audit",
    "render in headless Chrome; report errors, layout problems and density (no types, no tests)",
    ["wait", "full", "size", "og", "interactions"],
    `
  viz audit <url>
      Just the render: console errors, failed requests, layout findings, the screenshot.
      Everything else in \`viz verify\` is skipped.`,
  );
  piece(
    "types",
    "type-check the viz's TypeScript, strict; needs no browser",
    [],
    `
  viz types <viz>
      Fast, and works with no Chrome. A viz with no TypeScript reports nothing to check.`,
  );
  piece(
    "lint",
    "lint the viz's TypeScript with Oxlint (type-aware); any finding fails verify",
    ["fix"],
    `
  viz lint <viz>
      Every category on except style, with named exceptions that each carry a written reason
      (lib/lint/config.ts). Needs no browser. Any finding fails the run.
      --fix moves inline <script> code into <page>.<n>.ts files and applies Oxlint's safe fixes.`,
  );
  piece(
    "format",
    "check the viz's TypeScript, CSS and HTML are formatted by oxfmt; any unformatted file fails verify",
    ["fix"],
    `
  viz format <viz>
      oxfmt's defaults over the viz's .ts, .css and .html (no browser). Any unformatted file fails the run.
      --fix also moves inline <script> code into .ts files, applies Oxlint's safe fixes, and then writes the formatting.
      Where hand alignment carries meaning, put \`// prettier-ignore\` on the line before the statement, with a
      comment on the line above that saying why: a bare ignore fails the run.`,
  );
  piece(
    "test",
    "run the viz's own tests and coverage floor, and say whether it needs any",
    ["wait", "snapshots"],
    `
  viz test <viz>
      Opens the page once, only to see whether it takes input or calls live data (which is
      what makes tests mandatory), then runs tests/*.test.ts and the coverage floor.`,
  );

  const shots = program
    .command("shots <target>")
    .description(
      "screenshots waiting for a person: list them, open the review page, approve or reject",
    )
    .option(
      "--open",
      "serve the review page (side by side, swipe, blend, flicker, diff) until Ctrl-C",
    )
    .option("--approve <name>", "make the pending picture the baseline (a name, or all)")
    .option("--reject <name>", "discard the pending picture (a name, or all)")
    .option("--json", "machine-readable output")
    .action(
      async (
        target: string,
        opts: { open?: boolean; approve?: string; reject?: string; json?: boolean },
      ) => {
        const dir = vizFolder(target);
        for (const [flag, approve] of [
          ["approve", true],
          ["reject", false],
        ] as const) {
          if (typeof opts[flag] !== "string") continue;
          const done = decide(dir, opts[flag], approve);
          console.log(
            done.length > 0
              ? `✓ ${approve ? "approved" : "rejected"}: ${done.join(", ")}`
              : `· nothing pending matches "${opts[flag]}"`,
          );
          return;
        }
        if (opts.open) {
          const page = serveReview(dir);
          console.log(
            `review ${listPending(dir).length} screenshot(s): ${page}   (Ctrl-C when done)`,
          );
          if (process.env.VIZ_NO_OPEN !== "1") openBrowser(page);
          await new Promise<void>(() => {
            /* never settles: the server lives until the process is stopped */
          });
          return;
        }
        const pending = listPending(dir);
        if (opts.json) return console.log(JSON.stringify(pending));
        if (pending.length === 0) return console.log("· no screenshots waiting");
        for (const p of pending)
          console.log(`  ${p.kind === "new" ? "new    " : "changed"}  ${p.name}`);
        console.log(`look first: viz shots ${target} --open`);
      },
    );

  meta(shots, {
    mcp: { kind: "tool" },
    ui: {
      kind: "cli-only",
      why: "per-viz and per-test-run: the review page it opens is its own UI, reached from verify's failure message",
    },
    examples: `
  viz shots <viz>
      What's waiting: new pictures and changed ones.

  viz shots <viz> --open
      Look before approving: side by side, swipe at any angle, blend, flicker, and a diff
      that's redder where pixels differ more. A approves, R rejects.

  viz shots <viz> --approve all
      Only after a person has looked — approving is what makes a picture the truth.`,
  });

  program
    .command("spec <viz>")
    .description(
      "print a viz's living spec: its tests read as features, scenarios and GIVEN/WHEN/THEN steps",
    )
    .option("--open", "open spec.html in the browser instead of printing")
    .option("--json", "machine-readable output")
    .action((target: string, opts: { open?: boolean; json?: boolean }) => {
      const dir = vizFolder(target);
      if (!hasTests(dir))
        return console.log(
          `· ${path.basename(dir)} has no tests: the smoke run (viz verify) is all there is, so there is no spec`,
        );
      const out = path.join(verifyDir(dir), "tests");
      mkdirSync(out, { recursive: true });
      const spec = writeSpec(dir, out);
      if (opts.open) {
        const page = path.join(out, "spec.html");
        console.log(page);
        if (process.env.VIZ_NO_OPEN !== "1") openBrowser(page);
        return;
      }
      if (opts.json) return console.log(JSON.stringify(spec, null, 2));
      process.stdout.write(readFileSync(path.join(out, "spec.md"), "utf8"));
    });
  meta(program.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" },
    ui: {
      kind: "shown",
      how: "the viz row links to .verify/tests/spec.html when /slugs says it has one",
    },
    examples: `
  viz spec demo-app
      The behaviour index: every describe as a feature, every it as a scenario with its
      GIVEN/WHEN/THEN steps, pass/fail from the last verify, and the files each ran.
      Read it before changing a viz's code.

  viz spec demo-app --open
      The same as a page, with each scenario's files linked into coverage.html.`,
  });

  const check = program
    .command("check <viz-dir>")
    .description("structural check of an exchange viz's content.ts (or content.js)")
    .action(async (dir: string) => {
      await bridge("check-exchange.ts", [dir]);
    });

  meta(check, {
    mcp: { kind: "tool" },
    ui: {
      kind: "cli-only",
      why: "an authoring gate run while writing a viz; screenshots and audit lines belong in the agent's loop, not a dashboard button",
    },
    examples: `
  viz check ~/.agents/state/viz/my-exchange
      Catches what otherwise shows up as a blank page or a stranded arrow: a wire
      pointing at a node that does not exist, a step animating along an undeclared
      wire, a step filling a panel id nobody defined.

      Also the regression gate for /_kit/exchange.js itself — every exchange in the
      corpus shares that runtime, so a change to it must keep this green on all of them.`,
  });
}

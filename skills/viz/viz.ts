#!/usr/bin/env node
// viz.ts — the CLI entry point.
//
// Builds the tree (program.ts), fixes up exit codes, and parses. Nothing else: the
// commands live in commands/, the work in lib/, and the tree is shared with mcp.ts so
// the two surfaces cannot disagree.

import type { Command } from "commander";
import { buildProgram } from "./program.ts";
import { handleExamples } from "./lib/cli-meta.ts";

// On macOS Node writes to a pipe asynchronously, so a process.exit() right after a big --json
// result cut it at 64 KiB (measured: lint with 4,000 findings). Blocking stdio lets every exit path
// keep its exit. Node has no public API for this; `_handle.setBlocking` is the one tools use.
for (const s of [process.stdout, process.stderr])
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- _handle is private API: absent from Node's typings, optional at runtime
  (s as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(
    true,
  );

const program = buildProgram();

// Exit-code discipline. Commander reports every usage problem as exit 1, but the rest of
// this toolchain uses 2 for "you called it wrong" and 1 for "it ran and failed", and CI
// and the MCP server distinguish them. exitOverride is NOT inherited by subcommands, so
// this walks the tree — otherwise `viz rollback <dir>` with a missing argument would
// disagree with `viz frobnicate`.
function normalizeExitCodes(cmd: Command): void {
  cmd.exitOverride((err) => {
    if (
      err.code === "commander.helpDisplayed" ||
      err.code === "commander.help" ||
      err.code === "commander.version"
    ) {
      process.exit(0);
    }
    process.exit(err.exitCode === 1 ? 2 : err.exitCode);
  });
  cmd.showHelpAfterError("(run `viz --help`, or `viz <command> --help` for one command)");
  for (const sub of cmd.commands) normalizeExitCodes(sub);
}
normalizeExitCodes(program);

// Handled before parseAsync, since Commander validates required arguments first and
// `viz create --examples` should not have to invent a slug to ask a question.
if (handleExamples(program, process.argv.slice(2))) process.exit(0);

// Bare `viz` is someone asking what this is, not an error to be terse about.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(2);
}

await program.parseAsync();

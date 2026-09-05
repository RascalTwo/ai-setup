// lib/cli-meta.ts — declarative metadata a command carries about ITSELF.
//
// WHY: mcp.ts used to hand-restate the CLI surface — 8 tools whose coverage and enums
// were typed out by a human. It drifted within hours of the CLI changing: the enum still
// said `vendor-rm` after the verb became `vendor rm`, and six commands were unreachable
// entirely. Anything a human retypes about another file's contents will do that.
//
// So the command declares its own MCP shape and its own examples, right where it is
// defined, and both mcp.ts and `--examples` are DERIVED. Adding a verb cannot forget to
// update them, because there is nothing to update.

import type { Command } from "commander";

export type McpShape =
  /** Its own MCP tool — the verbs an agent reaches for mid-task. */
  | { kind: "tool" }
  /** Folded into one grouped tool with an action enum, e.g. everything under viz_manage. */
  | { kind: "grouped"; group: string }
  /** Deliberately not exposed. Must say why, so "we forgot" and "we decided" look different. */
  | { kind: "hidden"; why: string };

type Meta = { mcp: McpShape; examples?: string };

// Keyed off the Command object itself: no registry to keep in sync, and metadata dies
// with the command if it's ever removed.
const META = new WeakMap<Command, Meta>();

/**
 * Declare a command's MCP shape and (optionally) its examples.
 *
 * Examples live behind `--examples` rather than in `--help` because an agent pays tokens
 * every time it asks for help, and the flag surface is what it usually wants. Putting
 * them here rather than in reference/ keeps them next to the flags they demonstrate, so
 * they cannot describe a flag that no longer exists.
 */
export function meta(cmd: Command, m: Meta): Command {
  META.set(cmd, m);
  if (m.examples) cmd.option("--examples", "show worked examples for this command and exit");
  return cmd;
}

export const metaOf = (cmd: Command): Meta | undefined => META.get(cmd);

/**
 * A leaf's effective shape, inheriting from its group.
 *
 * `viz vendor rm` has no metadata of its own — `vendor` carries it, because every verb
 * in a group belongs in the same MCP tool by construction. Inheriting means adding a
 * subcommand to a group cannot forget to classify it.
 */
export function resolveMeta(cmd: Command): Meta | undefined {
  for (let c: Command | null = cmd; c; c = (c.parent as Command | null)) {
    const m = META.get(c);
    if (m) return m;
  }
  return undefined;
}

/** Every leaf command in the tree, with the full path you'd type to reach it. */
export function walk(cmd: Command, path: string[] = []): { cmd: Command; path: string[] }[] {
  const subs = cmd.commands.filter((c) => c.name() !== "help");
  if (subs.length === 0) return [{ cmd, path }];
  return subs.flatMap((c) => walk(c as Command, [...path, c.name()]));
}

/**
 * Handle `--examples` BEFORE Commander parses.
 *
 * A preAction hook is too late: Commander validates required arguments first, so
 * `viz create --examples` would die on the missing <slug> before ever reaching the hook.
 * Asking a command to explain itself should not require satisfying its arguments.
 *
 * Returns true if it handled the invocation and the caller should stop.
 */
export function handleExamples(program: Command, argv: string[]): boolean {
  if (!argv.includes("--examples")) return false;
  const words = argv.filter((a) => !a.startsWith("-"));
  let cur: Command = program;
  const named: string[] = [];
  for (const w of words) {
    const next = cur.commands.find((c) => c.name() === w || c.aliases().includes(w));
    if (!next) break;
    cur = next as Command;
    named.push(w);
  }
  const m = metaOf(cur);
  if (cur === program || !m?.examples) {
    const withExamples = walk(program)
      .filter(({ cmd }) => metaOf(cmd)?.examples)
      .map(({ path }) => "viz " + path.join(" "));
    console.error(
      named.length
        ? `No examples for \`viz ${named.join(" ")}\`.`
        : "Usage: viz <verb> --examples",
    );
    console.error("\nCommands with examples:\n" + withExamples.map((c) => "  " + c).join("\n"));
    process.exit(2);
  }
  console.log(`Examples — viz ${named.join(" ")}\n${m.examples.trimEnd()}`);
  return true;
}

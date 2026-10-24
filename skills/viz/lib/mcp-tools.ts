// lib/mcp-tools.ts — derive the MCP tool surface from the Commander tree.
//
// WHY: mcp.ts used to hand-restate the CLI. Within hours of the CLI changing, its enum
// still said `vendor-rm` after the verb became `vendor rm`, and six commands — check,
// export, preview, rotate, deploy-all, sync-runtimes — were unreachable entirely. Nobody
// had decided to omit them; the list was just typed once and never revisited.
//
// Now the tools are generated. A verb's MCP shape is declared next to the verb (see
// lib/cli-meta.ts), and this file turns the tree into tool definitions. Adding a command
// cannot forget to expose it, and renaming one cannot leave a stale enum behind, because
// there is no second list.
//
// Execution still SPAWNS `viz <verb>` rather than calling the action in-process, and
// deliberately: commands call process.exit, which in-process would kill the MCP server.

import { z } from "zod";
import type { EventEmitter } from "node:events";
import type { Command } from "commander";
import { walk, resolveMeta, metaOf } from "./cli-meta.ts";

export type GeneratedTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  /** Turn validated tool arguments into the argv `viz` expects. */
  toArgv: (args: Record<string, unknown>) => string[];
};

/** `viz vendor rm` -> `viz_vendor_rm`; the tool name is derived, never chosen. */
const toolName = (path: string[]) => "viz_" + path.join("_").replaceAll("-", "_");

/** Commander's option/argument metadata -> a zod shape, so schemas cannot drift either. */
function schemaFor(cmd: Command): { shape: Record<string, z.ZodTypeAny>; argNames: string[] } {
  const shape: Record<string, z.ZodTypeAny> = {};
  const argNames: string[] = [];

  for (const a of cmd.registeredArguments) {
    const n = a.name();
    argNames.push(n);
    const s = z.string().describe(a.description || `${n} (positional)`);
    shape[n] = a.required ? s : s.optional();
  }

  for (const o of cmd.options) {
    const attr = o.attributeName();
    // --examples is a help affordance for humans at a terminal; an MCP client gets the
    // examples in the tool description instead, so exposing it would be noise.
    if (attr === "examples") continue;
    const desc = o.description || attr;
    // A flag that takes a value has <value> or [value] in its flags string.
    const takesValue = /[<[]/u.test(o.flags);
    if (o.negate) {
      // Commander models `--no-print` as `print: false`; expose the negative directly.
      shape[attr] = z.boolean().optional().describe(`${desc} (false disables)`);
    } else if (o.optional) {
      // `--local [dir]` is two flags in one: bare, or with a value. A string-only schema
      // made the bare form unreachable, so accept both — true sends the flag alone.
      shape[attr] = z
        .union([z.boolean(), z.string()])
        .optional()
        .describe(`${desc} (true for the bare flag, or a value)`);
    } else if (takesValue) {
      shape[attr] = z.string().optional().describe(desc);
    } else {
      shape[attr] = z.boolean().optional().describe(desc);
    }
  }
  return { shape, argNames };
}

function argvFor(cmd: Command, path: string[], argNames: string[]) {
  const negated = new Set(cmd.options.filter((o) => o.negate).map((o) => o.attributeName()));
  const valued = new Set(
    cmd.options.filter((o) => /[<[]/u.test(o.flags)).map((o) => o.attributeName()),
  );
  const longOf = new Map(cmd.options.map((o) => [o.attributeName(), o.long ?? ""]));
  return (args: Record<string, unknown>): string[] => {
    const out = [...path];
    for (const n of argNames) {
      const v = args[n];
      if (v !== undefined) out.push(typeof v === "string" ? v : JSON.stringify(v));
    }
    for (const [k, v] of Object.entries(args)) {
      if (argNames.includes(k) || v === undefined) continue;
      const long = longOf.get(k);
      if (!long) continue;
      if (negated.has(k)) {
        if (v === false) out.push(long); // long is already `--no-x`
      } else if (valued.has(k) && typeof v === "string") {
        if (v !== "") out.push(long, v);
      } else if (v === true) {
        out.push(long);
      }
    }
    return out;
  };
}

/**
 * What `viz <verb> --help` and `--examples` would tell a human at a terminal, which an MCP
 * client cannot run. addHelpText registers an 'afterHelp' listener; emitting that event
 * with our own writer captures the text without printing help or exiting.
 */
function helpExtras(cmd: Command): string {
  let after = "";
  // commander's Command is an EventEmitter at runtime; its typings don't say so.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime EventEmitter that the typings omit
  (cmd as unknown as EventEmitter).emit("afterHelp", {
    error: false,
    command: cmd,
    write: (s: string) => (after += s),
  });
  const ex = metaOf(cmd)?.examples?.trim();
  return [after.trim(), ex && `Examples:\n  ${ex}`].filter(Boolean).join("\n\n");
}

/**
 * One tool per `kind: "tool"` leaf, plus one tool per group whose action enum is the
 * list of grouped leaves. Hidden leaves are dropped, and their stated reason is what
 * makes "we decided" distinguishable from "we forgot".
 */
export function generateTools(program: Command): GeneratedTool[] {
  const leaves = walk(program);
  const tools: GeneratedTool[] = [];
  const groups = new Map<string, { path: string[]; cmd: Command }[]>();

  for (const { cmd, path } of leaves) {
    const m = resolveMeta(cmd);
    if (!m || m.mcp.kind === "hidden") continue;
    if (m.mcp.kind === "grouped") {
      const g = groups.get(m.mcp.group) ?? [];
      g.push({ path, cmd });
      groups.set(m.mcp.group, g);
      continue;
    }
    const { shape, argNames } = schemaFor(cmd);
    tools.push({
      name: toolName(path),
      title: `viz ${path.join(" ")}`,
      description: [cmd.description(), helpExtras(cmd)].filter(Boolean).join("\n\n"),
      inputSchema: shape,
      toArgv: argvFor(cmd, path, argNames),
    });
  }

  for (const [group, members] of [...groups].toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)))) {
    members.sort((a, b) => a.path.join(" ").localeCompare(b.path.join(" ")));
    const [firstAction, ...otherActions] = members.map((m) => m.path.join(" "));
    if (firstAction === undefined) continue; // a group only exists once it has a member
    const actions = [firstAction, ...otherActions];
    // One line per action keeps the grouped schema cheap; the full flags and examples are
    // one call away, so they are fetched on demand rather than paid for on every list.
    const lines = members.map(
      ({ cmd, path }) =>
        `- ${path.join(" ")}${metaOf(cmd)?.examples ? " *" : ""}: ${cmd.description()}`,
    );
    tools.push({
      name: `viz_${group}`,
      title: `viz — ${group}`,
      description:
        `The rarer operations, behind one tool so they cost one schema instead of ${actions.length}. ` +
        `Set \`action\`, and put positional arguments and flags in \`args\`, in the order \`viz <action>\` takes them.\n\n` +
        `${lines.join("\n")}\n\n` +
        `Pass args: ["--help"] to get an action's flags, or ["--examples"] for worked examples (actions marked *).`,
      inputSchema: {
        action: z.enum([firstAction, ...otherActions]).describe("which operation to run"),
        args: z.array(z.string()).default([]).describe("positional args and flags, in CLI order"),
      },
      toArgv: (a) => [
        ...String(a.action).split(" "),
        ...(Array.isArray(a.args) ? a.args.filter((x): x is string => typeof x === "string") : []),
      ],
    });
  }
  return tools;
}

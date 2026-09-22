// program.ts — builds the command tree WITHOUT running it.
//
// Split out of viz.ts so two callers can share one definition: viz.ts parses argv against
// it, and mcp.ts walks it to generate MCP tools. Before this split mcp.ts could not see
// the tree at all — viz.ts called parseAsync at import — which is why the MCP surface was
// hand-restated, and why it drifted.

import { VERSION } from "./lib/version.ts";
import { Command } from "commander";
import { registerCreate } from "./commands/create.ts";
import { registerAuthor } from "./commands/author.ts";
import { registerLibrary } from "./commands/library.ts";
import { registerServer } from "./commands/server.ts";
import { registerPublish } from "./commands/publish.ts";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("viz")
    .description("Ad-hoc HTML visualizations — create, verify, manage and publish them.")
    .version(VERSION)
    .addHelpText("after", `
Groups:
  create                 scaffold a new viz
  verify, check          confirm it actually renders
  ls, search, update …   the library
  server                 the local server
  publish, preview …     getting it off localhost

Flags for any verb: \`viz <verb> --help\`. Worked examples, where a command has them:
\`viz <verb> --examples\`. Both are generated from the command itself.`);

  registerCreate(program);
  registerAuthor(program);
  registerLibrary(program);
  registerServer(program);
  registerPublish(program);
  return program;
}

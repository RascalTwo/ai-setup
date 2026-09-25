// mcp.ts — /viz as a local stdio MCP server.
//
// WHY THIS EXISTS: Claude Desktop and ChatGPT run skills in a sandbox with no host
// shell, no Bun, and no reachable 127.0.0.1 — so the full skill can't run there. But
// both run local *stdio MCP servers* as ordinary host processes, outside that sandbox.
// This file is that process. It gives a chat app the real machine.
//
// TOOLS ONLY, DELIBERATELY. Claude Desktop supports MCP tools fully and resources and
// prompts only partially (no UI for browsing resources, prompts not surfaced). So the
// manual ships through a tool — `viz_start` — rather than as a resource, and SEP-2640
// (Skills over MCP) is left alone until it ratifies and clients catch up. Everything
// here works on the SDK's default 2025-era wire format, which every current client
// speaks; serving 2026-07-28 is an opt-in we can add later without breaking anyone.
//
// This server OWNS NO LOGIC. Every tool shells out to the same CLI a human or Claude
// Code would run, so there is exactly one implementation of bootstrap/verify/publish
// and this file cannot drift from it. That is also why the CLIs' lack of exports
// doesn't matter — we spawn them, we don't import them.
//
// STDOUT IS THE JSON-RPC CHANNEL. Never console.log here; it corrupts the protocol
// stream and the client drops the connection. Log to stderr (which is also what the
// 2026-07-28 spec recommends now that MCP Logging is deprecated).

import { VERSION } from "./lib/version.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CENTRAL as VIZ, HOME } from "./discovery.ts";
import { buildProgram } from "./program.ts";
import { generateTools } from "./lib/mcp-tools.ts";

const SKILL_DIR = import.meta.dir;

const log = (msg: string) => process.stderr.write(`[viz-mcp] ${msg}\n`);

/** Run one of the skill's own CLIs and hand back whatever it printed. */
async function run(script: string, args: string[], cwd = SKILL_DIR) {
  const argv = [path.join(SKILL_DIR, script), ...args];
  log(`bun ${argv.join(" ")}`);
  const proc = Bun.spawn(["bun", ...argv], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  let body = [out.trim(), err.trim()].filter(Boolean).join("\n");
  // A real library makes `viz ls` ~42KB — around 11k tokens, enough to crowd out the viz
  // the agent was asked to build. Cap it and say so rather than silently truncating.
  const LIMIT = 24_000;
  if (body.length > LIMIT) {
    body = body.slice(0, LIMIT) + `\n\n… truncated (${body.length - LIMIT} more chars). Narrow the query, or pass --json and a filter.`;
  }
  return { code, body: body || `(no output, exit ${code})` };
}

const asResult = (r: { code: number; body: string }) => ({
  content: [{ type: "text" as const, text: r.body }],
  isError: r.code !== 0,
});

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });

/**
 * A viz lives either in the central library or in some repo's `viz-pages/`, and its
 * identity is its path relative to $HOME. Anything else is not a viz, and a tool that
 * writes files for a model should not accept arbitrary filesystem paths — a mistyped
 * or model-hallucinated path would otherwise clobber real work.
 */
function assertVizPath(p: string): string {
  const abs = path.resolve(p);
  const inCentral = abs === VIZ || abs.startsWith(VIZ + path.sep);
  const inRepoLocal =
    abs.startsWith(HOME + path.sep) &&
    abs.split(path.sep).includes("viz-pages");
  if (!inCentral && !inRepoLocal) {
    throw new Error(
      `refusing to touch ${abs} — a viz must live under ${VIZ} or in a viz-pages/ folder inside your home directory`,
    );
  }
  return abs;
}

/**
 * Prepended to every doc `viz_start` serves. The skill's prose assumes the reader has a
 * shell — `reference/full.md` is nothing but `bun <script>.ts` invocations — which is
 * exactly what an MCP client does not have. Rather than fork the docs for a second
 * audience (the mistake this whole split was designed to avoid), translate at the door.
 */
const MCP_PREAMBLE = `> **You are reading this through the /viz MCP server.** You are in **full mode** —
> this server is running on the user's real machine, so Bun, the viz server, git and
> Chrome are all available to it. Ignore the mode check below; it is already resolved.
>
> **You have no shell.** Every \`bun <script>.ts …\` command in these docs — and its
> \`viz <verb>\` equivalent — is something *this server* runs for you. Translate as you read:
>
> | The docs say | You call |
> |---|---|
> | \`viz create <slug> …\` | \`viz_create\` |
> | edit / write \`index.html\`, \`api.ts\`, \`data.json\` | \`viz_write\` (send the whole file) |
> | read a file back | \`viz_read\` |
> | \`viz verify …\` | \`viz_verify\` |
> | \`viz ls\` / \`viz search\` | \`viz_list\` |
> | \`viz publish\` / \`export\` / \`preview\` / \`rotate\` | \`viz_publish\` |
> | \`viz move/delete/update/mirror/vendor/history/rollback\`, \`viz server …\` | \`viz_manage\` |
>
> Flags: the docs deliberately stop restating them, because \`viz <verb> --help\` is
> generated from the parser. You cannot run that — so the tool schemas above carry the
> flags you need, and anything missing is in \`reference/full.md\`.
>
> Load the referenced files with \`viz_start({doc})\` rather than reading them off disk —
> \`reference/full.md\` is the toolchain half you want next.
>
> Everything else — the ambition bar, the visual-form menu, the kit, the diagram rules —
> applies to you unchanged. The plumbing differs; the standard does not.`;

const server = new McpServer({ name: "viz", version: VERSION });

// Registration order is the wire order of tools/list, and the 2026-07-28 spec asks for
// a deterministic order specifically so client-side prompt caching can hit. Keep it
// stable: read-the-manual first, then the authoring arc, then the rare stuff.

server.registerTool(
  "viz_start",
  {
    title: "Read the viz manual",
    description:
      "READ THIS FIRST, before any other viz tool. Returns the /viz skill manual — what makes a " +
      "visualization good, the ambition bar every viz must clear, the visual-form menu, the shared " +
      "kit, and the diagram rules. Call with no arguments for the main manual; pass `doc` to load a " +
      "referenced section on demand. Do not author a viz without reading this; the tools below are " +
      "only the plumbing.",
    inputSchema: {
      doc: z
        .string()
        .optional()
        .describe(
          "Optional doc to load instead of the main manual, e.g. 'reference/full.md' (the toolchain), " +
            "'reference/diagrams.md' (boxes and arrows), 'reference/verify.md', 'reference/backend.md', " +
            "'reference/publishing.md', 'reference/timeline.md', 'kit/README.md'.",
        ),
    },
  },
  async ({ doc }) => {
    const rel = doc ?? "SKILL.md";
    if (rel.includes("..") || path.isAbsolute(rel)) {
      throw new Error(`bad doc path: ${rel}`);
    }
    const file = path.join(SKILL_DIR, rel);
    if (!existsSync(file)) throw new Error(`no such doc: ${rel}`);
    // The docs are written for an agent holding a shell — reference/full.md is entirely
    // `bun bootstrap.ts …` invocations. Reaching them through MCP means there is no shell,
    // so say that up front or the agent will faithfully read instructions it cannot run.
    return textResult(`${MCP_PREAMBLE}\n\n---\n\n${readFileSync(file, "utf8")}`);
  },
);

// ---- Hand-written: the tools with NO CLI equivalent ----
//
// An MCP client has no filesystem, so reading and writing a viz's files has to be a tool
// call. These are not generated because there is nothing in the CLI to generate them
// from — at a terminal you just use an editor.

server.registerTool(
  "viz_read",
  {
    title: "Read a file from a viz",
    description: "Read one file out of a viz folder — usually index.html before editing it.",
    inputSchema: {
      file: z.string().describe("Absolute path to the file, inside a viz folder."),
    },
  },
  async ({ file }) => {
    const abs = assertVizPath(file);
    if (!existsSync(abs)) throw new Error(`no such file: ${abs}`);
    return textResult(readFileSync(abs, "utf8"));
  },
);

server.registerTool(
  "viz_write",
  {
    title: "Write a file in a viz",
    description:
      "Write (or overwrite) one file inside a viz folder — index.html, api.ts, data.json, anything. " +
      "Send the complete file contents; there is no partial-patch mode. Keep the `viz:posture` and " +
      "`viz:listed` meta lines when rewriting a scaffolded index.html.",
    inputSchema: {
      file: z.string().describe("Absolute path to write, inside a viz folder."),
      content: z.string().describe("Complete new contents of the file."),
    },
  },
  async ({ file, content }) => {
    const abs = assertVizPath(file);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return textResult(`wrote ${abs} (${Buffer.byteLength(content)} bytes)`);
  },
);

// ---- Generated from the Commander tree ----
//
// Every CLI verb reaches MCP through here. Tool names, parameter schemas and the
// viz_manage action enum are all derived from program.ts, so a verb added or renamed in
// the CLI shows up (or moves) here with no edit. That is the fix for the drift this file
// had: its hand-typed enum still said `vendor-rm` after the verb became `vendor rm`, and
// six commands were unreachable because nobody remembered to add them.
//
// Execution spawns `viz <verb>` rather than calling the action in-process, deliberately:
// commands call process.exit, which in-process would take the MCP server down with them.
for (const tool of generateTools(buildProgram())) {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
    async (args: Record<string, unknown>) => asResult(await run("viz.ts", tool.toArgv(args))),
  );
}

log(`skill dir ${SKILL_DIR}`);
log(`viz library ${VIZ}`);
await server.connect(new StdioServerTransport());
log("connected on stdio");

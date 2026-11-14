// The board's backend: every button runs the kelpie CLI itself, so the board and the terminal
// never behave differently. Nothing here holds state; the tracker is the truth.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Handlers } from "@viz/kit/api.js";
import { z } from "@viz/kit/zod.js";
// oxlint-disable-next-line import/no-relative-parent-imports -- the board ships inside the CLI it drives
import { safe } from "../../dispatcher.ts";
// oxlint-disable-next-line import/no-relative-parent-imports -- same
import { STATE } from "../../wiring.ts";
import type { Board, ProjectFile, Routes, Status, Verb, Words } from "./contract.js";

const CLI = path.join(import.meta.dir, "../../kelpie.ts");
const VERBS = new Set<string>([
  "refine",
  "build",
  "refine-next",
  "build-next",
  "pause",
  "resume",
  "more",
  "less",
  "for-agent",
  "assign",
  "keep",
  "drop",
  "later",
] satisfies Verb[]);
// A card's word-button → the CLI command it runs from the task's run folder (where those commands find their task).
const ANSWERS = {
  approve: "approve",
  signoff: "signoff",
  "signoff-now": "signoff --now",
  "signoff-hold": "signoff --hold",
  park: "park",
  close: "close",
  reply: "page",
} satisfies Record<Words, string>;
const VIZ = path.join(homedir(), ".agents/state/viz"),
  SERVER = "http://127.0.0.1:5180";

async function run(
  cmd: string[],
  stdin?: string,
  cwd?: string,
): Promise<{ ok: boolean; out: string }> {
  // Not an agent's pane: with HERDR_PANE_ID set, `approve` would take this for the agent's own run.
  const { HERDR_PANE_ID: _pane, ...env } = process.env;
  const p = Bun.spawn(cmd, {
    ...(cwd && { cwd }),
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { ok: code === 0, out: (code === 0 ? out : err || out).trim() };
}

// herdr's reply: only the fields the focus needs.
const Agents = z.object({
  result: z.object({
    agents: z.array(
      z.object({ pane_id: z.string(), tab_id: z.string(), workspace_id: z.string() }),
    ),
  }),
});

// viz verify and screenshots load the page like a reader: never let them press a button.
const automated = (req: Request) =>
  req.headers.get("user-agent")?.includes("VizAutomation") ?? false;

// The plan's own page with its capability, `<page>#<token>`: the board adds `&{"task":…}`, which
// Timeline Studio reads once to open that task. The token stays in the fragment (never sent to a
// server) and only reaches this machine's own page.
const Tracker = z.object({
  base: z.string().optional(),
  page: z.string().optional(),
  token: z.string(),
});
function trackerLink(): string {
  try {
    const cfg = Tracker.parse(
      JSON.parse(readFileSync(path.join(homedir(), ".config/timeline-studio/config.json"), "utf8")),
    );
    return `${(cfg.page ?? cfg.base ?? "https://timeline-studio.rascaltwo.com").replace(/\/$/u, "")}/#${cfg.token}`;
  } catch {
    return "https://timeline-studio.rascaltwo.com"; // no config: the app, without a plan
  }
}

export default {
  "/board": async () => {
    const res = await run(["bun", CLI, "status", "--json"]);
    if (!res.ok) throw new Error(`kelpie status: ${res.out.slice(0, 300)}`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own CLI's output, shaped by status-shape.ts in the same repo
    const status = JSON.parse(res.out) as Status;
    // A demo is the newer page for a task, so it wins over its spec.
    const pages: Record<string, string> = {};
    for (const row of status.projects.flatMap((p) => p.rows))
      if (row.section === "waiting")
        for (const slug of [`walk-${row.id}`, `spec-${row.id}`])
          if (existsSync(path.join(VIZ, slug, "index.html"))) {
            pages[row.id] = `${SERVER}/.agents/state/viz/${slug}/`;
            break;
          }
    return { status, pages, tracker: trackerLink() } satisfies Board;
  },
  "/act": async (req) => {
    if (automated(req)) return { ok: false, out: "not from automation" };
    const { verb, arg, to } = await req.json();
    // Trust boundary: only these verbs, and the argument is a task or project id, never a flag.
    if (!VERBS.has(verb)) return { ok: false, out: `not a board action: ${verb}` };
    if (arg && !/^\w[\w.-]*$/u.test(arg)) return { ok: false, out: `not an id: ${arg}` };
    if (verb === "assign" && !(typeof to === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(to)))
      return { ok: false, out: `not a project id: ${to}` };
    return run(["bun", CLI, verb, ...(arg ? [arg] : []), ...(verb === "assign" && to ? [to] : [])]);
  },
  "/answer": async (req) => {
    if (automated(req)) return { ok: false, out: "not from automation" };
    const { verb, project, id, text } = await req.json();
    // Trust boundary: your words go to the CLI as one argument, and they are never a flag.
    if (!Object.hasOwn(ANSWERS, verb)) return { ok: false, out: `not an answer: ${verb}` };
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(project) || !/^\w[\w.-]*$/u.test(id))
      return { ok: false, out: `not a task: ${project}/${id}` };
    const words = typeof text === "string" ? text.trim() : "";
    if (!words)
      return { ok: false, out: "write it in your own words first: they are quoted on the task" };
    if (words.startsWith("--")) return { ok: false, out: "start with a word, not --" };
    const dir = path.join(STATE, "runs", project, safe(id));
    if (!existsSync(path.join(dir, ".task.json")))
      return { ok: false, out: `${id} has no run folder to answer from` };
    return run(["bun", CLI, ...ANSWERS[verb].split(" "), words], undefined, dir);
  },
  "/projects": async () => {
    const res = await run(["bun", CLI, "project", "list"]);
    if (!res.ok) throw new Error(`kelpie project list: ${res.out.slice(0, 300)}`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own CLI's output (projects.ts list)
    return JSON.parse(res.out) as ProjectFile[];
  },
  "/project": async (req) => {
    if (automated(req)) return { ok: false, out: "not from automation" };
    const b = await req.json();
    // Trust boundary: the id is checked again by the CLI, but never let it pass as a flag here.
    if (typeof b.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(b.id))
      return { ok: false, out: `not a project id: ${b.id}` };
    if (b.op === "save" || b.op === "new")
      return typeof b.text === "string"
        ? run(["bun", CLI, "project", "save", b.id, ...(b.op === "new" ? ["--new"] : [])], b.text)
        : { ok: false, out: "no file text" };
    if (b.op === "retire" || b.op === "restore") return run(["bun", CLI, "project", b.op, b.id]);
    if (b.op === "move" && (b.way === "up" || b.way === "down"))
      return run(["bun", CLI, "project", "move", b.id, b.way]);
    return { ok: false, out: `not a project action: ${b.op}` };
  },
  "/focus": async (req) => {
    if (automated(req)) return { ok: false, out: "not from automation" };
    const { pane } = await req.json();
    const list = await run(["herdr", "agent", "list"]);
    if (!list.ok) return list;
    const { agents } = Agents.parse(JSON.parse(list.out)).result;
    const agent = agents.find((x) => x.pane_id === pane);
    if (!agent)
      return {
        ok: false,
        out: `pane ${pane} isn't open (the next tick revives a run whose pane died)`,
      };
    const ws = await run(["herdr", "workspace", "focus", agent.workspace_id]);
    return ws.ok ? run(["herdr", "tab", "focus", agent.tab_id]) : ws;
  },
} satisfies Handlers<Routes>;

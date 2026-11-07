// The board's backend: every button runs the kelpie CLI itself, so the board and the terminal
// never behave differently. Nothing here holds state; the tracker is the truth.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Handlers } from "@viz/kit/api.js";
import { z } from "@viz/kit/zod.js";
import type { Board, Routes, Status, Verb } from "./contract.js";

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
] satisfies Verb[]);
const VIZ = path.join(homedir(), ".agents/state/viz"),
  SERVER = "http://127.0.0.1:5180";

async function run(cmd: string[]): Promise<{ ok: boolean; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
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
    // A walkthrough is the newer page for a task, so it wins over its spec.
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
    const { verb, arg } = await req.json();
    // Trust boundary: only these verbs, and the argument is a task or project id, never a flag.
    if (!VERBS.has(verb)) return { ok: false, out: `not a board action: ${verb}` };
    if (arg && !/^\w[\w.-]*$/u.test(arg)) return { ok: false, out: `not an id: ${arg}` };
    return run(["bun", CLI, verb, ...(arg ? [arg] : [])]);
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

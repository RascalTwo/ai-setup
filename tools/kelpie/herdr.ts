// The herdr side: one tab per run, read through `herdr agent list`. The herdr CLI finds its
// server socket without the pane env vars, so this works under launchd too.
import { join } from "node:path";
import type { AgentStatus, Herdr } from "./dispatcher.ts";

async function herdr(...args: string[]): Promise<string> {
  const p = Bun.spawn(["herdr", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`herdr ${args[0]} ${args[1]}: ${(err || out).trim().slice(0, 300)}`);
  return out;
}
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const realHerdr: Herdr = {
  async agents() {
    const r = JSON.parse(await herdr("agent", "list")).result;
    return new Map((r.agents ?? []).map((a: any) => [a.pane_id, { status: a.agent_status as AgentStatus, seq: a.state_change_seq ?? 0, cwd: a.cwd }]));
  },
  async spawn(label, cwd, promptFile, space, run) {
    // Each project's agents live in its own space, so the human's own space holds only their
    // terminals. A new space opens with a shell tab at the project's home: kept as its shell.
    const spaces = JSON.parse(await herdr("workspace", "list")).result.workspaces as { label: string; workspace_id: string }[];
    const ws = spaces.find(w => w.label === space.label)?.workspace_id
      ?? JSON.parse(await herdr("workspace", "create", "--label", space.label, "--cwd", space.home, "--no-focus")).result.workspace.workspace_id;
    const tab = JSON.parse(await herdr("tab", "create", "--workspace", ws, "--label", label, "--cwd", cwd, "--no-focus")).result;
    const pane = tab.root_pane.pane_id as string;
    // The prompt travels as a file the pane's shell expands inside quotes, so the human's comment
    // text never meets a shell unquoted.
    // A Stop hook, for this session only, records its background tasks (see `kelpie bg`).
    const hooks = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `bun ${q(join(import.meta.dir, "kelpie.ts"))} bg` }] }] } });
    await herdr("pane", "run", pane, `claude --dangerously-skip-permissions --model ${q(run.model)} --effort ${q(run.effort)} --settings ${q(hooks)} "$(cat ${q(promptFile)})"`);
    return pane;
  },
  async prompt(pane, text) { await herdr("agent", "prompt", pane, text); },
  tail: (pane, lines) => herdr("pane", "read", pane, "--lines", String(lines)),
  async close(pane) { await herdr("pane", "close", pane); },
};

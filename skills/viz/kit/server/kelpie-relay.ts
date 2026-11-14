// kelpie-relay.ts — the one place a viz page's Send reaches a Kelpie agent. It runs `kelpie page <words>`
// from the task's run folder; Kelpie records the words on the task, then types them into the build
// agent's pane as a `[kelpie] …` line. A page's api.ts imports it through the kit alias
// (`import { relay } from "@viz/kit/server/kelpie-relay.ts"`), and the viz server's `_relay` route (the
// 🎙 💬 panel's Send) uses it too.
// Server only, so it lives outside kit/src: it spawns a process, and Bun's types can't join the
// browser-typed kit program. Bun runs it as TypeScript; nothing compiles it to .js.
import { existsSync } from "node:fs";
import path from "node:path";

/** What became of the words. `saved`: on the task, but no pane took them; Kelpie hands them over
 *  on its next tick. `no-run`: the folder isn't a Kelpie run, so nothing was sent. `refused`: a
 *  `viz verify` or page test pressed Send; it never reaches an agent. */
export type Outcome = "delivered" | "saved" | "failed" | "no-run" | "refused";
export interface Relayed {
  outcome: Outcome;
  /** delivered or saved: the words are on the task. */
  ok: boolean;
  message: string;
}

/** The same words on every page whose Send meets a closed pane. */
export const SAVED = "Saved on the task; the agent gets it when it next runs.";

/** Relay `words` to the agent of the run at `folder` (the run folder the page was made with: spec.json
 *  `task.folder`, walk.json `relay.folder`, a page's `viz:kelpie-run` tag). `env` overrides the
 *  process environment for Kelpie (`KELPIE_STATE`, `KELPIE_CLI`, a fixture's `HOME`). */
export function relay(
  req: Request,
  words: string,
  folder: string | undefined,
  env: Record<string, string | undefined> = {},
): Relayed {
  if (req.method !== "POST" || req.headers.get("user-agent")?.includes("VizAutomation"))
    return { outcome: "refused", ok: false, message: "not available under viz verify" };
  const e = { ...process.env, ...env };
  const home = process.env["HOME"] ?? ""; // the server's own: a fixture's HOME in `env` is only for Kelpie
  const runs = path.join(e["KELPIE_STATE"] ?? path.join(home, ".agents/state/kelpie"), "runs");
  if (
    !folder ||
    !path.resolve(folder).startsWith(runs + path.sep) ||
    !existsSync(path.join(folder, ".task.json"))
  )
    return {
      outcome: "no-run",
      ok: false,
      message: `${folder ?? "This page"} is not a Kelpie run folder, so there is no agent to send to.`,
    };
  const kelpie = e["KELPIE_CLI"] ?? path.join(home, ".agents/ai-setup/tools/kelpie/kelpie.ts");
  const run = Bun.spawnSync(["bun", kelpie, "page", words], {
    cwd: folder,
    env: e,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = run.stdout.toString().trim();
  if (run.exitCode !== 0)
    return {
      outcome: "failed",
      ok: false,
      message: `kelpie page failed: ${run.stderr.toString().trim() || out}`,
    };
  // Kelpie's "The agent has no live pane; the next tick picks the comment up."
  if (/no live pane;/u.test(out)) return { outcome: "saved", ok: true, message: SAVED };
  return { outcome: "delivered", ok: true, message: out };
}

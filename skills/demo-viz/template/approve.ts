// Accept + Send: approve the task the way the spec page's Sign off signs one off, by running Kelpie's
// `approve "<their words>"` from the task's run folder. Kelpie records the words on the task and
// tells the build pane to productionalize, so it works with that pane closed. Changes + Send goes
// through the kit's relay instead (`kelpie page`). Server only: api.ts imports it.
import { existsSync } from "node:fs";
import path from "node:path";

export interface Approved {
  outcome: "approved" | "failed" | "no-run" | "refused";
  ok: boolean;
  message: string;
}

/** `env` overrides the process environment for Kelpie, as walk.json's `relay.env` does for the relay. */
export function approve(
  req: Request,
  words: string,
  folder: string | undefined,
  env: Record<string, string | undefined> = {},
): Approved {
  // `viz verify` and the page's tests press Send too: they must never approve a real task.
  if (req.method !== "POST" || req.headers.get("user-agent")?.includes("VizAutomation"))
    return { outcome: "refused", ok: false, message: "not available under viz verify" };
  const e: Record<string, string | undefined> = { ...process.env, ...env };
  delete e["HERDR_PANE_ID"]; // Kelpie reads a pane id as "an agent ran this": the page is the human
  const home = process.env["HOME"] ?? "";
  const runs = path.join(e["KELPIE_STATE"] ?? path.join(home, ".agents/state/kelpie"), "runs");
  if (
    !folder ||
    !path.resolve(folder).startsWith(runs + path.sep) ||
    !existsSync(path.join(folder, ".task.json"))
  )
    return {
      outcome: "no-run",
      ok: false,
      message: `${folder ?? "This page"} is not a Kelpie run folder, so there is no task to approve.`,
    };
  const kelpie = e["KELPIE_CLI"] ?? path.join(home, ".agents/ai-setup/tools/kelpie/kelpie.ts");
  const run = Bun.spawnSync(["bun", kelpie, "approve", words], {
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
      message: `kelpie approve failed: ${run.stderr.toString().trim() || out}`,
    };
  return { outcome: "approved", ok: true, message: out };
}

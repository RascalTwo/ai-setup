// lib/bridge.ts — TEMPORARY: run a legacy script as a subprocess.
//
// The CLI is being migrated group by group. A command that has been extracted calls a
// lib/ function directly; one that hasn't yet goes through here, which spawns the
// original script exactly as before. Both paths behave identically from outside, which
// is what lets the migration happen a group at a time with the suite green throughout.
//
// Every call site is marked BRIDGE. When the last one is gone, delete this file.

import path from "node:path";

const SKILL_DIR = path.dirname(import.meta.dir);

/** Spawn a legacy script with stdio inherited; exit with whatever it exits with. */
export async function bridge(script: string, args: string[]): Promise<never> {
  const proc = Bun.spawn(["bun", path.join(SKILL_DIR, script), ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}

/**
 * Rebuild the argv a legacy script expects from Commander's parsed options.
 * Only needed while bridging — an extracted command passes typed values instead.
 */
export function toArgv(positionals: (string | undefined)[], opts: Record<string, unknown>): string[] {
  const out = positionals.filter((p): p is string => typeof p === "string");
  for (const [k, v] of Object.entries(opts)) {
    const flag = `--${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`;
    if (v === true) out.push(flag);
    else if (typeof v === "string") out.push(flag, v);
  }
  return out;
}

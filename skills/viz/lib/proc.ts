// lib/proc.ts — run a command and get its exit code and text output back.
//
// Both throw when the command can't start (ENOENT); a non-zero exit is a result, not a throw.

import {
  spawn,
  type ChildProcess,
  spawnSync,
  type SpawnOptions,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

type SyncOpts = Omit<SpawnSyncOptionsWithStringEncoding, "encoding">;

export function runSync(cmd: string[], opts: SyncOpts = {}): Ran {
  const [bin = "", ...args] = cmd;
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 1 << 30, ...opts });
  if (r.error) throw r.error;
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** stdin is closed unless `opts.stdio` says otherwise; stdout and stderr are captured. */
export async function run(cmd: string[], opts: SpawnOptions = {}): Promise<Ran> {
  const [bin = "", ...args] = cmd;
  const result = await new Promise<Ran>((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    p.stdout?.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    p.stderr?.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
  return result;
}

/** Resolves with the exit code once an already-spawned child has closed. */
export const exited = async (p: ChildProcess): Promise<number> => {
  const code = await new Promise<number>((resolve, reject) => {
    p.on("error", reject);
    p.on("close", (c) => resolve(c ?? 1));
  });
  return code;
};

// lib/render/jobs.ts — a render is a job: a detached process whose whole state is files.
//
// Every surface (CLI, MCP, UI) starts the same job and reads the same status.json, so
// there is one path, not three. Deliberately NOT a process manager: no queue, no retries,
// no concurrency limit, no cleanup (the OS owns $TMPDIR). The one thing it does beyond
// "spawn and read a file" is notice a dead pid, so a crash reads `crashed` instead of
// hanging at 40% forever. Needing more than this is a signal to rethink, not to add.

import { mkdirSync, openSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PORT } from "../../server-control.ts";

export const JOBS_ROOT = path.join(os.tmpdir(), "viz-render");
const RUNNER = path.join(import.meta.dir, "run.ts");

export type RenderOptions = {
  target: string;
  fps: number;
  width: number;
  height: number;
  workers: number;
  /** Seconds; only consulted when the page has no __viz.timeline. */
  duration?: number;
  out: string;
  frozen: boolean;
};

export type JobState = "running" | "done" | "failed" | "cancelled" | "crashed";

export type JobStatus = {
  id: string;
  state: JobState;
  pid: number | null;
  target: string;
  out: string;
  log: string;
  frame: number;
  frames: number;
  warnings: string[];
  /** Chrome pids: puppeteer runs Chrome in its own process group, so only these reach it on a hard kill. */
  browsers?: number[];
  error?: string;
  startedAt: string;
  endedAt?: string;
};

/** Same resolution as `viz verify`: a URL as given, else a path under the server root. */
export function urlFor(target: string): string {
  return target.includes("://")
    ? target
    : `http://127.0.0.1:${PORT}/${target.replaceAll(/^\/+|\/+$/gu, "")}/`;
}

export const jobDir = (id: string): string => path.join(JOBS_ROOT, id);
const statusFile = (id: string) => path.join(jobDir(id), "status.json");

const STATES: readonly string[] = [
  "running",
  "done",
  "failed",
  "cancelled",
  "crashed",
] satisfies JobState[];

/** status.json is ours and written atomically; this only guards the fields every reader switches on. */
function isJobStatus(v: unknown): v is JobStatus {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    typeof v.id === "string" &&
    "state" in v &&
    typeof v.state === "string" &&
    STATES.includes(v.state)
  );
}

export function readStatus(id: string): JobStatus | null {
  if (!/^[\w.-]+$/u.test(id)) return null; // ids are ours; never let one walk out of JOBS_ROOT
  try {
    const parsed: unknown = JSON.parse(readFileSync(statusFile(id), "utf8"));
    return isJobStatus(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Atomic write: a reader polling mid-write must never see half a file. */
export function writeStatus(s: JobStatus): void {
  const f = statusFile(s.id);
  writeFileSync(f + ".tmp", JSON.stringify(s, null, 2));
  renameSync(f + ".tmp", f);
}

export function patchStatus(id: string, patch: Partial<JobStatus>): JobStatus {
  const s = { ...readStatus(id)!, ...patch };
  writeStatus(s);
  return s;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}

export function startJob(o: RenderOptions): JobStatus {
  const slug =
    path.basename(o.target.replace(/[?#].*$/u, "").replace(/\/+$/u, "")).replace(/\.html?$/u, "") ||
    "viz";
  const id = `${slug.replaceAll(/[^\w.-]/gu, "_")}-${Date.now().toString(36)}`;
  mkdirSync(jobDir(id), { recursive: true });
  const out = o.out || path.join(jobDir(id), `${slug}.mp4`);
  const log = path.join(jobDir(id), "render.log");
  writeFileSync(path.join(jobDir(id), "job.json"), JSON.stringify({ ...o, out }, null, 2));
  const status: JobStatus = {
    id,
    state: "running",
    pid: null,
    target: o.target,
    out,
    log,
    frame: 0,
    frames: 0,
    warnings: [],
    startedAt: new Date().toISOString(),
  };
  writeStatus(status);
  // detached → it outlives the CLI/MCP/UI call that started it.
  const fd = openSync(log, "a"); // one fd for both streams, so they append instead of clobbering
  const proc = Bun.spawn([process.execPath, RUNNER, id], {
    stdin: "ignore",
    stdout: fd,
    stderr: fd,
    detached: true,
    windowsHide: true,
  });
  proc.unref();
  return patchStatus(id, { pid: proc.pid });
}

const kill = (pid: number, sig: NodeJS.Signals) => {
  try {
    process.kill(pid, sig);
  } catch {
    /* already gone */
  }
};

/** The status, with a dead pid on a "running" job reported as the crash it is. */
export function jobStatus(id: string): JobStatus | null {
  const s = readStatus(id);
  if (s?.state === "running" && s.pid && !alive(s.pid)) {
    // Re-read before declaring a crash: the runner may have finished between the two reads.
    const again = readStatus(id)!;
    if (again.state !== "running") return again;
    for (const b of again.browsers ?? []) kill(b, "SIGKILL"); // orphaned by the dead runner
    return patchStatus(id, {
      state: "crashed",
      endedAt: new Date().toISOString(),
      error: `render process ${s.pid} died — see ${s.log}`,
    });
  }
  return s;
}

/**
 * Ask the runner to stop; it closes its browsers and records `cancelled` itself, so it
 * stays the only writer of its own state. Only a runner that ignores SIGTERM for 5s is
 * killed outright and marked here. Signals go to the pid, never its process group: the
 * viz server can be in that group (the runner may have started it).
 */
export async function cancelJob(id: string): Promise<JobStatus | null> {
  const s = jobStatus(id);
  if (!s || s.state !== "running" || !s.pid) return s;
  kill(s.pid, "SIGTERM");
  for (let i = 0; i < 50; i++) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each tick depends on the last
    await Bun.sleep(100);
    const now = readStatus(id)!;
    if (now.state !== "running" || !alive(s.pid)) return jobStatus(id);
  }
  kill(s.pid, "SIGKILL");
  for (const b of readStatus(id)?.browsers ?? []) kill(b, "SIGKILL");
  return patchStatus(id, { state: "cancelled", endedAt: new Date().toISOString() });
}

export async function waitJob(
  id: string,
  onTick?: (s: JobStatus) => void,
): Promise<JobStatus | null> {
  for (;;) {
    const s = jobStatus(id);
    if (!s || s.state !== "running") return s;
    onTick?.(s);
    // oxlint-disable-next-line no-await-in-loop -- polling: each tick depends on the last
    await Bun.sleep(500);
  }
}

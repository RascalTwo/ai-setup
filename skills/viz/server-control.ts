// server-control.ts — one place that knows how to find, start, stop and poke the server.
//
// WHY: the server's identity — port, pid file, log file, health URL, the path to
// server.ts — used to be re-declared in bootstrap.ts, re-derived in manage.ts, and
// half-known by server.ts itself. Starting it was a side effect of minting a slug,
// stopping it was a manage verb that rebuilt the pid path by hand, and "is it up?" was
// a bare HTTP route nothing wrapped. Four files, one daemon, no shared vocabulary.
//
// Everything about the running process lives here now, so the constants can only be
// wrong in one place, and `viz server start|stop|status|rescan` is a thin shell over it.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CENTRAL } from "./discovery.ts";

export const PORT = Number(process.env.VIZ_PORT ?? 5180);
export const SERVER_TS = path.join(import.meta.dir, "server.ts");
export const PID_FILE = path.join(CENTRAL, ".server.pid");
export const LOG_FILE = path.join(CENTRAL, ".server.log");
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const HEALTH_URL = `${BASE_URL}/_health`;

/**
 * "ours" — the viz server is answering. "foreign" — something else holds the port, so
 * starting would collide and serving would be wrong. "free" — nothing there.
 *
 * The distinction matters: a foreign process on 5180 must fail loudly rather than be
 * treated as a dead server and stomped.
 */
export async function probePort(): Promise<"ours" | "foreign" | "free"> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(500) });
    return res.ok && (await res.text()) === "OK" ? "ours" : "foreign";
  } catch {
    return "free";
  }
}

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export type ServerStatus = {
  running: boolean;
  state: "ours" | "foreign" | "free";
  port: number;
  pid: number | null;
  url: string;
  log: string;
};

export async function status(): Promise<ServerStatus> {
  const state = await probePort();
  return { running: state === "ours", state, port: PORT, pid: readPid(), url: BASE_URL, log: LOG_FILE };
}

/**
 * Start the server if it isn't already up, and wait until it answers. Idempotent:
 * returns "already" when it was running, so callers don't have to probe first.
 */
export async function start(): Promise<"already" | "started"> {
  const state = await probePort();
  if (state === "ours") return "already";
  if (state === "foreign") {
    throw new Error(`port ${PORT} is occupied by another process (it isn't the viz server). Free that port and retry.`);
  }
  const proc = Bun.spawn([process.execPath, SERVER_TS], {
    stdin: "ignore",
    stdout: Bun.file(LOG_FILE),
    stderr: Bun.file(LOG_FILE),
    windowsHide: true,
  });
  proc.unref();
  await Bun.write(PID_FILE, String(proc.pid));

  for (let i = 0; i < 30; i++) {
    if ((await probePort()) === "ours") return "started";
    await Bun.sleep(100);
  }
  throw new Error(`server did not come up within 3s — see ${LOG_FILE}`);
}

export async function stop(): Promise<{ stopped: boolean; pid: number | null; reason?: string }> {
  const pid = readPid();
  if (pid === null) return { stopped: false, pid: null, reason: "no .server.pid — server isn't running" };
  try {
    process.kill(pid);
    return { stopped: true, pid };
  } catch (e) {
    return { stopped: false, pid, reason: (e as Error).message };
  }
}

/** Deep-scan $HOME for viz-pages/ folders and re-register them. */
export async function rescan(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${BASE_URL}/_rescan`);
    return { ok: res.ok, detail: res.ok ? "repo-local vizzes re-registered" : `${res.status} ${res.statusText}` };
  } catch (e) {
    return { ok: false, detail: `no server at ${BASE_URL} (${(e as Error).message})` };
  }
}

/**
 * Cheap slug-map rebuild so a newly created viz routes immediately. Best-effort by
 * design — if it fails the next scan or restart picks the viz up anyway.
 */
export async function refresh(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/_refresh`, { signal: AbortSignal.timeout(1500) });
  } catch {
    /* best-effort */
  }
}

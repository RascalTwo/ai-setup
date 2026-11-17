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

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** What a running server says about itself; null when nothing of ours answers. */
async function health(): Promise<{ mode: TapeMode | "unknown"; pid: number | null } | null> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(500) });
    if (!res.ok || (await res.text()) !== "OK") return null;
    const pid = Number(res.headers.get("x-viz-pid"));
    const mode = res.headers.get("x-viz-mode");
    return {
      mode: mode === "live" || mode === "record" || mode === "frozen" ? mode : "unknown",
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    };
  } catch {
    return null;
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM"; // exists, just not ours to signal
  }
};

/**
 * The server's pid: the live one from /_health when it answers, else the pid file.
 * The file is a hint, not an authority — a supervisor (launchd KeepAlive) restarts the
 * server without writing it — so it is corrected when the live answer disagrees, and
 * removed when it names a dead process.
 */
async function livePid(): Promise<{ pid: number | null; mode: TapeMode | "unknown" | null }> {
  const h = await health();
  const filed = readPid();
  if (h?.pid) {
    if (filed !== h.pid) writeFileSync(PID_FILE, String(h.pid));
    return { pid: h.pid, mode: h.mode };
  }
  if (filed !== null && !alive(filed)) {
    rmSync(PID_FILE, { force: true });
    return { pid: null, mode: h?.mode ?? null };
  }
  return { pid: h ? filed : null, mode: h?.mode ?? null }; // an old server with no pid header
}

/** The tape-recorder mode (ADR 0003). A process-level flag: one server, one mode. */
export type TapeMode = "live" | "record" | "frozen";

export type ServerStatus = {
  running: boolean;
  /** null when not running; "unknown" for a server too old to report it. */
  mode: TapeMode | "unknown" | null;
  state: "ours" | "foreign" | "free";
  port: number;
  pid: number | null;
  url: string;
  log: string;
};

export async function status(): Promise<ServerStatus> {
  const state = await probePort();
  // Run even when nothing answers: that is when it tidies a pid file left by a dead server.
  const { pid, mode } = await livePid();
  return { running: state === "ours", state, mode, port: PORT, pid, url: BASE_URL, log: LOG_FILE };
}

/**
 * Start the server if it isn't already up, and wait until it answers. Idempotent:
 * returns "already" when it was running, so callers don't have to probe first.
 *
 * `mode` is only checked when asked for. The server is a singleton, so a request for a
 * mode it is not in cannot be honoured by starting a second one — it refuses and says how
 * to restart, rather than answering "already" and leaving you recording nothing. Callers
 * that just need A server (viz create) pass nothing and accept whatever mode is up.
 */
export async function start(mode?: TapeMode): Promise<"already" | "started"> {
  const state = await probePort();
  if (state === "ours") {
    const running = mode ? ((await health())?.mode ?? "unknown") : mode;
    if (running !== mode) {
      throw new Error(
        `the server is already running in ${running} mode, and it is one process with one mode — \`viz server stop\`, then start it again${mode === "live" ? "" : ` with --${mode}`}`,
      );
    }
    return "already";
  }
  if (state === "foreign") {
    throw new Error(
      `port ${PORT} is occupied by another process (it isn't the viz server). Free that port and retry.`,
    );
  }
  const proc = Bun.spawn(
    [process.execPath, SERVER_TS, ...(mode && mode !== "live" ? [`--${mode}`] : [])],
    {
      stdin: "ignore",
      stdout: Bun.file(LOG_FILE),
      stderr: Bun.file(LOG_FILE),
      windowsHide: true,
    },
  );
  proc.unref();
  await Bun.write(PID_FILE, String(proc.pid));

  for (let i = 0; i < 30; i++) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each probe waits on the last
    if ((await probePort()) === "ours") return "started";
    // oxlint-disable-next-line no-await-in-loop -- polling: each probe waits on the last
    await Bun.sleep(100);
  }
  throw new Error(`server did not come up within 3s — see ${LOG_FILE}`);
}

/**
 * `restarted` means the kill worked but something serves the port again within ~2s under a
 * new pid — a supervisor (launchd KeepAlive) brought it back. That is neither "stopped" nor
 * "failed", and calling it either sends the user chasing the wrong problem.
 */
export async function stop(): Promise<{
  stopped: boolean;
  pid: number | null;
  reason?: string;
  restarted?: number;
}> {
  const state = await probePort();
  if (state === "foreign")
    return {
      stopped: false,
      pid: null,
      reason: `port ${PORT} is held by something that is NOT the viz server — not killing it`,
    };
  const { pid } = await livePid();
  if (pid === null)
    return {
      stopped: false,
      pid: null,
      reason: "server isn't running (no live server, no live .server.pid)",
    };
  try {
    process.kill(pid);
  } catch (e) {
    return { stopped: false, pid, reason: e instanceof Error ? e.message : String(e) };
  }
  for (let i = 0; i < 20; i++) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each probe waits on the last
    await Bun.sleep(100);
    // oxlint-disable-next-line no-await-in-loop -- polling: each probe waits on the last
    const h = await health();
    if (h?.pid && h.pid !== pid) {
      writeFileSync(PID_FILE, String(h.pid));
      return {
        stopped: false,
        pid,
        restarted: h.pid,
        reason: `restarted by its supervisor (launchd KeepAlive) as pid ${h.pid} — \`launchctl bootout\` it first`,
      };
    }
  }
  rmSync(PID_FILE, { force: true });
  return { stopped: true, pid };
}

/** Deep-scan $HOME for viz-pages/ folders and re-register them. */
export async function rescan(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${BASE_URL}/_rescan`);
    return {
      ok: res.ok,
      detail: res.ok ? "repo-local vizzes re-registered" : `${res.status} ${res.statusText}`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: `no server at ${BASE_URL} (${e instanceof Error ? e.message : String(e)})`,
    };
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

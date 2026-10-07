// lib/library/server-cmds.ts — The server verbs, rendering what server-control.ts does.
//
// Extracted from the since-deleted manage.ts, which was 878 lines of everything.

import {
  rescan as serverRescan,
  stop as serverStop,
  start as serverStart,
  status as serverStatus,
} from "../../server-control.ts";
import { die, emit } from "../../cli.ts";
export async function cmdRescan(flags: Record<string, string | boolean>): Promise<void> {
  const r = await serverRescan();
  emit(flags, r, () => console.log(r.ok ? `✓ rescanned — ${r.detail}` : `⚠️  rescan: ${r.detail}`));
  // oxlint-disable-next-line unicorn/no-process-exit -- CLI verb: the exit code is the result
  if (!r.ok) process.exit(1);
}

export async function cmdStop(flags: Record<string, string | boolean>): Promise<void> {
  const r = await serverStop();
  emit(flags, r, () =>
    console.log(
      r.stopped
        ? `✓ stopped viz server (pid ${r.pid})`
        : r.restarted
          ? `⚠️  stopped pid ${r.pid}, but it was ${r.reason}`
          : `ERROR: ${r.reason}`,
    ),
  );
  // oxlint-disable-next-line unicorn/no-process-exit -- CLI verb: the exit code is the result
  if (!r.stopped) process.exit(r.restarted ? 1 : 2);
}

export async function cmdServerStatus(flags: Record<string, string | boolean>): Promise<void> {
  const s = await serverStatus();
  emit(flags, s, () =>
    console.log(
      s.running
        ? `✓ running — ${s.url} (pid ${s.pid ?? "unknown"})\n  log: ${s.log}`
        : s.state === "foreign"
          ? `⚠️  port ${s.port} is held by something that is NOT the viz server`
          : `not running (port ${s.port} free)`,
    ),
  );
}

export async function cmdServerStart(flags: Record<string, string | boolean>): Promise<void> {
  try {
    const r = await serverStart(
      flags.frozen === true ? "frozen" : flags.record === true ? "record" : undefined,
    );
    const s = await serverStatus();
    emit(flags, { result: r, ...s }, () =>
      console.log(
        r === "already" ? `✓ already running — ${s.url}` : `✓ started — ${s.url} (pid ${s.pid})`,
      ),
    );
  } catch (e) {
    die(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
}

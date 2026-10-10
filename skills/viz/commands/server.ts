// commands/server.ts — `viz server <start|stop|status|rescan>`.
//
// The thinnest group in the CLI, because server-control.ts already owns every bit of
// the behaviour. A command file's job is to declare the interface and render the
// result; if it starts containing logic, that logic belongs in lib/.

import type { Command } from "commander";
import { start, stop, status, rescan } from "../server-control.ts";
import { output, fail } from "../lib/output.ts";
import { meta } from "../lib/cli-meta.ts";

export function registerServer(program: Command): void {
  const server = program
    .command("server")
    .description("start, stop, inspect or rescan the local viz server");
  meta(server, {
    mcp: { kind: "grouped", group: "manage" },
    ui: {
      kind: "cli-only",
      why: "the UI is served BY the server, so it cannot start it, and stopping it from its own page would kill the page",
    },
  });

  server
    .command("status")
    .description("is the server up, on which port and pid")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      const s = await status();
      output(opts.json, s, () =>
        console.log(
          s.running
            ? `✓ running — ${s.url} (pid ${s.pid ?? "unknown"}, mode ${s.mode})\n  log: ${s.log}`
            : s.state === "foreign"
              ? `⚠️  port ${s.port} is held by something that is NOT the viz server`
              : `not running (port ${s.port} free)`,
        ),
      );
    });

  meta(server.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" },
    ui: { kind: "shown", how: "the dashboard's server panel reads /server-info" },
  });

  server
    .command("start")
    .description("start it if it isn't already up (idempotent)")
    .addHelpText(
      "after",
      `
--record and --frozen are the tape recorder (ADR 0003, reference/backend.md). They are
process-wide, and there is one server: if it is already up in another mode this refuses
rather than pretend — stop it, then start it in the mode you want.`,
    )
    .option("--record", "serve live AND tee every api response into the viz's recordings.json")
    .option("--frozen", "serve the recorded tape for every api call; the live backend is untouched")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean; frozen?: boolean; record?: boolean }) => {
      try {
        // frozen wins if both are given — the same precedence server.ts applies.
        const result = await start(opts.frozen ? "frozen" : opts.record ? "record" : undefined);
        const s = await status();
        output(opts.json, { result, ...s }, () =>
          console.log(
            result === "already"
              ? `✓ already running — ${s.url}`
              : `✓ started — ${s.url} (pid ${s.pid}${s.mode === "live" ? "" : `, mode ${s.mode}`})`,
          ),
        );
      } catch (e) {
        fail(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  server
    .command("stop")
    .description("stop the running server")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      const r = await stop();
      output(opts.json, r, () =>
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
    });

  server
    .command("rescan")
    .description("re-register repo-local vizzes now instead of waiting for a restart")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      const r = await rescan();
      output(opts.json, r, () =>
        console.log(r.ok ? `✓ rescanned — ${r.detail}` : `⚠️  rescan: ${r.detail}`),
      );
      // oxlint-disable-next-line unicorn/no-process-exit -- CLI verb: the exit code is the result
      if (!r.ok) process.exit(1);
    });
  meta(server.commands.at(-1)!, {
    mcp: { kind: "grouped", group: "manage" },
    ui: {
      kind: "shown",
      how: "the dashboard's Rescan button calls the server's own /_rescan route",
    },
  });
}

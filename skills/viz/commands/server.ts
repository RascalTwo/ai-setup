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
  meta(server, { mcp: { kind: "grouped", group: "manage" } });

  server
    .command("status")
    .description("is the server up, on which port and pid")
    .option("--json", "machine-readable output")
    .action(async (opts) => {
      const s = await status();
      output(opts.json, s, () =>
        console.log(
          s.running
            ? `✓ running — ${s.url} (pid ${s.pid ?? "unknown"})\n  log: ${s.log}`
            : s.state === "foreign"
              ? `⚠️  port ${s.port} is held by something that is NOT the viz server`
              : `not running (port ${s.port} free)`,
        ),
      );
    });

  server
    .command("start")
    .description("start it if it isn't already up (idempotent)")
    .option("--json", "machine-readable output")
    .action(async (opts) => {
      try {
        const result = await start();
        const s = await status();
        output(opts.json, { result, ...s }, () =>
          console.log(result === "already" ? `✓ already running — ${s.url}` : `✓ started — ${s.url} (pid ${s.pid})`),
        );
      } catch (e) {
        fail(`ERROR: ${(e as Error).message}`);
      }
    });

  server
    .command("stop")
    .description("stop the running server")
    .option("--json", "machine-readable output")
    .action(async (opts) => {
      const r = await stop();
      output(opts.json, r, () =>
        console.log(
          r.stopped
            ? `✓ stopped viz server (pid ${r.pid})\n  (launchd agents will restart it — \`launchctl bootout\` first)`
            : `ERROR: ${r.reason}`,
        ),
      );
      if (!r.stopped) process.exit(2);
    });

  server
    .command("rescan")
    .description("re-register repo-local vizzes now instead of waiting for a restart")
    .option("--json", "machine-readable output")
    .action(async (opts) => {
      const r = await rescan();
      output(opts.json, r, () => console.log(r.ok ? `✓ rescanned — ${r.detail}` : `⚠️  rescan: ${r.detail}`));
      if (!r.ok) process.exit(1);
    });
}

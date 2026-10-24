#!/usr/bin/env bun
// app-panel-progress — the `progress` tool from a shell: sends one update to this session's app-panel host,
// or wraps a command, showing it running and finishing it by its exit code.
//
//   app-panel-progress --title "viz tests" --eta 7m -- bun test     wrap a command
//   app-panel-progress --title deploy --stage build --stages build:2m,ship:30s   one update, like the tool
//
// Outside a herdr session with app-panel, it still runs the command, just without a bar.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Progress } from "./lib.ts";

const SESSIONS = process.env["APP_PANEL_SESSIONS"] ?? path.join(homedir(), ".agents/state/app-panel/sessions");
const cut = process.argv.indexOf("--");
const cmd = cut < 0 ? [] : process.argv.slice(cut + 1);
const { values: o } = parseArgs({
  args: process.argv.slice(2, cut < 0 ? undefined : cut),
  options: {
    title: { type: "string" }, stage: { type: "string" }, stages: { type: "string" }, eta: { type: "string" },
    done: { type: "string" }, total: { type: "string" }, status: { type: "string" }, note: { type: "string" },
  },
});
if (!o.title) {
  console.error('usage: app-panel-progress --title <name> [--eta 7m] [--stage S] [--stages a:5s,b:2m] [--done N --total M] [--status done|failed] [--note text] [-- command...]');
  process.exit(2);
}

/** "90", "90s", "7m", "1h" → seconds. */
const seconds = (t: string): number => {
  const m = t.match(/^(\d+(?:\.\d+)?)([smh]?)$/);
  if (!m) throw new Error(`--eta: can't read "${t}" (try 90s, 7m or 1h)`);
  return Number(m[1]) * { "": 1, s: 1, m: 60, h: 3600 }[m[2] as "" | "s" | "m" | "h"];
};

const pane = process.env["HERDR_PANE_ID"];
const file = pane && path.join(SESSIONS, `${pane.replace(/[^\w.-]/g, "_")}.json`);
const url = file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { url: string }).url : undefined;

// A missing or gone panel never fails the command: the bar is a nicety.
async function send(p: Progress): Promise<void> {
  if (!url) return;
  await fetch(url, { method: "POST", body: JSON.stringify(p) }).catch(() => {});
}

const update: Progress = {
  title: o.title,
  ...(o.stage && { stage: o.stage }),
  // "lint:5s,test:2m" names each stage with its estimate; a bare name has none.
  ...(o.stages && { stages: o.stages.split(",").map((s) => { const [name, eta] = s.trim().split(":") as [string, string?]; return eta ? { name, eta: seconds(eta) } : name; }) }),
  ...(o.eta && { eta: seconds(o.eta) }),
  ...(o.done && { done: Number(o.done) }),
  ...(o.total && { total: Number(o.total) }),
  ...(o.status && { status: o.status as Progress["status"] }),
  ...(o.note && { note: o.note }),
};
if (!url) console.error("app-panel-progress: no app-panel for this session, so no bar");
if (!cmd.length) {
  await send(update);
  process.exit(0);
}

await send({ ...update, status: "running" });
// Its stderr passes through as it comes, and its tail is kept as the reason when it fails.
const child = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "pipe" });
let tail = "";
const text = new TextDecoder();
for await (const chunk of child.stderr) {
  process.stderr.write(chunk);
  tail = (tail + text.decode(chunk, { stream: true })).slice(-2000);
}
const code = await child.exited;
const why = tail.trim().split("\n").slice(-3).join("\n");
await send({ title: o.title, status: code === 0 ? "done" : "failed", ...(code !== 0 && { note: `exit ${code}${why ? `\n${why}` : ""}` }) });
process.exit(code);

#!/usr/bin/env node
// The critic: scores screenshots and returns ranked, located issues as JSON on stdout.
// The proof harness and the loop both call this file, so what was proved is what runs.
// Usage: node critic.ts [--model sonnet|opus|fable] [--brief brief.md] [--checks checks.md] shot1.png [shot2.png ...]
// The brief says what the screen is for and what is intentional, so intended design is not reported as a fault.
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODELS: Record<string, string> = {
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-2",
};
const EFFORT = "medium";
const here = import.meta.dirname;

export type Issue = {
  severity: "blocker" | "major" | "minor";
  dimension: string;
  shot: number;
  box: [number, number, number, number];
  what: string;
};
export type Verdict = {
  dims: Record<"legibility" | "layout" | "hierarchy" | "polish", number>;
  overall: number;
  issues: Issue[];
  checks: { check: string; pass: boolean; note: string }[];
  model: string;
  secs: number;
  cost: number;
};

/** Runs a command with `input` on its stdin; a non-zero exit is a result, not a throw. */
export function exec(cmd: string[], opts: { cwd?: string; input?: string } = {}): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve, reject) => {
    const [bin = "", ...args] = cmd;
    const p = spawn(bin, args, { cwd: opts.cwd, stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    p.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ out, err, code: code ?? 1 }));
    p.stdin?.on("error", () => {}); // the child may exit before reading it all
    p.stdin?.end(opts.input);
  });
}

export function pngSize(buf: Buffer): [number, number] {
  if (buf.toString("ascii", 1, 4) !== "PNG") throw new Error("critic takes PNG screenshots only");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// The screenshots as message content: a numbered label, then the image, for each one.
export function images(shots: string[], label = "Screenshot", from = 1): unknown[] {
  return shots.flatMap((path, i) => {
    const buf = readFileSync(path);
    const [w, h] = pngSize(buf);
    return [
      { type: "text", text: `${label} ${i + from} (${w}x${h} pixels):` },
      { type: "image", source: { type: "base64", media_type: "image/png", data: buf.toString("base64") } },
    ];
  });
}

export async function critique(shots: string[], opts: { model?: string; brief?: string; checks?: string } = {}): Promise<Verdict> {
  const content = images(shots);
  if (opts.brief) {
    content.push({
      type: "text",
      text: `The builder's brief for these screens, saying what they are for and what is intentional. Judge against it: anything it says is intended is not a problem.\n${opts.brief}`,
    });
  }
  content.push({
    type: "text",
    text: opts.checks
      ? `Task checks, judge each one:\n${opts.checks}`
      : "No task checks for this screen set; return an empty checks list.",
  });
  return ask(content, readFileSync(join(here, "prompt.md"), "utf8"), readFileSync(join(here, "schema.json"), "utf8"), opts.model);
}

// One isolated, tool-less `claude -p` call that must answer in the given JSON schema. The loop proof's judge reuses it.
export async function ask(content: unknown[], system: string, schema: string, modelName?: string): Promise<any> {
  const model = MODELS[modelName ?? "sonnet"] ?? modelName!;
  const msg = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";

  // Empty cwd and empty setting sources: no CLAUDE.md, skills, hooks or MCP reach the critic.
  const cwd = mkdtempSync(join(tmpdir(), "critic-"));
  const t0 = Date.now();
  const { out, err, code } = await exec(
    [
      "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--model", model, "--effort", EFFORT,
      "--system-prompt", system,
      "--json-schema", schema,
      "--tools", "", "--setting-sources=", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
    ],
    { cwd, input: msg },
  );
  rmSync(cwd, { recursive: true, force: true });
  const last = out.trim().split("\n").at(-1) ?? "";
  let result: any;
  try {
    result = JSON.parse(last);
  } catch {
    throw new Error(`critic: claude exited ${code}, unparseable output: ${out.slice(0, 400)} ${err.slice(0, 400)}`);
  }
  if (result.is_error || !result.structured_output) {
    throw new Error(`critic: no verdict (exit ${code}): ${last.slice(0, 600)} ${err.slice(0, 300)}`);
  }
  return { ...result.structured_output, model, secs: (Date.now() - t0) / 1000, cost: result.total_cost_usd ?? 0 };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { model: { type: "string", default: "sonnet" }, brief: { type: "string" }, checks: { type: "string" } },
    allowPositionals: true,
  });
  if (!positionals.length) {
    console.error("usage: node critic.ts [--model sonnet|opus|fable] [--brief brief.md] [--checks checks.md] shot.png ...");
    process.exit(2);
  }
  const read = (f?: string) => (f ? readFileSync(f, "utf8") : undefined);
  console.log(JSON.stringify(await critique(positionals, { model: values.model, brief: read(values.brief), checks: read(values.checks) }), null, 1));
}

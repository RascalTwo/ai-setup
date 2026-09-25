// lib/create/git.ts — Git against the central viz repo, plus session-id detection for commit trailers.
//
// Extracted from bootstrap.ts.

import { die } from "../../cli.ts";
import path from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { CENTRAL, HOME } from "../../discovery.ts";

const VIZ_ROOT = CENTRAL;

export async function gitOut(args: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const out = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 ? out : null;
  } catch {
    return null;
  }
}

export async function gitCentral(args: string[]): Promise<void> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: VIZ_ROOT,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    die("ERROR: git not found on PATH. Install git and retry.");
  }
}

export function detectSessionId(): string {
  const envId = process.env.CLAUDE_CODE_SESSION_ID;
  if (envId) return envId;
  const projSlug = process.cwd().replace(/[/\\:]/g, "-");
  const projDir = path.join(HOME, ".claude", "projects", projSlug);
  try {
    if (existsSync(projDir)) {
      const latest = readdirSync(projDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({ f, m: statSync(path.join(projDir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)[0];
      if (latest) return path.basename(latest.f, ".jsonl");
    }
  } catch {
    // best-effort — fall through to timestamp
  }
  return "ts-" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

// Keep transient/generated per-viz files out of git in every viz container — central and
// repo-local alike: `comments.json` (review scratch) and `og.auto.png` (the auto-rendered OG
// card, regenerated from hero.html / the live page on every build — an artifact, not source).
// Idempotent: appends only the entries that are missing. A .gitignore takes effect on disk
// whether or not it's itself committed.

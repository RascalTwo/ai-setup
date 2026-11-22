// What a vendored runtime IS, in one place. Both writers import this: `viz create --runtime`
// stamps one, sync-runtimes.ts re-stamps the ones that already exist.
//
// It lives in its own module so the two share one file list. The alternative — copying
// the list into the sweeper — would let the two lists drift, which is the exact class of
// bug the sweeper exists to fix.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

// The serve core. NOT the whole skill: no publish, library, verify or create code —
// a cloner serves vizzes, they don't publish, manage or scaffold them (ADR 0004).
//
// This list is load-bearing and easy to get wrong: server.ts grew imports of cli.ts and
// server-control.ts when it gained flag parsing, and the list was not updated, so every
// runtime stamped after that would have failed to boot on a missing module. Nothing
// caught it because no test ever booted a vendored copy. There is one now.
export const RUNTIME_FILES = [
  "server.ts",
  "discovery.ts",
  "recordings.ts",
  "tape-key.js",
  "cli.ts", // server.ts parses its own flags
  "server-control.ts", // PORT, and the health/pid vocabulary
  "lib/write.ts", // discovery and server-control write files through it
  "lib/proc.ts", // lib/server/ runs git and other commands through it
];

/** Directories copied whole. lib/server/ is the server itself, split out of server.ts. */
export const RUNTIME_DIRS = ["kit", "lib/server"];

// Vendor a verbatim copy of the serve runtime into <container>/.runtime/ so the host
// repo runs standalone with no skill installed. The server self-detects standalone mode
// from this location. cpSync overwrites, so stamping is idempotent. The dot-prefix keeps
// the central server's discovery from ever mistaking .runtime/ for a viz.
//
// Copies whatever is on disk RIGHT NOW, including uncommitted edits — callers that stamp
// into other people's repos should check the result resolves (see sync-runtimes.ts).
// Anything already in runtimeDir that this stamp would not write is deleted first: a re-stamp
// that only overwrote kept files the skill dropped long ago (a copy still carried kit/comments.js).
export function vendorRuntime(skillDir: string, runtimeDir: string): void {
  mkdirSync(runtimeDir, { recursive: true });
  for (const rel of readdirSync(runtimeDir, { recursive: true, encoding: "utf8" }).toSorted())
    if (!shipped(skillDir, rel))
      rmSync(path.join(runtimeDir, rel), { recursive: true, force: true });
  for (const f of RUNTIME_FILES) {
    mkdirSync(path.dirname(path.join(runtimeDir, f)), { recursive: true });
    cpSync(path.join(skillDir, f), path.join(runtimeDir, f));
  }
  for (const d of RUNTIME_DIRS) {
    mkdirSync(path.join(runtimeDir, d), { recursive: true });
    // kit/src is the kit's TypeScript source; a runtime serves the generated kit/*.js beside it.
    cpSync(path.join(skillDir, d), path.join(runtimeDir, d), {
      recursive: true,
      filter: (s) => !(path.basename(s) === "src" && path.basename(path.dirname(s)) === "kit"),
    });
  }
}

/** Would a stamp write `rel` (a file, or a folder on the way to one)? */
function shipped(skillDir: string, rel: string): boolean {
  const parts = rel.split(path.sep);
  if (parts[0] === "kit" && parts[1] === "src") return false;
  const top = RUNTIME_DIRS.find((d) => rel === d || rel.startsWith(d + path.sep));
  if (top) return existsSync(path.join(skillDir, rel));
  return (
    RUNTIME_FILES.some((f) => f === rel) ||
    [...RUNTIME_FILES, ...RUNTIME_DIRS].some((f) => f.startsWith(rel + path.sep))
  );
}

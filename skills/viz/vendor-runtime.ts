// What a vendored runtime IS, in one place. Both writers import this: bootstrap.ts
// stamps one on `--runtime`, sync-runtimes.ts re-stamps the ones that already exist.
//
// It lives in its own module rather than in bootstrap.ts because bootstrap is a script
// with top-level side effects (it parses argv and dies on a missing slug), so importing
// it to reuse one function would run the whole CLI. The alternative — copying the file
// list into the sweeper — would let the two lists drift, which is the exact class of bug
// the sweeper exists to fix.

import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";

// The serve core. NOT the whole skill: no build.ts, manage.ts, verify.ts or bootstrap.ts —
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
  "cli.ts",            // server.ts parses its own flags
  "server-control.ts", // PORT, and the health/pid vocabulary
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
export function vendorRuntime(skillDir: string, runtimeDir: string): void {
  mkdirSync(runtimeDir, { recursive: true });
  for (const f of RUNTIME_FILES) {
    cpSync(path.join(skillDir, f), path.join(runtimeDir, f));
  }
  for (const d of RUNTIME_DIRS) {
    mkdirSync(path.join(runtimeDir, d), { recursive: true });
    cpSync(path.join(skillDir, d), path.join(runtimeDir, d), { recursive: true });
  }
}

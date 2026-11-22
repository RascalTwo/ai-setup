// lib/copy.ts — a mirror (`viz publish`) or a vendored copy (`viz vendor`) is a projection of a viz that lives somewhere else.
//
// Its source is checked where it lives: lint, types, format and tests run at the origin, never on the copy (a second run
// would report the same finding twice, and a copy's fix belongs at the origin and then a re-sync). What is still done on the
// copy is what only it can show: the rendered page.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const COPY_MARKERS = [".mirror.json", ".vendored.json"];

export const isCopy = (dir: string): boolean =>
  COPY_MARKERS.some((m) => existsSync(path.join(dir, m)));

/** Where the source checks run for `dir`: the dir itself, or for a vendored copy its origin when the receipt names one that
 *  exists on this machine. A mirror's origin is an opaque id, so null; null too when the origin is not here. */
export function sourceDirFor(dir: string): string | null {
  if (!isCopy(dir)) return dir;
  try {
    const receipt: unknown = JSON.parse(readFileSync(path.join(dir, ".vendored.json"), "utf8"));
    const origin =
      typeof receipt === "object" && receipt !== null
        ? new Map<string, unknown>(Object.entries(receipt)).get("origin")
        : undefined;
    const abs = typeof origin === "string" && origin ? path.join(os.homedir(), origin) : "";
    return abs && existsSync(path.join(abs, "index.html")) ? abs : null;
  } catch {
    return null;
  }
}

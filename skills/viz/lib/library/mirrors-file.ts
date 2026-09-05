// lib/library/mirrors-file.ts — Raw read/write of a container's mirrors.json.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- mirrors.json raw read/write (fail-closed on write via publish's validator) ----
// One manifest, two edge kinds (ADR 0010): `mirrors` ship a built artifact, `vendors`
// ship a verbatim source copy. Same file so they share the gitignore nudge, the commit
// filter and one validator — and so a slug declared as both can be caught.
import { validateMirrors } from "../publish/mirrors.ts";
import { die } from "../../cli.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nativeSlugsOf } from "./viz.ts";

export type RawTarget = { path: string; vizzes: any[] };
export type RawMirrors = { mirrors: RawTarget[]; vendors?: RawTarget[] };
export type EdgeKind = "mirrors" | "vendors";

export function loadMirrorsRaw(file: string): RawMirrors {
  if (!existsSync(file)) return { mirrors: [] };
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    if (!j || typeof j !== "object") return { mirrors: [] };
    // Preserve a `vendors` array even when `mirrors` is absent/garbage, so a
    // vendor-only manifest survives a round-trip through any mirror command.
    return { mirrors: Array.isArray(j.mirrors) ? j.mirrors : [], ...(Array.isArray(j.vendors) ? { vendors: j.vendors } : {}) };
  } catch (e) {
    die(`ERROR: ${file} is not valid JSON: ${(e as Error).message}`, 2);
  }
}

// Drop empty targets and an empty vendors array, so removing the last edge leaves a
// clean file rather than a litter of `{"path": …, "vizzes": []}` husks.
export function tidyRaw(raw: RawMirrors): RawMirrors {
  raw.mirrors = (raw.mirrors ?? []).filter((t) => t.vizzes?.length);
  if (raw.vendors) {
    raw.vendors = raw.vendors.filter((t) => t.vizzes?.length);
    if (!raw.vendors.length) delete raw.vendors;
  }
  return raw;
}

export function writeMirrors(file: string, raw: RawMirrors, container: string): void {
  const { errors } = validateMirrors(raw, container, nativeSlugsOf(container));
  if (errors.length) die(`ERROR: refusing to write invalid ${file} — NOTHING written:\n  - ${errors.join("\n  - ")}`, 2);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
}

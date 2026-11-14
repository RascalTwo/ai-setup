// lib/library/hidden.ts — Tags that keep a viz out of the default listings (ADR 0020).
//
// Some vizzes are working material, not things you browse for — a grill session's pages
// are the first case. They still exist, still serve and still show up with `--all`; they
// just don't crowd `viz ls`, `viz search`, the self-portrait or a lobby by default.
//
// The list is DATA, not a const: the skill ships viz.config.json at its root, and a
// viz.config.json at the central library root replaces it whole (no merge — one file
// decides, so "why is this hidden?" has one answer).

import { CENTRAL } from "../../discovery.ts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FILES = [
  path.join(CENTRAL, "viz.config.json"),
  path.resolve(import.meta.dir, "../../viz.config.json"),
];

/** The configured hidden tags; [] if no config file exists. A malformed file throws, naming it. */
export function hiddenTags(): string[] {
  const file = FILES.find((f) => existsSync(f));
  if (!file) return [];
  let tags: unknown;
  try {
    const json: unknown = JSON.parse(readFileSync(file, "utf8"));
    tags =
      (typeof json === "object" && json !== null && "hiddenTags" in json
        ? json.hiddenTags
        : undefined) ?? [];
  } catch (e) {
    throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))
    throw new Error(`${file}: "hiddenTags" must be an array of strings`);
  return tags;
}

/** True if any of a viz's tags is configured hidden. */
export const isHidden = (tags: string[], hidden = hiddenTags()): boolean =>
  tags.some((t) => hidden.includes(t));

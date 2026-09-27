// lib/library/templates.ts — Templates: vizzes a new viz can start from.
//
// A template is an ORDINARY viz that declares <meta name="viz:template" content="<kind>">.
// The built-ins ship in the skill's bundled viz-pages/; any other container (the central
// library, a repo's viz-pages/) can hold more. There is no registry — like ls, this is a
// derived view over what is on disk.
//
// A template's NAME is its folder name. Names may repeat across containers (ADR 0008:
// only a path is unique), so a name resolves only when exactly one template has it.

import path from "node:path";
import { existsSync } from "node:fs";
import { HOME, deepScan, readRegistry, writeRegistry } from "../../discovery.ts";
import { corpus, type Row } from "./list.ts";
import { die } from "../../cli.ts";

/** Scan $HOME for viz-pages/ folders the registry doesn't know yet — a repo cloned since the
 *  server last scanned — and save them. Without this a template there is silently missing,
 *  and the agent never learns to ask about it. ~5s over a large $HOME: paid once per list,
 *  not per create. VIZ_SCAN_ROOT narrows it (the test suite points it at its sandbox). */
export async function rescan(): Promise<void> {
  const found = await deepScan(process.env.VIZ_SCAN_ROOT || HOME);
  await writeRegistry([...new Set([...readRegistry(), ...found])]);
}

export type Template = { name: string; kind: string; title: string; desc: string; dir: string; id: string; duplicate: boolean };

/** Every template (optionally of one kind), sorted by kind then name. `duplicate` marks a
 *  name more than one template shares — those can only be named by path. */
export function listTemplates(kind?: string): Template[] {
  const all = corpus()
    .filter((r: Row) => r.template)
    .map((r) => ({ name: path.basename(r.dir), kind: r.template, title: r.title, desc: r.desc, dir: r.dir, id: r.id, duplicate: false }));
  const count = new Map<string, number>();
  for (const t of all) count.set(t.name, (count.get(t.name) ?? 0) + 1);
  for (const t of all) t.duplicate = count.get(t.name)! > 1;
  return all
    .filter((t) => !kind || t.kind === kind.toLowerCase())
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** --from takes a path (absolute, containing a separator, or starting with . or ~) or a
 *  template name. Backslash counts too: the .mcpb ships to Windows. */
export const looksLikePath = (s: string) =>
  path.isAbsolute(s) || /[\\/]/.test(s) || s.startsWith(".") || s.startsWith("~");

/** The folder of the ONE template named `name`. Exits the process (via die) when none or
 *  several have it — never guesses. A miss rescans once before giving up, so a template in a
 *  freshly cloned repo still resolves. `bareDir`, if it exists, is used when no template has
 *  the name, so a bare folder name in the cwd still works as it did before templates. */
export async function resolveTemplate(name: string, bareDir?: string): Promise<string> {
  let hits = listTemplates().filter((t) => t.name === name);
  if (!hits.length) {
    await rescan();
    hits = listTemplates().filter((t) => t.name === name);
  }
  if (hits.length === 1) return hits[0].dir;
  if (!hits.length && bareDir && existsSync(bareDir)) return bareDir;
  if (!hits.length) {
    die(`ERROR: no template named '${name}'. See them with \`viz templates\`, or pass a path to a viz folder.`);
  }
  die(
    `ERROR: ${hits.length} templates are named '${name}' — pass the path of the one you mean:\n` +
      hits.map((t) => `  ${t.dir}`).join("\n"),
  );
}

/** `viz templates [kind]`: rescan, then a human listing, or --json. */
export async function cmdTemplates(kind: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  await rescan();
  const ts = listTemplates(kind);
  if (flags.json === true) {
    console.log(JSON.stringify(ts, null, 2));
    return;
  }
  if (!ts.length) {
    console.log(kind ? `(no templates of kind '${kind}')` : "(no templates)");
    return;
  }
  for (const t of ts) {
    const dupe = t.duplicate ? "  ⚠ name shared with another template — use its path" : "";
    console.log(`${t.kind.padEnd(12)}  ${t.name}${dupe}\n${" ".repeat(14)}${t.desc || t.title}\n${" ".repeat(14)}${t.dir}`);
  }
  console.log(`\n${ts.length} template(s). Start from one:  viz create <slug> --from <name>`);
}

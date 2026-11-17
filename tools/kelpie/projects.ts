// Creating, editing, retiring and reordering project files (`kelpie project …`, and the board's editor).
// A file is checked by the same loadProjects the tick uses before it is written, so a save can't
// leave a project the tick would choke on. Retiring renames to .md.retired: reversible, as by hand.
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjects } from "./dispatcher.ts";

const ID = /^[a-z0-9][a-z0-9-]*$/;
const file = (dir: string, id: string, retired = false) => join(dir, "projects", `${id}.md${retired ? ".retired" : ""}`);

function id_(id: string) {
  if (!ID.test(id)) throw new Error(`"${id}" isn't a project id: lowercase letters, digits and dashes`);
  return id;
}

/** Throws loadProjects' own error (naming the field) if the text isn't a valid project file;
 * with `colors`, also if its Project colour isn't in the plan. */
export function check(id: string, text: string, colors?: string[]) {
  const tmp = mkdtempSync(join(tmpdir(), "kelpie-project-"));
  try {
    mkdirSync(join(tmp, "projects"));
    writeFileSync(file(tmp, id_(id)), text);
    let p;
    try { [p] = loadProjects(tmp); }
    catch (e: any) { throw new Error(e.message.replace(file(tmp, id), `${id}.md`)); }
    if (p && colors && !colors.includes(p.color)) throw new Error(`${id}.md: no Project colour "${p.color}" in the plan (have: ${colors.join(", ")})`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Every project file, live and retired, with its text: what the board's editor lists. */
export function list(dir: string): { id: string; retired: boolean; text: string }[] {
  const pdir = join(dir, "projects");
  if (!existsSync(pdir)) return [];
  return readdirSync(pdir).flatMap(f => {
    const m = f.match(/^(.+)\.md(\.retired)?$/);
    return m?.[1] ? [{ id: m[1], retired: !!m[2], text: readFileSync(join(pdir, f), "utf8") }] : [];
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function save(dir: string, id: string, text: string, isNew: boolean, colors?: string[]) {
  if (isNew && (existsSync(file(dir, id_(id))) || existsSync(file(dir, id, true)))) throw new Error(`a project "${id}" already exists${existsSync(file(dir, id, true)) ? " (retired: restore it)" : ""}`);
  if (!isNew && !existsSync(file(dir, id_(id)))) throw new Error(`no project "${id}"`);
  check(id, text, colors);
  mkdirSync(join(dir, "projects"), { recursive: true });
  writeFileSync(file(dir, id), text);
}

export function retire(dir: string, id: string, back = false) {
  const [from, to] = [file(dir, id_(id), back), file(dir, id, !back)];
  if (!existsSync(from)) throw new Error(`no ${back ? "retired " : ""}project "${id}"`);
  if (existsSync(to)) throw new Error(`${to} is in the way`);
  renameSync(from, to);
}

/** Swap priorities with the next project up or down the order: row order on the board is priority. */
export function move(dir: string, id: string, way: "up" | "down") {
  const order = loadProjects(dir);
  const i = order.findIndex(p => p.id === id_(id)), j = way === "up" ? i - 1 : i + 1;
  const a = order[i], b = order[j];
  if (!a) throw new Error(`no project "${id}"`);
  if (!b) throw new Error(`${id} is already ${way === "up" ? "first" : "last"}`);
  // Projects without a priority sort last by name; giving both numbers makes the swap stick.
  const pa = a.priority ?? i, pb = b.priority ?? j;
  setPriority(dir, a.id, pb === pa ? pb + (way === "up" ? -1 : 1) : pb);
  setPriority(dir, b.id, pa);
}

function setPriority(dir: string, id: string, n: number) {
  const f = file(dir, id), text = readFileSync(f, "utf8");
  const next = /^priority:.*$/m.test(text.split(/\n---\n/)[0] ?? "") ? text.replace(/^priority:.*$/m, `priority: ${n}`) : text.replace(/^---\n/, `---\npriority: ${n}\n`);
  writeFileSync(f, next);
}

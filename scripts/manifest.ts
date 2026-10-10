// The rascaltwo-ai-setup manifest: the block in each SKILL.md / tool README frontmatter.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const REPO = join(import.meta.dir, "..");

/** What a skill or tool needs. Direct needs only; skills are followed transitively. */
export type Requires = {
  skills?: string[];   // in skills/ here, or listed in external-skills.json
  tools?: string[];    // in tools/ here
  commands?: string[]; // must be on PATH
  manual?: string[];   // human setup (apps, MCP servers, the Chrome extension), shown verbatim
};
export const REQUIRES_KEYS = ["skills", "tools", "commands", "manual"] as const;

export type Owned = {
  name: string;
  kind: "skill" | "tool";
  manifest: Record<string, unknown> & { requires?: Requires };
  noManifest?: boolean;
};

/** Every tool and skill, read off the frontmatter that already declares them. */
export function owned(): Owned[] {
  const out: Owned[] = [];
  for (const [dir, file, kind] of [["tools", "README.md", "tool"], ["skills", "SKILL.md", "skill"]] as const) {
    const root = join(REPO, dir);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const p = join(REPO, dir, name, file);
      if (!existsSync(p)) continue;
      // A skill with no manifest used to be skipped here, silently — so it never needed a
      // poster. Keep it owned, flagged `noManifest`, so the checker reports it.
      // Strict YAML: an unquoted ": " in a description throws here, which is the point.
      const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(p, "utf8"));
      const man = fm && (Bun.YAML.parse(fm[1]) as Record<string, unknown>)["rascaltwo-ai-setup"];
      if (!man || typeof man !== "object") { out.push({ name, kind, manifest: {}, noManifest: true }); continue; }
      out.push({ name, kind, manifest: man as Owned["manifest"] });
    }
  }
  return out;
}

/** Skill names installable from elsewhere, by source repo (external-skills.json). */
export function externalSkills(): Record<string, string[]> {
  return JSON.parse(readFileSync(join(REPO, "external-skills.json"), "utf8")).repos;
}

/** A `manual` entry only the full setup provides; it switches the strip to `bun install.ts`. */
export const SUBAGENTS = "ai-setup subagents";
export const HOME_REPO = "RascalTwo/ai-setup";

/** Everything installing `o` brings: skills grouped by source repo, and every need, flattened. */
export function closure(o: Owned, all: Owned[]) {
  const ext = externalSkills();
  const find = (kind: string, n: string) => all.find((x) => x.kind === kind && x.name === n);
  const skills = new Set<string>(), tools = new Set<string>(), commands = new Set<string>(), manual = new Set<string>();
  const walk = (x: Owned) => {
    const r = x.manifest.requires ?? {};
    r.commands?.forEach((c) => commands.add(c));
    r.manual?.forEach((m) => manual.add(m));
    for (const t of r.tools ?? []) if (!tools.has(t)) { tools.add(t); const tt = find("tool", t); if (tt) walk(tt); }
    for (const s of r.skills ?? []) if (!skills.has(s)) { skills.add(s); const ss = find("skill", s); if (ss) walk(ss); }
  };
  walk(o);
  const repos: Record<string, string[]> = o.kind === "skill" ? { [HOME_REPO]: [o.name] } : {};
  for (const s of skills) {
    if (s === o.name) continue;
    const repo = find("skill", s) ? HOME_REPO : Object.keys(ext).find((k) => ext[k].includes(s))!;
    (repos[repo] ??= []).push(s);
  }
  return { repos, tools: [...tools], commands: [...commands], manual: [...manual] };
}

/** Problems with one manifest's `requires`, as human-readable lines. */
export function requiresProblems(o: Owned, all: Owned[]): string[] {
  const r = o.manifest.requires;
  if (r === undefined) return [];
  if (!r || typeof r !== "object" || Array.isArray(r)) return ["requires must be a map of skills/tools/commands/manual, not a flat list"];
  const out: string[] = [];
  const ext = new Set(Object.values(externalSkills()).flat());
  const has = (kind: string, n: string) => all.some((x) => x.kind === kind && x.name === n);
  for (const [k, v] of Object.entries(r)) {
    if (!(REQUIRES_KEYS as readonly string[]).includes(k)) { out.push(`requires.${k} is not one of ${REQUIRES_KEYS.join("/")}`); continue; }
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) { out.push(`requires.${k} must be a list of names`); continue; }
    for (const n of v) {
      if (k === "skills" && !has("skill", n) && !ext.has(n)) out.push(`requires.skills names ${n}: not in skills/ or external-skills.json`);
      if (k === "tools" && !has("tool", n)) out.push(`requires.tools names ${n}: not in tools/`);
    }
  }
  return out;
}

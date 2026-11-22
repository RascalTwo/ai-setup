// scripts/manifest.ts: the rascaltwo-ai-setup block each SKILL.md / tool README declares, and what installing one brings.
import { expect, test } from "vitest";
import { closure, externalSkills, HOME_REPO, owned, requiresProblems, type Owned } from "../scripts/manifest.ts";

const skill = (name: string, requires?: Owned["manifest"]["requires"]): Owned => ({ name, kind: "skill", manifest: requires ? { requires } : {} });
const tool = (name: string, requires?: Owned["manifest"]["requires"]): Owned => ({ name, kind: "tool", manifest: requires ? { requires } : {} });
const [lockedRepo, lockedSkills] = Object.entries(externalSkills())[0];

test("every tool and skill on disk is read, its frontmatter parsed as YAML", () => {
  // WHEN the repo's tools and skills are read
  const all = owned();
  // THEN skills and tools are both there, and a skill's manifest is the parsed map, not text
  expect(all.some((o) => o.kind === "tool")).toBe(true);
  const viz = all.find((o) => o.kind === "skill" && o.name === "viz");
  expect(viz?.noManifest).toBeUndefined();
  expect(typeof viz?.manifest).toBe("object");
});

test("installing a skill brings its skills, tools, commands and manual steps, followed transitively", () => {
  // GIVEN a skill needing another skill, a tool and a command, and that tool needing a command and a manual step
  const all = [
    skill("a", { skills: ["b"], tools: ["t"], commands: ["git"] }),
    skill("b", { commands: ["jq"] }),
    tool("t", { commands: ["node"], manual: ["a browser extension"] }),
  ];
  // WHEN a is closed over
  const c = closure(all[0], all);
  // THEN everything below it is listed once, and local skills come from this repo
  expect(c.repos).toEqual({ [HOME_REPO]: ["a", "b"] });
  expect(c.tools).toEqual(["t"]);
  expect(c.commands.toSorted()).toEqual(["git", "jq", "node"]);
  expect(c.manual).toEqual(["a browser extension"]);
});

test("a skill locked in skills-lock.json is grouped under its source repo, and a tool names no skill of its own", () => {
  // GIVEN a tool that needs a locked skill
  const t = tool("t", { skills: [lockedSkills[0]] });
  // WHEN closed over
  const c = closure(t, [t]);
  // THEN the locked skill is under its source repo and the tool adds none under this one
  expect(c.repos).toEqual({ [lockedRepo]: [lockedSkills[0]] });
});

test("a cycle between two needs does not loop", () => {
  const all = [skill("a", { skills: ["b"] }), skill("b", { skills: ["a"] })];
  expect(closure(all[0], all).repos).toEqual({ [HOME_REPO]: ["a", "b"] });
});

test("requiresProblems says what is wrong with a manifest's requires, and nothing for a good one", () => {
  const all = [skill("a"), tool("t")];
  // GIVEN no requires, or a good one: THEN no problem
  expect(requiresProblems(skill("x"), all)).toEqual([]);
  expect(requiresProblems(skill("x", { skills: ["a"], tools: ["t"], commands: ["git"] }), all)).toEqual([]);
  // GIVEN requires that is not a map: THEN it is named
  expect(requiresProblems({ name: "x", kind: "skill", manifest: { requires: ["a"] as never } }, all)[0]).toMatch(/must be a map/);
  expect(requiresProblems({ name: "x", kind: "skill", manifest: { requires: null as never } }, all)[0]).toMatch(/must be a map/);
  // GIVEN an unknown key, a non-list, and names that exist nowhere: THEN each is named
  const bad = requiresProblems(skill("x", { cmds: ["git"], skills: "a", tools: ["nope"] } as never), all);
  expect(bad).toEqual([
    "requires.cmds is not one of skills/tools/commands/manual",
    "requires.skills must be a list of names",
    "requires.tools names nope: not in tools/",
  ]);
  expect(requiresProblems(skill("x", { skills: ["nope"] }), all)).toEqual(["requires.skills names nope: not in skills/ or skills-lock.json"]);
  // GIVEN a locked skill: THEN it is a good name
  expect(requiresProblems(skill("x", { skills: [lockedSkills[0]] }), all)).toEqual([]);
});

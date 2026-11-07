#!/usr/bin/env bun
// walk.json from a signed spec.json. With no walk.json yet, writes the skeleton: one step per ✓
// `should` example, in the spec's order, each naming the example it shows. With one, checks it
// against the spec and prints what's wrong (exit 1), so a walkthrough can't drift from what was signed.
// Usage: from-spec.ts <spec.json> <walk.json> [viz dir]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Example = { id: string; kind: string; text: string; verdict?: string | null };
type Spec = { task: { id: string; title: string; folder?: string }; examples: Example[]; signedOffAt?: string | null };
type Step = { id: string; example?: string; say: string; done?: object; target?: string | null; run?: string[]; clip?: { src: string; why: string } };
type Walk = { kind: string; yes?: string; steps: Step[]; stage?: object; cmd?: object; change: Record<string, string>; relay: { folder: string } };

const shown = (spec: Spec) => spec.examples.filter((e) => e.kind === "should" && e.verdict === "ok");

export function skeleton(spec: Spec) {
  return {
    title: `Walkthrough: ${spec.task.title}`,
    change: { repo: "TODO", commit: "TODO", subject: "TODO" },
    source: "TODO: one line on what this is: a throwaway copy, nothing of theirs.",
    kind: "TODO: web or cli",
    reset: ["TODO: the command that puts the throwaway copy back to its start"],
    relay: { folder: spec.task.folder ?? "TODO: the task's Kelpie run folder" },
    yes: "TODO: what Accept does, in plain words, as your \"Approve?\" line says it (\"Accept adds this to your local copy; nothing goes online.\")",
    steps: shown(spec).map((e, i) => ({
      id: `S${i + 1}`,
      example: e.id,
      say: `TODO: where to look and what to do, to see: ${e.text}`,
    })),
    notes: ["TODO: your own account of the change, and your doubts. Opens after they decide."],
  };
}

// The guide says where to look and what to do, never what is right (the anchoring rule).
const JUDGES = /\b(?:correct(?:ly)?|properly|as expected|works?|working|fixed|should|successfully|nicely)\b/iu;

export function check(spec: Spec, walk: Walk, dir?: string): string[] {
  const out: string[] = [];
  if (!spec.signedOffAt) out.push("spec.json isn't signed off: walk through what was agreed, not a draft");
  const want = shown(spec).map((e) => e.id);
  const ids = walk.steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) out.push("two steps share an id");
  const order = walk.steps.flatMap((s) => (s.example ? [s.example] : []));
  for (const e of want) if (!order.includes(e)) out.push(`no step shows ${e}`);
  for (const e of order) if (!want.includes(e)) out.push(`a step names ${e}, which isn't a ✓ should example`);
  const firsts = want.filter((e) => order.includes(e)).map((e) => order.indexOf(e));
  if (firsts.some((v, i) => i > 0 && v < (firsts[i - 1] ?? 0))) out.push("steps don't follow the spec's order of examples");
  if (JSON.stringify(walk).includes("TODO")) out.push("walk.json still has a TODO");
  if (!walk.yes?.trim()) out.push("walk.json has no yes: what Accept does, shown beside it");
  for (const s of walk.steps) {
    const hit = JUDGES.exec(s.say.replaceAll(/<[^>]+>/gu, ""));
    if (hit) out.push(`${s.id}'s say judges ("${hit[0]}"): say where to look and what to do, not what is right`);
    if (walk.kind === "web" && s.run) out.push(`${s.id} has run, but this is a web walkthrough`);
    if (walk.kind === "cli" && (s.done || s.target)) out.push(`${s.id} has done/target, but this is a cli walkthrough`);
    if (s.clip && !s.clip.why) out.push(`${s.id}'s clip doesn't say why it isn't live`);
    if (s.clip && dir && !existsSync(path.join(dir, s.clip.src))) out.push(`${s.id}'s clip ${s.clip.src} isn't in the viz folder`);
  }
  if (walk.kind === "web" && !walk.stage) out.push("a web walkthrough needs stage (the two builds' URLs)");
  if (walk.kind === "cli" && !walk.cmd) out.push("a cli walkthrough needs cmd (how each side runs a step)");
  return out;
}

if (import.meta.main) {
  const [specFile, walkFile, dir] = process.argv.slice(2);
  if (!specFile || !walkFile) throw new Error("usage: from-spec.ts <spec.json> <walk.json> [viz dir]");
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as Spec;
  if (!existsSync(walkFile)) {
    writeFileSync(walkFile, `${JSON.stringify(skeleton(spec), null, 1)}\n`);
    console.log(`wrote ${walkFile}: ${shown(spec).length} steps to fill in (every TODO)`);
  } else {
    const problems = check(spec, JSON.parse(readFileSync(walkFile, "utf8")) as Walk, dir);
    for (const p of problems) console.log(`✗ ${p}`);
    if (problems.length > 0) process.exit(1);
    console.log(`✓ ${walkFile} shows every ✓ example of ${specFile}, in order`);
  }
}

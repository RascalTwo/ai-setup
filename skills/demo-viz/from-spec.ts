#!/usr/bin/env bun
// walk.json from a spec.json. With no walk.json yet, writes the skeleton: the spec's personas, and one
// step per `should` example in each persona's journey (the spec's order within a persona), each naming
// the example it shows and the persona it belongs to. With one, checks it against the spec and prints
// what's wrong (exit 1), so a demo can't drift from what was agreed.
// Usage: from-spec.ts <spec.json> <walk.json> [viz dir] [--mode promised|live]   (live by default)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Example = { id: string; kind: string; text: string; verdict?: string | null; persona?: string };
type SpecPersona = { id: string; who: string; before?: { capture?: string } };
type Spec = {
  task: { id: string; title: string; folder?: string };
  demo?: { personas?: SpecPersona[] };
  examples: Example[];
  signedOffAt?: string | null;
};
type Step = {
  id: string;
  persona?: string;
  example?: string;
  say: string;
  done?: object;
  target?: string | null;
  run?: string[];
  clip?: { src: string; before?: string; why: string };
  capture?: string;
  promised?: string;
  differs?: string;
  measure?: unknown[];
};
type Walk = {
  mode?: string;
  impact?: string;
  notes?: string[];
  kind: string;
  personas?: { id: string; who: string }[];
  yes?: string;
  steps: Step[];
  stage?: { before?: string | null };
  cmd?: object;
  change: Record<string, string>;
  relay?: { folder: string };
};
export type Mode = "promised" | "live";
/** The most steps one persona's walkthrough takes: what shows their life changing, not every example. The rest are in notes. */
export const MAX_STEPS = 3;

/** The examples the demo shows, in journey order: each persona's, in the spec's order. Live shows only what was judged ✓; promised is made before any judging. */
export function shown(spec: Spec, mode: Mode = "live"): Example[] {
  const should = spec.examples.filter((e) => e.kind === "should" && (mode === "promised" || e.verdict === "ok"));
  return (spec.demo?.personas ?? []).flatMap((p) => should.filter((e) => e.persona === p.id));
}

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function skeleton(spec: Spec, mode: Mode = "live") {
  const personas = spec.demo?.personas;
  if (!personas?.length) throw new Error("spec.json has no demo.personas: an old spec goes back through refine to name them");
  const live = mode === "live";
  return {
    mode,
    title: `Demo: ${spec.task.title}`,
    change: live ? { repo: "TODO", commit: "TODO", subject: "TODO" } : { repo: "TODO", commit: "promised", subject: spec.task.title },
    ...(live && { impact: "TODO: 2-3 plain sentences: who is affected, their life before, their life after, why it matters. No commands, paths or data." }),
    source: live
      ? "TODO: one line on what this is: a throwaway copy, nothing of theirs."
      : "A mock with made-up data: how it would feel after the change. Nothing here is real.",
    kind: "TODO: web, cli, agent or dev",
    personas: personas.map((p) => ({ id: p.id, who: p.who })),
    reset: ["TODO: the command that puts the throwaway copy back to its start"],
    ...(live && { relay: { folder: spec.task.folder ?? "TODO: the task's Kelpie run folder" } }),
    ...(live && { yes: 'TODO: what Accept does, in plain words, as your "Approve?" line says it ("Accept adds this to your local copy; nothing goes online.")' }),
    steps: shown(spec, mode).map((e, i) => ({
      id: `S${i + 1}`,
      persona: e.persona,
      example: e.id,
      say: `TODO: where to look and what to do, to see: ${e.text}`,
      // What the spec promised for this step, so the live page can show it behind a toggle.
      ...(live && { promised: `<p>${esc(e.text)}</p>` }),
    })),
    notes: live ? ["TODO: the examples you didn't walk through (one line each, by id), then your own account of the change and your doubts. Opens after they decide."] : [],
  };
}

// The guide says where to look and what to do, never what is right (the anchoring rule).
const JUDGES = /\b(?:correct(?:ly)?|properly|as expected|works?|working|fixed|should|successfully|nicely)\b/iu;

export function check(spec: Spec, walk: Walk, dir?: string): string[] {
  const out: string[] = [];
  const mode: Mode = walk.mode === "promised" ? "promised" : "live";
  if (walk.mode !== "promised" && walk.mode !== "live") out.push("walk.json has no mode: promised or live");
  if (mode === "live" && !spec.signedOffAt) out.push("spec.json isn't signed off: demo what was agreed, not a draft");
  const personas = spec.demo?.personas ?? [];
  if (personas.length === 0) out.push("spec.json has no demo.personas: an old spec goes back through refine");
  const want = shown(spec, mode);
  const wantIds = want.map((e) => e.id);
  const ids = walk.steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) out.push("two steps share an id");

  // Personas: the spec's, copied; each with steps; every step in one of them.
  const walkPersonas = (walk.personas ?? []).map((p) => p.id);
  if (JSON.stringify(walkPersonas) !== JSON.stringify(personas.map((p) => p.id)))
    out.push("walk.json's personas aren't the spec's demo.personas, in the same order");
  for (const p of personas) {
    const n = walk.steps.filter((s) => s.persona === p.id).length;
    if (n === 0) out.push(`persona ${p.id} has no steps`);
    if (n > MAX_STEPS) out.push(`persona ${p.id} has ${n} steps: keep the ${MAX_STEPS} that show the impact and move the other examples to notes`);
  }
  for (const s of walk.steps) {
    if (!s.persona) out.push(`${s.id} has no persona`);
    else if (!walkPersonas.includes(s.persona)) out.push(`${s.id} names persona ${s.persona}, which isn't in personas`);
  }

  // Examples: all shown, each under its persona, in journey order.
  const order = walk.steps.flatMap((s) => (s.example ? [s.example] : []));
  // A live example with no step is named in notes (opened after the decision); a promised one is a card on the spec page.
  const noted = (e: string) => mode === "promised" || (walk.notes ?? []).some((n) => new RegExp(`\\b${e}\\b`, "u").test(n));
  for (const e of wantIds) if (!order.includes(e) && !noted(e)) out.push(`no step shows ${e}, and notes don't name it`);
  for (const e of order) if (!wantIds.includes(e)) out.push(`a step names ${e}, which isn't ${mode === "live" ? "a ✓" : "a"} should example`);
  for (const s of walk.steps) {
    const ex = want.find((e) => e.id === s.example);
    if (ex && s.persona && ex.persona !== s.persona) out.push(`${s.id} shows ${ex.id}, which is ${ex.persona}'s, under ${s.persona}`);
  }
  const firsts = wantIds.filter((e) => order.includes(e)).map((e) => order.indexOf(e));
  if (firsts.some((v, i) => i > 0 && v < (firsts[i - 1] ?? 0))) out.push("steps don't follow the journey order: persona by persona, the spec's order of examples within each");

  if (JSON.stringify(walk).includes("TODO")) out.push("walk.json still has a TODO");
  if (mode === "live" && !walk.impact?.trim()) out.push("walk.json has no impact: 2-3 plain sentences on who is affected, their life before and after, why it matters");
  if (mode === "live" && !walk.relay?.folder) out.push("walk.json has no relay.folder: the task's Kelpie run folder, where Send runs");
  if (mode === "live" && !walk.yes?.trim()) out.push("walk.json has no yes: what Accept does, shown beside it");
  const kinds = ["web", "cli", "agent", "dev"];
  if (!kinds.includes(walk.kind)) out.push(`kind is ${walk.kind}: web, cli, agent or dev`);

  for (const s of walk.steps) {
    const hit = JUDGES.exec(s.say.replaceAll(/<[^>]+>/gu, ""));
    if (hit) out.push(`${s.id}'s say judges ("${hit[0]}"): say where to look and what to do, not what is right`);
    if (walk.kind === "web" && s.run) out.push(`${s.id} has run, but this is a web demo`);
    if (walk.kind === "cli" && (s.done || s.target)) out.push(`${s.id} has done/target, but this is a cli demo`);
    if (s.clip && !s.clip.why) out.push(`${s.id}'s clip doesn't say why it isn't live`);
    if (s.clip && dir && !existsSync(path.join(dir, s.clip.src))) out.push(`${s.id}'s clip ${s.clip.src} isn't in the viz folder`);
    if (s.clip?.before && dir && !existsSync(path.join(dir, s.clip.before))) out.push(`${s.id}'s clip.before ${s.clip.before} isn't in the viz folder`);
    if (s.capture && dir && !existsSync(path.join(dir, s.capture))) out.push(`${s.id}'s capture ${s.capture} isn't in the viz folder`);
    // The promise and how the build differs from it exist only once there is a build.
    if (mode === "promised" && (s.promised || s.differs)) out.push(`${s.id} has promised/differs, but a promised demo is the promise`);
    if (s.differs !== undefined && !s.differs.trim()) out.push(`${s.id}'s differs is empty: say in plain words how the build differs, or leave it out`);
    if (s.differs?.trim() && !s.promised) out.push(`${s.id} differs from the promise but doesn't carry the promise: fill promised so the toggle shows what was promised`);
    // Agent steps put the old and the new run side by side; dev steps are measured.
    if (walk.kind === "agent" && !(s.clip?.src && s.clip.before)) out.push(`${s.id} is an agent step without a clip on both sides (clip.src and clip.before)`);
    if (walk.kind === "dev" && s.example && !s.measure?.length) out.push(`${s.id} is a dev step without measure: the numbers from doing the task in both checkouts`);
  }

  // A before that can't run has to be shown some other way.
  if (mode === "promised") {
    const noRunningBefore = walk.kind !== "web" || !walk.stage?.before;
    for (const p of personas)
      if (p.before?.capture === "real" && noRunningBefore && !walk.steps.some((s) => s.persona === p.id && (s.capture || s.clip?.before)))
        out.push(`persona ${p.id}'s before is a real capture, but none of its steps carries one (capture)`);
  }

  if (walk.kind === "web" && !walk.stage) out.push(`a web demo needs stage (${mode === "live" ? "the two builds' URLs" : "the mock's URL"})`);
  if (walk.kind === "cli" && mode === "live" && !walk.cmd) out.push("a live cli demo needs cmd (how each side runs a step)");
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const m = args.indexOf("--mode");
  const mode = m >= 0 ? args.splice(m, 2)[1] : "live";
  if (mode !== "promised" && mode !== "live") throw new Error("--mode is promised or live");
  const [specFile, walkFile, dir] = args;
  if (!specFile || !walkFile) throw new Error("usage: from-spec.ts <spec.json> <walk.json> [viz dir] [--mode promised|live]");
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as Spec;
  if (!existsSync(walkFile)) {
    writeFileSync(walkFile, `${JSON.stringify(skeleton(spec, mode), null, 1)}\n`);
    console.log(`wrote ${walkFile}: ${shown(spec, mode).length} steps to fill in (every TODO)`);
  } else {
    const problems = check(spec, JSON.parse(readFileSync(walkFile, "utf8")) as Walk, dir);
    for (const p of problems) console.log(`✗ ${p}`);
    if (problems.length > 0) process.exit(1);
    console.log(`✓ ${walkFile} shows every ${mode === "live" ? "✓ " : ""}example of ${specFile}, persona by persona, in order`);
  }
}

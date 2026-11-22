#!/usr/bin/env node
// Runs the critic over a proof set and keeps every verdict, so a rerun only does what's missing.
// Usage: node proof/run.ts <truth.json|pairs.json> <model> <out-dir> [parallel=4] [briefs.json]
// briefs.json ({ page: brief }) gives each page's screens a brief; results then go under <model>+brief.
// truth.json (from plant.ts): every faulty screen once; the clean screens and 10 faulty ones 5 times each.
// pairs.json (from pairs.ts): every screen in every pair once.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { critique } from "../critic.ts";

export const REPS = 5;
export type Job = { id: string; shot: string; rep: number };

export function jobsFor(set: any): Job[] {
  const jobs: Job[] = [];
  if (set.faults) {
    const faults = set.faults;
    // One faulty screen per page repeated, kinds rotating, so each kind is repeated on 2 pages.
    const kinds = ["overlap", "contrast", "misalign", "broken", "clipped"];
    const repeated = new Set(set.pages.map((p: string, i: number) => `${p}/${kinds[i % kinds.length]}`));
    for (const f of faults) for (let r = 0; r < (repeated.has(f.id) ? REPS : 1); r++) jobs.push({ id: f.id, shot: f.shot, rep: r });
    for (const p of set.pages) {
      const clean = faults.find((f: any) => f.page === p).clean;
      for (let r = 0; r < REPS; r++) jobs.push({ id: `${p}/clean`, shot: clean, rep: r });
    }
  }
  if (set.pairs) for (const pr of set.pairs) for (const side of ["a", "b"]) jobs.push({ id: `${pr.id}/${side}`, shot: pr[side], rep: 0 });
  return jobs;
}

if (import.meta.main) {
  const [setFile, model, outDir, par, briefFile] = process.argv.slice(2);
  const briefs: Record<string, string> | null = briefFile ? JSON.parse(readFileSync(briefFile, "utf8")) : null;
  const label = briefs ? `${model}+brief` : model;
  if (!setFile || !model || !outDir) {
    console.error("usage: node proof/run.ts <truth.json|pairs.json> <model> <out-dir> [parallel=4]");
    process.exit(2);
  }
  const jobs = jobsFor(JSON.parse(readFileSync(setFile, "utf8")));
  const file = (j: Job) => join(outDir, label, `${j.id.replaceAll("/", "__")}__${j.rep}.json`);
  const todo = jobs.filter((j) => !existsSync(file(j)));
  mkdirSync(join(outDir, label), { recursive: true });
  console.log(`${model}: ${jobs.length} jobs, ${todo.length} to run`);
  let done = 0, failed = 0;
  const worker = async () => {
    for (let j = todo.shift(); j; j = todo.shift()) {
      try {
        const v = await critique([j.shot], { model, brief: briefs?.[j.id.split("/")[0]] });
        writeFileSync(file(j), JSON.stringify({ ...j, ...v }, null, 1));
        done++;
      } catch (e) {
        failed++;
        console.log(`fail ${j.id}#${j.rep}: ${(e as Error).message.slice(0, 200)}`);
      }
      if ((done + failed) % 10 === 0) console.log(`${model}: ${done} done, ${failed} failed`);
    }
  };
  await Promise.all(Array.from({ length: Number(par ?? 4) }, worker));
  console.log(`${model}: finished, ${done} done, ${failed} failed`);
}

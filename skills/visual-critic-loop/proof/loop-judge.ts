#!/usr/bin/env node
// The loop proof's judge and tally. An isolated Opus call sees both finals of a task (arm A: builder alone,
// arm B: with the loop) under neutral names, twice with the sides swapped; it counts only when both orders agree.
// Then it prints the wins beside chance (one-sided sign test, ties dropped), with the user's blind picks if given.
// Usage: node proof/loop-judge.ts <loop-tasks.json> <out-dir> [user-picks.json pick-key.json]
//   user-picks.json: {"T1": "L" | "R" | "="}; pick-key.json: {"T1": {"id": "...", "L": "A" | "B"}}
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask, images } from "../critic.ts";
import { binomTail } from "./analyze.ts";

type Pick = "L" | "R" | "=";
type Arm = "A" | "B" | "=";

const SYSTEM = `You judge two builds of the same task, made independently. You see only screenshots: build L's, then build R's, each at a desktop and a phone width.
Pick the build you would rather hand to the person who asked for it: the one that does the task more completely and is more legible, better laid out and more finished at both widths.
Answer "=" only when you truly cannot tell which is better. Give a one-sentence reason naming the difference that decided it.`;
const SCHEMA = JSON.stringify({
  type: "object",
  properties: { pick: { type: "string", enum: ["L", "R", "="] }, why: { type: "string" } },
  required: ["pick", "why"],
});

// Maps a pick made with `left` shown on the left to the arm it favours.
export const toArm = (p: Pick, left: "A" | "B"): Arm => (p === "=" ? "=" : (p === "L") === (left === "A") ? "A" : "B");
// Both orders must agree, otherwise position bias decided it and it counts as a tie.
export const combine = (a: Arm, b: Arm): Arm => (a === b ? a : "=");

export function signTest(arms: Arm[]) {
  const b = arms.filter((x) => x === "B").length, a = arms.filter((x) => x === "A").length;
  return { B: b, A: a, ties: arms.length - a - b, p: binomTail(b, a + b) };
}

async function judge(task: string, left: string[], right: string[]) {
  const content = [
    { type: "text", text: `The task both builds were given:\n${task}` },
    ...images(left, "Build L screenshot"),
    ...images(right, "Build R screenshot"),
  ];
  return ask(content, SYSTEM, SCHEMA, "opus") as Promise<{ pick: Pick; why: string; cost: number; secs: number }>;
}

if (import.meta.main) {
  const [tasksFile, out, picksFile, keyFile] = process.argv.slice(2);
  if (!tasksFile || !out) {
    console.error("usage: node proof/loop-judge.ts <loop-tasks.json> <out-dir> [user-picks.json pick-key.json]");
    process.exit(2);
  }
  const tasks = JSON.parse(readFileSync(tasksFile, "utf8")).filter((t: any) => existsSync(join(out, t.id, "final-B")));
  const shots = (id: string, arm: string) => readdirSync(join(out, id, `final-${arm}`)).filter((f) => f.endsWith(".png")).sort().map((f) => join(out, id, `final-${arm}`, f));
  const verdicts: Arm[] = [];
  let cost = 0;
  // Two tasks at a time, two calls each: within the Mac's 3–4 concurrent claude -p budget.
  const todo = [...tasks];
  const worker = async () => {
    for (let t = todo.shift(); t; t = todo.shift()) {
      const file = join(out, t.id, "judge.json");
      const same = readFileSync(join(out, t.id, "A.html"), "utf8") === readFileSync(join(out, t.id, "B.html"), "utf8");
      // The loop stopped clean on round 1, so both arms are the same page: a tie by construction, nothing to judge.
      if (same) { verdicts.push("="); console.log(`${t.id}: same page (loop changed nothing), tie`); continue; }
      if (!existsSync(file)) {
        const [ab, ba] = await Promise.all([judge(t.task, shots(t.id, "A"), shots(t.id, "B")), judge(t.task, shots(t.id, "B"), shots(t.id, "A"))]);
        writeFileSync(file, JSON.stringify({ ab, ba, winner: combine(toArm(ab.pick, "A"), toArm(ba.pick, "B")) }, null, 1));
      }
      const j = JSON.parse(readFileSync(file, "utf8"));
      cost += j.ab.cost + j.ba.cost;
      verdicts.push(j.winner);
      console.log(`${t.id}: judge ${j.winner} · A-left: ${j.ab.pick} "${j.ab.why}" · B-left: ${j.ba.pick} "${j.ba.why}"`);
    }
  };
  await Promise.all([worker(), worker()]);

  const states = tasks.map((t: any) => JSON.parse(readFileSync(join(out, t.id, "state.json"), "utf8")));
  const sum = (f: (s: any) => number) => states.reduce((x: number, s: any) => x + f(s), 0);
  const j = signTest(verdicts);
  console.log(`\n${tasks.length} tasks · Opus judge: loop wins ${j.B}, alone wins ${j.A}, ties ${j.ties} · sign test p = ${j.p.toFixed(3)} (chance: p = 0.5)`);
  if (picksFile && keyFile) {
    const picks: Record<string, Pick> = JSON.parse(readFileSync(picksFile, "utf8"));
    const key: Record<string, { id: string; L: "A" | "B" }> = JSON.parse(readFileSync(keyFile, "utf8"));
    const user = Object.entries(picks).map(([k, p]) => toArm(p, key[k].L));
    const u = signTest(user);
    console.log(`Your blind picks: loop wins ${u.B}, alone wins ${u.A}, ties ${u.ties} · sign test p = ${u.p.toFixed(3)}`);
  }
  console.log(`Cost, list price: builder alone $${sum((s) => s.A.cost).toFixed(2)}, loop extra $${sum((s) => s.B.builderCost + s.B.criticCost).toFixed(2)} ` +
    `(critic $${sum((s) => s.B.criticCost).toFixed(2)}), judge $${cost.toFixed(2)} · loop extra time ${Math.round(sum((s) => s.B.secs) / 60)} min`);
  console.log(`Stop reasons: ${states.map((s: any) => `${s.B.reason}@${s.B.rounds}`).join(", ")}`);
}

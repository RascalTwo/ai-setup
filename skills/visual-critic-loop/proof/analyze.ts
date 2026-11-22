#!/usr/bin/env node
// Turns the proof runs into numbers, each beside a critic with no judgement, so the result is read
// against chance rather than against a bar picked in advance.
// Usage: node proof/analyze.ts <proof-dir> [model ...]
// <proof-dir> holds screens/truth.json, pairs/pairs.json, pairs/pick-key.json, runs/<model>/,
// and optionally picks.json ({ "P1": "L" | "R" | "=" }) from the pick page.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Box = [number, number, number, number];
const SCREEN: [number, number] = [1280, 800];
const MAX_BOX_SHARE = 0.25; // a box over a quarter of the screen points at nothing in particular

// An issue box counts as pointing at a fault if they overlap meaningfully, or one's centre sits in the other.
export function hits(issue: Box, truth: Box, screen = SCREEN, strict = false): boolean {
  const [ix, iy, iw, ih] = issue, [tx, ty, tw, th] = truth;
  if (iw * ih > MAX_BOX_SHARE * screen[0] * screen[1] || iw <= 0 || ih <= 0) return false;
  const ox = Math.max(0, Math.min(ix + iw, tx + tw) - Math.max(ix, tx));
  const oy = Math.max(0, Math.min(iy + ih, ty + th) - Math.max(iy, ty));
  const inter = ox * oy, iou = inter / (iw * ih + tw * th - inter);
  const pad = 20, [icx, icy] = [ix + iw / 2, iy + ih / 2], [tcx, tcy] = [tx + tw / 2, ty + th / 2];
  if (strict) return iou >= 0.1;
  return iou >= 0.1 ||
    (icx >= tx - pad && icx <= tx + tw + pad && icy >= ty - pad && icy <= ty + th + pad) ||
    (tcx >= ix && tcx <= ix + iw && tcy >= iy && tcy <= iy + ih);
}

// One-sided exact binomial: P(X >= k) for X ~ Bin(n, 1/2).
export function binomTail(k: number, n: number): number {
  let c = 1, sum = 0;
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += c;
    c = (c * (n - i)) / (i + 1);
  }
  return sum / 2 ** n;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node proof/analyze.ts <proof-dir> [model ...]");
    process.exit(2);
  }
  const models = process.argv.slice(3).length ? process.argv.slice(3) : readdirSync(join(dir, "runs"));
  const truth = JSON.parse(readFileSync(join(dir, "screens/truth.json"), "utf8"));
  const pairs = JSON.parse(readFileSync(join(dir, "pairs/pairs.json"), "utf8")).pairs;
  const key = JSON.parse(readFileSync(join(dir, "pairs/pick-key.json"), "utf8"));
  const picks: Record<string, string> | null = existsSync(join(dir, "picks.json")) ? JSON.parse(readFileSync(join(dir, "picks.json"), "utf8")) : null;
  const report: any = { models: {} };

  for (const m of models) {
    const v = (id: string, rep = 0) => {
      const f = join(dir, "runs", m, `${id.replaceAll("/", "__")}__${rep}.json`);
      return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
    };
    const R: any = (report.models[m] = {});

    // 1. Finds planted faults. Control: the same critic's boxes on the clean page (what it flags anyway).
    const rows = truth.faults.map((f: any) => {
      const fv = v(f.id), cv = v(`${f.page}/clean`);
      const caught = fv.issues.filter((i: any) => hits(i.box, f.box));
      const strictCaught = fv.issues.some((i: any) => hits(i.box, f.box, SCREEN, true));
      const cleanHit = [0, 1, 2, 3, 4].some((r) => v(`${f.page}/clean`, r)?.issues.some((i: any) => hits(i.box, f.box)));
      return {
        id: f.id, kind: f.kind, caught: caught.length > 0, strictCaught,
        strictControl: cv.issues.some((i: any) => hits(i.box, f.box, SCREEN, true)),
        serious: caught.some((i: any) => i.severity !== "minor"),
        controlCaught: cv.issues.some((i: any) => hits(i.box, f.box)),
        cleanHit, dropped: fv.overall < cv.overall, nIssues: fv.issues.length,
      };
    });
    const fresh = rows.filter((r: any) => !r.cleanHit);
    // Random-box baseline: same number of boxes per screen, sizes drawn from the critic's own boxes.
    const sizes = truth.faults.flatMap((f: any) => v(f.id).issues.map((i: any) => [i.box[2], i.box[3]]));
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const simulate = (strict: boolean) => Array.from({ length: 1000 }, () =>
      mean(truth.faults.map((f: any, k: number) => {
        const n = rows[k].nIssues;
        return Array.from({ length: n }, () => {
          const [w, h] = sizes[Math.floor(rnd() * sizes.length)] ?? [100, 30];
          return [rnd() * (SCREEN[0] - w), rnd() * (SCREEN[1] - h), w, h] as Box;
        }).some((b) => hits(b, f.box, SCREEN, strict)) ? 1 : 0;
      }))).sort((a, b) => a - b);
    const sims = simulate(false), strictSims = simulate(true);
    R.detect = {
      caught: mean(rows.map((r: any) => +r.caught)), serious: mean(rows.map((r: any) => +r.serious)),
      freshCaught: mean(fresh.map((r: any) => +r.caught)), fresh: fresh.length,
      control: mean(rows.map((r: any) => +r.controlCaught)),
      random: mean(sims), random95: sims[Math.floor(0.95 * sims.length)],
      scoreDropped: mean(rows.map((r: any) => +r.dropped)),
      strict: { caught: mean(rows.map((r: any) => +r.strictCaught)), control: mean(rows.map((r: any) => +r.strictControl)), random: mean(strictSims), random95: strictSims[950] },
      byKind: Object.fromEntries(["overlap", "contrast", "misalign", "broken", "clipped"].map((k) =>
        [k, mean(rows.filter((r: any) => r.kind === k).map((r: any) => +r.caught))])),
    };
    // Issues raised on clean screens: may be real problems, so they are listed for a person to judge.
    const cleanRuns = truth.pages.flatMap((p: string) => [0, 1, 2, 3, 4].map((r) => v(`${p}/clean`, r)).filter(Boolean));
    R.clean = {
      seriousPerScreen: mean(cleanRuns.map((c: any) => c.issues.filter((i: any) => i.severity !== "minor").length)),
      examples: truth.pages.map((p: string) => ({ page: p, issues: v(`${p}/clean`).issues.filter((i: any) => i.severity !== "minor").map((i: any) => `${i.severity}: ${i.what}`) })),
    };

    // 2. Agrees with itself: spread of the overall score over 5 runs of one screen, beside the spread between screens.
    const repeated = [...new Set(truth.faults.map((f: any) => f.id).filter((id: string) => v(id, 4)))]
      .concat(truth.pages.map((p: string) => `${p}/clean`)) as string[];
    const spreads = repeated.map((id) => {
      const o = [0, 1, 2, 3, 4].map((r) => v(id, r).overall);
      return { id, spread: Math.max(...o) - Math.min(...o), sd: sd(o), mean: mean(o) };
    });
    const randSpread = mean(Array.from({ length: 2000 }, () => {
      const o = Array.from({ length: 5 }, () => rnd() * 10);
      return Math.max(...o) - Math.min(...o);
    }));
    const faultRepeats = repeated.filter((id) => !id.endsWith("/clean")).map((id) => {
      const f = truth.faults.find((x: any) => x.id === id);
      return `${id.split("/").at(-1)}:${[0, 1, 2, 3, 4].filter((r) => v(id, r).issues.some((i: any) => hits(i.box, f.box))).length}`;
    });
    R.consistency = {
      screens: spreads.length, withinOnePoint: mean(spreads.map((x) => +(x.spread <= 1))),
      medianSpread: spreads.map((x) => x.spread).sort((a, b) => a - b)[Math.floor(spreads.length / 2)],
      withinSD: mean(spreads.map((x) => x.sd)), betweenSD: sd(spreads.map((x) => x.mean)), randomSpread: randSpread,
      faultCaughtOutOf5: faultRepeats,
    };

    // 3. Agrees with you: does it score the screen you picked higher? Ties count half. Also vs the fix commit's direction.
    const pv = (id: string, side: string) => v(`${id}/${side}`)?.overall;
    const vsCommit = pairs.filter((p: any) => p.kind === "same").map((p: any) => Math.sign(pv(p.id, "b") - pv(p.id, "a")));
    R.commit = { n: vsCommit.length, agree: mean(vsCommit.map((x: number) => (x > 0 ? 1 : x === 0 ? 0.5 : 0))), ties: vsCommit.filter((x: number) => x === 0).length };
    if (picks) {
      const judged = key.map((k: any) => {
        const pick = picks[`P${k.n}`];
        if (!pick || pick === "=") return null;
        const better = pick === "L" ? k.left : k.left === "a" ? "b" : "a";
        const d = pv(k.pair, better) - pv(k.pair, better === "a" ? "b" : "a");
        return { pair: k.pair, kind: k.kind, agree: d > 0 ? 1 : d === 0 ? 0.5 : 0 };
      }).filter(Boolean);
      const wins = judged.filter((j: any) => j.agree === 1).length, decided = judged.filter((j: any) => j.agree !== 0.5).length;
      R.you = {
        judged: judged.length, agree: mean(judged.map((j: any) => j.agree)), ties: judged.length - decided,
        p: binomTail(wins, decided),
        same: mean(judged.filter((j: any) => j.kind === "same").map((j: any) => j.agree)),
        cross: mean(judged.filter((j: any) => j.kind === "cross").map((j: any) => j.agree)),
      };
    }
    const all = readdirSync(join(dir, "runs", m)).map((f) => JSON.parse(readFileSync(join(dir, "runs", m, f), "utf8")));
    R.cost = { calls: all.length, usd: r2(all.reduce((x, a) => x + a.cost, 0)), secsPerCall: r1(mean(all.map((a) => a.secs))) };

    const D = R.detect, C = R.consistency;
    console.log(`\n== ${m}`);
    console.log(`finds faults: caught ${pct(D.caught)} (as blocker/major ${pct(D.serious)}); faults it never flagged on the clean page: ${pct(D.freshCaught)} of ${D.fresh}`);
    console.log(`  controls: same critic on the clean page ${pct(D.control)}; random boxes ${pct(D.random)} (95th pct ${pct(D.random95)}); score dropped on ${pct(D.scoreDropped)} of faulty screens`);
    console.log(`  strict (overlap only): caught ${pct(D.strict.caught)}; clean-page control ${pct(D.strict.control)}; random boxes ${pct(D.strict.random)} (95th pct ${pct(D.strict.random95)})`);
    console.log(`  by kind: ${Object.entries(D.byKind).map(([k, x]) => `${k} ${pct(x as number)}`).join(", ")}`);
    console.log(`  clean screens: ${r1(R.clean.seriousPerScreen)} blocker/major issues per screen (may be real; listed in results.json)`);
    console.log(`agrees with itself: spread <= 1 point on ${pct(C.withinOnePoint)} of ${C.screens} screens, median spread ${r1(C.medianSpread)}; within-screen SD ${r1(C.withinSD)} vs between-screen SD ${r1(C.betweenSD)}; random scorer spread ${r1(C.randomSpread)}`);
    console.log(`  repeated faulty screens, fault caught in k of 5 runs: ${C.faultCaughtOutOf5.join(" ")}`);
    console.log(`fix commits: scores the fixed version higher on ${pct(R.commit.agree)} of ${R.commit.n} same-page pairs (${R.commit.ties} ties)`);
    if (R.you) console.log(`agrees with you: ${pct(R.you.agree)} of ${R.you.judged} pairs (${R.you.ties} ties), p=${R.you.p.toPrecision(2)} vs chance; same-page ${pct(R.you.same)}, cross-page ${pct(R.you.cross)}`);
    console.log(`cost: ${R.cost.calls} calls, $${R.cost.usd}, ${R.cost.secsPerCall}s per call`);
  }
  if (picks) {
    const yc = key.filter((k: any) => k.kind === "same" && picks[`P${k.n}`] && picks[`P${k.n}`] !== "=")
      .map((k: any) => +(((picks[`P${k.n}`] === "L") === (k.left === "b"))));
    report.youVsCommit = { n: yc.length, agree: mean(yc) };
    console.log(`\nyou vs the fix commits: you picked the fixed version on ${pct(mean(yc))} of ${yc.length} same-page pairs you decided`);
  }
  writeFileSync(join(dir, "results.json"), JSON.stringify(report, null, 1));
}

// The coverage floor: totals that may only rise (r2-testing-paradigm, coverage-and-mutation.md).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const KEYS = ["lines", "statements", "functions", "branches"];
const SLACK = 0.1;
const whole = (n) => (Number.isInteger(n) ? n : Math.floor(n - SLACK)); // an exact total (100%, 9/10) stands as is

/**
 * Compares totals ({ lines: 93.1, ... }) with the floor file. Below fails; a gain of a whole point rewrites the file; else it is left.
 * Floors are written rounded down to whole percents, less SLACK: totals wobble by ~0.05 on unchanged code (27.48–27.53
 * measured), so an exact floor, or a 28 written from a 28.02, would fail the next run.
 */
export function checkFloor(file, totals, label = file) {
  const floor = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  if (!floor) {
    writeFileSync(file, JSON.stringify(pick(totals), null, 2) + "\n");
    return { ok: true, messages: [`COVERAGE FLOOR: created ${label} at ${show(totals)}; commit it`] };
  }
  const below = KEYS.filter((k) => totals[k] < (floor[k] ?? 0));
  if (below.length) return { ok: false, messages: below.map((k) => `COVERAGE FLOOR: ${k} ${totals[k]}% < ${floor[k]}%`) };
  const above = KEYS.filter((k) => whole(totals[k]) > (floor[k] ?? 0));
  if (!above.length) return { ok: true, messages: [`COVERAGE FLOOR: met (${show(floor)})`] };
  // Only the raised keys: rewriting the rest would round an older exact floor (93.14) down.
  const raised = Object.fromEntries(above.map((k) => [k, whole(totals[k])]));
  writeFileSync(file, JSON.stringify({ ...floor, ...raised }, null, 2) + "\n");
  return { ok: true, messages: [`COVERAGE FLOOR: raised ${above.map((k) => `${k} ${floor[k] ?? 0}% → ${raised[k]}%`).join(", ")}; commit ${label}`] };
}

const pick = (t) => Object.fromEntries(KEYS.map((k) => [k, whole(t[k])]));
const show = (t) => KEYS.map((k) => `${k} ${t[k]}%`).join(", ");

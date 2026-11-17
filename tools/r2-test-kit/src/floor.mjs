// The coverage floor: totals that may only rise (r2-testing-paradigm, coverage-and-mutation.md).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const KEYS = ["lines", "statements", "functions", "branches"];

/** Compares totals ({ lines: 93.1, ... }) with the floor file. Below fails; above rewrites the file; equal leaves it. */
export function checkFloor(file, totals, label = file) {
  const floor = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  if (!floor) {
    writeFileSync(file, JSON.stringify(pick(totals), null, 2) + "\n");
    return { ok: true, messages: [`COVERAGE FLOOR: created ${label} at ${show(totals)}; commit it`] };
  }
  const below = KEYS.filter((k) => totals[k] < (floor[k] ?? 0));
  if (below.length) return { ok: false, messages: below.map((k) => `COVERAGE FLOOR: ${k} ${totals[k]}% < ${floor[k]}%`) };
  const above = KEYS.filter((k) => totals[k] > (floor[k] ?? 0));
  if (!above.length) return { ok: true, messages: [`COVERAGE FLOOR: met (${show(floor)})`] };
  writeFileSync(file, JSON.stringify({ ...floor, ...pick(totals) }, null, 2) + "\n");
  return { ok: true, messages: [`COVERAGE FLOOR: raised ${above.map((k) => `${k} ${floor[k] ?? 0}% → ${totals[k]}%`).join(", ")}; commit ${label}`] };
}

const pick = (t) => Object.fromEntries(KEYS.map((k) => [k, t[k]]));
const show = (t) => KEYS.map((k) => `${k} ${t[k]}%`).join(", ");

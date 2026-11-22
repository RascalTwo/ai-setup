// lib/testing/timing.ts — where a run's time went: a scenario's total and the GIVEN / WHEN / THEN split of it, added up
// per feature and per run, and the words for it that the terminal, spec.md and spec.html share.

import type { Scenario, Spec } from "./spec.ts";

/** Where a scenario's time went, in ms: its own total and what its GIVEN, WHEN and THEN steps took of it (the rest is between steps). */
export type Timing = { ms: number; givenMs: number; whenMs: number; thenMs: number };

/** What a set of scenarios took, added up: null when none of them has times. */
export function totalTiming(scenarios: readonly Pick<Scenario, "timing">[]): Timing | null {
  const all = scenarios.flatMap((s) => (s.timing ? [s.timing] : []));
  if (all.length === 0) return null;
  const sum = (k: keyof Timing) => all.reduce((n, t) => n + t[k], 0);
  return { ms: sum("ms"), givenMs: sum("givenMs"), whenMs: sum("whenMs"), thenMs: sum("thenMs") };
}

/** The time not spent in any step: setup, teardown and waiting between them. */
export const betweenMs = (t: Timing): number => Math.max(0, t.ms - t.givenMs - t.whenMs - t.thenMs);

/** The run's times as verify reports them (terminal and `--json`): the totals, and every scenario's own split. */
export type RunTiming = Timing & {
  /** From the first test file starting to the last one ending. */
  wallMs: number | null;
  betweenMs: number;
  scenarios: (Timing & {
    feature: string;
    title: string;
    file: string;
    line: number;
    betweenMs: number;
  })[];
};
export function runTiming(spec: Spec): RunTiming | null {
  const total = totalTiming(spec.scenarios);
  if (!total) return null;
  return {
    wallMs: spec.wallMs,
    ...total,
    betweenMs: betweenMs(total),
    scenarios: spec.scenarios.flatMap(({ feature, title, file, line, timing }) =>
      timing ? [{ feature, title, file, line, ...timing, betweenMs: betweenMs(timing) }] : [],
    ),
  };
}

/** A time for a person: "340 ms", "4.2 s", "102 s". */
export const fmtMs = (ms: number): string =>
  ms < 1000
    ? `${Math.round(ms)} ms`
    : ms < 10_000
      ? `${(ms / 1000).toFixed(1)} s`
      : `${Math.round(ms / 1000)} s`;
export const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/** "GIVEN 2.1 s (65%) · WHEN 0.5 s (15%) · THEN 0.6 s (20%)": the share is of `t.ms`. */
export const splitWithShare = (t: Timing): string =>
  [
    ["GIVEN", t.givenMs],
    ["WHEN", t.whenMs],
    ["THEN", t.thenMs],
  ]
    .map(([k, ms]) => `${k} ${fmtMs(Number(ms))} (${pct(Number(ms), t.ms)}%)`)
    .join(" · ");

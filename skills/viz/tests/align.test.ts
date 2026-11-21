import { expect, test } from "bun:test";
import { alignWords, type Heard } from "../lib/render/align.ts";

const h = (...w: [string, number, number][]): Heard[] =>
  w.map(([word, start, end]) => ({ word, start, end }));

test("words that match keep their times", () => {
  const w = alignWords(
    "Open the router.",
    h([" Open", 0, 0.3], [" the", 0.4, 0.5], [" router.", 0.6, 1]),
  );
  expect(w).toEqual([
    ["Open", 0, 0.3],
    ["the", 0.4, 0.5],
    ["router", 0.6, 1],
  ]);
});

test("a merged transcript word is split across the script words it covers", () => {
  const w = alignWords(
    "line forty one now",
    h([" line", 0, 0.4], [" fortyone", 0.5, 1.3], [" now", 1.4, 1.7]),
  );
  const forty = w[1] ?? ["", Number.NaN, Number.NaN];
  const one = w[2] ?? ["", Number.NaN, Number.NaN];
  expect(forty[1]).toBeCloseTo(0.5, 2);
  expect(one[2]).toBeCloseTo(1.3, 2);
  expect(forty[2]).toBeLessThanOrEqual(one[1] + 0.001);
  expect(w[3]).toEqual(["now", 1.4, 1.7]);
});

test("a word the transcript dropped is interpolated between its neighbours", () => {
  const w = alignWords("alpha quietly beta", h([" alpha", 0, 1], [" beta", 2, 3]));
  expect(w.map((x) => x[0])).toEqual(["alpha", "quietly", "beta"]);
  expect((w[1] ?? [])[1]).toBeCloseTo(1, 2);
  expect((w[1] ?? [])[2]).toBeCloseTo(2, 2);
});

test("a digit the recogniser spelled out is interpolated, neighbours stay put", () => {
  const w = alignWords(
    "line 41 here",
    h([" line", 0, 0.4], [" forty-one", 0.5, 1.2], [" here", 1.3, 1.6]),
  );
  expect(w.map((x) => x[0])).toEqual(["line", "41", "here"]);
  expect(w[0]).toEqual(["line", 0, 0.4]);
  expect(w[2]).toEqual(["here", 1.3, 1.6]);
  expect((w[1] ?? [])[1]).toBeGreaterThanOrEqual(0.4);
  expect((w[1] ?? [])[2]).toBeLessThanOrEqual(1.3);
});

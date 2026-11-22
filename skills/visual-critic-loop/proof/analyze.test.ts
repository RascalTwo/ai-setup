import { expect, test } from "vitest";
import { binomTail, hits } from "./analyze.ts";

test("an issue box hits the fault it overlaps, not one across the screen", () => {
  expect(hits([100, 100, 200, 40], [110, 105, 150, 30])).toBe(true);
  expect(hits([900, 600, 100, 40], [110, 105, 150, 30])).toBe(false);
});

test("a box over a quarter of the screen hits nothing, however it overlaps", () => {
  expect(hits([0, 0, 1280, 800], [110, 105, 150, 30])).toBe(false);
});

test("a small box centred just outside the fault still counts, within 20 px", () => {
  expect(hits([255, 100, 20, 20], [100, 100, 150, 30])).toBe(true);
});

test("binomial tail matches the exact values", () => {
  expect(binomTail(9, 10)).toBeCloseTo(11 / 1024);
  expect(binomTail(0, 10)).toBeCloseTo(1);
});

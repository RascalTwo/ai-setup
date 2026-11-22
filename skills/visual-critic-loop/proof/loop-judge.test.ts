import { expect, test } from "vitest";
import { combine, signTest, toArm } from "./loop-judge.ts";

test("a pick maps to the arm that was on that side", () => {
  expect(toArm("L", "A")).toBe("A");
  expect(toArm("L", "B")).toBe("B");
  expect(toArm("R", "A")).toBe("B");
  expect(toArm("=", "B")).toBe("=");
});

test("the two orders must agree, or it's a tie", () => {
  expect(combine("B", "B")).toBe("B");
  expect(combine("A", "B")).toBe("=");
  expect(combine("=", "B")).toBe("=");
});

test("the sign test drops ties", () => {
  const r = signTest(["B", "B", "B", "B", "B", "B", "B", "B", "B", "A", "=", "="]);
  expect([r.B, r.A, r.ties]).toEqual([9, 1, 2]);
  expect(r.p).toBeCloseTo(11 / 1024, 6);
});

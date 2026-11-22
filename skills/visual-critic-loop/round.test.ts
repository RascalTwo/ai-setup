import { expect, test } from "vitest";
import { decide } from "./round.ts";

const r = (overall: number, severities: string[] = [], checks: boolean[] = []) => ({
  overall,
  issues: severities.map((severity) => ({ severity, dimension: "layout", shot: 1, box: [0, 0, 1, 1], what: "" })) as any,
  checks: checks.map((pass) => ({ check: "c", pass, note: "" })),
});

test("stops clean when only minor issues are left and every check passes", () => {
  expect(decide([r(5, ["blocker"]), r(7.5, ["minor"], [true])])).toEqual({ stop: true, reason: "clean" });
});

test("a failing task check keeps the loop going like a major issue", () => {
  expect(decide([r(8, ["minor"], [false])]).reason).toBe("continue");
});

test("stops on a plateau when two rounds rise less than half a point", () => {
  expect(decide([r(6, ["major"]), r(6.2, ["major"]), r(6.4, ["major"])]).reason).toBe("plateau");
  expect(decide([r(6, ["major"]), r(6.2, ["major"]), r(6.6, ["major"])]).reason).toBe("continue");
});

test("stops at the cap after round 4 with serious issues left", () => {
  expect(decide([r(3, ["blocker"]), r(4.5, ["blocker"]), r(6, ["major"]), r(7, ["major"])]).reason).toBe("cap");
});

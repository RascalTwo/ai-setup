import { expect, test } from "vitest";
import { allure } from "../src/allurerc.mjs";

test("the Allure preset fails on any failed test and on fewer tests than expected", () => {
  const c = allure({ name: "app", minTestsCount: 6 });
  expect(c).toMatchObject({ name: "app", output: "out/allure-report", qualityGate: { rules: [{ maxFailures: 0 }, { minTestsCount: 6 }] } });
  expect(allure({ name: "app", minTestsCount: 1, output: "x" }).output).toBe("x");
});

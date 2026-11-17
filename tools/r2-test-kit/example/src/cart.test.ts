import { describe, expect, test } from "vitest";
import { freeShipping, total } from "./cart.ts";

describe("cart", () => {
  test("total adds tax", () => {
    expect(total([{ name: "mug", price: 10 }])).toBe(process.env["DEMO_FAIL"] ? 999 : 11);
  });
  test("shipping is free over 50", () => {
    expect(freeShipping(51)).toBe(true);
    expect(freeShipping(50)).toBe(false);
  });
});

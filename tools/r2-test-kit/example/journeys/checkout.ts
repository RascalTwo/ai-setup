import { expect, test } from "@rascaltwo/r2-test-kit/playwright";

test("buyer checks out with free shipping", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Free shipping")).toBeHidden();
  await page.getByRole("button", { name: "Add mug" }).click();
  await page.getByRole("button", { name: "Add lamp" }).click();
  await expect(page.getByText("Free shipping")).toBeVisible();
  await page.getByRole("link", { name: "Check out" }).click();
  await expect(page.getByText("Shipping is free")).toBeVisible();
});

test("a small order pays shipping", async ({ page }) => {
  await page.goto("/checkout.html?total=13.2");
  await expect(page.getByText("Shipping costs 5")).toBeVisible();
});

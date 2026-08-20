import { expect, test } from "@playwright/test";

test("starts with one independent anvil operation and no operation buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-stage", "forge");
  await expect(page.locator("#hud-title")).toHaveText("铁砧 · 锤击");
  await expect(page.locator("button")).toHaveCount(0);
  await expect(page.locator("#hud-state")).toContainText("弹簧钢");

  const initialOperations = await page.locator("body").getAttribute("data-operation-count");
  await page.locator("#game").click({ position: { x: 640, y: 350 } });
  await expect(page.locator("body")).not.toHaveAttribute("data-operation-count", initialOperations ?? "");
});

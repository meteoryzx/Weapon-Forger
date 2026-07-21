import { expect, test } from "@playwright/test";

test("clicking the billet changes the rendered canvas", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#game");
  await expect(canvas).toBeVisible();

  const before = await canvas.screenshot();
  await canvas.click({ position: { x: 640, y: 360 } });
  const after = await canvas.screenshot();

  expect(after.equals(before)).toBe(false);
});

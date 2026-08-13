import { expect, test } from "@playwright/test";

test("the cold billet can be sent into the furnace", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#game");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-billet-location", "inspection");
  const before = await canvas.screenshot();

  await canvas.click({ position: { x: 326, y: 410 } });
  await expect(canvas).toHaveAttribute("data-billet-location", "furnace");
  await page.waitForTimeout(750);
  const inside = await canvas.screenshot();

  expect(inside.equals(before)).toBe(false);
});

test("input is locked during travel and the furnace can return the billet", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#game");
  await expect(canvas).toHaveAttribute("data-billet-location", "inspection");

  await canvas.click({ position: { x: 326, y: 410 } });
  await canvas.click({ position: { x: 890, y: 390 } });
  await expect(canvas).toHaveAttribute("data-billet-location", "furnace");

  await page.waitForTimeout(750);
  await canvas.click({ position: { x: 890, y: 390 } });
  await expect(canvas).toHaveAttribute("data-billet-location", "inspection");
  await page.waitForTimeout(750);
});

test("the portrait layout keeps the billet and furnace touchable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const canvas = page.locator("#game");
  await expect(canvas).toHaveAttribute("data-billet-location", "inspection");

  await canvas.click({ position: { x: 200, y: 555 } });
  await expect(canvas).toHaveAttribute("data-billet-location", "furnace");
});

import { expect, test } from "@playwright/test";

test("clicking the billet changes the rendered canvas", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#game");
  await expect(canvas).toBeVisible();

  const before = await canvas.screenshot();
  let changed = false;

  for (const y of [220, 260, 300, 340]) {
    for (const x of [360, 440, 520, 600, 680, 760]) {
      await canvas.click({ position: { x, y } });
      const after = await canvas.screenshot();
      if (!after.equals(before)) {
        changed = true;
        break;
      }
    }
    if (changed) {
      break;
    }
  }

  expect(changed).toBe(true);
});

test("turning the billet four times returns to its initial face", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#game");
  await expect(canvas).toBeVisible();

  const initial = await canvas.screenshot();
  await page.keyboard.press("d");
  const turned = await canvas.screenshot();
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  const restored = await canvas.screenshot();

  expect(turned.equals(initial)).toBe(false);
  expect(restored.equals(initial)).toBe(true);
});

test("feeding moves the whole billet on the anvil", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#game");
  await expect(canvas).toBeVisible();

  const initial = await canvas.screenshot();
  await page.keyboard.press("w");
  const fed = await canvas.screenshot();
  await page.keyboard.press("s");
  const restored = await canvas.screenshot();

  expect(fed.equals(initial)).toBe(false);
  expect(restored.equals(initial)).toBe(true);
});

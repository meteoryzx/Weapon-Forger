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

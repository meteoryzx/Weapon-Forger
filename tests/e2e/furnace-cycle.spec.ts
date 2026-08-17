import { expect, test, type Page } from "@playwright/test";

async function selectHighCarbonSteel(page: Page): Promise<void> {
  await page.locator("#hud-actions button").filter({ hasText: "高碳钢" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "heat");
}

test("runs the R1 forging chain and shows the raw state result", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-stage", "select");

  await selectHighCarbonSteel(page);
  await page.getByRole("button", { name: "完成加热" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "forge");

  await page.getByRole("button", { name: "完成锻打" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "quench");

  await page.getByRole("button", { name: "水淬" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "grind");

  await page.getByRole("button", { name: "完成研磨" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "done");

  await expect(page.locator("#story")).toBeVisible();
  await expect(page.locator("#story-text")).toContainText("原始状态");
  await expect(page.locator("#story-text")).toContainText("含碳");
});

test("the furnace still toggles the billet between inspection and furnace", async ({ page }) => {
  await page.goto("/");
  await selectHighCarbonSteel(page);

  const canvas = page.locator("#game");
  await expect(canvas).toHaveAttribute("data-billet-location", "inspection");
  await canvas.click({ position: { x: 326, y: 410 } });
  await expect(canvas).toHaveAttribute("data-billet-location", "furnace");
  await page.waitForTimeout(750);
  await canvas.click({ position: { x: 890, y: 390 } });
  await expect(canvas).toHaveAttribute("data-billet-location", "inspection");
});

test("water and oil quench leave different raw quench state", async ({ page }) => {
  async function runQuench(medium: "水淬" | "油淬"): Promise<string> {
    await page.goto("/");
    await selectHighCarbonSteel(page);
    await page.getByRole("button", { name: "完成加热" }).click();
    await page.getByRole("button", { name: "完成锻打" }).click();
    await page.getByRole("button", { name: medium }).click();
    await page.getByRole("button", { name: "完成研磨" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-stage", "done");
    return (await page.locator("#story-text").textContent()) ?? "";
  }

  const water = await runQuench("水淬");
  const oil = await runQuench("油淬");
  expect(water).not.toBe(oil);
});

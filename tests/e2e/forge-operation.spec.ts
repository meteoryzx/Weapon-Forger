import { expect, test } from "@playwright/test";

test("runs the eight forge verbs through direct station interactions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-stage", "forge-mvp");
  await expect(page.locator("#hud-title")).toHaveText("铁砧 · 锤击");
  await expect(page.locator("button")).toHaveCount(0);
  await expect(page.locator("#hud-state")).toContainText("弹簧钢");

  const initialOperations = await page.locator("body").getAttribute("data-operation-count");
  await page.locator("#game").click({ position: { x: 640, y: 350 } });
  await expect(page.locator("body")).not.toHaveAttribute("data-operation-count", initialOperations ?? "");
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /hammer/);

  // Material shelf, cut bench, weld bench, quench basin, temper furnace and grindstone.
  await page.locator("#game").click({ position: { x: 370, y: 220 } });
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /materials/);
  await page.locator("#game").click({ position: { x: 180, y: 430 } });
  await page.locator("#game").dragTo(page.locator("#game"), { sourcePosition: { x: 640, y: 350 }, targetPosition: { x: 690, y: 360 } });
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /cut/);
  await page.locator("#game").click({ position: { x: 1080, y: 440 } });
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /weld/);
  await page.locator("#game").click({ position: { x: 220, y: 310 } });
  await page.mouse.move(220, 310);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /heat/);
  await page.locator("#game").click({ position: { x: 1000, y: 330 } });
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /quench/);
  await page.locator("#game").click({ position: { x: 850, y: 220 } });
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /temper/);
  await page.locator("#game").click({ position: { x: 180, y: 570 } });
  await page.mouse.move(580, 380);
  await page.mouse.down();
  await page.mouse.move(640, 390, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /grind/);
  await expect(page.locator("body")).toHaveAttribute("data-verb-count", "8");
});

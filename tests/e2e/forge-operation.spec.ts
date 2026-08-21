import { expect, test } from "@playwright/test";

test("each forge verb has a station camera and a continuous input", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-stage", "forge-mvp");
  await expect(page.locator("#hud-title")).toHaveText("铁匠铺 · 总览");
  await expect(page.locator("button")).toHaveCount(0);

  await page.locator("#game").click({ position: { x: 640, y: 330 } });
  await expect(page.locator("body")).toHaveAttribute("data-active-station", "anvil");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "moving");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await expect(page.locator("#hud-title")).toHaveText("铁砧 · 锤击");
  const initialOperations = await page.locator("body").getAttribute("data-operation-count");
  await page.locator("#game").click({ position: { x: 640, y: 330 } });
  await expect(page.locator("body")).not.toHaveAttribute("data-operation-count", initialOperations ?? "");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 300, y: 280 } });
  await expect(page.locator("#hud-title")).toHaveText("材料架 · 选料");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 770, y: 350 } });
  await expect(page.locator("#hud-state")).toContainText("工作台 1 块");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 260, y: 410 } });
  await expect(page.locator("#hud-title")).toHaveText("切割台 · 切割");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(450, 500);
  await page.mouse.down();
  await page.mouse.move(590, 440, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("body")).toHaveAttribute("data-bench-count", "2");
  await expect(page.locator("body")).toHaveAttribute("data-bench-material-ids", "spring-steel,high-carbon-steel");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 1000, y: 425 } });
  await expect(page.locator("#hud-title")).toHaveText("焊合台 · 焊合");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(120, 470);
  await page.mouse.down();
  await page.mouse.move(1040, 370, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("焊合 1");
  await expect(page.locator("body")).toHaveAttribute("data-carbon", "0.900000");
  await expect(page.locator("body")).toHaveAttribute("data-layer-count", "2");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 400, y: 300 } });
  await expect(page.locator("#hud-title")).toHaveText("火炉 · 加热");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(400, 330);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /heat/);

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 870, y: 350 } });
  await expect(page.locator("#hud-title")).toHaveText("水槽 · 淬火");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(150, 410);
  await page.mouse.down();
  await page.mouse.move(620, 330, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("淬火 water");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 780, y: 245 } });
  await expect(page.locator("#hud-title")).toHaveText("回火炉 · 回火");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(640, 310);
  await page.mouse.down();
  await page.mouse.move(640, 270, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("回火");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 430, y: 460 } });
  await expect(page.locator("#hud-title")).toHaveText("磨石 · 研磨");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(450, 380);
  await page.mouse.down();
  await page.mouse.move(600, 320, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("研磨");
});

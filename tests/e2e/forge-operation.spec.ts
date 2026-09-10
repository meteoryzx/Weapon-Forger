import { expect, test } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { materialsCameraFrame, MATERIALS_ORIGIN } from "../../src/render/materials-station-view.ts";

function materialPoint(focus: "table" | "rack", local: [number, number, number]) {
  const camera = new PerspectiveCamera(52, 1280 / 720, 0.1, 2000);
  const frame = materialsCameraFrame(focus, camera.aspect);
  camera.position.fromArray(frame.position);
  camera.lookAt(new Vector3().fromArray(frame.target));
  camera.updateMatrixWorld(true);
  const point = new Vector3(...local).add(MATERIALS_ORIGIN).project(camera);
  return { x: (point.x + 1) * 640, y: (1 - point.y) * 360 };
}

test("each forge verb has a station camera and a continuous input", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-stage", "forge-mvp");
  await expect(page.locator("#hud-title")).toHaveText("铁匠铺 · 总览");
  await expect(page.locator("#acceptance-console")).toBeVisible();
  await expect(page.locator("[data-acceptance-target]")).toHaveCount(8);

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
  await expect(page.locator("#hud-title")).toHaveText("选料桌 · 选料");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  if (await page.locator("#material-cancel").isVisible()) await page.locator("#material-cancel").click();
  await page.waitForTimeout(650);
  await page.locator("#game").click({ position: materialPoint("table", [3, 71.36, -37]) });
  await expect(page.locator("body")).toHaveAttribute("data-material-candidate", "high-carbon-steel");
  await page.locator("#material-confirm").click();
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: materialPoint("rack", [140, 63, -169]) });
  await expect(page.locator("body")).toHaveAttribute("data-carbon", "0.900000");
  await expect(page.locator("#hud-state")).toContainText("工作台 1 块");

  await page.locator("#materials-table").click();
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").focus();
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
  await page.mouse.move(979, 446);
  await page.mouse.down();
  await page.mouse.move(393, 267, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("焊合 1");
  await expect(page.locator("body")).toHaveAttribute("data-carbon", "0.900000");
  await expect(page.locator("body")).toHaveAttribute("data-layer-count", "2");
  await expect(page.locator("body")).toHaveAttribute("data-material-region-count", "2");
  await expect(page.locator("body")).toHaveAttribute("data-joint-count", "1");

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
  await page.mouse.move(413, 236);
  await page.mouse.down();
  await page.mouse.move(640, 317, { steps: 4 });
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

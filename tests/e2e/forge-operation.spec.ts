import { expect, test } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { materialsCameraFrame, MATERIALS_ORIGIN } from "../../src/render/materials-station-view.ts";
import { FURNACE_ORIGIN } from "../../src/render/furnace-station-view.ts";

function materialPoint(focus: "table" | "rack", local: [number, number, number]) {
  const camera = new PerspectiveCamera(52, 1280 / 720, 0.1, 2000);
  const frame = materialsCameraFrame(focus, camera.aspect);
  camera.position.fromArray(frame.position);
  camera.lookAt(new Vector3().fromArray(frame.target));
  camera.updateMatrixWorld(true);
  const point = new Vector3(...local).add(MATERIALS_ORIGIN).project(camera);
  return { x: (point.x + 1) * 640, y: (1 - point.y) * 360 };
}

function overviewPoint(point:[number,number,number]) {
  const camera=new PerspectiveCamera(52,1280/720,0.1,2000);
  camera.position.set(-100,740,1100);camera.lookAt(new Vector3(-170,55,40));camera.updateMatrixWorld(true);
  const projected=new Vector3(...point).project(camera);
  return {x:(projected.x+1)*640,y:(1-projected.y)*360};
}

test("each forge verb has a station camera and a continuous input", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-stage", "forge-mvp");
  await expect(page.locator("#hud-title")).toHaveText("铁匠铺 · 总览");
  await expect(page.locator("#acceptance-console")).toBeVisible();
  await expect(page.locator("[data-acceptance-target]")).toHaveCount(8);

  await page.locator("#game").click({ position: overviewPoint([0,4,0]) });
  await expect(page.locator("body")).toHaveAttribute("data-active-station", "anvil");
  // Poll the final view: a short transition can finish before the assertion runs.
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await expect(page.locator("#hud-title")).toHaveText("铁砧 · 锤击");
  const initialOperations = await page.locator("body").getAttribute("data-operation-count");
  const hammerCanvas=await page.locator("#game").boundingBox();
  await page.locator("#game").click({ position: { x: hammerCanvas!.width/2, y: hammerCanvas!.height/2 } });
  await expect(page.locator("body")).not.toHaveAttribute("data-operation-count", initialOperations ?? "");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: overviewPoint([-600,72,-130]) });
  await expect(page.locator("#hud-title")).toHaveText("选料桌 · 选料");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  if (await page.locator("#material-cancel").isVisible()) await page.locator("#material-cancel").click();
  await page.waitForTimeout(650);
  await page.locator("#game").click({ position: materialPoint("table", [0, 202, -112]) });
  await expect(page.locator("body")).toHaveAttribute("data-material-candidate", "high-carbon-steel");
  await page.locator("#material-confirm").click();
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#material-return").click();
  await expect(page.locator("body")).toHaveAttribute("data-current-workpiece-location", "rack");
  await expect(page.locator("#workpiece-travel")).toBeDisabled();
  await page.locator("#game").click({ position: materialPoint("table", [-174, 74, 48]) });
  await expect(page.locator("body")).toHaveAttribute("data-current-workpiece-location", "table");
  await expect(page.locator("#workpiece-travel")).toBeEnabled();
  await expect(page.locator("body")).toHaveAttribute("data-carbon", "0.900000");
  await expect(page.locator("#hud-state")).toContainText("工作台 1 块");

  await page.locator("#game").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: overviewPoint([-420,62,360]) });
  await expect(page.locator("#hud-title")).toHaveText("切割台 · 切割");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await expect(page.locator("#cut-confirm")).toBeEnabled({timeout:30000});
  await page.locator("#cut-confirm").click();
  await expect(page.locator("body")).toHaveAttribute("data-bench-count", "2");
  await expect(page.locator("body")).toHaveAttribute("data-bench-material-ids", "spring-steel,high-carbon-steel");

  await page.getByRole("button",{name:"工坊总览"}).click();
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: overviewPoint([330,28,150]) });
  await expect(page.locator("#hud-title")).toHaveText("焊合台 · 焊合");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(979, 446);
  await page.mouse.down();
  await page.mouse.move(393, 267, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("焊合 1");
  await expect(page.locator("body")).toHaveAttribute("data-carbon", "0.900000");
  await expect(page.locator("body")).toHaveAttribute("data-layer-count", "2");
  // Rejoining two halves of the same source preserves one material region;
  // cutting creates new workpiece identities, not a fictitious new material.
  await expect(page.locator("body")).toHaveAttribute("data-material-region-count", "1");
  await expect(page.locator("body")).toHaveAttribute("data-joint-count", "1");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: overviewPoint([FURNACE_ORIGIN.x, 110, FURNACE_ORIGIN.z]) });
  await expect(page.locator("#hud-title")).toHaveText("火炉 · 加热");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.getByRole("button", { name: "送入加热", exact: true }).click();
  await expect.poll(async () => Number(await page.locator("body").getAttribute("data-temperature-c"))).toBeGreaterThan(50);
  await page.getByRole("button", { name: "取出查看", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-completed-verbs", /heat/);

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: overviewPoint([520,30,-250]) });
  await expect(page.locator("#hud-title")).toHaveText("水槽 · 淬火");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(413, 236);
  await page.mouse.down();
  await page.mouse.move(640, 317, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("淬火 water");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: overviewPoint([520,44,-145]) });
  await expect(page.locator("#hud-title")).toHaveText("回火炉 · 回火");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(640, 310);
  await page.mouse.down();
  await page.mouse.move(640, 270, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("回火");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: overviewPoint([500,48,285]) });
  await expect(page.locator("#hud-title")).toHaveText("磨石 · 研磨");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(450, 380);
  await page.mouse.down();
  await page.mouse.move(600, 320, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#hud-state")).toContainText("研磨");
});

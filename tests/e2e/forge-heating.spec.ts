import { expect, test, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { furnaceCameraFrame, FURNACE, FURNACE_ORIGIN } from "../../src/render/furnace-station-view.ts";

async function clickMouth(page: Page) {
  const box = (await page.locator("#game").boundingBox())!;
  const frame = furnaceCameraFrame(box.width / box.height);
  const camera = new PerspectiveCamera(52, box.width / box.height, 0.1, 2000);
  camera.position.fromArray(frame.position); camera.lookAt(new Vector3().fromArray(frame.target)); camera.updateMatrixWorld(true);
  const point = new Vector3(0, (FURNACE.hearth + FURNACE.ceiling) / 2, FURNACE.front).add(FURNACE_ORIGIN).project(camera);
  await page.locator("#game").click({ position: { x: (point.x + 1) * box.width / 2, y: (1 - point.y) * box.height / 2 } });
}

test("one click inserts and keeps heating; a second extracts and cools without changing material", async ({ page }) => {
  await page.goto("/?accept=heat");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  const body = page.locator("body");
  const volume = await body.getAttribute("data-total-material-volume");
  const id = await body.getAttribute("data-workpiece-id");
  await clickMouth(page);
  await expect(body).toHaveAttribute("data-billet-location", "furnace");
  const temperature = async () => Number(await body.getAttribute("data-temperature-c"));
  await expect.poll(temperature).toBeGreaterThan(80);
  await page.locator("#game").click({ position: { x: 4, y: 4 } });
  await expect(body).toHaveAttribute("data-billet-location", "furnace");
  await clickMouth(page);
  await expect(body).toHaveAttribute("data-billet-location", "inspection");
  const extracted = await temperature();
  await expect.poll(temperature).toBeLessThan(extracted - 1);
  await expect(body).toHaveAttribute("data-total-material-volume", volume!);
  await expect(body).toHaveAttribute("data-workpiece-id", id!);
  await expect(body).toHaveAttribute("data-acceptance-operation-count", "1");
  await page.getByRole("button", { name: "工坊总览", exact: true }).click();
  await expect(body).toHaveAttribute("data-active-station", "overview");
  await expect(body).toHaveAttribute("data-workpiece-id", id!);
});

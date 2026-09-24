import { expect, test } from "@playwright/test";
import { dragScene } from "./scene-input.ts";

test("dragging fully inside starts heating; dragging fully outside stops without changing material", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/?accept=heat");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  const body = page.locator("body");
  const volume = await body.getAttribute("data-total-material-volume");
  const id = await body.getAttribute("data-workpiece-id");
  await dragScene(page, "billet", { x: 230, y: 0 });
  await expect(body).toHaveAttribute("data-billet-location", "furnace");
  const temperature = async () => Number(await body.getAttribute("data-temperature-c"));
  await expect.poll(temperature).toBeGreaterThan(80);
  await dragScene(page, "billet", { x: -230, y: 0 });
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

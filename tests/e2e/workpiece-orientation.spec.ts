import { expect, test } from "@playwright/test";

type AxisPoint = { x: number; y: number };
type Inspection = { workpieceAxis: { start: AxisPoint; end: AxisPoint } | null };

const inspect = (page: import("@playwright/test").Page): Promise<Inspection> =>
  page.evaluate(() => (window as unknown as { __forgeInspect: () => Inspection }).__forgeInspect());

test.describe("forging workpiece presentation axes", () => {
  test("hand hammer presents the billet from lower-left to upper-right", async ({ page }) => {
    await page.goto("/?accept=hammer");
    await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
    const axis = (await inspect(page)).workpieceAxis!;
    expect(axis.end.x - axis.start.x).toBeGreaterThan(80);
    expect(axis.end.y - axis.start.y).toBeLessThan(-18);
  });

  test("hand hammer W/S follows the displayed long edge", async ({ page }) => {
    await page.goto("/?accept=hammer");
    await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
    await page.locator("#game").focus();
    const before = await page.evaluate(() => ({
      x: Number(document.body.dataset.hammerX),
      z: Number(document.body.dataset.hammerZ),
    }));
    await page.keyboard.press("w");
    const after = await page.evaluate(() => ({
      x: Number(document.body.dataset.hammerX),
      z: Number(document.body.dataset.hammerZ),
    }));
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    expect(Math.abs(dx)).toBeGreaterThan(0.1);
    expect(Math.abs(dz)).toBeGreaterThan(0.1);
    expect(Math.abs(Math.abs(dx) - Math.abs(dz))).toBeLessThan(0.2);
  });

  for (const station of ["power", "press"] as const) {
    test(`${station} presents the feed axis into screen depth`, async ({ page }) => {
      await page.goto(`/?accept=${station}`);
      await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
      const axis = (await inspect(page)).workpieceAxis!;
      const dx = Math.abs(axis.end.x - axis.start.x);
      const dy = Math.abs(axis.end.y - axis.start.y);
      expect(dy).toBeGreaterThan(dx * 1.35);
    });
  }
});

import { expect, test } from "@playwright/test";

interface PressInspection {
  press: { pose: { x: number; z: number; yaw: number; roll: number }; contact: { supported: boolean } | null } | null;
}

const inspect = (page: import("@playwright/test").Page): Promise<PressInspection> =>
  page.evaluate(() => (window as unknown as { __forgeInspect: () => PressInspection }).__forgeInspect());

test("press placement responds immediately and stays under the head", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?accept=press");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").focus();

  const initial = await inspect(page);
  // The press billet is intentionally aligned to the machine's screen-depth
  // feed axis. Its presentation yaw is therefore non-zero by design.
  expect(Math.abs(initial.press?.pose.yaw ?? 0)).toBeGreaterThan(1);
  expect(initial.press?.contact?.supported).toBe(true);
  const timings: number[] = [];
  for (const key of ["w", "s", "a", "d"]) {
    const start = Date.now();
    await page.keyboard.press(key);
    timings.push(Date.now() - start);
    const current = await inspect(page);
    expect(current.press?.contact?.supported).toBe(true);
  }
  const beforeSide = (await inspect(page)).press!.pose;
  await page.keyboard.press("a");
  const afterSide = (await inspect(page)).press!.pose;
  expect(Math.hypot(afterSide.x - beforeSide.x, afterSide.z - beforeSide.z)).toBeGreaterThan(0.1);
  expect(afterSide.roll).toBeCloseTo(beforeSide.roll, 6);
  const beforeRoll = afterSide.roll;
  await page.keyboard.press("q");
  expect((await inspect(page)).press!.pose.roll).not.toBeCloseTo(beforeRoll, 6);
  // Headless software WebGL can block the event loop for a full render. Keep
  // this as a regression guard against the old 120 ms timer plus render stall,
  // while allowing that renderer's measured frame cost.
  expect(Math.max(...timings), JSON.stringify(timings)).toBeLessThan(300);
});

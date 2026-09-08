import { expect, test } from "@playwright/test";

const acceptanceSlices = [
  ["materials", "materials", "材料架 · 选料"],
  ["cut", "cut", "切割台 · 切割"],
  ["weld", "weld", "焊合台 · 焊合"],
  ["heat", "furnace", "火炉 · 加热"],
  ["hammer", "anvil", "铁砧 · 锤击"],
  ["quench", "quench-water", "水槽 · 淬火"],
  ["temper", "temper", "回火炉 · 回火"],
  ["grind", "grind", "磨石 · 研磨"],
] as const;

for (const [verb, station, title] of acceptanceSlices) {
  test(`${verb} opens as an isolated R1 acceptance slice`, async ({ page }) => {
    await page.goto(`/?accept=${verb}`);
    await expect(page.locator("body")).toHaveAttribute("data-stage", "forge-acceptance");
    await expect(page.locator("body")).toHaveAttribute("data-acceptance-verb", verb);
    await expect(page.locator("body")).toHaveAttribute("data-active-station", station);
    await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
    await expect(page.locator("#hud-title")).toHaveText(`R1 单项验收 · ${title}`);
    await expect(page.locator("body")).toHaveAttribute("data-acceptance-operation-count", "0");

    await page.keyboard.press("Escape");
    await expect(page.locator("body")).toHaveAttribute("data-active-station", station);
  });
}

test("the acceptance console switches between all eight isolated slices", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#acceptance-console")).toBeVisible();
  await expect(page.locator("[data-acceptance-target]" )).toHaveCount(8);
  await page.locator("[data-acceptance-target=hammer]").click();
  await expect(page).toHaveURL(/accept=hammer/);
  await expect(page.locator("body")).toHaveAttribute("data-active-station", "anvil");
  await expect(page.locator("[data-acceptance-target=hammer]")).toHaveAttribute("aria-current", "step");
});

test("the acceptance console resets the current sample", async ({ page }) => {
  await page.goto("/?accept=hammer");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.locator("#game").click({ position: { x: 640, y: 330 } });
  await expect(page.locator("body")).toHaveAttribute("data-acceptance-operation-count", "1");
  await page.locator("#acceptance-reset").click();
  await expect(page.locator("body")).toHaveAttribute("data-acceptance-operation-count", "0");
  await expect(page.locator("body")).toHaveAttribute("data-active-station", "anvil");
});

test("weld acceptance starts with one selectable bench workpiece", async ({ page }) => {
  await page.goto("/?accept=weld");
  await expect(page.locator("body")).toHaveAttribute("data-bench-count", "1");
  await expect(page.locator("body")).toHaveAttribute("data-bench-material-ids", "spring-steel");
  await expect(page.locator("body")).toHaveAttribute("data-acceptance-setup-operations", "6");
  const temperatureC = Number(await page.locator("body").getAttribute("data-temperature-c"));
  expect(temperatureC).toBeGreaterThan(700);
});

test("weld acceptance joins the visible current and bench workpieces", async ({ page }) => {
  await page.goto("/?accept=weld");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await page.mouse.move(301, 446);
  await page.mouse.down();
  await page.mouse.move(393, 267, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator("body")).toHaveAttribute("data-acceptance-operation-count", "1");
  await expect(page.locator("body")).toHaveAttribute("data-joint-count", "1");
  await expect(page.locator("body")).toHaveAttribute("data-material-region-count", "2");
});

test("hammer and quench acceptance start with a hot inspected workpiece", async ({ page }) => {
  for (const url of ["/?accept=hammer", "/?accept=quench&medium=oil"]) {
    await page.goto(url);
    await expect(page.locator("body")).toHaveAttribute("data-acceptance-operation-count", "0");
    await expect(page.locator("body")).toHaveAttribute("data-acceptance-setup-operations", "2");
    const temperatureC = Number(await page.locator("body").getAttribute("data-temperature-c"));
    expect(temperatureC).toBeGreaterThan(700);
  }
  await expect(page.locator("body")).toHaveAttribute("data-active-station", "quench-oil");
  await expect(page.locator("#hud-title")).toHaveText("R1 单项验收 · 油槽 · 淬火");
});

test("temper acceptance starts from a quenched workpiece", async ({ page }) => {
  await page.goto("/?accept=temper");
  await expect(page.locator("body")).toHaveAttribute("data-acceptance-setup-operations", "3");
  await expect(page.locator("body")).toHaveAttribute("data-acceptance-operation-count", "0");
  await expect(page.locator("body")).toHaveAttribute("data-quench-medium", "water");
});

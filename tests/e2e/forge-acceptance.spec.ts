import { expect, test } from "@playwright/test";

const acceptanceSlices = [
  ["materials", "materials", "选料桌 · 选料"],
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
    await expect(page.locator("body")).toHaveAttribute("data-active-station", verb==="cut" || verb==="heat" ? "overview" : station);
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

test("saw preview is read-only, confirms finite cuts, and preserves independently selectable pieces", async ({page})=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/?accept=cut");
  const body=page.locator("body"),confirm=page.getByRole("button",{name:"确认切割"});
  await expect(confirm).toBeEnabled({timeout:30000});
  const original=Number(await body.getAttribute("data-total-material-volume"));
  await page.locator("#game").focus();
  await page.keyboard.press("e");await page.keyboard.press("ArrowRight");
  await expect(body).toHaveAttribute("data-cut-angle","5");
  await expect(body).toHaveAttribute("data-acceptance-operation-count","0");
  expect(Number(await body.getAttribute("data-total-material-volume"))).toBe(original);
  await expect(confirm).toBeEnabled({timeout:30000});
  await confirm.click();
  await expect(body).toHaveAttribute("data-cutting","true");
  await expect(confirm).toBeDisabled();
  await expect(body).toHaveAttribute("data-acceptance-operation-count","1",{timeout:15000});
  await expect(body).toHaveAttribute("data-bench-count","1");
  const firstId=await body.getAttribute("data-workpiece-id");
  const retained=Number(await body.getAttribute("data-total-material-volume"));
  const loss=Number(await body.getAttribute("data-cut-loss-volume"));
  expect(retained+loss).toBeCloseTo(original,5);expect(loss).toBeGreaterThan(0);expect(loss).toBeLessThan(original*0.01);
  await page.locator("#cut-piece").selectOption({index:1});
  await expect(body).not.toHaveAttribute("data-workpiece-id",firstId!);
  await expect(confirm).toBeEnabled({timeout:30000});
  await confirm.click();
  await expect(body).toHaveAttribute("data-acceptance-operation-count","2",{timeout:15000});
  await expect(body).toHaveAttribute("data-bench-count","2");
  expect(Number(await body.getAttribute("data-total-material-volume"))+Number(await body.getAttribute("data-cut-loss-volume"))).toBeCloseTo(original,5);
  const current=await body.getAttribute("data-workpiece-id");
  await page.getByRole("button",{name:"工坊总览"}).click();
  await expect(body).toHaveAttribute("data-active-station","overview");
  await expect(body).toHaveAttribute("data-workpiece-id",current!);
  expect(errors).toEqual([]);
});

test("stock can overhang freely and a partial notch remains until a later cut severs its bridge",async({page})=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/?accept=cut");
  const body=page.locator("body"), confirm=page.getByRole("button",{name:"确认切割"});
  await expect(confirm).toBeEnabled({timeout:30000});
  const original=Number(await body.getAttribute("data-total-material-volume"));
  const id=await body.getAttribute("data-workpiece-id");
  await page.locator("#game").focus();
  // At the shared smaller scale the stock cannot span the blade and table edge
  // simultaneously. First verify overhang is unclamped, then return to the blade.
  for(let i=0;i<56;i++)await page.keyboard.press("ArrowRight");
  await expect.poll(async()=>JSON.parse((await body.getAttribute("data-cut-pose"))!).x).toBe(224);
  expect(Number(await body.getAttribute("data-total-material-volume"))).toBe(original);
  for(let i=0;i<46;i++)await page.keyboard.press("ArrowLeft");
  // Center the width on the finite guide's endpoint, leaving half uncut.
  for(let i=0;i<5;i++)await page.keyboard.press("ArrowDown");
  await expect(confirm).toBeEnabled({timeout:30000});
  await expect(page.locator("#cut-status")).toContainText("仍为一块");
  const pose=await body.getAttribute("data-cut-pose");
  expect(JSON.parse(pose!).x).toBe(40);
  expect(Number(await body.getAttribute("data-total-material-volume"))).toBe(original);
  await confirm.click();
  await expect(body).toHaveAttribute("data-acceptance-operation-count","1",{timeout:15000});
  await expect(body).toHaveAttribute("data-bench-count","0");
  await expect(body).toHaveAttribute("data-workpiece-id",id!);
  await expect(body).toHaveAttribute("data-cut-pose",pose!);
  expect(Number(await body.getAttribute("data-cut-loss-volume"))).toBeCloseTo(24*8,5);
  await page.locator("#game").focus();
  for(let i=0;i<5;i++)await page.keyboard.press("ArrowUp");
  await expect(confirm).toBeEnabled({timeout:30000});
  await expect(page.locator("#cut-status")).toContainText("将分成 2 块");
  await confirm.click();
  await expect(body).toHaveAttribute("data-acceptance-operation-count","2",{timeout:15000});
  await expect(body).toHaveAttribute("data-bench-count","1");
  expect(Number(await body.getAttribute("data-cut-loss-volume"))).toBeCloseTo(48*8,5);
  expect(Number(await body.getAttribute("data-total-material-volume"))+Number(await body.getAttribute("data-cut-loss-volume"))).toBeCloseTo(original,5);
  expect(errors).toEqual([]);
});

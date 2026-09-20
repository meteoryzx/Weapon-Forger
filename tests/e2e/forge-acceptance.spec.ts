import { expect, test } from "@playwright/test";
import { dragScene, scenePoint } from "./scene-input.ts";

const acceptanceSlices = [
  ["materials", "materials", "选料桌 · 选料"],
  ["cut", "cut", "切割台 · 切割"],
  ["weld", "weld", "焊合台 · 焊合"],
  ["heat", "furnace", "火炉 · 加热"],
  ["hammer", "anvil", "铁砧 · 锤击"],
  ["power", "power", "动力锤"],
  ["press", "press", "锻造压力机 · 压下延展"],
  ["quench", "quench-water", "水槽 · 淬火"],
  ["temper", "temper", "火炉 · 回火"],
  ["grind", "grind", "砂带 · 研磨"],
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
    await expect(page.locator("body")).toHaveAttribute("data-active-station", ["cut","heat","hammer","power","press"].includes(verb) ? "overview" : station);
  });
}

test("the acceptance console switches between all isolated slices", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#acceptance-console")).toBeVisible();
  await expect(page.locator("[data-acceptance-target]" )).toHaveCount(10);
  await page.locator("[data-acceptance-target=hammer]").click();
  await expect(page).toHaveURL(/accept=hammer/);
  await expect(page.locator("body")).toHaveAttribute("data-active-station", "anvil");
  await expect(page.locator("[data-acceptance-target=hammer]")).toHaveAttribute("aria-current", "step");
});

test("the acceptance console resets the current sample", async ({ page }) => {
  await page.goto("/?accept=hammer");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  const canvas=await page.locator("#game").boundingBox();
  await page.locator("#game").click({ position: { x: canvas!.width/2, y: canvas!.height/2 } });
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

test("hammer force, free placement, continuous roll and click deformation preserve the workpiece",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?accept=hammer");const body=page.locator("body"),canvas=page.locator("#game");
  await expect(body).toHaveAttribute("data-camera-state","settled");
  const initialVolume=await body.getAttribute("data-total-material-volume"),temperature=await body.getAttribute("data-temperature-c");
  const bounds=(await canvas.boundingBox())!,point={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
  await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,-100);
  await expect(body).toHaveAttribute("data-hammer-energy","0.6");
  await expect(body).toHaveAttribute("data-acceptance-operation-count","0");
  await page.mouse.dblclick(point.x,point.y);
  await expect(body).toHaveAttribute("data-acceptance-operation-count","1");
  await expect.poll(async()=>Number(await body.getAttribute("data-hammer-minimum-thickness"))).toBeLessThan(8);
  await page.waitForTimeout(260);
  await canvas.focus();await page.keyboard.press("d");await page.keyboard.press("e");
  expect(Number(await body.getAttribute("data-hammer-roll"))).toBeCloseTo(Math.PI/36,12);
  expect(Number(await body.getAttribute("data-hammer-yaw"))).toBeCloseTo(Math.PI/36,12);
  await expect(body).toHaveAttribute("data-acceptance-operation-count","1");
  await page.mouse.click(point.x,point.y);
  await expect(body).toHaveAttribute("data-acceptance-operation-count","2");
  await page.waitForTimeout(260);
  await page.keyboard.down("Shift");await page.mouse.move(point.x,point.y);await page.mouse.down();
  await page.mouse.move(point.x+25,point.y,{steps:5});await page.mouse.up();await page.keyboard.up("Shift");
  await expect.poll(async()=>Number(await body.getAttribute("data-hammer-x"))).toBeGreaterThan(5);
  await expect(body).toHaveAttribute("data-acceptance-operation-count","2");
  await expect(body).toHaveAttribute("data-total-material-volume",initialVolume!);
  await expect(body).toHaveAttribute("data-temperature-c",temperature!);
  await page.getByRole("button",{name:"工坊总览"}).click();await expect(body).toHaveAttribute("data-active-station","overview");
  await expect(body).toHaveAttribute("data-workpiece-id","workpiece-0");
  expect(errors).toEqual([]);
});

test("a local blow on a half-width overhang does not bend the whole billet",async({page})=>{
  await page.goto("/?accept=hammer");
  const body=page.locator("body"),canvas=page.locator("#game");
  await expect(body).toHaveAttribute("data-camera-state","settled");
  await canvas.focus();
  for(let i=0;i<10;i++)await page.keyboard.press("ArrowDown");
  await expect(body).toHaveAttribute("data-hammer-z","40");
  const before=await page.evaluate(()=>(window as unknown as {__forgeInspect:()=>{hammer:{overhangMidPlanes:(number|null)[]}}}).__forgeInspect().hammer.overhangMidPlanes);
  const p=await scenePoint(page,"hammer:0:58");
  await page.mouse.move(p.x,p.y);
  for(let i=0;i<5;i++)await page.mouse.wheel(0,-100);
  await expect(body).toHaveAttribute("data-hammer-energy","0.8");
  await page.mouse.click(p.x,p.y);
  await expect(body).toHaveAttribute("data-acceptance-operation-count","1");
  const after=await page.evaluate(()=>(window as unknown as {__forgeInspect:()=>{hammer:{overhangMidPlanes:(number|null)[]}}}).__forgeInspect().hammer.overhangMidPlanes);
  expect(after[1]!-before[1]!).toBeLessThan(-0.05);
  expect(Math.abs(after[0]!-before[0]!)).toBeLessThan(0.02);
});

test("a corner strike exposes two finite support paths and deforms through real input",async({page})=>{
  await page.goto("/?accept=hammer");
  const body=page.locator("body"),canvas=page.locator("#game");
  await expect(body).toHaveAttribute("data-camera-state","settled");
  await canvas.focus();
  for(let i=0;i<25;i++)await page.keyboard.press("ArrowRight");
  for(let i=0;i<10;i++)await page.keyboard.press("ArrowDown");
  const p=await scenePoint(page,"hammer:105:58");
  await page.mouse.move(p.x,p.y);
  const contact=await page.evaluate(()=>(window as unknown as {__forgeInspect:()=>{hammer:{aim:{
    impactNormal:{x:number;y:number;z:number};edges:{boundaryNormal:{x:number;y:number;z:number};loadPath:unknown;supportPath:unknown}[]
  }}}}).__forgeInspect().hammer.aim);
  expect(contact.impactNormal).toEqual({x:0,y:-1,z:0});
  expect(contact.edges.map(edge=>edge.boundaryNormal)).toEqual([{x:1,y:0,z:0},{x:0,y:0,z:1}]);
  expect(contact.edges.every(edge=>edge.loadPath&&edge.supportPath)).toBe(true);
  const volume=await body.getAttribute("data-total-material-volume");
  await page.mouse.click(p.x,p.y);
  await expect(body).toHaveAttribute("data-acceptance-operation-count","1");
  await expect.poll(async()=>Number(await body.getAttribute("data-hammer-minimum-thickness"))).toBeLessThan(8);
  await expect(body).toHaveAttribute("data-total-material-volume",volume!);
});

test("grind contact commits real material removal", async ({ page }) => {
  await page.goto("/?accept=grind");
  const body = page.locator("body");
  const point = await scenePoint(page, "billet");
  const before = Number(await body.getAttribute("data-removed-volume"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) await page.keyboard.press("w");
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(body).toHaveAttribute("data-completed-verbs", /grind/);
  await expect.poll(async () => Number(await body.getAttribute("data-removed-volume"))).toBeGreaterThan(before);
  const once=Number(await body.getAttribute("data-removed-volume"));
  const again=await scenePoint(page,"billet");
  await page.mouse.move(again.x,again.y);await page.mouse.down();
  await expect.poll(async()=>Number(await body.getAttribute("data-removed-volume")),{timeout:6000}).toBeGreaterThan(once+5);
  await page.keyboard.press("s");
  await page.waitForTimeout(500);
  const withdrawn=await body.getAttribute("data-removed-volume");
  await page.waitForTimeout(400);
  expect(await body.getAttribute("data-removed-volume")).toBe(withdrawn);
  await page.mouse.up();
});

test("quench cools only while the workpiece remains in the liquid", async ({ page }) => {
  for (const medium of ["water", "oil"] as const) {
    await page.goto(`/?accept=quench&medium=${medium}`);
    const body = page.locator("body");
    // The app listens on window; avoid a focus round-trip while the renderer
    // is settling so this regression measures the real keyboard path.
    const before = Number(await body.getAttribute("data-temperature-c"));
    for (let i = 0; i < 40; i++) await page.keyboard.press("s");
    await expect(body).toHaveAttribute("data-quench-medium", medium);
    await expect.poll(async () => Number(await body.getAttribute("data-temperature-c"))).toBeLessThan(before);
    for (let i = 0; i < 40; i++) await page.keyboard.press("w");
    await page.waitForTimeout(450);
    const outside = Number(await body.getAttribute("data-temperature-c"));
    await page.waitForTimeout(450);
    expect(Number(await body.getAttribute("data-temperature-c"))).toBe(outside);
  }
});

test("weld acceptance joins the visible current and bench workpieces", async ({ page }) => {
  await page.goto("/?accept=weld");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state", "settled");
  await dragScene(page,"billet","weld:0");

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

test("heating and tempering use independent furnaces and retain the current workpiece",async({page})=>{
  await page.goto("/?accept=temper");
  const body=page.locator("body"),id=await body.getAttribute("data-workpiece-id");
  const camera=()=>page.evaluate(()=>(window as unknown as {__forgeInspect:()=>{camera:{position:number[];target:number[]}}}).__forgeInspect().camera);
  await expect(body).toHaveAttribute("data-camera-state","settled");
  const temperFrame=await camera();
  await page.locator("[data-furnace-mode=furnace]").click();
  await expect(body).toHaveAttribute("data-active-station","furnace");
  await expect(body).toHaveAttribute("data-camera-state","settled");
  const heatingFrame=await camera();
  expect(heatingFrame.position).not.toEqual(temperFrame.position);
  expect(heatingFrame.target).not.toEqual(temperFrame.target);
  await page.locator("[data-furnace-mode=temper]").click();
  await expect(body).toHaveAttribute("data-active-station","temper");
  await expect(body).toHaveAttribute("data-camera-state","settled");
  expect(await camera()).toEqual(temperFrame);
  await dragScene(page,"billet",{x:-230,y:0});
  await expect(page.locator("#heat-toggle")).toHaveText("取出并完成回火");
  await page.waitForTimeout(250);
  await page.locator("#heat-toggle").click();
  await expect(body).toHaveAttribute("data-completed-verbs",/temper/);
  await expect(body).toHaveAttribute("data-workpiece-id",id!);
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
  for(let i=0;i<16;i++)await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async()=>JSON.parse((await body.getAttribute("data-cut-pose"))!).x).toBe(64);
  expect(Number(await body.getAttribute("data-total-material-volume"))).toBe(original);
  for(let i=0;i<15;i++)await page.keyboard.press("Shift+ArrowLeft");
  // Center the width on the finite guide's endpoint, leaving half uncut.
  for(let i=0;i<9;i++)await page.keyboard.press("ArrowDown");
  await expect(confirm).toBeEnabled({timeout:30000});
  await expect(page.locator("#cut-status")).toContainText("仍为一块");
  const pose=await body.getAttribute("data-cut-pose");
  expect(JSON.parse(pose!).x).toBe(4);
  expect(Number(await body.getAttribute("data-total-material-volume"))).toBe(original);
  await confirm.click();
  await expect(body).toHaveAttribute("data-acceptance-operation-count","1",{timeout:15000});
  await expect(body).toHaveAttribute("data-bench-count","0");
  await expect(body).toHaveAttribute("data-workpiece-id",id!);
  await expect(body).toHaveAttribute("data-cut-pose",pose!);
  expect(Number(await body.getAttribute("data-cut-loss-volume"))).toBeCloseTo(24*8,5);
  await page.locator("#game").focus();
  for(let i=0;i<9;i++)await page.keyboard.press("ArrowUp");
  await expect(confirm).toBeEnabled({timeout:30000});
  await expect(page.locator("#cut-status")).toContainText("将分成 2 块");
  await confirm.click();
  await expect(body).toHaveAttribute("data-acceptance-operation-count","2",{timeout:15000});
  await expect(body).toHaveAttribute("data-bench-count","1");
  expect(Number(await body.getAttribute("data-cut-loss-volume"))).toBeCloseTo(48*8,5);
  expect(Number(await body.getAttribute("data-total-material-volume"))+Number(await body.getAttribute("data-cut-loss-volume"))).toBeCloseTo(original,5);
  expect(errors).toEqual([]);
});

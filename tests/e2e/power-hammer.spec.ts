import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { scenePoint } from "./scene-input.ts";

const { PNG } = createRequire(import.meta.url)("pngjs");
interface PowerInspection {
  power: {pose:{x:number;z:number;yaw:number;roll:number};gapMm:number;previewVertices:number;previewVisible:boolean;contactHeight:number};
  renderer: {calls:number;triangles:number};
}
const inspect = (page:Page):Promise<PowerInspection> => page.evaluate(() =>
  (window as unknown as {__forgeInspect:()=>PowerInspection}).__forgeInspect());
const count = async (page:Page) => Number(await page.locator("body").getAttribute("data-operation-count"));
async function ready(page:Page) {
  await page.goto("/?accept=power");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state","settled");
  await expect(page.locator("body")).toHaveAttribute("data-power-phase","idle");
}
async function idle(page:Page) {
  await expect(page.locator("body")).toHaveAttribute("data-power-phase","idle",{timeout:30_000});
  await expect(page.locator("body")).toHaveAttribute("data-powered-pending","false");
}
async function drag(page:Page,dx:number,dy:number,button:"left"|"right"="left") {
  const p=await scenePoint(page,"billet");
  await page.mouse.move(p.x,p.y);await page.mouse.down({button});
  await page.mouse.move(p.x+dx,p.y+dy,{steps:4});await page.mouse.up({button});
}
function pixels(buffer:Buffer) {
  const png=PNG.sync.read(buffer) as {data:Buffer;width:number;height:number};
  let sum=0,squared=0,nonblack=0;
  const n=png.width*png.height;
  for(let i=0;i<png.data.length;i+=4){
    const l=(png.data[i]!+png.data[i+1]!+png.data[i+2]!)/3;
    sum+=l;squared+=l*l;if(l>4)nonblack++;
  }
  return {nonblack:nonblack/n,deviation:Math.sqrt(squared/n-(sum/n)**2)};
}

for(const viewport of [{width:1280,height:900},{width:390,height:844}]) {
  test(`power: repeat, release, placement and rendered model at ${viewport.width}px`,async({page},testInfo)=>{
    test.setTimeout(90_000);
    const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(viewport);await ready(page);
    const body=page.locator("body"),before=await count(page);
    const volume=await body.getAttribute("data-total-material-volume"),temperature=await body.getAttribute("data-temperature-c");
    expect((await inspect(page)).power.previewVertices).toBeGreaterThan(0);
    const p=await scenePoint(page,"billet");await page.mouse.move(p.x,p.y);
    await page.mouse.wheel(0,-120);
    await expect(page.locator("#powered-force")).toHaveValue("50");
    await drag(page,12,0);
    expect(Math.abs((await inspect(page)).power.pose.x)).toBeGreaterThan(1);
    await page.locator("#powered-center").click();
    await drag(page,10,0,"right");
    expect((await inspect(page)).power.pose.yaw).toBeGreaterThan(0.05);
    await page.locator("#power-axis").selectOption("roll");
    await drag(page,10,0,"right");
    expect((await inspect(page)).power.pose.roll).toBeGreaterThan(0.05);
    expect(await count(page)).toBe(before);
    await page.locator("#powered-center").click();
    // A focused force slider must not swallow the primary Space control.
    await page.locator("#powered-force").focus();
    await page.keyboard.down("Space");
    await expect.poll(()=>count(page),{timeout:30_000}).toBeGreaterThanOrEqual(before+2);
    await page.keyboard.up("Space");await idle(page);
    const stopped=await count(page);await page.waitForTimeout(800);
    expect(await count(page)).toBe(stopped);
    await expect(body).toHaveAttribute("data-total-material-volume",volume!);
    await expect(body).toHaveAttribute("data-temperature-c",temperature!);
    expect((await inspect(page)).power.gapMm).toBeCloseTo(120);
    const metrics=pixels(await page.locator("#game").screenshot({path:`output/playwright/power-${viewport.width}-operation.png`}));
    expect(metrics.nonblack).toBeGreaterThan(0.8);expect(metrics.deviation).toBeGreaterThan(12);
    await page.screenshot({path:`output/playwright/power-${viewport.width}-layout.png`});
    const canvas=await page.locator("#game").boundingBox(),controls=await page.locator("#powered-controls").boundingBox();
    expect(controls!.y).toBeGreaterThanOrEqual(canvas!.y+canvas!.height-1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator("#power-machine-view").click();
    await expect(body).toHaveAttribute("data-camera-state","settled");
    const machine=pixels(await page.locator("#game").screenshot({path:`output/playwright/power-${viewport.width}-machine.png`}));
    expect(machine.deviation).toBeGreaterThan(12);
    await testInfo.attach("render-evidence",{body:JSON.stringify({viewport,metrics,machine,stopped,renderer:(await inspect(page)).renderer}),contentType:"application/json"});
    expect(errors).toEqual([]);
  });
}

test("power: release in descent completes one stroke; inspection cancels held input",async({page})=>{
  test.setTimeout(60_000);await ready(page);
  const body=page.locator("body"),before=await count(page);
  await page.keyboard.down("Space");
  await expect(body).toHaveAttribute("data-power-phase","down");
  await expect(page.locator("#powered-feed")).toBeDisabled();
  await page.keyboard.up("Space");
  await expect.poll(()=>count(page),{timeout:30_000}).toBe(before+1);await idle(page);
  await page.waitForTimeout(800);expect(await count(page)).toBe(before+1);
  await page.locator("#power-machine-view").click();
  await page.keyboard.down("Space");await page.keyboard.up("Space");
  await expect(body).toHaveAttribute("data-power-held","false");
  await page.locator('[data-inspection-view="default"]').click();
  await page.waitForTimeout(800);expect(await count(page)).toBe(before+1);
});

test("power: empty strikes animate without material edits and blur stops repeat",async({page})=>{
  test.setTimeout(60_000);await ready(page);
  const body=page.locator("body"),before=await count(page);
  await page.locator("#game").focus();
  for(let i=0;i<5;i++)await page.keyboard.press("Shift+ArrowDown");
  expect((await inspect(page)).power.previewVisible).toBe(false);
  await page.keyboard.down("Space");
  await expect(body).toHaveAttribute("data-power-phase","down");
  expect((await inspect(page)).power.gapMm).toBeLessThan(120);
  await page.keyboard.up("Space");await idle(page);expect(await count(page)).toBe(before);
  await page.locator("#powered-center").click();await page.locator("#game").focus();
  await page.keyboard.down("Space");
  await expect(body).toHaveAttribute("data-power-phase","down");
  const second=await page.context().newPage();await second.bringToFront();
  // Headless window managers do not always dispatch OS focus changes.
  await page.evaluate(()=>window.dispatchEvent(new Event("blur")));
  await expect(body).toHaveAttribute("data-power-held","false");
  await page.keyboard.up("Space");await idle(page);
  const stopped=await count(page);await page.waitForTimeout(800);expect(await count(page)).toBe(stopped);
  await second.close();
});

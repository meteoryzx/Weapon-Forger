import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { scenePoint } from "./scene-input.ts";

const { PNG } = createRequire(import.meta.url)("pngjs");
interface Inspection {
  press:{pose:{x:number;z:number;yaw:number;roll:number};gapMm:number;contactHeight:number;previewVertices:number;previewVisible:boolean};
  renderer:{calls:number;triangles:number};
}
const inspect=(page:Page):Promise<Inspection>=>page.evaluate(()=>(window as unknown as {__forgeInspect:()=>Inspection}).__forgeInspect());
const count=async(page:Page)=>Number(await page.locator("body").getAttribute("data-operation-count"));
async function ready(page:Page){
  await page.goto("/?accept=press");
  await expect(page.locator("body")).toHaveAttribute("data-camera-state","settled");
  await expect(page.locator("body")).toHaveAttribute("data-press-phase","idle");
}
async function idle(page:Page){
  await expect(page.locator("body")).toHaveAttribute("data-press-phase","idle",{timeout:30_000});
  await expect(page.locator("body")).toHaveAttribute("data-powered-pending","false");
}
async function drag(page:Page,dx:number,dy=0,button:"left"|"right"="left"){
  const p=await scenePoint(page,"billet");
  await page.mouse.move(p.x,p.y);await page.mouse.down({button});
  await page.mouse.move(p.x+dx,p.y+dy,{steps:4});await page.mouse.up({button});
}
function pixels(buffer:Buffer){
  const png=PNG.sync.read(buffer) as {data:Buffer;width:number;height:number};
  let sum=0,squared=0,nonblack=0;
  const n=png.width*png.height;
  for(let i=0;i<png.data.length;i+=4){const l=(png.data[i]!+png.data[i+1]!+png.data[i+2]!)/3;sum+=l;squared+=l*l;if(l>4)nonblack++;}
  return {nonblack:nonblack/n,deviation:Math.sqrt(squared/n-(sum/n)**2)};
}

for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  test(`press: held compression, placement and reference model at ${viewport.width}px`,async({page},testInfo)=>{
    test.setTimeout(90_000);
    const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(viewport);await ready(page);
    const body=page.locator("body"),before=await count(page);
    const volume=await body.getAttribute("data-total-material-volume"),temperature=await body.getAttribute("data-temperature-c");
    expect((await inspect(page)).press.previewVertices).toBeGreaterThan(0);
    const beforeDrag=await inspect(page);
    await drag(page,16);
    const afterDrag=await inspect(page);
    expect(Math.abs(afterDrag.press.pose.x-beforeDrag.press.pose.x)+Math.abs(afterDrag.press.pose.z-beforeDrag.press.pose.z)).toBeGreaterThan(1);
    await page.locator("#game").focus();await page.keyboard.press("w");
    expect(Math.abs((await inspect(page)).press.pose.z)+Math.abs((await inspect(page)).press.pose.x)).toBeGreaterThan(1);
    await page.keyboard.press("d");expect((await inspect(page)).press.pose.roll).toBeGreaterThan(0.05);
    await page.locator("#powered-center").click();
    const p=await scenePoint(page,"billet");await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,-120);
    await expect(page.locator("#powered-force")).toHaveValue("70");
    const original=(await inspect(page)).press.contactHeight;
    await page.locator("#powered-force").focus();await page.keyboard.down("Space");
    await expect(body).toHaveAttribute("data-press-phase","closing");
    await expect(body).toHaveAttribute("data-press-phase","loading");
    await expect.poll(async()=>Number(await body.getAttribute("data-press-dwell")),{timeout:30_000}).toBeGreaterThan(700);
    expect(await count(page)).toBe(before);
    const loaded=(await inspect(page)).press;
    expect(loaded.contactHeight).toBeLessThan(original);
    expect(loaded.gapMm).toBeCloseTo(loaded.contactHeight,1);
    await page.screenshot({path:`output/playwright/press-${viewport.width}-loading.png`});
    await page.keyboard.up("Space");await idle(page);
    expect(await count(page)).toBe(before+1);
    await page.waitForTimeout(500);expect(await count(page)).toBe(before+1);
    await expect(body).toHaveAttribute("data-total-material-volume",volume!);
    await expect(body).toHaveAttribute("data-temperature-c",temperature!);
    expect((await inspect(page)).press.gapMm).toBeCloseTo(120);
    const metrics=pixels(await page.locator("#game").screenshot({path:`output/playwright/press-${viewport.width}-operation.png`}));
    expect(metrics.nonblack).toBeGreaterThan(0.8);expect(metrics.deviation).toBeGreaterThan(12);
    const canvas=await page.locator("#game").boundingBox(),controls=await page.locator("#powered-controls").boundingBox();
    expect(controls!.y).toBeGreaterThanOrEqual(canvas!.y+canvas!.height-1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator("#power-machine-view").click();
    await expect(body).toHaveAttribute("data-camera-state","settled");
    const machine=pixels(await page.locator("#game").screenshot({path:`output/playwright/press-${viewport.width}-machine.png`}));
    expect(machine.deviation).toBeGreaterThan(12);
    await testInfo.attach("press-evidence",{body:JSON.stringify({viewport,original,loaded,metrics,machine,renderer:(await inspect(page)).renderer}),contentType:"application/json"});
    expect(errors).toEqual([]);
  });
}

test("press: early release, empty load and blur do not leave queued cycles",async({page})=>{
  test.setTimeout(90_000);await page.setViewportSize({width:1280,height:900});await ready(page);
  const body=page.locator("body"),before=await count(page);
  await page.keyboard.press("Space",{delay:20});
  await idle(page);expect(await count(page)).toBe(before);
  await page.locator("#game").focus();
  // Feed toward the screen-depth frame. The aligned press axis reaches its
  // physical placement boundary before it can pass through the upright.
  for(let i=0;i<22;i++)await page.keyboard.press("s");
  const bounded=await inspect(page);
  expect(bounded.press.pose.z).toBeLessThan(-90);
  await page.waitForTimeout(150);
  await drag(page,-16);
  expect((await inspect(page)).press.previewVisible).toBe(false);
  await page.keyboard.down("Space");await expect(body).toHaveAttribute("data-press-phase","loading");
  await page.keyboard.up("Space");await idle(page);expect(await count(page)).toBe(before);
  await page.locator("#powered-center").click();
  const button=await page.locator("#powered-run").boundingBox();
  await page.mouse.move(button!.x+button!.width/2,button!.y+button!.height/2);await page.mouse.down();
  await expect.poll(async()=>Number(await body.getAttribute("data-press-dwell")),{timeout:30_000}).toBeGreaterThan(250);
  await page.evaluate(()=>window.dispatchEvent(new Event("blur")));
  await page.mouse.up();await idle(page);
  await expect(body).toHaveAttribute("data-press-held","false");
  expect(await count(page)).toBe(before+1);
  await page.waitForTimeout(1000);expect(await count(page)).toBe(before+1);
});

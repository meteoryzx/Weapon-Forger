import { expect, type Page } from "@playwright/test";

export async function scenePoint(page:Page,name:string) {
  await expect(page.locator("body")).toHaveAttribute("data-camera-state","settled");
  const point=await page.evaluate(key=>{
    const inspect=(window as unknown as {__forgeInspect:()=>{points:Record<string,{x:number;y:number}>}}).__forgeInspect;
    return inspect().points[key];
  },name);
  expect(point,`projected scene target ${name}`).toBeTruthy();
  const canvas=(await page.locator("#game").boundingBox())!;
  return {x:canvas.x+point!.x,y:canvas.y+point!.y};
}

export async function clickScene(page:Page,name:string) {
  const p=await scenePoint(page,name);await page.mouse.click(p.x,p.y);
}

export async function dragScene(page:Page,from:string,to:string|{x:number;y:number}) {
  const start=await scenePoint(page,from),end=typeof to==="string"?await scenePoint(page,to):{x:start.x+to.x,y:start.y+to.y};
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(end.x,end.y,{steps:6});await page.mouse.up();
}

import { expect, test, type Page } from "@playwright/test";
import { scenePoint } from "./scene-input.ts";

type Point = {x:number;y:number;z:number};
type HammerInspection = {
  busy:boolean;
  tailSections:{points:Point[];widthProfile:Point[];cup:number}[];
};
const inspect = (page:Page) => page.evaluate(() =>
  (window as unknown as {__forgeInspect:()=>{hammer:HammerInspection}}).__forgeInspect().hammer);

for(const viewport of [{width:1280,height:720},{width:390,height:844}])for(const eccentric of [false,true]){
  const targetZ=eccentric?(viewport.width===390?-18:18):0;
  test(`repeated right-edge hammering ${eccentric?"off-center":"centered"} keeps the unloaded tail connected at ${viewport.width}px`,async({page},testInfo)=>{
    test.setTimeout(120000);
    const errors:string[]=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/?accept=hammer");
    const body=page.locator("body"),canvas=page.locator("#game");
    await expect(body).toHaveAttribute("data-camera-state","settled");
    const volume=await body.getAttribute("data-total-material-volume");
    await canvas.focus();
    for(let i=0;i<25;i++)await page.keyboard.press("ArrowRight");
    await expect(body).toHaveAttribute("data-hammer-x","100");
    const target=await scenePoint(page,`hammer:105:${targetZ}`);
    expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id,target)).toBe("game");
    await page.mouse.move(target.x,target.y);
    for(let i=0;i<5;i++)await page.mouse.wheel(0,-100);
    await expect(body).toHaveAttribute("data-hammer-energy","0.8");
    const before=await inspect(page);
    const prefix=`output/playwright/${eccentric?"eccentric":"moment"}-${viewport.width}`;
    await page.screenshot({path:`${prefix}-before.png`});
    await canvas.screenshot({path:`${prefix}-canvas-before.png`});
    const frames:HammerInspection[]=[];
    for(let hit=1;hit<=12;hit++){
      await expect.poll(async()=>(await inspect(page)).busy).toBe(false);
      await expect(body).toHaveAttribute("data-hammer-pending","false");
      const p=await scenePoint(page,`hammer:105:${targetZ}`);
      await page.mouse.click(p.x,p.y);
      await expect(body).toHaveAttribute("data-acceptance-operation-count",String(hit));
      const state=await inspect(page),[a,b,c]=state.tailSections.map(section=>section.points[1]!);
      const slope=(c!.y-a!.y)/(c!.x-a!.x);
      expect(slope).toBeLessThan(0);
      expect(Math.abs(b!.y-a!.y-slope*(b!.x-a!.x))).toBeLessThan(0.002);
      for(const section of state.tailSections){
        const first=section.widthProfile[0]!,last=section.widthProfile.at(-1)!;
        const transverseSlope=(last.y-first.y)/(last.z-first.z);
        for(const point of section.widthProfile)
          expect(Math.abs(point.y-first.y-transverseSlope*(point.z-first.z))).toBeLessThan(0.01);
      }
      frames.push(state);
    }
    await expect.poll(async()=>(await inspect(page)).busy).toBe(false);
    await page.mouse.move(1,1);
    await page.screenshot({path:`${prefix}-after.png`});
    await canvas.screenshot({path:`${prefix}-canvas-after.png`});
    const after=await inspect(page);
    if(eccentric){
      const section=after.tailSections.at(-1)!.points;
      expect((section[0]!.y-section[2]!.y)*Math.sign(targetZ)).toBeGreaterThan(0.1);
    }
    expect(after.tailSections[2]!.points[1]!.y).toBeLessThan(before.tailSections[2]!.points[1]!.y-0.05);
    await expect(body).toHaveAttribute("data-total-material-volume",volume!);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const canvasBox=(await canvas.boundingBox())!;
    const controls=await page.getByRole("button",{name:"重新摆正",exact:true}).boundingBox();
    expect(controls!.y).toBeGreaterThanOrEqual(canvasBox.y+canvasBox.height);
    await testInfo.attach("tail-measurements",{body:JSON.stringify({viewport,before,frames,after},null,2),contentType:"application/json"});
    if(eccentric){
      await page.getByRole("button",{name:"前视",exact:true}).click();
      await expect(body).toHaveAttribute("data-camera-state","settled");
      await page.screenshot({path:`${prefix}-front.png`});
    }
    expect(errors).toEqual([]);
  });
}

import { expect, test } from "@playwright/test";
import { clickScene, dragScene, scenePoint } from "./scene-input.ts";

test("authored stations preserve the continuous forge workflow and workpiece facts",async({page})=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");
  const body=page.locator("body");
  const visit=async(station:string)=>{
    await page.keyboard.press("Escape");
    await expect(body).toHaveAttribute("data-active-station","overview");
    await clickScene(page,"station:"+station);
    await expect(body).toHaveAttribute("data-active-station",station);
    await expect(body).toHaveAttribute("data-camera-state","settled");
  };
  await clickScene(page,"station:anvil");
  await expect(body).toHaveAttribute("data-active-station","anvil");
  await clickScene(page,"hammer");
  await expect(body).toHaveAttribute("data-operation-count","1",{timeout:20000});

  await visit("materials");
  await clickScene(page,"material:high-carbon-steel");
  await expect(body).toHaveAttribute("data-material-candidate","high-carbon-steel");
  await page.locator("#material-confirm").click();
  await clickScene(page,"table:1");
  await expect(body).toHaveAttribute("data-carbon","0.900000");
  const acquired=await body.getAttribute("data-workpiece-id");
  await page.locator("#material-return").click();
  await expect(body).toHaveAttribute("data-current-workpiece-location","rack");
  await expect(page.locator("#workpiece-travel")).toBeDisabled();
  await clickScene(page,"returned:"+acquired);
  await expect(body).toHaveAttribute("data-current-workpiece-location","table");
  await expect(body).toHaveAttribute("data-carbon","0.900000");

  await visit("cut");
  await expect(page.locator("#cut-confirm")).toBeEnabled({timeout:30000});
  await page.locator("#cut-confirm").click();
  await expect(body).toHaveAttribute("data-bench-count","2",{timeout:15000});
  await expect(body).toHaveAttribute("data-bench-material-ids","spring-steel,high-carbon-steel");

  const identity=await body.getAttribute("data-workpiece-id");

  await visit("furnace");
  await dragScene(page,"billet",{x:230,y:0});
  await expect.poll(async()=>Number(await body.getAttribute("data-temperature-c"))).toBeGreaterThan(50);
  const removeFromFurnace=page.getByRole("button",{name:"取出查看",exact:true});
  const removeFromFurnaceBox=await removeFromFurnace.boundingBox();
  expect(removeFromFurnaceBox).not.toBeNull();
  await page.mouse.click(removeFromFurnaceBox!.x+removeFromFurnaceBox!.width/2,removeFromFurnaceBox!.y+removeFromFurnaceBox!.height/2);
  await expect(body).toHaveAttribute("data-billet-location","inspection");

  await visit("quench-water");
  await page.locator("#game").focus();
  for(let i=0;i<10;i++)await page.keyboard.press("s");
  await expect(body).toHaveAttribute("data-quench-medium","water");

  await visit("furnace");
  await page.locator("[data-furnace-mode=temper]").click({force:true});
  await expect(body).toHaveAttribute("data-active-station","temper");
  await dragScene(page,"billet",{x:-230,y:0});
  await expect(page.locator("#heat-toggle")).toHaveText("取出并完成回火");
  await page.waitForTimeout(250);
  await page.locator("#heat-toggle").click();
  await expect(body).toHaveAttribute("data-completed-verbs",/temper/);

  await visit("grind");
  const removedBeforeGrinding=Number(await body.getAttribute("data-removed-volume"));
  const grindPoint=await scenePoint(page,"billet");
  await page.mouse.move(grindPoint.x,grindPoint.y);
  await page.mouse.down();
  try {
    for(let i=0;i<8;i++)await page.keyboard.press("w");
    // Grinding advances on held-contact ticks; releasing after input delivery
    // can cancel contact before the first tick submits any material removal.
    await expect.poll(async()=>Number(await body.getAttribute("data-removed-volume")),{timeout:15000})
      .toBeGreaterThan(removedBeforeGrinding);
  } finally {
    await page.mouse.up();
  }
  await expect(body).toHaveAttribute("data-completed-verbs",/grind/,{timeout:15000});
  await expect(body).toHaveAttribute("data-workpiece-id",identity!);
  expect(errors).toEqual([]);
});

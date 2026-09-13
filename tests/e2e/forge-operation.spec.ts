import { expect, test } from "@playwright/test";
import { clickScene, dragScene } from "./scene-input.ts";

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

  // Welding compatibility remains on the selection table; there is no separate room station.
  await visit("materials");
  await page.locator("#workpiece-station").selectOption("weld");
  await page.locator("#workpiece-travel").click();
  await expect(body).toHaveAttribute("data-active-station","weld");
  await dragScene(page,"billet","weld:0");
  await expect(body).toHaveAttribute("data-joint-count","1");
  await expect(body).toHaveAttribute("data-layer-count","2");
  await expect(body).toHaveAttribute("data-material-region-count","2");
  expect(Number(await body.getAttribute("data-carbon"))).toBeGreaterThan(0.65);
  expect(Number(await body.getAttribute("data-carbon"))).toBeLessThan(0.9);
  const identity=await body.getAttribute("data-workpiece-id");

  await visit("furnace");
  await page.getByRole("button",{name:"送入加热",exact:true}).click();
  await expect.poll(async()=>Number(await body.getAttribute("data-temperature-c"))).toBeGreaterThan(50);
  await page.getByRole("button",{name:"取出查看",exact:true}).click();
  await expect(body).toHaveAttribute("data-completed-verbs",/heat/);

  await visit("quench-water");
  await page.locator("#game").focus();
  for(let i=0;i<3;i++)await page.keyboard.press("s");
  await expect(body).toHaveAttribute("data-quench-medium","water");

  await visit("furnace");
  await page.locator("[data-furnace-mode=temper]").click({force:true});
  await expect(body).toHaveAttribute("data-active-station","temper");
  await dragScene(page,"temper",{x:0,y:-40});
  await expect(body).toHaveAttribute("data-completed-verbs",/temper/);

  await visit("grind");
  await dragScene(page,"billet",{x:140,y:-15});
  await expect(body).toHaveAttribute("data-completed-verbs",/grind/);
  await expect(body).toHaveAttribute("data-workpiece-id",identity!);
  expect(errors).toEqual([]);
});

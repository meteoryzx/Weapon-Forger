import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  for (const station of ["press"] as const) {
    test(`${station} performs one real powered shaping cycle at ${viewport.width}px`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize(viewport);
      await page.goto(`/?accept=${station}`);
      const body=page.locator("body"),controls=page.locator("#powered-controls");
      await expect(body).toHaveAttribute("data-camera-state","settled");
      await expect(controls).toBeVisible();
      const volume=await body.getAttribute("data-total-material-volume");
      const temperature=await body.getAttribute("data-temperature-c");
      const operationCount=Number(await body.getAttribute("data-operation-count"));
      await page.locator("#powered-feed").evaluate((element:HTMLInputElement)=>{
        element.value="24";element.dispatchEvent(new Event("input",{bubbles:true}));
      });
      await page.locator("#powered-cycle").evaluate((element:HTMLInputElement)=>{
        element.value=element.max==="4"?"1":"2";element.dispatchEvent(new Event("input",{bubbles:true}));
      });
      await expect(body).toHaveAttribute("data-powered-feed","24");
      await page.locator("#powered-run").click();
      await expect.poll(async () => Number(await body.getAttribute("data-operation-count")), { timeout: 30_000 })
        .toBe(operationCount + 1);
      await expect(body).toHaveAttribute("data-powered-pending","false");
      await expect(body).toHaveAttribute("data-completed-verbs",new RegExp(station));
      await expect(page.locator("#powered-run")).toBeEnabled();
      await expect(body).toHaveAttribute("data-total-material-volume",volume!);
      await expect(body).toHaveAttribute("data-temperature-c",temperature!);
      await expect(page.locator("#powered-status")).toContainText(
        "手动开关控制一次压下、保压和回程",
      );
      await page.screenshot({path:`output/playwright/${station}-${viewport.width}.png`});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const canvasBox=await page.locator("#game").boundingBox(),controlsBox=await controls.boundingBox();
      expect(controlsBox!.y).toBeGreaterThanOrEqual(canvasBox!.y+canvasBox!.height-1);
      await testInfo.attach("powered-state",{body:JSON.stringify({station,viewport,volume,temperature}),contentType:"application/json"});
      expect(errors).toEqual([]);
    });
  }
}

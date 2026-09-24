import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const skill=path.join(homedir(),".codex/skills/threejs-qa-release/scripts/inspect-threejs-canvas.mjs");
const {inspectPage}=await import(pathToFileURL(skill));
const runId="reconstruction-r2-shared-furnace",root="artifacts/reconstruction-r2";
const base=process.env.FORGE_REVIEW_URL??"http://127.0.0.1:4183/";
const states=["overview","materials","cut","heat","hammer","quench","temper","grind"];
const modes={desktop:{width:1440,height:900},mobile:{width:390,height:844}};
const manifest={version:1,runId,captures:[],artifacts:[`${root}/workshop-actions.webm`,`${root}/motion.json`]};
for(const mode of Object.keys(modes))for(const state of states){
  const report=`${root}/${mode}-${state}/${mode}.json`;
  if(state==="overview")manifest.captures.push({mode,state:null,report});
  else manifest.artifacts.push(report,`${root}/${mode}-${state}/${mode}.png`);
}
await mkdir(root,{recursive:true});await writeFile("artifacts/evidence.json",JSON.stringify(manifest,null,2)+"\n");
const browser=await chromium.launch({channel:process.env.FORGE_TEST_CHANNEL??"msedge"});
const summary=[];
try {
  for(const [mode,viewport] of Object.entries(modes)){
    const context=await browser.newContext({viewport,deviceScaleFactor:1});
    for(const state of states){
      const out=`${root}/${mode}-${state}`;await mkdir(out,{recursive:true});
      const page=await context.newPage();
      const report=await inspectPage(page,{url:base+(state==="overview"?"":"?accept="+state),out,mobile:mode==="mobile",wait:1200,state:null,runId});
      const expected=state==="heat"?"furnace":state==="hammer"?"anvil":state==="quench"?"quench-water":state;
      report.expectedStation=expected;
      report.actualStation=report.result.diagnostics?.station;
      report.layout=await page.evaluate(()=>{
        const box=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
        return {canvas:box(document.querySelector("#game")),controls:[...document.querySelectorAll("section:not([hidden])")].filter(e=>getComputedStyle(e).display!=="none").map(e=>({id:e.id,...box(e),overflow:e.scrollHeight>e.clientHeight+1}))};
      });
      await writeFile(`${out}/${mode}.json`,JSON.stringify(report,null,2)+"\n");
      if(!report.result.ok || report.consoleErrors.length || report.pageErrors.length || report.actualStation!==expected)throw new Error(`Invalid capture ${mode}/${state}: ${JSON.stringify(report)}`);
      summary.push({mode,state,renderer:report.result.diagnostics.renderer,metrics:report.result.metrics,gpu:report.gpu,layout:report.layout});
      console.log(`${mode}/${state}: nonblank, ${report.result.diagnostics.renderer.calls} calls`);
      await page.close();
    }
    await context.close();
  }
  const context=await browser.newContext({viewport:modes.desktop,recordVideo:{dir:root,size:modes.desktop}});
  const page=await context.newPage(),motion=[];
  const point=async key=>{
    const p=await page.evaluate(key=>window.__forgeInspect().points[key],key),r=await page.locator("#game").boundingBox();
    return {x:p.x+r.x,y:p.y+r.y};
  };
  for(const state of ["hammer","cut","heat","quench"]){
    await page.goto(base+"?accept="+state);await page.locator("body[data-camera-state=settled]").waitFor();
    const before=await page.locator("#game").screenshot();
    if(state==="hammer"){const p=await point("hammer");await page.mouse.click(p.x,p.y);await page.locator('body[data-acceptance-operation-count="1"]').waitFor();}
    if(state==="cut"){await page.locator("#cut-confirm:not([disabled])").click();await page.locator('body[data-acceptance-operation-count="1"]').waitFor();}
    if(state==="heat"){await page.locator("#heat-toggle").click();await page.waitForTimeout(2200);}
    if(state==="quench"){await page.locator("#game").focus();for(let i=0;i<3;i++)await page.keyboard.press("s");await page.waitForTimeout(550);}
    const after=await page.locator("#game").screenshot(),a=PNG.sync.read(before),b=PNG.sync.read(after);
    let changed=0;for(let i=0;i<a.data.length;i+=4)if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>20)changed++;
    await page.screenshot({path:`${root}/${state}-after-input.png`});
    motion.push({state,changedPixels:changed,diagnostics:await page.evaluate(()=>window.__forgeInspect()),facts:await page.locator("body").evaluate(e=>({...e.dataset}))});
    if(changed<30)throw new Error(`${state}: input did not visibly change the canvas`);
  }
  const video=page.video();await context.close();await video.saveAs(`${root}/workshop-actions.webm`);
  await writeFile(`${root}/motion.json`,JSON.stringify(motion,null,2)+"\n");
  await writeFile(`${root}/summary.json`,JSON.stringify(summary,null,2)+"\n");
} finally {await browser.close();}

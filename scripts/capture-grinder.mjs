import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const pass=process.argv[2]??'blockout';
const output='artifacts/grinder-build/'+pass;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
try{
  const page=await browser.newPage({viewport:{width:800,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const view of ['hero','front','side','rear','left']){
    await page.goto('http://127.0.0.1:4199/grinder-preview.html?pass='+pass+'&view='+view);
    await page.waitForFunction(()=>window.__grinderReview?.renderer.info.render.calls>0);
    await page.locator('nav').evaluate(e=>e.style.visibility='hidden');
    await page.screenshot({path:output+'/'+view+'.png'});
  }
  await writeFile(output+'/runtime.json',JSON.stringify({errors,...await page.evaluate(()=>{
    const {root,renderer}=window.__grinderReview;const parts=[];
    root.traverse(o=>{if(o.isMesh)parts.push({name:o.name,vertices:o.geometry.attributes.position.count});});
    return {parts,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  })},null,2));
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}

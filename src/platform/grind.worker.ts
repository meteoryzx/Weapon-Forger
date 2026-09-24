import { applyForgeOperation, createForgeSnapshot, type ForgeState, type GrindOperation } from "../forge/index.ts";
import { createBilletGeometry } from "../render/forge-billet-view.ts";
import type { AbrasiveUpdate } from "../app/grind-update.ts";

let state:ForgeState|null=null;
self.onmessage=(event:MessageEvent<{state?:ForgeState;operation:GrindOperation}>)=>{
  try{
    if(event.data.state)state=event.data.state;
    if(!state)throw new Error("Missing grinding source.");
    const start=performance.now(),source=state,next=applyForgeOperation(source,event.data.operation);
    if(next===source){self.postMessage({changed:false} satisfies AbrasiveUpdate);return;}
    const original=new Set(source.workpiece.geometry.solids),remaining=new Set(next.workpiece.geometry.solids!.map(s=>s.id));
    const mesh=createBilletGeometry(createForgeSnapshot(next),null);
    const changed=next.workpiece.geometry.solids!.filter(s=>!original.has(s));
    const beforeIndex=new Map(source.workpiece.geometry.solids!.map((s,i)=>[s,i]));
    const changedIndex=new Map(changed.map((s,i)=>[s,i]));
    const order=Int32Array.from(next.workpiece.geometry.solids!,s=>beforeIndex.get(s)??(-changedIndex.get(s)!-1));
    const positions=mesh.getAttribute("position").array as Float32Array,colors=mesh.getAttribute("color").array as Float32Array;
    const update:AbrasiveUpdate={changed:true,operation:event.data.operation,
      solids:changed,order,
      removedSolidIds:source.workpiece.geometry.solids!.filter(s=>!remaining.has(s.id)).map(s=>s.id),
      sections:next.workpiece.sections.flatMap((section,index)=>section===source.workpiece.sections[index]?[]:[{index,section}]),
      outline:next.workpiece.geometry.outline,positions,colors,computeMs:performance.now()-start};
    state=next;mesh.dispose();
    self.postMessage(update,{transfer:[positions.buffer,colors.buffer,order.buffer]});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:"Grinding failed."});}
};

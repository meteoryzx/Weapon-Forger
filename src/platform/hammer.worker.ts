import { applyForgeOperation, type ForgeState, type ForgeOperation } from "../forge/index.ts";

let baseline:ForgeState|null=null;
self.onmessage=(event:MessageEvent<{state?:ForgeState;reuseBaseline?:boolean;operation:ForgeOperation}>)=>{
  try {
    if(!event.data.reuseBaseline)baseline=event.data.state??null;
    if(!baseline)throw new Error("Missing forge baseline.");
    self.postMessage({state:applyForgeOperation(baseline,event.data.operation)});
  }
  catch(error){self.postMessage({error:error instanceof Error?error.message:"锤击计算失败。"});}
};

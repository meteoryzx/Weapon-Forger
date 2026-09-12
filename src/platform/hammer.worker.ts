import { applyForgeOperation, type ForgeState, type SurfaceHammerOperation } from "../forge/index.ts";

self.onmessage=(event:MessageEvent<{state:ForgeState;operation:SurfaceHammerOperation}>)=>{
  try { self.postMessage({state:applyForgeOperation(event.data.state,event.data.operation)}); }
  catch(error){self.postMessage({error:error instanceof Error?error.message:"锤击计算失败。"});}
};

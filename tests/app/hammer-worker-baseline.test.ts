import { expect, it, vi } from "vitest";

const solve=vi.hoisted(()=>vi.fn((state:object,operation:object)=>({state,operation})));
vi.mock("../../src/forge/index.ts",()=>({applyForgeOperation:solve}));

it("reuses the immutable source, never the last pressure result, and requires a baseline",async()=>{
  const worker={onmessage:null as ((e:{data:object})=>void)|null,postMessage:vi.fn()};
  vi.stubGlobal("self",worker);
  try {
    await import("../../src/platform/hammer.worker.ts");
    worker.onmessage!({data:{reuseBaseline:true,operation:{dwellMs:100}}});
    expect(worker.postMessage).toHaveBeenLastCalledWith({error:"Missing forge baseline."});
    const state={id:1};
    worker.onmessage!({data:{state,operation:{dwellMs:200}}});
    worker.onmessage!({data:{reuseBaseline:true,operation:{dwellMs:400}}});
    expect(solve.mock.calls.at(-1)![0]).toBe(state);
    const next={id:2};worker.onmessage!({data:{state:next,operation:{dwellMs:600}}});
    expect(solve.mock.calls.at(-1)![0]).toBe(next);
  } finally {vi.unstubAllGlobals();}
});

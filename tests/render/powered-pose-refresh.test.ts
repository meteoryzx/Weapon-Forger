import { describe, expect, it, vi } from "vitest";
import { ForgeBilletView } from "../../src/render/forge-billet-view.ts";
import { HAMMER_HOME } from "../../src/forge/index.ts";

describe("powered placement redraws",()=>{
  it("does not rebuild or render unchanged poses during stroke control refreshes",()=>{
    const view=Object.create(ForgeBilletView.prototype) as ForgeBilletView;
    Object.assign(view,{poweredPose:{...HAMMER_HOME},snapshot:{},station:"power",temperPreviewC:null});
    const update=vi.spyOn(view,"update").mockImplementation(()=>{});
    view.setPoweredPose({...HAMMER_HOME});
    expect(update).not.toHaveBeenCalled();
    view.setPoweredPose({...HAMMER_HOME,x:4});
    expect(update).toHaveBeenCalledTimes(1);
    // A committed shape is refreshed with its new snapshot, never the old geometry.
    view.setPoweredPose({...HAMMER_HOME,x:5},false);
    view.setPoweredPose({...HAMMER_HOME,x:5});
    expect(update).toHaveBeenCalledTimes(1);
  });
});

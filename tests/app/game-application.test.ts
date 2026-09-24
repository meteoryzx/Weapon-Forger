import { describe, expect, it } from "vitest";

import { GameApplication } from "../../src/app/game-application.ts";
import { applyForgeOperation, HAMMER_HOME, type ForgeState, type SurfaceHammerOperation } from "../../src/forge/index.ts";

describe("heating application", () => {
  it("rejects stale hammer worker results and recovers from a failed evaluation", async () => {
    const app=new GameApplication();
    const operation:SurfaceHammerOperation={kind:"surface-hammer",pose:HAMMER_HOME,target:{x:0,z:0},energy:0.5};
    let resolve!:(state:ForgeState)=>void;
    const old=app.getState();
    const pending=app.applySurfaceHammer(operation,()=>new Promise(done=>{resolve=done;}));
    app.applyIntent({kind:"move-billet",destination:"furnace",elapsedMs:0});
    app.applyIntent({kind:"move-billet",destination:"inspection",elapsedMs:15000});
    const current=app.getState();
    resolve(old);
    await expect(pending).rejects.toThrow(/已经改变/);
    expect(app.getState()===current).toBe(true);
    await expect(app.applySurfaceHammer(operation,async()=>{throw new Error("worker failure");})).rejects.toThrow("worker failure");
    expect(app.getState()===current).toBe(true);
    const result=await app.applySurfaceHammer(operation,async(state,op)=>applyForgeOperation(state,op));
    expect(result.workpieceId).toBe(current.workpiece.id);
    expect(app.getState().operations.at(-1)?.kind).toBe("surface-hammer");
  });
  it("starts cold, heats in the furnace, and cools at the inspection position", () => {
    const application = new GameApplication();
    const initial = application.getSnapshot();

    expect(initial.billetLocation).toBe("inspection");
    expect(initial.averageTemperatureC).toBe(20);
    expect(initial.geometry.grid).toEqual({ widthBlocks: 24, heightBlocks: 4 });

    application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
    const heatingPreview = application.getSnapshot(15_000);
    expect(heatingPreview.billetLocation).toBe("furnace");
    expect(heatingPreview.averageTemperatureC).toBeGreaterThan(650);

    const inspected = application.applyIntent({
      kind: "move-billet", destination: "inspection", elapsedMs: 15_000,
    });
    expect(inspected.averageTemperatureC).toBeCloseTo(heatingPreview.averageTemperatureC, 0);
    const coolingPreview = application.getSnapshot(10_000);
    expect(coolingPreview.averageTemperatureC).toBeLessThan(inspected.averageTemperatureC);
  });

  it("exposes raw forge facts without choosing a downstream profile", () => {
    const application = new GameApplication();
    application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
    const heated = application.getSnapshot(15_000);
    application.commitPreview();

    const facts = application.getFacts();
    expect(facts.averageTemperatureC).toBeCloseTo(heated.averageTemperatureC, 8);
    expect(facts.averageTemperatureC).toBeGreaterThan(650);
    expect(facts.stateVersion).toBe(application.getState().stateVersion);
  });
});

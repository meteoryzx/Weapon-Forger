import { expect, it } from "vitest";
import { GameApplication } from "../../src/app/game-application.ts";
import { HAMMER_HOME, type ForgePressOperation, type ForgeState } from "../../src/forge/index.ts";

const operation:ForgePressOperation={kind:"forge-press",pose:HAMMER_HOME,target:{x:0,z:0},pressure:0.5,strokeMm:24,dwellMs:1000};
it("commits a prepared pressure result once without reapplying the operation",async()=>{
  const app=new GameApplication(),source=app.getState();
  const final={...source,operations:[...source.operations,operation]};
  await app.applyPoweredForge(operation,async baseline=>{expect(baseline).toBe(source);return final;});
  expect(app.getState()).toBe(final);expect(app.getState().operations).toHaveLength(source.operations.length+1);
});
it("rejects an outstanding pressure result when its material baseline changes",async()=>{
  const app=new GameApplication(),source=app.getState();
  let resolve!:(result:ForgeState)=>void;
  const pending=app.applyPoweredForge(operation,()=>new Promise(done=>{resolve=done;}));
  app.applyIntent({kind:"move-billet",destination:"furnace",elapsedMs:0});
  const current=app.getState();resolve(source);
  await expect(pending).rejects.toThrow(/已经改变/);expect(app.getState()).toBe(current);
});

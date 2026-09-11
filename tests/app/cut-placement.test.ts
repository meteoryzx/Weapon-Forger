import { describe, expect, it } from "vitest";
import { CUT_HOME, CUT_TABLE, SAW_PATH, cutOperationFor, validCutPose, tablePoint } from "../../src/app/cut-placement.ts";
import { GameApplication } from "../../src/app/game-application.ts";
import { applyForgeIntent, createForgeState, createForgeSnapshot } from "../../src/forge/index.ts";

describe("saw placement and prepared cutting",()=>{
  it("maps a finite world tool path back through the exact displayed rotation and translation",()=>{
    const snapshot=createForgeSnapshot(createForgeState());
    for(const angle of [0,0.2,-0.3,Math.PI]){
      const pose={x:13,z:21,angle};
      const op=cutOperationFor(snapshot,pose,0);
      const a=tablePoint(snapshot,pose,op.path!.start.axialPosition,op.path!.start.lateralOffset);
      const b=tablePoint(snapshot,pose,op.path!.end.axialPosition,op.path!.end.lateralOffset);
      expect(a.x).toBeCloseTo(SAW_PATH.x,9);expect(b.x).toBeCloseTo(SAW_PATH.x,9);
      expect(a.z).toBeCloseTo(SAW_PATH.startZ,9);expect(b.z).toBeCloseTo(SAW_PATH.endZ,9);
    }
  });
  it("allows overhang and unrestricted rotation, rejecting only invalid coordinates",()=>{
    expect(validCutPose(CUT_HOME)).toBe(true);
    expect(validCutPose({...CUT_HOME,x:CUT_TABLE.halfWidth})).toBe(true);
    expect(validCutPose({...CUT_HOME,z:-100})).toBe(true);
    expect(validCutPose({...CUT_HOME,angle:Math.PI/2})).toBe(true);
    expect(validCutPose({...CUT_HOME,x:NaN})).toBe(false);
  });
  it("preparing is read-only; confirmation commits exactly the validated result once",async()=>{
    const app=new GameApplication(), before=app.getState();
    // Use a precomputed small, valid result to exercise the application transaction
    // separately from geometric regressions (which cover the full executor).
    const operation=cutOperationFor(app.getSnapshot(),CUT_HOME,0);
    const result=applyForgeIntent(createForgeState({sectionCount:8}),{kind:"cut",sectionIndex:4});
    expect(await app.prepareCut(operation,async(source)=>{expect(source).toBe(before);return result;})).toBe(true);
    expect(app.getState()).toBe(before);
    app.commitPreparedCut(operation);
    expect(app.getState()).toBe(result);
    expect(()=>app.commitPreparedCut(operation)).toThrow(/stale/);
  });
  it("rejects a stale result after a new pose or source-state operation",async()=>{
    const app=new GameApplication(), op=cutOperationFor(app.getSnapshot(),CUT_HOME,0);
    let complete:(state:ReturnType<typeof app.getState>)=>void=()=>{};
    const pending=app.prepareCut(op,()=>new Promise(resolve=>{complete=resolve;}));
    app.cancelPreparedCut();complete(app.getState());
    expect(await pending).toBe(false);
    expect(()=>app.commitPreparedCut(op)).toThrow(/stale/);
    await app.prepareCut(op,async state=>state);
    app.applyIntent({kind:"feed",step:1});
    expect(()=>app.commitPreparedCut(op)).toThrow(/stale/);
  });
});

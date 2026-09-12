import { describe, it, expect } from "vitest";
import { applyForgeOperation, createForgeState, createForgeSnapshot, createForgeFacts, serializeForgeState, deserializeForgeState,
  replayForgeState, HAMMER_HOME, hammerFrame, placedHammerSurface, hammerContact, geometryVolumes, toAnvil, fromAnvil,
  type ForgeState, type HammerPose, type SurfaceHammerOperation } from "../../src/forge/index.ts";

const hot=()=>applyForgeOperation(createForgeState({sectionCount:24}),{kind:"heat",temperatureC:950});
const strike=(pose:HammerPose=HAMMER_HOME,energy=0.8):SurfaceHammerOperation=>({kind:"surface-hammer",pose,target:{x:0,z:0},energy});
const volume=(s:ForgeState)=>[...geometryVolumes(s.workpiece).values()].reduce((a,b)=>a+b,0);
const contact=(s:ForgeState,pose=HAMMER_HOME,x=0,z=0)=>hammerContact(placedHammerSurface(s.workpiece.geometry,hammerFrame(s.workpiece.geometry,pose)),x,z);
const height=(s:ForgeState,pose=HAMMER_HOME)=>contact(s,pose)!.point.y;

describe("surface hammer",()=>{
  it("round trips arbitrary yaw and roll, grounds material without changing its shape",()=>{
    const s=hot(),pose={x:13,z:-9,yaw:0.73,roll:0.47},frame=hammerFrame(s.workpiece.geometry,pose);
    const p={x:5,y:3,z:-11},restored=fromAnvil(toAnvil(p,frame),frame);
    expect(restored.x).toBeCloseTo(p.x,10);expect(restored.y).toBeCloseTo(p.y,10);expect(restored.z).toBeCloseTo(p.z,10);
    const points=placedHammerSurface(s.workpiece.geometry,frame).flatMap(t=>t.points);
    expect(Math.min(...points.map(p=>p.y))).toBeCloseTo(0,10);
  });
  it("makes hot heavy blows deeper than light or cold blows and preserves volume and temperature",()=>{
    const s=hot(),heavy=applyForgeOperation(s,strike()),light=applyForgeOperation(s,strike(HAMMER_HOME,0.2));
    const cold=createForgeState({sectionCount:24}),coldHit=applyForgeOperation(cold,strike());
    expect(height(heavy)).toBeLessThan(height(light));expect(height(light)).toBeLessThan(height(s));
    expect(height(s)-height(heavy)).toBeGreaterThan(height(cold)-height(coldHit));
    expect(volume(heavy)/volume(s)).toBeCloseTo(1,4);
    expect(createForgeSnapshot(heavy).averageTemperatureC).toBe(950);
    expect(heavy.workpiece.sections.reduce((a,b)=>a+b.mechanicalWorkJ,0)).toBeGreaterThan(0);
    expect(createForgeFacts(heavy)).toBeDefined();
  });
  it("supports repeated oblique and side blows with deterministic save and replay",()=>{
    const s=hot(),ops=[strike({...HAMMER_HOME,yaw:0.24,roll:0.4}),strike({...HAMMER_HOME,yaw:-0.3,roll:Math.PI/2})];
    let next=s;for(const op of ops)next=applyForgeOperation(next,op);
    expect(volume(next)/volume(s)).toBeCloseTo(1,4);
    expect(serializeForgeState(deserializeForgeState(serializeForgeState(next)))).toBe(serializeForgeState(next));
    expect(serializeForgeState(replayForgeState(createForgeState({sectionCount:24}),next.operations))===serializeForgeState(next)).toBe(true);
  });
  it("rejects empty space and unsupported overhang without modifying the source",()=>{
    const s=hot(),before=serializeForgeState(s);
    expect(()=>applyForgeOperation(s,{...strike(),target:{x:0,z:100}})).toThrow(/金属/);
    expect(()=>applyForgeOperation(s,{...strike({...HAMMER_HOME,x:200}),target:{x:200,z:0}})).toThrow(/支撑/);
    expect(serializeForgeState(s)).toBe(before);
  });
  it("retains a finite slot, ignores its void, and hammers surviving material",()=>{
    const s=applyForgeOperation(hot(),{kind:"cut",path:{id:"slot",start:{axialPosition:24,lateralOffset:-5},end:{axialPosition:24,lateralOffset:5},kerfWidth:3}});
    expect(contact(s)).toBeNull();
    const op={...strike(),target:{x:10,z:0}},next=applyForgeOperation(s,op);
    expect(volume(next)/volume(s)).toBeCloseTo(1,4);
    expect(next.cutLosses).toEqual(s.cutLosses);
    expect(deserializeForgeState(serializeForgeState(next)).workpiece.id).toBe(s.workpiece.id);
  });
  it("migrates v4 and validates new stored operation fields",()=>{
    const s=hot(),old=deserializeForgeState(JSON.stringify({...s,stateVersion:"forge-state-4",parameterVersion:"physics-3"}));
    expect(old.stateVersion).toBe("forge-state-5");
    expect(old.parameterVersion).toBe("physics-3");
    expect(applyForgeOperation(old,strike()).parameterVersion).toBe("physics-4");
    const invalid={...s,operations:[{...strike(),energy:2}]};
    expect(()=>deserializeForgeState(JSON.stringify(invalid))).toThrow(/energy/);
  });
  it("forms a narrower tip by placing repeated side blows near one end",()=>{
    const s=applyForgeOperation(createForgeState({sectionCount:64}),{kind:"heat",temperatureC:950});
    let next=s;
    for(let i=0;i<10;i++)next=applyForgeOperation(next,{...strike({...HAMMER_HOME,roll:Math.PI/2}),target:{x:48,z:0}});
    const widthAt=(state:ForgeState,index:number)=>{
      const g=state.workpiece.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1);
      const nodes=g.nodes.slice(index*ring,(index+1)*ring);
      return Math.max(...nodes.map(n=>n.lateralOffset))-Math.min(...nodes.map(n=>n.lateralOffset));
    };
    expect(widthAt(next,56)).toBeLessThan(widthAt(next,32)*0.9);
    expect(volume(next)/volume(s)).toBeCloseTo(1,3);
    expect(next.workpiece.sections.every(s=>s.blocks.every(b=>Number.isFinite(b.damage)&&Number.isFinite(b.stress)))).toBe(true);
  });
  it("progressively thins and widens a face, and narrows the width after rolling onto an edge",()=>{
    const s=hot();let flat=s,side=s;
    for(let i=0;i<16;i++){
      flat=applyForgeOperation(flat,strike());
      side=applyForgeOperation(side,strike({...HAMMER_HOME,roll:Math.PI/2}));
    }
    expect(height(flat)).toBeLessThan(height(s)*0.65);
    expect(height(side,{...HAMMER_HOME,roll:Math.PI/2})).toBeLessThan(height(s,{...HAMMER_HOME,roll:Math.PI/2})*0.8);
    expect(volume(flat)/volume(s)).toBeCloseTo(1,3);expect(volume(side)/volume(s)).toBeCloseTo(1,3);
    const width=(n:ForgeState)=>Math.max(...n.workpiece.geometry.nodes.map(p=>p.lateralOffset))-Math.min(...n.workpiece.geometry.nodes.map(p=>p.lateralOffset));
    expect(width(flat)).toBeGreaterThan(width(s));
    const afterCut=applyForgeOperation(flat,{kind:"cut",path:{id:"after-hammer",start:{axialPosition:24,lateralOffset:-50},end:{axialPosition:24,lateralOffset:50},kerfWidth:1}});
    expect(afterCut.bench.length).toBe(1);expect(()=>serializeForgeState(afterCut)).not.toThrow();
  });
});

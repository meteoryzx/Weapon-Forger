import { expect, it } from "vitest";
import { applyForgeOperation, createForgeState, HAMMER_HOME, SPRING_STEEL,
  geometryVolumes, serializeForgeState, deserializeForgeState, replayForgeState,
  hammerContact, hammerFrame, placedHammerSurface,
  type ForgeState } from "../../src/forge/index.ts";

const stock=()=>applyForgeOperation(createForgeState({material:SPRING_STEEL}),{kind:"heat",temperatureC:1007});
const strike=(state:ForgeState,z:number)=>applyForgeOperation(state,{
  kind:"surface-hammer",pose:{...HAMMER_HOME,x:100},target:{x:105,z},energy:0.8,
});
const tail=(state:ForgeState)=>{
  const g=state.workpiece.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1);
  return g.nodes.slice(-ring).filter(n=>n.heightIndex===g.grid.heightBlocks/2);
};

it("an eccentric edge blow does not split the unloaded tail into independent width strips",()=>{
  const next=strike(stock(),18),row=tail(next),a=row[0]!,b=row.at(-1)!;
  // Beyond the local load, a solid narrow bar carries bending and torsion as
  // a connected section, not a lowered half joined to an unbent flat half.
  const slope=(b.verticalOffset-a.verticalOffset)/(b.lateralOffset-a.lateralOffset);
  const residual=Math.max(...row.map(n=>Math.abs(n.verticalOffset-a.verticalOffset-slope*(n.lateralOffset-a.lateralOffset))));
  expect(residual).toBeLessThan(0.01);
});

it("moving the hammer 0.2 mm across the old whole-section threshold does not detach the opposite side",()=>{
  const s=stock(),a=tail(strike(s,7.9)),b=tail(strike(s,8.1));
  const change=Math.max(...a.map((n,i)=>Math.abs(n.verticalOffset-b[i]!.verticalOffset)));
  expect(change).toBeLessThan(0.01);
  const surface=placedHammerSurface(s.workpiece.geometry,hammerFrame(s.workpiece.geometry,{...HAMMER_HOME,x:100}));
  const before=hammerContact(surface,105,7.9)!.edges[0]!,after=hammerContact(surface,105,8.1)!.edges[0]!;
  expect(before.width-after.width).toBeCloseTo(0.2,8);
  expect(before.coherentSection).toEqual(after.coherentSection);
});

it("rotates eccentric bending and torsion consistently with the support boundary",()=>{
  const s=stock(),right=strike(s,18),turned=applyForgeOperation(s,{
    kind:"surface-hammer",pose:{...HAMMER_HOME,z:-40,yaw:Math.PI/2},target:{x:18,z:-45},energy:0.8,
  });
  const a=tail(right),b=tail(turned);
  for(let i=0;i<a.length;i++){
    expect(a[i]!.verticalOffset).toBeCloseTo(b[i]!.verticalOffset,5);
    expect(a[i]!.lateralOffset).toBeCloseTo(b[i]!.lateralOffset,5);
  }
});

it("repeated eccentric blows rotate a connected section, mirror with load side, and preserve volume/history",()=>{
  const s=stock();let left=s,right=s;
  const volume=(state:ForgeState)=>[...geometryVolumes(state.workpiece).values()].reduce((sum,v)=>sum+v,0);
  for(let hit=0;hit<12;hit++){
    left=strike(left,-18);right=strike(right,18);
    for(const state of [left,right]){
      const row=tail(state),a=row[0]!,b=row.at(-1)!;
      const slope=(b.verticalOffset-a.verticalOffset)/(b.lateralOffset-a.lateralOffset);
      expect(Math.max(...row.map(n=>Math.abs(n.verticalOffset-a.verticalOffset-slope*(n.lateralOffset-a.lateralOffset))))).toBeLessThan(0.01);
      expect(Math.abs(volume(state)/volume(s)-1)).toBeLessThan(0.0002);
    }
  }
  const l=tail(left),r=tail(right);
  expect(l[0]!.verticalOffset-l.at(-1)!.verticalOffset).toBeLessThan(-0.1);
  expect(r[0]!.verticalOffset-r.at(-1)!.verticalOffset).toBeGreaterThan(0.1);
  for(let i=0;i<l.length;i++){
    expect(l[i]!.verticalOffset).toBeCloseTo(r.at(-i-1)!.verticalOffset,4);
    expect(l[i]!.lateralOffset).toBeCloseTo(-r.at(-i-1)!.lateralOffset,4);
  }
  const saved=serializeForgeState(right);
  expect(serializeForgeState(deserializeForgeState(saved))).toBe(saved);
  expect(serializeForgeState(replayForgeState(createForgeState({material:SPRING_STEEL}),right.operations))).toBe(saved);
},20000);

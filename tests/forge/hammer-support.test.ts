import { describe, expect, it } from "vitest";
import { applyForgeOperation, createForgeState, hammerFrame, placedHammerSurface, hammerContact,
  geometryVolumes, HAMMER_HOME, serializeForgeState, deserializeForgeState, replayForgeState,
  type ForgeState, type HammerPose, type SurfaceHammerOperation } from "../../src/forge/index.ts";

const initial = () => createForgeState({sectionCount:64});
const hot = () => applyForgeOperation(initial(), {kind:"heat",temperatureC:1000});
const pose = {...HAMMER_HOME,x:100};
const operation = (energy=0.8):SurfaceHammerOperation => ({kind:"surface-hammer",pose,target:{x:105,z:0},energy});
const volume = (s:ForgeState) => [...geometryVolumes(s.workpiece).values()].reduce((a,b)=>a+b,0);
const surface = (s:ForgeState,p:HammerPose=pose) => placedHammerSurface(s.workpiece.geometry,hammerFrame(s.workpiece.geometry,p));
const mid = (s:ForgeState,fraction:number) => {
  const g=s.workpiece.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1);
  const index=Math.round((g.nodes.length/ring-1)*fraction);
  const ys=g.nodes.slice(index*ring,(index+1)*ring).map(n=>n.verticalOffset);
  return (Math.min(...ys)+Math.max(...ys))/2;
};
const drop = (s:ForgeState) => mid(s,0.1)-mid(s,0.9);

describe("finite anvil support",()=>{
  it("bends a hot overhang more than a light or cold blow, with conserved volume",()=>{
    const s=hot(),heavy=applyForgeOperation(s,operation()),light=applyForgeOperation(s,operation(0.1));
    const cold=applyForgeOperation(initial(),operation(0.1));
    expect(drop(heavy)).toBeGreaterThan(0.05);
    expect(drop(heavy)).toBeGreaterThan(drop(light));
    expect(Math.abs(drop(cold))).toBeLessThan(0.001);
    for(const next of [heavy,light,cold])expect(Math.abs(volume(next)/volume(s)-1)).toBeLessThan(0.00002);
  });
  it("does not bend an unloaded overhang or a fully supported strike",()=>{
    const s=hot(),center=applyForgeOperation(s,{...operation(),pose:HAMMER_HOME,target:{x:0,z:0}});
    expect(hammerContact(surface(s,HAMMER_HOME),0,0)!.edges).toHaveLength(0);
    expect(Math.abs(drop(center))).toBeLessThan(0.001);
    const away=applyForgeOperation(s,{...operation(),target:{x:65,z:0}});
    expect(Math.abs(drop(away))).toBeLessThan(0.001);
  });
  it("responds symmetrically at opposite edges and after yawing across the short edge",()=>{
    const s=hot(),right=applyForgeOperation(s,operation());
    const left=applyForgeOperation(s,{...operation(),pose:{...HAMMER_HOME,x:-100},target:{x:-105,z:0}});
    const turned=applyForgeOperation(s,{...operation(),pose:{...HAMMER_HOME,z:-40,yaw:Math.PI/2},target:{x:0,z:-45}});
    expect(drop(right)).toBeCloseTo(-drop(left),4);
    expect(drop(right)).toBeCloseTo(drop(turned),4);
  });
  it("retains a finite cut and its loss accounting while bending surviving material",()=>{
    const s=applyForgeOperation(hot(),{kind:"cut",path:{id:"overhang-slot",start:{axialPosition:96,lateralOffset:-5},end:{axialPosition:96,lateralOffset:5},kerfWidth:3}});
    const next=applyForgeOperation(s,operation());
    expect(drop(next)).toBeGreaterThan(0.05);
    expect(Math.abs(volume(next)/volume(s)-1)).toBeLessThan(0.00002);
    expect(next.cutLosses).toEqual(s.cutLosses);
    expect(next.workpiece.geometry.solids).toEqual(s.workpiece.geometry.solids);
  });
  it("keeps support grounded across repeated blows, permits a tip below the plane and repositions without penetration",()=>{
    const s=hot();let next=s;
    for(let i=0;i<5;i++){
      next=applyForgeOperation(next,operation());
      const triangles=surface(next),points=triangles.flatMap(t=>t.points);
      const supported=points.filter(p=>Math.abs(p.x)<=112&&Math.abs(p.z)<=52);
      // The resting contact can lie between lattice vertices at the anvil edge.
      for(const triangle of triangles)for(let k=0;k<3;k++)for(const x of [-112,112]){
        const a=triangle.points[k]!,b=triangle.points[(k+1)%3]!;
        if((a.x-x)*(b.x-x)>=0)continue;
        const t=(x-a.x)/(b.x-a.x),z=a.z+t*(b.z-a.z);
        if(Math.abs(z)<=52)supported.push({x,y:a.y+t*(b.y-a.y),z});
      }
      expect(Math.min(...supported.map(p=>p.y))).toBeCloseTo(0,5);
      expect(Math.min(...points.map(p=>p.y))).toBeLessThan(-0.05);
    }
    expect(drop(next)).toBeGreaterThan(drop(applyForgeOperation(s,operation())));
    expect(Math.abs(volume(next)/volume(s)-1)).toBeLessThan(0.0001);
    expect(Math.min(...surface(next,HAMMER_HOME).flatMap(t=>t.points.map(p=>p.y)))).toBeGreaterThanOrEqual(-1e-8);
    const saved=serializeForgeState(next);
    expect(serializeForgeState(deserializeForgeState(saved))).toBe(saved);
    expect(serializeForgeState(replayForgeState(initial(),next.operations))).toBe(saved);
  });
});

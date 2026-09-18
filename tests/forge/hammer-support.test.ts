import { describe, expect, it } from "vitest";
import { applyForgeOperation, createForgeState, hammerFrame, placedHammerSurface, hammerContact,
  geometryVolumes, HAMMER_HOME, serializeForgeState, deserializeForgeState, replayForgeState, nodePoint, toAnvil,
  SPRING_STEEL,
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
const overhangHeightAt = (s:ForgeState,fraction:number) => {
  const g=s.workpiece.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1);
  const index=Math.round((g.nodes.length/ring-1)*fraction);
  const ys=g.nodes.slice(index*ring,(index+1)*ring)
    .filter(n=>n.lateralOffset>12)
    .map(n=>n.verticalOffset);
  return (Math.min(...ys)+Math.max(...ys))/2;
};
const anvilMidProfile = (s:ForgeState,p:HammerPose) => {
  const g=s.workpiece.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1),frame=hammerFrame(g,p);
  return Array.from({length:g.nodes.length/ring},(_,index)=>{
    const points=g.nodes.slice(index*ring,(index+1)*ring).map(n=>toAnvil(nodePoint(n),frame));
    return {
      x:points.reduce((sum,point)=>sum+point.x,0)/points.length,
      z:points.reduce((sum,point)=>sum+point.z,0)/points.length,
      y:(Math.min(...points.map(point=>point.y))+Math.max(...points.map(point=>point.y)))/2,
    };
  });
};
const closestProfilePoint = (profile:ReturnType<typeof anvilMidProfile>,axis:"x"|"z",position:number) =>
  profile.reduce((closest,point)=>Math.abs(point[axis]-position)<Math.abs(closest[axis]-position)?point:closest);
const edgeDepth = (s:ForgeState,p:HammerPose,axis:"x"|"z",supported:number,near:number) => {
  const profile=anvilMidProfile(s,p);
  return closestProfilePoint(profile,axis,near).y-closestProfilePoint(profile,axis,supported).y;
};

describe("finite anvil support",()=>{
  it("does not introduce reverse curvature beyond a downward loaded footprint on the full-size billet",()=>{
    const s=applyForgeOperation(createForgeState({material:SPRING_STEEL}),{kind:"heat",temperatureC:1007});
    let next=s;
    for(let hit=0;hit<8;hit++)next=applyForgeOperation(next,operation());
    const profile=anvilMidProfile(next,pose);
    const root=closestProfilePoint(profile,"x",112),loaded=closestProfilePoint(profile,"x",124);
    const tail=closestProfilePoint(profile,"x",220);
    // A downward load on a held cantilever has one sign of bending moment.
    // Forcing the free tail back up adds an unphysical second support/reaction.
    expect(loaded.y).toBeLessThan(root.y-0.02);
    expect(tail.y).toBeLessThanOrEqual(loaded.y+0.002);
    const g=next.workpiece.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1);
    for(const axialIndex of [115,135,155,168]){
      const row=g.nodes.slice(axialIndex*ring,(axialIndex+1)*ring).filter(n=>n.heightIndex===2);
      const cup=(row[0]!.verticalOffset+row.at(-1)!.verticalOffset)/2-row[12]!.verticalOffset;
      expect(Math.abs(cup)).toBeLessThan(0.002);
    }
  });
  it("bends a hot overhang more than a light or cold blow, with conserved volume",()=>{
    const s=hot(),heavy=applyForgeOperation(s,operation()),light=applyForgeOperation(s,operation(0.1));
    const cold=applyForgeOperation(initial(),operation(0.1));
    expect(edgeDepth(heavy,pose,"x",108,128)).toBeLessThan(-0.05);
    expect(edgeDepth(heavy,pose,"x",108,128)).toBeLessThan(edgeDepth(light,pose,"x",108,128));
    expect(Math.abs(edgeDepth(cold,pose,"x",108,128))).toBeLessThan(0.001);
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
    expect(edgeDepth(right,pose,"x",108,128)).toBeCloseTo(edgeDepth(left,{...HAMMER_HOME,x:-100},"x",-108,-128),4);
    expect(edgeDepth(right,pose,"x",108,128)).toBeCloseTo(edgeDepth(turned,{...HAMMER_HOME,z:-40,yaw:Math.PI/2},"z",-48,-68),4);
  });
  it("retains a finite cut and its loss accounting while bending surviving material",()=>{
    const s=applyForgeOperation(hot(),{kind:"cut",path:{id:"overhang-slot",start:{axialPosition:96,lateralOffset:-5},end:{axialPosition:96,lateralOffset:5},kerfWidth:3}});
    const next=applyForgeOperation(s,operation());
    expect(edgeDepth(next,pose,"x",108,128)).toBeLessThan(-0.05);
    expect(Math.abs(volume(next)/volume(s)-1)).toBeLessThan(0.00002);
    expect(next.cutLosses).toEqual(s.cutLosses);
    expect(next.workpiece.geometry.solids).toEqual(s.workpiece.geometry.solids);
  });
  it("localizes a half-width overhang load along the billet instead of bending the whole strip",()=>{
    const s=hot();
    const overhang={...HAMMER_HOME,z:40};
    const op={kind:"surface-hammer" as const,pose:overhang,target:{x:0,z:58},energy:0.8};
    const next=applyForgeOperation(s,op);
    const beforeNear=overhangHeightAt(s,0.5),beforeFar=overhangHeightAt(s,0.05);
    const near=overhangHeightAt(next,0.5),far=overhangHeightAt(next,0.05);
    expect(beforeNear-beforeFar).toBeCloseTo(0,6);
    expect(near-beforeNear).toBeLessThan(-0.05);
    expect(Math.abs(far-beforeFar)).toBeLessThan(0.01);
  });
  it("keeps the unloaded tail straight while it follows the yielded root",()=>{
    const s=hot();let next=s;
    for(let hit=0;hit<5;hit++)next=applyForgeOperation(next,operation());
    const profile=anvilMidProfile(next,pose);
    const supported=closestProfilePoint(profile,"x",108),near=closestProfilePoint(profile,"x",128);
    const farA=closestProfilePoint(profile,"x",148),farB=closestProfilePoint(profile,"x",164);
    const farMid=closestProfilePoint(profile,"x",156);
    const remoteSlope=(farB.y-farA.y)/(farB.x-farA.x);
    expect(near.y-supported.y).toBeLessThan(-0.05);
    expect(Math.abs(supported.y-4)).toBeLessThan(0.002);
    expect(remoteSlope).toBeLessThan(0);
    expect(Math.abs(farMid.y-(farA.y+remoteSlope*(farMid.x-farA.x)))).toBeLessThan(0.002);
  });
  it("keeps finite edge-impact propagation symmetric after mirroring and yawing the workpiece",()=>{
    let reference=hot();
    for(let hit=0;hit<5;hit++)reference=applyForgeOperation(reference,operation());
    const right=anvilMidProfile(reference,pose);
    const rightA=closestProfilePoint(right,"x",148),rightB=closestProfilePoint(right,"x",164);
    const rightSlope=(rightB.y-rightA.y)/(rightB.x-rightA.x);
    const cases=[
      {pose:{...HAMMER_HOME,x:-100},target:{x:-105,z:0},axis:"x" as const,supported:-108,near:-128,farA:-148,farB:-164},
      {pose:{...HAMMER_HOME,z:-40,yaw:Math.PI/2},target:{x:0,z:-45},axis:"z" as const,supported:-48,near:-68,farA:-88,farB:-104},
    ];
    for(const scenario of cases){
      let next=hot();
      for(let hit=0;hit<5;hit++)next=applyForgeOperation(next,{kind:"surface-hammer",pose:scenario.pose,target:scenario.target,energy:0.8});
      const profile=anvilMidProfile(next,scenario.pose);
      const farA=closestProfilePoint(profile,scenario.axis,scenario.farA);
      const farB=closestProfilePoint(profile,scenario.axis,scenario.farB);
      const supported=closestProfilePoint(profile,scenario.axis,scenario.supported);
      const near=closestProfilePoint(profile,scenario.axis,scenario.near);
      const remoteSlope=(farB.y-farA.y)/(farB[scenario.axis]-farA[scenario.axis]);
      expect(near.y-supported.y).toBeLessThan(-0.05);
      expect(remoteSlope).toBeCloseTo(-rightSlope,5);
      expect(near.y-supported.y).toBeCloseTo(edgeDepth(reference,pose,"x",108,128),5);
    }
  });
  it("describes a corner strike as two finite load and support paths",()=>{
    const s=hot(),corner={...HAMMER_HOME,x:100,z:40};
    const contact=hammerContact(surface(s,corner),105,58)!;
    expect(contact.impactNormal).toEqual({x:0,y:-1,z:0});
    expect(contact.edges).toHaveLength(2);
    expect(contact.edges.map(edge=>edge.boundaryNormal)).toEqual([
      {x:1,y:0,z:0},{x:0,y:0,z:1},
    ]);
    for(const edge of contact.edges){
      const path=edge.loadPath;
      const loadVector={x:path.end.x-path.start.x,y:path.end.y-path.start.y,z:path.end.z-path.start.z};
      expect(loadVector.x*edge.boundaryNormal.x+loadVector.z*edge.boundaryNormal.z).toBeCloseTo(edge.lever,8);
      expect(Math.hypot(edge.supportPath.end.x-edge.supportPath.start.x,
        edge.supportPath.end.z-edge.supportPath.start.z)).toBeCloseTo(edge.width,8);
      expect([path.start,path.end,edge.supportPath.start,edge.supportPath.end]
        .every(point=>Object.values(point).every(Number.isFinite))).toBe(true);
    }
    const next=applyForgeOperation(s,{kind:"surface-hammer",pose:corner,target:{x:105,z:58},energy:0.8});
    expect(Math.abs(volume(next)/volume(s)-1)).toBeLessThan(0.00002);
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
    expect(edgeDepth(next,pose,"x",108,128)).toBeLessThan(edgeDepth(applyForgeOperation(s,operation()),pose,"x",108,128));
    expect(Math.abs(volume(next)/volume(s)-1)).toBeLessThan(0.0001);
    expect(Math.min(...surface(next,HAMMER_HOME).flatMap(t=>t.points.map(p=>p.y)))).toBeGreaterThanOrEqual(-1e-8);
    const saved=serializeForgeState(next);
    expect(serializeForgeState(deserializeForgeState(saved))).toBe(saved);
    expect(serializeForgeState(replayForgeState(initial(),next.operations))).toBe(saved);
  });
});

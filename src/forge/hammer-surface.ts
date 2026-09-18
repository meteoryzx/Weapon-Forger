import { FORGE_RULES } from "./forge-rules.ts";
import { solidPoint, solidSurface, solidVolumesByBlock, type SolidPoint } from "./solid-geometry.ts";
import { yieldStrengthMPa } from "./forge-physics.ts";
import { bendingIntegral, bendingProfile, torsionalCapacity, torsionProfile, torsionRotation } from "./hammer-bending.ts";
import type { BladeBlock, HammerPose, SurfaceHammerOperation, WorkpieceGeometry, WorkpieceNode, WorkpieceState } from "./forge-types.ts";

export const HAMMER_RULES = {
  // One source of truth for the tool face. This used to be a separate 32 while
  // FORGE_RULES declared a 48 mm face, so the flow kernel worked a narrower
  // patch than the tool the player sees and the billet's outer strips were
  // never reached.
  face: FORGE_RULES.hammerFaceLength, defaultEnergy: 0.55, minimumEnergy: 0.1, energyStep: 0.05,
  // Calibrated with `npm run bench:hammer`: at 0.17 a hot high-carbon billet was
  // limited to ~11% contact compression by its 90 MPa hot yield, so 40 blows
  // barely moved the work. The element guard (absolute cell floor plus automatic
  // softening) now absorbs an over-hard blow, so the cap can sit where a hot
  // forging pass really sits.
  maximumCompression: 0.26, supportTolerance: 2, minimumHeight: 0.4,
  volumeTolerance: 0.00001, integrationSteps: 24,
  // A relative before/after check still lets a cell ratchet down over many blows
  // until it is degenerate, and at that point every later blow fails forever.
  // Keep each cell above a floor of its own undeformed volume too.
  minimumCellVolumeFraction: 0.02,
  // How far one lateral direction may outweigh another. The free-surface rule is
  // only a bias, so a corner blow cannot fling metal out sideways.
  maximumFlowBias: 4,
  // Reduced impact calibration: 1.6 kg at 5 m/s, 20 J at full input.
  impactEnergyJ: 20,
  contactSamples: 5,
  maximumBendRadians: 0.04,
} as const;
export const HAMMER_HOME: HammerPose = { x: 0, z: 0, yaw: 0, roll: 0 };
export interface HammerTriangle { readonly blockId: string; readonly points: readonly [SolidPoint, SolidPoint, SolidPoint] }
export interface HammerFrame {
  readonly center: SolidPoint;
  readonly lift: number;
  readonly pose: HammerPose;
}
export interface HammerContact {
  readonly point: SolidPoint;
  readonly blockId: string;
  /** Direction of the tool impulse in anvil coordinates. */
  readonly impactNormal: SolidPoint;
  readonly supported: boolean;
  readonly supportRatio: number;
  readonly thickness: number;
  readonly edges: readonly HammerEdgeLoad[];
}
// Estimated load on a held strip crossing a planar anvil edge, not a general
// contact manifold. Fractions use occupied footprint samples, not solved pressure.
export interface HammerEdgeLoad {
  readonly axis: "x" | "z";
  readonly sign: -1 | 1;
  readonly boundary: number;
  readonly loadFraction: number;
  readonly lever: number;
  readonly width: number;
  readonly thickness: number;
  readonly neutralY: number;
  /** Furthest occupied hammer sample beyond the support edge. */
  readonly normalReach: number;
  readonly loadedDistances: readonly number[];
  readonly loadedPoints: readonly SolidPoint[];
  /** Full support section and geometry-based beam/plate transition, independent of aim. */
  readonly coherentSection: {
    readonly width:number; readonly thickness:number; readonly center:number;
    readonly neutralY:number; readonly beamWeight:number;
  };
  /** Center and half-span of the loaded footprint along the edge. */
  readonly tangentCenter: number;
  readonly tangentHalfWidth: number;
  /** Outward support-boundary normal and tangent in anvil coordinates. */
  readonly boundaryNormal: SolidPoint;
  readonly boundaryTangent: SolidPoint;
  /** Resultant path from the support boundary toward the loaded footprint. */
  readonly loadPath: HammerContactPath;
  /** Actual material cross-section carried along the support boundary. */
  readonly supportPath: HammerContactPath;
}
export interface HammerContactPath { readonly start: SolidPoint; readonly end: SolidPoint }

function clipSurface(points: readonly SolidPoint[], axis:"x"|"z", boundary:number, sign:number): SolidPoint[] {
  const result:SolidPoint[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i]!,b=points[(i+1)%points.length]!,da=sign*(a[axis]-boundary),db=sign*(b[axis]-boundary);
    if(da<=0)result.push(a);
    if((da<0&&db>0)||(da>0&&db<0)){
      const t=da/(da-db);result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
    }
  }
  return result;
}
const surfaces = new WeakMap<WorkpieceGeometry, readonly HammerTriangle[]>();
const tetrahedra = [[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]] as const;
export function nodePoint(n: WorkpieceNode): SolidPoint { return {x:n.axialPosition,y:n.verticalOffset,z:n.lateralOffset}; }
export function cellCorners(a: number, b: Pick<BladeBlock,"widthIndex"|"heightIndex">, g: WorkpieceGeometry): number[] {
  const stride=g.grid.widthBlocks+1, ring=stride*(g.grid.heightBlocks+1);
  const i=a*ring+b.heightIndex*stride+b.widthIndex;
  return [i,i+ring,i+1,i+ring+1,i+stride,i+ring+stride,i+stride+1,i+ring+stride+1];
}
export function hammerSurface(g: WorkpieceGeometry): readonly HammerTriangle[] {
  const cached=surfaces.get(g); if(cached)return cached;
  const triangles: HammerTriangle[]=[];
  if(g.solids) {
    for(const face of solidSurface(g)) for(let i=1;i+1<face.points.length;i++)
      triangles.push({blockId:face.blockId,points:[face.points[0]!,face.points[i]!,face.points[i+1]!]});
  } else {
    const {widthBlocks:w,heightBlocks:h}=g.grid, count=g.nodes.length/((w+1)*(h+1))-1;
    const idPrefix=g.nodes[0]!.id.split(":node:")[0]!;
    for(let a=0;a<count;a++)for(let z=0;z<w;z++)for(let y=0;y<h;y++) {
      const corners=cellCorners(a,{widthIndex:z,heightIndex:y},g);
      const faces:number[][]=[];
      if(y===0)faces.push([0,2,3,1]); if(y===h-1)faces.push([4,5,7,6]);
      if(z===0)faces.push([0,1,5,4]); if(z===w-1)faces.push([2,6,7,3]);
      if(a===0)faces.push([0,4,6,2]); if(a===count-1)faces.push([1,3,7,5]);
      for(const f of faces)for(let i=1;i<3;i++)triangles.push({blockId:`${idPrefix}:cell:${a}:${z}:${y}`,
        points:[nodePoint(g.nodes[corners[f[0]!]!]!),nodePoint(g.nodes[corners[f[i]!]!]!),nodePoint(g.nodes[corners[f[i+1]!]!]!)]});
    }
  }
  surfaces.set(g,triangles);return triangles;
}
export function assertHammerPose(p: HammerPose): void {
  if(!p || ![p.x,p.z,p.yaw,p.roll].every(Number.isFinite) || Math.abs(p.x)>10000 || Math.abs(p.z)>10000)
    throw new Error("Invalid hammer placement.");
}
export function rotateHammerPoint(p: SolidPoint, pose: HammerPose): SolidPoint {
  const cr=Math.cos(pose.roll),sr=Math.sin(pose.roll),cy=Math.cos(pose.yaw),sy=Math.sin(pose.yaw);
  const y=cr*p.y-sr*p.z,z=sr*p.y+cr*p.z;
  return {x:cy*p.x+sy*z,y,z:-sy*p.x+cy*z};
}
export function hammerFrame(g: WorkpieceGeometry,pose: HammerPose): HammerFrame {
  assertHammerPose(pose);
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,minY=Infinity;
  const points=g.solids?g.solids.flatMap(s=>s.vertices.map(v=>solidPoint(v,g))):g.nodes.map(nodePoint);
  for(const p of points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
  const center={x:(minX+maxX)/2,y:0,z:(minZ+maxZ)/2};
  const ungrounded={center,lift:0,pose};
  // Only material above the finite face can establish the resting plane. A
  // bent overhang is allowed below that plane instead of lifting the support.
  for(const t of placedHammerSurface(g,ungrounded)){
    let polygon:readonly SolidPoint[]=t.points;
    for(const [axis,half] of [["x",FORGE_RULES.anvilFaceLength/2],["z",FORGE_RULES.anvilFaceWidth/2]] as const){
      polygon=clipSurface(polygon,axis,half,1);polygon=clipSurface(polygon,axis,-half,-1);
    }
    for(const p of polygon)minY=Math.min(minY,p.y);
  }
  if(!Number.isFinite(minY))for(const p of points)minY=Math.min(minY,toAnvil(p,ungrounded).y);
  return {center,lift:-minY,pose};
}
export function toAnvil(p: SolidPoint,f: HammerFrame): SolidPoint {
  const q=rotateHammerPoint({x:p.x-f.center.x,y:p.y,z:p.z-f.center.z},f.pose);
  return {x:q.x+f.pose.x,y:q.y+f.lift,z:q.z+f.pose.z};
}
export function fromAnvil(p: SolidPoint,f: HammerFrame): SolidPoint {
  const x=p.x-f.pose.x,z=p.z-f.pose.z,y=p.y-f.lift;
  const cy=Math.cos(f.pose.yaw),sy=Math.sin(f.pose.yaw),cr=Math.cos(f.pose.roll),sr=Math.sin(f.pose.roll);
  const lx=cy*x-sy*z,lz=sy*x+cy*z;
  return {x:lx+f.center.x,y:cr*y+sr*lz,z:-sr*y+cr*lz+f.center.z};
}
export function placedHammerSurface(g: WorkpieceGeometry,f: HammerFrame): readonly HammerTriangle[] {
  return hammerSurface(g).map(t=>({...t,points:t.points.map(p=>toAnvil(p,f)) as unknown as HammerTriangle["points"]}));
}
function triangleHeight(t: HammerTriangle,x: number,z: number): number|null {
  const [a,b,c]=t.points,det=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
  if(Math.abs(det)<1e-10)return null;
  const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/det;
  const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/det;
  if(u < -1e-7 || v < -1e-7 || u+v>1+1e-7)return null;
  return u*a.y+v*b.y+(1-u-v)*c.y;
}
export function hammerContact(surface: readonly HammerTriangle[],x: number,z: number): HammerContact|null {
  let top=-Infinity,bottom=Infinity,blockId="";
  for(const t of surface){const y=triangleHeight(t,x,z);if(y===null)continue;if(y>top){top=y;blockId=t.blockId;}bottom=Math.min(bottom,y);}
  if(!Number.isFinite(top) || top-bottom<1e-5)return null;
  // At an oblique roll the support is an edge, not the full lower face. Measure
  // distance to actual resting material within the finite anvil footprint.
  let distance=Infinity;
  for(const t of surface)for(const p of t.points)if(p.y<=HAMMER_RULES.supportTolerance &&
    Math.abs(p.x)<=FORGE_RULES.anvilFaceLength/2 && Math.abs(p.z)<=FORGE_RULES.anvilFaceWidth/2)
    distance=Math.min(distance,Math.hypot(p.x-x,p.z-z));
  const radius=HAMMER_RULES.face/2;
  const nearEdge=Math.abs(x)+radius>FORGE_RULES.anvilFaceLength/2 || Math.abs(z)+radius>FORGE_RULES.anvilFaceWidth/2;
  const reach=Math.max(0,1-distance/(HAMMER_RULES.face*1.5));
  const edges:HammerEdgeLoad[]=[];
  let supportedFraction=1;
  if(nearEdge){
    const samples:SolidPoint[]=[];
    let supported=0;
    for(let i=0;i<HAMMER_RULES.contactSamples;i++)for(let j=0;j<HAMMER_RULES.contactSamples;j++){
      const sx=x-radius+(i+0.5)*HAMMER_RULES.face/HAMMER_RULES.contactSamples;
      const sz=z-radius+(j+0.5)*HAMMER_RULES.face/HAMMER_RULES.contactSamples;
      let upper=-Infinity,lower=Infinity;
      for(const t of surface){const y=triangleHeight(t,sx,sz);if(y!==null){upper=Math.max(upper,y);lower=Math.min(lower,y);}}
      if(!Number.isFinite(upper)||upper-lower<1e-5)continue;
      samples.push({x:sx,y:upper,z:sz});
      if(Math.abs(sx)<=FORGE_RULES.anvilFaceLength/2&&Math.abs(sz)<=FORGE_RULES.anvilFaceWidth/2)supported++;
    }
    supportedFraction=samples.length?supported/samples.length:0;
    for(const [axis,half] of [["x",FORGE_RULES.anvilFaceLength/2],["z",FORGE_RULES.anvilFaceWidth/2]] as const)for(const sign of [-1,1] as const){
      const boundary=sign*half,loaded=samples.filter(p=>sign*(p[axis]-boundary)>0);
      if(!loaded.length)continue;
      const transverse=axis==="x"?"z":"x";
      // Read the material cross-section at the edge, not the billet envelope.
      // No bridge across the edge means this cantilever approximation cannot apply.
      const section:SolidPoint[]=[],fullSection:SolidPoint[]=[];
      for(const triangle of surface){
        const intersections:SolidPoint[]=[];
        for(let i=0;i<3;i++){
          const a=triangle.points[i]!,b=triangle.points[(i+1)%3]!,da=a[axis]-boundary,db=b[axis]-boundary;
          if(da*db>0||Math.abs(da-db)<1e-9)continue;
          const t=da/(da-db);
          intersections.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
        }
        fullSection.push(...intersections);
        // Clip intersection segments, not just their endpoints: moving the face
        // across a lattice vertex must not jump the effective section width.
        const center=transverse==="x"?x:z;
        section.push(...clipSurface(clipSurface(intersections,transverse,center+radius,1),transverse,center-radius,-1));
      }
      if(section.length<2)continue;
      const lo=Math.min(...section.map(p=>p.y)),hi=Math.max(...section.map(p=>p.y));
      const width=Math.max(...section.map(p=>p[transverse]))-Math.min(...section.map(p=>p[transverse]));
      if(hi-lo<1e-5||width<1e-5||lo>HAMMER_RULES.supportTolerance)continue;
      const tangentValues=loaded.map(p=>p[transverse]);
      const tangentMin=Math.min(...tangentValues),tangentMax=Math.max(...tangentValues);
      const sectionMin=Math.min(...section.map(p=>p[transverse])),sectionMax=Math.max(...section.map(p=>p[transverse]));
      const fullMin=Math.min(...fullSection.map(p=>p[transverse])),fullMax=Math.max(...fullSection.map(p=>p[transverse]));
      const fullLo=Math.min(...fullSection.map(p=>p.y)),fullHi=Math.max(...fullSection.map(p=>p.y));
      const overhang=surface.reduce((extent,triangle)=>Math.max(extent,...triangle.points.map(p=>sign*(p[axis]-boundary))),0);
      // A long narrow overhang carries load through a coherent beam section.
      // Broad, short plate overhangs retain the local-strip approximation, with
      // a smooth geometry-only transition for aspect ratios between 0.5 and 1.
      const slenderness=Math.max(0,Math.min(1,2*overhang/(fullMax-fullMin)-1));
      const coherentSection={width:fullMax-fullMin,thickness:fullHi-fullLo,center:(fullMin+fullMax)/2,
        neutralY:(fullLo+fullHi)/2,beamWeight:slenderness*slenderness*(3-2*slenderness)};
      const lever=loaded.reduce((s,p)=>s+sign*(p[axis]-boundary),0)/loaded.length;
      const tangentCenter=(tangentMin+tangentMax)/2;
      const boundaryNormal:SolidPoint=axis==="x"?{x:sign,y:0,z:0}:{x:0,y:0,z:sign};
      const boundaryTangent:SolidPoint=axis==="x"?{x:0,y:0,z:1}:{x:1,y:0,z:0};
      const pathPoint=(normalDistance:number,tangent:number,y:number):SolidPoint=>axis==="x"
        ? {x:boundary+sign*normalDistance,y,z:tangent}
        : {x:tangent,y,z:boundary+sign*normalDistance};
      edges.push({axis,sign,boundary,loadFraction:loaded.length/samples.length,
        lever,
        width,thickness:hi-lo,neutralY:(hi+lo)/2,
        normalReach:Math.max(...loaded.map(p=>sign*(p[axis]-boundary))),
        loadedDistances:loaded.map(p=>sign*(p[axis]-boundary)),loadedPoints:loaded,coherentSection,
        tangentCenter,tangentHalfWidth:(tangentMax-tangentMin)/2+HAMMER_RULES.face/HAMMER_RULES.contactSamples/2,
        boundaryNormal,boundaryTangent,
        loadPath:{start:pathPoint(0,tangentCenter,(hi+lo)/2),end:pathPoint(lever,tangentCenter,loaded.reduce((sum,p)=>sum+p.y,0)/loaded.length)},
        supportPath:{start:pathPoint(0,sectionMin,(hi+lo)/2),end:pathPoint(0,sectionMax,(hi+lo)/2)}});
    }
  }
  const supportRatio=supportedFraction*reach;
  return {point:{x,y:top,z},blockId,impactNormal:{x:0,y:-1,z:0},supported:supportRatio>0,supportRatio,thickness:top-bottom,edges};
}
// Metal leaves the hammer face towards whatever free surface is closest. A blow
// mid-bar finds the width edges far nearer than the ends, so it spreads; a blow
// next to an end finds that end nearer than the sides, so it draws out. These
// distances are read from the placed surface, so the choice belongs to the
// player's placement rather than to a hard-coded product shape.
export interface LateralFlowWeights { readonly plusX:number; readonly minusX:number; readonly plusZ:number; readonly minusZ:number }
export function freeSurfaceReach(surface: readonly HammerTriangle[],x: number,z: number,band: number) {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const t of surface)for(const p of t.points){
    if(Math.abs(p.z-z)<=band){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);}
    if(Math.abs(p.x-x)<=band){minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
  }
  return {
    plusX:Number.isFinite(maxX)?maxX-x:HAMMER_RULES.face,
    minusX:Number.isFinite(minX)?x-minX:HAMMER_RULES.face,
    plusZ:Number.isFinite(maxZ)?maxZ-z:HAMMER_RULES.face,
    minusZ:Number.isFinite(minZ)?z-minZ:HAMMER_RULES.face,
  };
}
export function lateralFlowWeights(reach: ReturnType<typeof freeSurfaceReach>): LateralFlowWeights {
  const floor=HAMMER_RULES.face/4;
  const raw=[reach.plusX,reach.minusX,reach.plusZ,reach.minusZ].map(distance=>1/Math.max(distance,floor));
  const mean=raw.reduce((sum,value)=>sum+value,0)/raw.length;
  const bounded=raw.map(value=>Math.min(HAMMER_RULES.maximumFlowBias,Math.max(1/HAMMER_RULES.maximumFlowBias,value/mean)));
  return {plusX:bounded[0]!,minusX:bounded[1]!,plusZ:bounded[2]!,minusZ:bounded[3]!};
}
export function geometryVolumes(piece: WorkpieceState,g=piece.geometry): Map<string,number> {
  if(g.solids)return solidVolumesByBlock(g.solids,g);
  const result=new Map<string,number>();
  piece.sections.forEach((s,a)=>s.blocks.forEach(b=>{
    const p=cellCorners(a,b,g).map(i=>nodePoint(g.nodes[i]!));
    let volume=0;
    for(const t of tetrahedra){const o=p[t[0]]!,u=sub(p[t[1]]!,o),v=sub(p[t[2]]!,o),w=sub(p[t[3]]!,o);volume+=Math.abs(dot(u,cross(v,w)))/6;}
    result.set(b.id,volume);
  }));return result;
}
function sub(a:SolidPoint,b:SolidPoint):SolidPoint{return{x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};}
function cross(a:SolidPoint,b:SolidPoint):SolidPoint{return{x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
function dot(a:SolidPoint,b:SolidPoint):number{return a.x*b.x+a.y*b.y+a.z*b.z;}
function bump(t:number):number {return Math.abs(t)>=1?0:(1-t*t)**2;}
// Cell-corner helper used by the deformation guard. Kept allocation-free because
// it runs over every affected cell of a 16k-cell lattice, several times per blow.
function sameEdge(ap:WorkpieceNode,aq:WorkpieceNode,bp:WorkpieceNode,bq:WorkpieceNode):boolean {
  return Math.abs((aq.axialPosition-ap.axialPosition)-(bq.axialPosition-bp.axialPosition))<1e-9
    &&Math.abs((aq.verticalOffset-ap.verticalOffset)-(bq.verticalOffset-bp.verticalOffset))<1e-9
    &&Math.abs((aq.lateralOffset-ap.lateralOffset)-(bq.lateralOffset-bp.lateralOffset))<1e-9;
}
function det4(nodes:readonly WorkpieceNode[],cell:readonly number[],tetrahedron:readonly number[]):number {
  const at=(k:number)=>nodes[cell[tetrahedron[k]!]!]!;
  const o=at(0),a=at(1),b=at(2),c=at(3);
  const ux=a.axialPosition-o.axialPosition,uy=a.verticalOffset-o.verticalOffset,uz=a.lateralOffset-o.lateralOffset;
  const vx=b.axialPosition-o.axialPosition,vy=b.verticalOffset-o.verticalOffset,vz=b.lateralOffset-o.lateralOffset;
  const wx=c.axialPosition-o.axialPosition,wy=c.verticalOffset-o.verticalOffset,wz=c.lateralOffset-o.lateralOffset;
  return ux*(vy*wz-vz*wy)+uy*(vz*wx-vx*wz)+uz*(vx*wy-vy*wx);
}
function cellVolume(nodes:readonly WorkpieceNode[],cell:readonly number[]):number {
  let volume=0;
  for(const t of tetrahedra)volume+=Math.abs(det4(nodes,cell,t))/6;
  return volume;
}
// A smooth compression and its reciprocal radial flow form an isochoric map.
// Working in radius rather than as two separable one-dimensional profiles is
// what keeps a blow local: a separable kernel translates everything in its
// axial band outwards forever, so hammering one spot widened the bar without
// limit while its thickness never changed.
function radialFlow(distance:number,k:number,radius:number,steps:number):number {
  if(distance<=0||k<=0)return 0;
  const step=distance/steps;
  let integral=0;
  for(let i=0;i<=steps;i++){
    const r=i*step;
    const s=1-k*bump(r/radius);
    const weight=(i===0||i===steps)?1:(i%2===0?2:4);
    integral+=weight*(1/s-1)*r;
  }
  integral*=step/3;
  // Cylindrical volume of a ring is preserved when (r+u)^2 = r^2 + 2*integral.
  return Math.sqrt(distance*distance+2*integral)-distance;
}
export function deformSurfaceHammer(piece:WorkpieceState,operation:SurfaceHammerOperation) {
  assertHammerPose(operation.pose);
  if(!Number.isFinite(operation.energy)||operation.energy<0.1||operation.energy>1 ||
    ![operation.target.x,operation.target.z].every(Number.isFinite))throw new Error("Invalid surface hammer load.");
  const frame=hammerFrame(piece.geometry,operation.pose), surface=placedHammerSurface(piece.geometry,frame);
  const contact=hammerContact(surface,operation.target.x,operation.target.z);
  if(!contact)throw new Error("落点没有金属，请瞄准材料表面。");
  if(!contact.supported)throw new Error("落点缺少砧面支撑，请把受敲部位移到砧面上。");
  if(contact.thickness<HAMMER_RULES.minimumHeight)throw new Error("此处已经很薄，请降低力度或换一个位置。");
  const blocks=piece.sections.flatMap(s=>s.blocks), block=blocks.find(b=>b.id===contact.blockId) ?? blocks[0]!;
  const resistance=yieldStrengthMPa(block,piece.material);
  const requested=Math.min(HAMMER_RULES.maximumCompression,
    HAMMER_RULES.maximumCompression*operation.energy*105/Math.max(resistance,30))*contact.supportRatio;
  const radius=HAMMER_RULES.face/2;
  const world=piece.geometry.nodes.map(n=>toAnvil(nodePoint(n),frame));
  // Read the free surfaces once: they do not depend on how hard this blow lands.
  const flow=lateralFlowWeights(freeSurfaceReach(surface,contact.point.x,contact.point.z,radius));
  const beforeVolumes=geometryVolumes(piece),beforeTotal=[...beforeVolumes.values()].reduce((a,b)=>a+b,0);
  // A held, supported strip acts as a short elastoplastic cantilever. Residual
  // deflection requires moment above its plastic section capacity (sigma*b*h^2/4).
  // Work is allocated once across edges; temperature enters through flow stress.
  const impactWork=operation.energy*HAMMER_RULES.impactEnergyJ*1000;
  const force=impactWork/FORGE_RULES.hammerMaximumTravel;
  const edgeWeight=contact.edges.reduce((sum,e)=>sum+e.loadFraction*e.lever/radius,0);
  const bends=contact.edges.map(edge=>{
    const capacity=resistance*edge.width*edge.thickness**2/4;
    const available=impactWork*(edge.loadFraction*edge.lever/radius)/Math.max(1,edgeWeight);
    const profile=bendingProfile(edge.loadedDistances.map(distance=>({distance,
      force:force*edge.loadFraction/edge.loadedDistances.length})),capacity,available,
      FORGE_RULES.hammerMaximumTravel*operation.energy,HAMMER_RULES.maximumBendRadians,FORGE_RULES.simulationCellSize);
    const section=edge.coherentSection;
    const samples=edge.loadedPoints.map(point=>({distance:dot(sub(point,edge.loadPath.start),edge.boundaryNormal),
      force:force*edge.loadFraction/edge.loadedPoints.length,
      eccentricity:dot(point,edge.boundaryTangent)-section.center}));
    const beamCapacity=resistance*section.width*section.thickness**2/4;
    const twistCapacity=torsionalCapacity(section.width,section.thickness,resistance);
    const moment=samples.reduce((sum,sample)=>sum+sample.force*sample.distance,0);
    const torque=samples.reduce((sum,sample)=>sum+sample.force*sample.eccentricity,0);
    const bendDemand=Math.max(0,moment/beamCapacity-1),twistDemand=Math.max(0,Math.abs(torque)/twistCapacity-1);
    // Share the existing work/travel allowance; adding torsion does not give
    // eccentric strikes a second full impact budget.
    const bendShare=bendDemand+twistDemand>0?bendDemand/(bendDemand+twistDemand):1;
    const travel=FORGE_RULES.hammerMaximumTravel*operation.energy;
    const beamProfile=bendingProfile(samples,beamCapacity,available*bendShare,travel*bendShare,
      HAMMER_RULES.maximumBendRadians,FORGE_RULES.simulationCellSize);
    const twistProfile=torsionProfile(samples,twistCapacity,available*(1-bendShare),travel*(1-bendShare),
      HAMMER_RULES.maximumBendRadians,Math.hypot(section.width,section.thickness)/2,FORGE_RULES.simulationCellSize);
    return {...edge,profile,beamProfile,twistProfile};
  });
  // A full-strength blow can push a worked column past the orientation guard. The
  // old code threw for that blow and then rejected *every* later blow at *every*
  // position, so a long shaping session bricked the workpiece permanently. Soften
  // this blow instead; only give up when even a minimal deformation would invert.
  const attempt=(scale:number)=>{
    const compression=requested*scale;
    const k=1-Math.sqrt(1-compression);
    const base=world.map(p=>{
      const dx=p.x-contact.point.x,dz=p.z-contact.point.z;
      const distance=Math.hypot(dx,dz);
      const compression=1-k*bump(distance/radius);
      if(distance<=0)return {x:p.x,y:p.y*compression,z:p.z};
      const outward=radialFlow(distance,k,radius,HAMMER_RULES.integrationSteps)/distance;
      return {
        x:p.x+dx*outward*(dx>0?flow.plusX:flow.minusX),
        y:p.y*compression,
        z:p.z+dz*outward*(dz>0?flow.plusZ:flow.minusZ),
      };
    });
    const makeNodes=(spread:number)=>base.map((p,i)=>{
      const start=world[i]!;
      let bent={x:start.x+(p.x-start.x)*spread,y:p.y,z:start.z+(p.z-start.z)*spread};
      for(const bend of bends){
        const relative=sub(bent,bend.loadPath.start);
        const distance=dot(relative,bend.boundaryNormal);
        if(distance<=0)continue;
        const tangentDistance=Math.abs(dot(relative,bend.boundaryTangent));
        const transition=Math.max(2*bend.thickness,FORGE_RULES.simulationCellSize);
        const tangentOutside=Math.max(0,tangentDistance-bend.tangentHalfWidth);
        const tangentWeight=tangentOutside>=transition?0:bump(tangentOutside/transition);
        // Integrate only yielded curvature. The unloaded tail inherits position
        // and tangent, not further curvature or a forced return to its old height.
        const section=bend.coherentSection,beamWeight=section.beamWeight;
        const amplitude=bend.profile.angle*scale*tangentWeight,integral=bendingIntegral(bend.profile,distance);
        const beamAmplitude=bend.beamProfile.angle*scale,beamIntegral=bendingIntegral(bend.beamProfile,distance);
        const localAngle=(1-beamWeight)*amplitude*integral.rotation+beamWeight*beamAmplitude*beamIntegral.rotation;
        const neutralY=(1-beamWeight)*bend.neutralY+beamWeight*section.neutralY;
        const twist=beamWeight*scale*torsionRotation(bend.twistProfile,distance);
        const u=dot(bent,bend.boundaryTangent)-section.center,v=bent.y-neutralY;
        // A section rotates as a connected cross-section. Both transverse and
        // vertical coordinates move; a scalar height mask would shear it apart.
        const vertical=v*Math.cos(twist)-u*Math.sin(twist);
        const tangentShift=u*(Math.cos(twist)-1)+v*Math.sin(twist);
        const centerY=-(1-beamWeight)*amplitude*integral.deflection-beamWeight*beamAmplitude*beamIntegral.deflection;
        const normalShift=-((1-beamWeight)*amplitude**2*integral.shortening+beamWeight*beamAmplitude**2*beamIntegral.shortening)/2
          +vertical*Math.sin(localAngle);
        bent={x:bent.x+bend.boundaryNormal.x*normalShift,
          y:neutralY+centerY+vertical*Math.cos(localAngle),z:bent.z+bend.boundaryNormal.z*normalShift};
        bent={x:bent.x+bend.boundaryTangent.x*tangentShift,y:bent.y,z:bent.z+bend.boundaryTangent.z*tangentShift};
      }
      const local=fromAnvil(bent,frame);
      return {...piece.geometry.nodes[i]!,axialPosition:local.x,verticalOffset:local.y,lateralOffset:local.z};
    });
    // Only cells whose shape changes can be collapsed by this blow: rigid
    // translation leaves every determinant untouched, and outside the kernel the
    // flow is a constant translation. Collecting them once lets the volume
    // correction and the guard touch a fraction of the 16k-cell lattice instead
    // of walking all of it up to 22 times per attempt.
    const source=piece.geometry.nodes, probe=makeNodes(1);
    const affected:{cell:number[];volume:number;reference:number}[]=[];
    let collapsed=false;
    piece.sections.forEach((section,index)=>{
      if(collapsed)return;
      for(const block of section.blocks){
        if(collapsed)return;
        const cell=cellCorners(index,block,piece.geometry);
        // Two opposite corners pin all eight: if both sets of edges are unchanged
        // the whole cell is rigidly translated and its determinant cannot flip.
        const rigid=[[0,1],[0,2],[0,4],[7,6],[7,5],[7,3]].every(pair=>sameEdge(
          source[cell[pair[0]!]!]!,source[cell[pair[1]!]!]!,
          probe[cell[pair[0]!]!]!,probe[cell[pair[1]!]!]!));
        if(rigid)continue;
        for(const t of tetrahedra){
          const start=det4(source,cell,t),end=det4(probe,cell,t);
          if(!Number.isFinite(end)||Math.abs(start)<1e-12||end/start<1e-6
            ||Math.abs(end)<block.volume*HAMMER_RULES.minimumCellVolumeFraction){collapsed=true;return;}
        }
        affected.push({cell,volume:cellVolume(source,cell),reference:block.volume});
      }
    });
    if(collapsed)return null;
    const beforeAffected=affected.reduce((sum,entry)=>sum+entry.volume,0);
    // A cut or ground piece reports volume per clipped solid, so the lattice sum
    // above would not match its total; those pieces keep the full recomputation.
    const targeted=!piece.geometry.solids;
    const totalOf=(nodes:readonly WorkpieceNode[])=>targeted
      ? beforeTotal-beforeAffected+affected.reduce((sum,entry)=>sum+cellVolume(nodes,entry.cell),0)
      : [...geometryVolumes(piece,{...piece.geometry,nodes}).values()].reduce((a,b)=>a+b,0);
    // The analytic flow is incompressible; finite lattice interpolation introduces
    // quadrature error. Correct only the flow's lateral displacement, never mass.
    let low=0,high=3,nodes=probe,total=totalOf(probe);
    for(let iteration=0;iteration<22;iteration++) {
      if(Math.abs(total/beforeTotal-1)<HAMMER_RULES.volumeTolerance)break;
      const factor=iteration===0?1:(low+high)/2;
      if(total<beforeTotal)low=factor;else high=factor;
      nodes=makeNodes((low+high)/2);total=totalOf(nodes);
    }
    if(Math.abs(total/beforeTotal-1)>HAMMER_RULES.volumeTolerance*2)return null;
    for(const entry of affected)for(const t of tetrahedra){
      const start=det4(source,entry.cell,t),end=det4(nodes,entry.cell,t);
      if(!Number.isFinite(end)||Math.abs(start)<1e-12||end/start<1e-6
        ||Math.abs(end)<entry.reference*HAMMER_RULES.minimumCellVolumeFraction){return null;}
    }
    return {nodes,compression};
  };
  for(const scale of [1,0.75,0.5,0.35,0.25,0.15,0.1]){
    const softened=attempt(scale);
    if(softened)return {nodes:softened.nodes,contact,compression:softened.compression,frame};
  }
  throw new Error("此处形变过度，请降低力度或调整落点。");
}

/** Principal stretches of a material cell; rigid rotations create no strain. */
export function cellStretches(indices:readonly number[],before:readonly WorkpieceNode[],after:readonly WorkpieceNode[]):number[] {
  const basis=(nodes:readonly WorkpieceNode[])=>{
    const p=indices.map(i=>nodePoint(nodes[i]!));
    return [[0,2,4,6],[0,1,4,5],[0,1,2,3]].map((starts,axis)=>{
      const step=[1,2,4][axis]!;
      return starts.reduce((v,i)=>{const d=sub(p[i+step]!,p[i]!);return{x:v.x+d.x/4,y:v.y+d.y/4,z:v.z+d.z/4};},{x:0,y:0,z:0});
    });
  };
  const a=basis(before),b=basis(after),det=dot(a[0]!,cross(a[1]!,a[2]!));
  if(Math.abs(det)<1e-10)return [1,1,1];
  const rows=[cross(a[1]!,a[2]!),cross(a[2]!,a[0]!),cross(a[0]!,a[1]!)].map(v=>[v.x/det,v.y/det,v.z/det]);
  const cols=b.map(v=>[v.x,v.y,v.z]);
  const f=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>cols.reduce((s,c,k)=>s+c[i]!*rows[k]![j]!,0)));
  const c=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>f.reduce((s,r)=>s+r[i]!*r[j]!,0)));
  for(let n=0;n<12;n++){
    let p=0,q=1;for(const [i,j] of [[0,2],[1,2]])if(Math.abs(c[i!]![j!]!)>Math.abs(c[p]![q]!)){p=i!;q=j!;}
    if(Math.abs(c[p]![q]!)<1e-12)break;
    const angle=0.5*Math.atan2(2*c[p]![q]!,c[q]![q]!-c[p]![p]!),co=Math.cos(angle),si=Math.sin(angle);
    const pp=c[p]![p]!,qq=c[q]![q]!,pq=c[p]![q]!;
    c[p]![p]=co*co*pp-2*co*si*pq+si*si*qq;c[q]![q]=si*si*pp+2*co*si*pq+co*co*qq;c[p]![q]=c[q]![p]=0;
    for(let k=0;k<3;k++)if(k!==p&&k!==q){const kp=c[k]![p]!,kq=c[k]![q]!;c[k]![p]=c[p]![k]=co*kp-si*kq;c[k]![q]=c[q]![k]=si*kp+co*kq;}
  }
  return [0,1,2].map(i=>Math.sqrt(Math.max(c[i]![i]!,1e-10)));
}

import type { ForgeState, GrindOperation, WorkpieceGeometry, WorkpieceSolid, WorkpieceState } from "./forge-types.ts";
import { clipSolid, solidEnvelope, solidPoint, solidVolume, workpieceGrindingSolids, workpieceSolids, type SolidPoint } from "./solid-geometry.ts";
import { faceNormal } from "./solid-topology.ts";

type Frame = NonNullable<NonNullable<GrindOperation["contact"]>["frame"]>;
const dot = (a: SolidPoint, b: SolidPoint) => a.x*b.x+a.y*b.y+a.z*b.z;
const relative = (p: SolidPoint, o: SolidPoint) => ({x:p.x-o.x,y:p.y-o.y,z:p.z-o.z});
const caches = new WeakMap<WorkpieceGeometry["nodes"], WeakMap<WorkpieceSolid, {points: SolidPoint[]; volume: number}>>();
function measure(s: WorkpieceSolid, g: WorkpieceGeometry) {
  let cache = caches.get(g.nodes);
  if (!cache) { cache = new WeakMap(); caches.set(g.nodes, cache); }
  let m = cache.get(s);
  if (!m) { m = {points:s.vertices.map(v=>solidPoint(v,g)),volume:solidVolume(s,g)}; cache.set(s,m); }
  return m;
}

function validate(f: Frame, depth: number) {
  if (![...Object.values(f.origin), ...Object.values(f.normal), ...Object.values(f.across), ...Object.values(f.down), f.width, f.height, depth].every(Number.isFinite)
    || f.width<=0 || f.height<=0 || depth<=0
    || [f.normal,f.across,f.down].some(v=>Math.abs(dot(v,v)-1)>1e-5)
    || Math.abs(dot(f.normal,f.across))+Math.abs(dot(f.normal,f.down))+Math.abs(dot(f.across,f.down))>1e-5) {
    throw new Error("Abrasive contact must have a finite orthonormal frame and positive dimensions.");
  }
}

/** Subtract a finite abrasive prism; never rebuild material from its enclosing lattice. */
export function applyAbrasiveContact(state: ForgeState, op: GrindOperation): ForgeState {
  const c=op.contact!, f=c.frame!; validate(f,c.depth);
  const piece=state.workpiece;
  const source=piece.geometry.solids ?? (piece.sections.some(s=>s.plasticStrain>0) ? workpieceSolids(piece) : workpieceGrindingSolids(piece));
  const g={...piece.geometry,solids:source};
  const distance=(p:SolidPoint)=>dot(relative(p,f.origin),f.normal);
  const sides=[(p:SolidPoint)=>dot(relative(p,f.origin),f.across)-f.width/2,
    (p:SolidPoint)=>-dot(relative(p,f.origin),f.across)-f.width/2,
    (p:SolidPoint)=>dot(relative(p,f.origin),f.down)-f.height/2,
    (p:SolidPoint)=>-dot(relative(p,f.origin),f.down)-f.height/2];
  const temperature=piece.sections.reduce((sum,s)=>sum+s.temperatureC,0)/piece.sections.length;
  // Reduced-order abrasion: hot/soft metal cuts faster; hardenable quenched steel resists it.
  const resistance=1+(piece.heatTreatments.some(e=>e.kind==="quench")?piece.material.hardenability:0)+piece.material.yieldStrengthAmbientMPa/1000;
  const depth=c.depth*op.amount*Math.min(2,1+Math.max(0,temperature-20)/1000)/resistance;
  const next:WorkpieceSolid[]=[],removed=new Map<string,number>(),original=new Map<string,number>();
  for(const s of source){
    const m=measure(s,g);
    original.set(s.blockId,(original.get(s.blockId)??0)+m.volume);
    if(m.points.every(p=>distance(p)<-depth-1e-8) || sides.some(d=>m.points.every(p=>d(p)>-1e-8))){next.push(s);continue;}
    let inside:WorkpieceSolid|null=s;
    const retained:WorkpieceSolid[]=[];
    for(const [i,d] of sides.entries()){
      if(!inside)break;
      const points=measure(inside,g).points;
      if(points.every(p=>d(p)<=1e-8))continue;
      const outside=clipSolid(inside,g,p=>-d(p),`rim-${i}`);
      if(outside)retained.push(outside);
      inside=clipSolid(inside,g,d,`patch-${i}`);
    }
    if(inside){const keep=clipSolid(inside,g,p=>distance(p)+depth,"abrasive");if(keep)retained.push(keep);}
    const loss=Math.max(0,m.volume-retained.reduce((sum,r)=>sum+measure(r,g).volume,0));
    if(loss<1e-9)next.push(s);
    else {next.push(...retained);removed.set(s.blockId,(removed.get(s.blockId)??0)+loss);}
  }
  if(removed.size===0)return state;
  const affected=new Set<string>();
  for(const section of piece.sections)if(section.blocks.some(b=>removed.has(b.id)))for(const b of section.blocks)affected.add(b.id);
  const bounds=new Map<string,{minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number}>();
  for(const s of next){
    if(!affected.has(s.blockId))continue;
    let b=bounds.get(s.blockId);
    if(!b){b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};bounds.set(s.blockId,b);}
    for(const p of measure(s,g).points){b.minX=Math.min(b.minX,p.x);b.maxX=Math.max(b.maxX,p.x);b.minY=Math.min(b.minY,p.y);b.maxY=Math.max(b.maxY,p.y);b.minZ=Math.min(b.minZ,p.z);b.maxZ=Math.max(b.maxZ,p.z);}
  }
  const sections=piece.sections.map(s=>{
    let loss=0;
    const blocks=s.blocks.flatMap(b=>{
      const fraction=Math.min(1,(removed.get(b.id)??0)/Math.max(original.get(b.id)??0,1e-12));
      if(!fraction)return [b];
      const v=b.volume*fraction;loss+=v;
      const extent=bounds.get(b.id);
      return fraction>=1-1e-10?[]:[{...b,volume:b.volume-v,mechanicalWorkJ:b.mechanicalWorkJ*(1-fraction),
        ...(extent?{length:extent.maxX-extent.minX,width:extent.maxZ-extent.minZ,thickness:extent.maxY-extent.minY,
          verticalOffset:(extent.maxY+extent.minY)/2,lateralOffset:(extent.maxZ+extent.minZ)/2}:{})}];
    });
    const volume=s.blocks.reduce((v,b)=>v+b.volume,0);
    if(!loss)return s;
    const extents=blocks.map(b=>bounds.get(b.id)!).filter(Boolean);
    const lo=(axis:"minX"|"minY"|"minZ")=>Math.min(...extents.map(b=>b[axis]));
    const hi=(axis:"maxX"|"maxY"|"maxZ")=>Math.max(...extents.map(b=>b[axis]));
    return {...s,blocks,removedVolume:s.removedVolume+loss,groundAmount:Math.min(1,s.groundAmount+loss/Math.max(volume,1e-9)),
      mechanicalWorkJ:blocks.reduce((v,b)=>v+b.mechanicalWorkJ,0),
      ...(extents.length?{length:hi("maxX")-lo("minX"),width:hi("maxZ")-lo("minZ"),thickness:hi("maxY")-lo("minY"),
        position:(hi("maxX")+lo("minX"))/2,verticalOffset:(hi("maxY")+lo("minY"))/2,lateralOffset:(hi("maxZ")+lo("minZ"))/2}:{length:0,width:0,thickness:0})};
  });
  // Geometry and state are immutable. Cache keys therefore survive thermal-only updates.
  const geometry={...g,solids:next};
  return {...state,workpiece:{...piece,sections,geometry:{...geometry,outline:solidEnvelope(geometry)}},operations:[...state.operations,structuredClone(op)]};
}

const metricsCache=new WeakMap<WorkpieceGeometry, ReturnType<typeof measureMetrics>>();
export function abrasiveMetrics(piece:WorkpieceState){
  let value=metricsCache.get(piece.geometry);
  if(!value){value=measureMetrics(piece);metricsCache.set(piece.geometry,value);}
  return value;
}
function measureMetrics(piece:WorkpieceState){
  const g=piece.geometry;
  const faces:{angle:number;area:number;side:number}[]=[];
  const edges=new Map<number,{z:number;lo:number;hi:number}>();
  for(const s of g.solids??[]){
    const {points}=measure(s,g);
    for(const i of s.groundFaces??[]){
      const n=faceNormal(s.faces[i]!.map(k=>points[k]!)),length=Math.hypot(n.x,n.y,n.z);
      const center=points.reduce((a,p)=>({x:a.x+p.x/points.length,y:a.y+p.y/points.length,z:a.z+p.z/points.length}),{x:0,y:0,z:0});
      const outward=dot(n,relative(points[s.faces[i]![0]!]!,center))<0?-1:1;
      if(length<1e-9 || n.z*outward<1e-8 || Math.abs(n.x)/length>0.7)continue;
      faces.push({angle:Math.atan2(Math.abs(n.z),Math.abs(n.y))*180/Math.PI,area:length/2,side:Math.sign(n.y*outward)});
    }
    for(const p of points){
      const x=Math.round(p.x*1e6),edge=edges.get(x);
      if(!edge || p.z>edge.z+1e-7)edges.set(x,{z:p.z,lo:p.y,hi:p.y});
      else if(Math.abs(p.z-edge.z)<1e-7){edge.lo=Math.min(edge.lo,p.y);edge.hi=Math.max(edge.hi,p.y);}
    }
  }
  const average=(side:number)=>{const f=faces.filter(f=>f.side===side),area=f.reduce((v,f)=>v+f.area,0);return area?f.reduce((v,f)=>v+f.angle*f.area,0)/area:0;};
  const top=average(1),bottom=average(-1),area=faces.reduce((v,f)=>v+f.area,0);
  const variance=area?faces.reduce((v,f)=>v+f.area*(f.angle-(f.side===1?top:bottom))**2,0)/area:0;
  return {bladeAngleDeg:top+bottom,
    edgeThicknessMm:edges.size?Math.min(...[...edges.values()].map(e=>e.hi-e.lo)):Math.min(...piece.sections.map(s=>s.thickness)),
    roughness:Math.min(1,Math.sqrt(variance)/90),
    symmetry:top+bottom?1-Math.abs(top-bottom)/(top+bottom):1};
}

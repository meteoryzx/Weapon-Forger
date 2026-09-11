import type { SolidVertex, WorkpieceGeometry, WorkpieceSolid, WorkpieceState } from "./forge-types.ts";
import type { FiniteThroughCut } from "./workpiece-geometry.ts";

export interface SolidPoint { readonly x: number; readonly y: number; readonly z: number }
const EPS = 1e-9;
const TETRAHEDRA = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]] as const;

export function solidPoint(vertex: SolidVertex, geometry: WorkpieceGeometry): SolidPoint {
  let x = 0, y = 0, z = 0;
  for (const { nodeIndex, weight } of vertex.weights) {
    const node = geometry.nodes[nodeIndex];
    if (!node) throw new Error("Solid references a missing deformation node.");
    x += node.axialPosition * weight;
    y += node.verticalOffset * weight;
    z += node.lateralOffset * weight;
  }
  return { x, y, z };
}

// Reuse the same six-tetrahedron decomposition as the existing mechanical
// lattice. Clipping changes occupied material, never the lattice dimensions.
export function workpieceSolids(piece: WorkpieceState): readonly WorkpieceSolid[] {
  if (piece.geometry.solids) return piece.geometry.solids;
  const grid = piece.geometry.grid;
  const index = (a: number, w: number, h: number) => a * (grid.widthBlocks + 1) * (grid.heightBlocks + 1)
    + h * (grid.widthBlocks + 1) + w;
  return piece.sections.flatMap((section, a) => section.blocks.flatMap(block => {
    const w = block.widthIndex, h = block.heightIndex;
    const corners = [index(a,w,h), index(a+1,w,h), index(a,w+1,h), index(a+1,w+1,h),
      index(a,w,h+1), index(a+1,w,h+1), index(a,w+1,h+1), index(a+1,w+1,h+1)];
    return TETRAHEDRA.map((tetra, t) => ({
      id: `${block.id}:tetra:${t}`, blockId: block.id,
      vertices: tetra.map(corner => ({ weights: [{ nodeIndex: corners[corner]!, weight: 1 }] })),
      faces: [[0,2,1], [0,1,3], [1,2,3], [2,0,3]],
    }));
  }));
}

export function solidVolume(solid: WorkpieceSolid, geometry: WorkpieceGeometry): number {
  const points = solid.vertices.map(vertex => solidPoint(vertex, geometry));
  const center = mean(points);
  let volume = 0;
  for (const face of solid.faces) for (let i = 1; i + 1 < face.length; i++) {
    volume += Math.abs(dot(sub(points[face[0]!]!, center),
      cross(sub(points[face[i]!]!, center), sub(points[face[i+1]!]!, center)))) / 6;
  }
  return volume;
}

export function solidAxialMoment(solid: WorkpieceSolid, geometry: WorkpieceGeometry): number {
  const points = solid.vertices.map(vertex => solidPoint(vertex, geometry));
  const center = mean(points);
  let moment = 0;
  for (const face of solid.faces) for (let i = 1; i + 1 < face.length; i++) {
    const a = points[face[0]!]!, b = points[face[i]!]!, c = points[face[i + 1]!]!;
    const volume = Math.abs(dot(sub(a, center), cross(sub(b, center), sub(c, center)))) / 6;
    moment += volume * (center.x + a.x + b.x + c.x) / 4;
  }
  return moment;
}

export function occupiedAxialCenter(piece: WorkpieceState): number {
  const solids = piece.geometry.solids!;
  const volumes = solidVolumesByBlock(solids, piece.geometry);
  const material = new Map(piece.sections.flatMap(section => section.blocks.map(block => [block.id, block.volume] as const)));
  const total = [...material.values()].reduce((sum, volume) => sum + volume, 0);
  return solids.reduce((sum, solid) => sum + solidAxialMoment(solid, piece.geometry)
    * material.get(solid.blockId)! / volumes.get(solid.blockId)!, 0) / total;
}

export function solidVolumesByBlock(solids: readonly WorkpieceSolid[], geometry: WorkpieceGeometry): Map<string, number> {
  const result = new Map<string, number>();
  for (const solid of solids) result.set(solid.blockId, (result.get(solid.blockId) ?? 0) + solidVolume(solid, geometry));
  return result;
}

// Remove a prescribed fraction from the positive lateral edge of each block.
// The grinder owns the amount; geometry owns where that material is removed.
export function grindSolids(geometry: WorkpieceGeometry, fractions: ReadonlyMap<string, number>): readonly WorkpieceSolid[] {
  const groups = new Map<string, WorkpieceSolid[]>();
  for (const solid of geometry.solids ?? []) groups.set(solid.blockId, [...(groups.get(solid.blockId) ?? []), solid]);
  return [...groups].flatMap(([id, solids]) => {
    const fraction = fractions.get(id) ?? 1;
    if (fraction >= 1) return solids;
    const bounds = solidBounds(solids, geometry);
    const target = solids.reduce((sum, solid) => sum + solidVolume(solid, geometry), 0) * fraction;
    let lo = bounds.minZ, hi = bounds.maxZ;
    const at = (z: number) => solids.flatMap(solid => {
      const clipped = clipSolid(solid, geometry, point => point.z - z, "grind");
      return clipped ? [clipped] : [];
    });
    for (let iteration = 0; iteration < 40; iteration++) {
      const middle = (lo + hi) / 2;
      const volume = at(middle).reduce((sum, solid) => sum + solidVolume(solid, geometry), 0);
      if (volume < target) lo = middle; else hi = middle;
    }
    return at((lo + hi) / 2);
  });
}

function interpolate(a: SolidVertex, b: SolidVertex, t: number): SolidVertex {
  const weights = new Map<number, number>();
  for (const weight of a.weights) weights.set(weight.nodeIndex, weight.weight * (1 - t));
  for (const weight of b.weights) weights.set(weight.nodeIndex, (weights.get(weight.nodeIndex) ?? 0) + weight.weight * t);
  return { weights: [...weights].filter(([, weight]) => Math.abs(weight) > 1e-14)
    .sort(([a], [b]) => a-b).map(([nodeIndex, weight]) => ({ nodeIndex, weight })) };
}

// Convex half-space clipping. Every generated vertex is a weighted sample of
// its source tetrahedron, so subsequent node deformation preserves the cut.
export function clipSolid(
  solid: WorkpieceSolid, geometry: WorkpieceGeometry,
  distance: (point: SolidPoint) => number, suffix: string,
): WorkpieceSolid | null {
  const points = solid.vertices.map(vertex => solidPoint(vertex, geometry));
  const distances = points.map(distance);
  if (distances.every(d => d <= EPS)) return solid;
  if (distances.every(d => d >= -EPS)) return null;
  const vertices: SolidVertex[] = [];
  const coordinates: SolidPoint[] = [];
  const faces: number[][] = [];
  const cap = new Set<number>();
  const addVertex = (vertex: SolidVertex): number => {
    const point = solidPoint(vertex, geometry);
    let index = coordinates.findIndex(other => length(sub(point, other)) < EPS);
    if (index < 0) { index = vertices.length; vertices.push(vertex); coordinates.push(point); }
    if (Math.abs(distance(point)) <= EPS) cap.add(index);
    return index;
  };
  for (const face of solid.faces) {
    const output: number[] = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!, b = face[(i+1)%face.length]!;
      const da = distances[a]!, db = distances[b]!;
      if (da <= EPS) output.push(addVertex(solid.vertices[a]!));
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        output.push(addVertex(interpolate(solid.vertices[a]!, solid.vertices[b]!, da / (da-db))));
      }
    }
    const unique = [...new Set(output)];
    if (unique.length >= 3) faces.push(unique);
  }
  if (cap.size >= 3) {
    const indices = [...cap];
    const center = mean(indices.map(i => coordinates[i]!));
    const u = unit(sub(coordinates[indices[0]!]!, center));
    let normal: SolidPoint = {x:0,y:0,z:0};
    for (const i of indices.slice(1)) {
      normal = cross(u, sub(coordinates[i]!, center));
      if (length(normal) > EPS) break;
    }
    const v = unit(cross(unit(normal), u));
    indices.sort((a,b) => {
      const pa = sub(coordinates[a]!,center), pb = sub(coordinates[b]!,center);
      return Math.atan2(dot(pa,v),dot(pa,u)) - Math.atan2(dot(pb,v),dot(pb,u));
    });
    faces.push(indices);
  }
  const result = { id: `${solid.id}:${suffix}`, blockId: solid.blockId, vertices, faces };
  return solidVolume(result, geometry) > EPS ? result : null;
}

export function partitionSolids(piece: WorkpieceState, path: FiniteThroughCut) {
  const dx = path.end.axialPosition - path.start.axialPosition;
  const dz = path.end.lateralOffset - path.start.lateralOffset;
  const pathLength = Math.hypot(dx, dz);
  if (!path.id || ![dx,dz,path.start.axialPosition,path.start.lateralOffset,path.kerfWidth].every(Number.isFinite)
    || pathLength <= EPS || path.kerfWidth < 0) throw new Error("Invalid finite cut path.");
  const signed = (p: SolidPoint) => (-dz * (p.x-path.start.axialPosition) + dx * (p.z-path.start.lateralOffset)) / pathLength;
  const along = (p: SolidPoint) => (dx * (p.x-path.start.axialPosition) + dz * (p.z-path.start.lateralOffset)) / pathLength;
  const source = workpieceSolids(piece);
  const negative: WorkpieceSolid[] = [], positive: WorkpieceSolid[] = [], kerf: WorkpieceSolid[] = [];
  const half = path.kerfWidth / 2;
  let crossed = false;
  for (const solid of source) {
    const positions = solid.vertices.map(v => solidPoint(v, piece.geometry));
    const distances = positions.map(signed);
    // Check the entire swept band, not just intersections of the infinite line
    // with an enclosing outline. Never remove material beyond the finite path.
    if (Math.min(...distances) < half-EPS && Math.max(...distances) > -half+EPS) {
      const band = clipSolid(solid, piece.geometry, p => signed(p)-half, "band-a");
      const cutBand = band && clipSolid(band, piece.geometry, p => -signed(p)-half, "band-b");
      const samples = cutBand ? cutBand.vertices.map(v => solidPoint(v,piece.geometry)) : [];
      for (const face of solid.faces) for (let i=0;i<face.length;i++) {
        const a=face[i]!, b=face[(i+1)%face.length]!;
        const da=distances[a]!, db=distances[b]!;
        if (da*db < 0) {
          const t=da/(da-db), pa=positions[a]!, pb=positions[b]!;
          samples.push({x:pa.x+(pb.x-pa.x)*t,y:pa.y+(pb.y-pa.y)*t,z:pa.z+(pb.z-pa.z)*t});
        }
      }
      if (samples.some(p => along(p) < -EPS || along(p) > pathLength+EPS)) {
        throw new Error("Finite cut path does not cover the material thickness along its full intersection.");
      }
      crossed = true;
    }
    const a=clipSolid(solid,piece.geometry,p=>signed(p)+half,`${path.id}:negative`);
    const b=clipSolid(solid,piece.geometry,p=>-signed(p)+half,`${path.id}:positive`);
    if(a) negative.push(a); if(b) positive.push(b);
    if(half>0) {
      const lo=clipSolid(solid,piece.geometry,p=>-signed(p)-half,`${path.id}:kerf-a`);
      const removed=lo && clipSolid(lo,piece.geometry,p=>signed(p)-half,`${path.id}:kerf-b`);
      if(removed) kerf.push(removed);
    }
  }
  // A zero-kerf cut coinciding with a lattice face can separate whole cells
  // without crossing any tetrahedron interior.
  if(!negative.length || !positive.length) throw new Error("Cut must leave material on both sides.");
  if (!crossed && path.kerfWidth === 0) {
    const boundary = source.flatMap(s => s.vertices.map(v=>solidPoint(v,piece.geometry))).filter(p=>Math.abs(signed(p))<EPS);
    if(!boundary.length || boundary.some(p=>along(p)<-EPS || along(p)>pathLength+EPS)) {
      throw new Error("Finite cut path must cover the boundary between both pieces.");
    }
  }
  if (!connectedSolids(negative, piece.geometry) || !connectedSolids(positive, piece.geometry)) {
    throw new Error("Cut would create disconnected fragments; this operation requires two connected pieces.");
  }
  return {source, negative, positive, kerf};
}

// Shared faces establish material connectivity; touching at one point or edge
// is not enough to treat detached fragments as a single workpiece. A seam with
// unmatched face tessellation is conservatively rejected, never silently filled.
function connectedSolids(solids: readonly WorkpieceSolid[], geometry: WorkpieceGeometry): boolean {
  const parents = solids.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!;
      index = parents[index]!;
    }
    return index;
  };
  const faces = new Map<string, number>();
  solids.forEach((solid, index) => {
    const points = solid.vertices.map(vertex => solidPoint(vertex, geometry));
    for (const face of solid.faces) {
      const key = face.map(vertex => pointKey(points[vertex]!)).sort().join(";");
      const other = faces.get(key);
      if (other === undefined) faces.set(key, index); else parents[root(index)] = root(other);
    }
  });
  return solids.every((_, index) => root(index) === root(0));
}

function pointKey(point: SolidPoint): string {
  return [point.x, point.y, point.z].map(n => Math.round(n * 1e7)).join(",");
}

export function solidBounds(solids: readonly WorkpieceSolid[], geometry: WorkpieceGeometry) {
  let minX=Infinity, minY=Infinity, minZ=Infinity, maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  for(const solid of solids) for(const vertex of solid.vertices) {
    const p=solidPoint(vertex,geometry);
    minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); minZ=Math.min(minZ,p.z);
    maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); maxZ=Math.max(maxZ,p.z);
  }
  return {minX,minY,minZ,maxX,maxY,maxZ};
}

export function solidSurface(geometry: WorkpieceGeometry): readonly {blockId: string; points: readonly SolidPoint[]}[] {
  const faces = new Map<string, {blockId:string; points:SolidPoint[]; count:number}>();
  for(const solid of geometry.solids ?? []) {
    const positions=solid.vertices.map(v=>solidPoint(v,geometry));
    const center=mean(positions);
    for(const face of solid.faces) {
      const points=face.map(i=>positions[i]!);
      if(dot(cross(sub(points[1]!,points[0]!),sub(points[2]!,points[0]!)),sub(mean(points),center))<0) points.reverse();
      const faceKey=points.map(pointKey).sort().join(";");
      const existing=faces.get(faceKey);
      if(existing) existing.count++; else faces.set(faceKey,{blockId:solid.blockId,points,count:1});
    }
  }
  return [...faces.values()].filter(f=>f.count===1);
}

export function solidSurfaceArea(geometry: WorkpieceGeometry): number {
  let area=0;
  for(const face of solidSurface(geometry)) for(let i=1;i+1<face.points.length;i++) {
    area+=length(cross(sub(face.points[i]!,face.points[0]!),sub(face.points[i+1]!,face.points[0]!)))/2;
  }
  return area;
}

// Broad-phase planar envelope only. Actual surfaces and further cuts always
// consume solids, including concavities; this envelope never adds material.
export function solidEnvelope(geometry: WorkpieceGeometry) {
  const points = new Map<string,{id:string;axialPosition:number;lateralOffset:number}>();
  for(const solid of geometry.solids ?? []) for(const [index,vertex] of solid.vertices.entries()) {
    const p=solidPoint(vertex,geometry), key=`${Math.round(p.x*1e8)},${Math.round(p.z*1e8)}`;
    if(!points.has(key)) points.set(key,{id:`${solid.id}:outline:${index}`,axialPosition:p.x,lateralOffset:p.z});
  }
  const sorted=[...points.values()].sort((a,b)=>a.axialPosition-b.axialPosition || a.lateralOffset-b.lateralOffset);
  type P=typeof sorted[number];
  const turn=(a:P,b:P,c:P)=>(b.axialPosition-a.axialPosition)*(c.lateralOffset-a.lateralOffset)
    -(b.lateralOffset-a.lateralOffset)*(c.axialPosition-a.axialPosition);
  const chain=(input:P[])=>{const out:P[]=[];for(const p of input){while(out.length>=2&&turn(out.at(-2)!,out.at(-1)!,p)<=EPS)out.pop();out.push(p);}out.pop();return out;};
  return [...chain(sorted),...chain([...sorted].reverse())];
}

function mean(points: readonly SolidPoint[]): SolidPoint {
  return points.reduce((a,p)=>({x:a.x+p.x/points.length,y:a.y+p.y/points.length,z:a.z+p.z/points.length}),{x:0,y:0,z:0});
}
function sub(a:SolidPoint,b:SolidPoint):SolidPoint{return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};}
function dot(a:SolidPoint,b:SolidPoint):number{return a.x*b.x+a.y*b.y+a.z*b.z;}
function cross(a:SolidPoint,b:SolidPoint):SolidPoint{return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
function length(p:SolidPoint):number{return Math.hypot(p.x,p.y,p.z);}
function unit(p:SolidPoint):SolidPoint{const n=length(p);return {x:p.x/n,y:p.y/n,z:p.z/n};}

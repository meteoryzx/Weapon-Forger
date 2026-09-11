import type { SolidPoint } from "./solid-geometry.ts";

// Convex faces may share only part of their area after finite subtraction or
// grinding. Matching vertex lists alone would invent cracks at those seams.
export interface SolidFace {
  readonly owner: number;
  readonly blockId: string;
  readonly points: readonly SolidPoint[];
}
const EPS = 1e-8;
type Axis = "x" | "y" | "z";
interface PlanarFace {
  readonly face: SolidFace;
  readonly u: Axis;
  readonly v: Axis;
  readonly sign: number;
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
  pieces: (readonly SolidPoint[])[];
}

export function faceNormal(points: readonly SolidPoint[]): SolidPoint {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

function area(points: readonly SolidPoint[], u: Axis, v: Axis): number {
  let result = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    result += a[u] * b[v] - b[u] * a[v];
  }
  return result / 2;
}

function clip(points: readonly SolidPoint[], distance: (p: SolidPoint) => number): SolidPoint[] {
  const result: SolidPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    const da = distance(a), db = distance(b);
    if (da <= EPS) result.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t, z: a.z + (b.z-a.z)*t });
    }
  }
  return result;
}

function edgeDistances(face: PlanarFace): ((p: SolidPoint) => number)[] {
  const { points } = face.face, { u, v } = face;
  const orientation = Math.sign(area(points, u, v));
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const du = b[u]-a[u], dv = b[v]-a[v], length = Math.hypot(du, dv);
    return (p: SolidPoint) => length <= EPS ? 0 : orientation * (dv*(p[u]-a[u])-du*(p[v]-a[v])) / length;
  });
}

function intersects(a: PlanarFace, b: PlanarFace): boolean {
  let overlap = a.face.points;
  for (const distance of edgeDistances(b)) {
    overlap = clip(overlap, distance);
    if (overlap.length < 3) return false;
  }
  return Math.abs(area(overlap, a.u, a.v)) > EPS;
}

function subtract(a: PlanarFace, b: PlanarFace): void {
  const result: (readonly SolidPoint[])[] = [];
  const edges = edgeDistances(b);
  for (const piece of a.pieces) {
    let inside = piece;
    for (const distance of edges) {
      // A collinear/duplicate edge imposes no half-space.
      if (inside.every(p => Math.abs(distance(p)) <= EPS)) continue;
      const outside = clip(inside, p => -distance(p));
      if (outside.length >= 3 && Math.abs(area(outside, a.u, a.v)) > EPS) result.push(outside);
      inside = clip(inside, distance);
      if (inside.length < 3) break;
    }
  }
  a.pieces = result;
}

// Exact pairs have already been removed by the caller. Sweep unmatched faces
// on each supporting plane; only opposite outward normals can be neighbors.
export function matchPartialFaces(
  faces: readonly SolidFace[], onContact: (a: number, b: number) => void, surface: boolean,
): SolidFace[] {
  const planes = new Map<string, PlanarFace[]>();
  for (const face of faces) {
    const n = faceNormal(face.points), length = Math.hypot(n.x, n.y, n.z);
    if (length <= EPS) continue;
    const normal = { x: n.x/length, y: n.y/length, z: n.z/length };
    const axes: Axis[] = ["x", "y", "z"];
    const axis = axes.reduce((a, b) => Math.abs(normal[a]) >= Math.abs(normal[b]) ? a : b);
    const sign = Math.sign(normal[axis]);
    const [u, v] = axes.filter(a => a !== axis) as [Axis, Axis];
    const p = face.points[0]!;
    const key = [normal.x*sign, normal.y*sign, normal.z*sign,
      (normal.x*p.x+normal.y*p.y+normal.z*p.z)*sign].map(n => Math.round(n*1e7)).join(",");
    const entry: PlanarFace = { face, u, v, sign,
      minU: Math.min(...face.points.map(p => p[u])), maxU: Math.max(...face.points.map(p => p[u])),
      minV: Math.min(...face.points.map(p => p[v])), maxV: Math.max(...face.points.map(p => p[v])),
      pieces: [face.points] };
    const group = planes.get(key);
    if (group) group.push(entry); else planes.set(key, [entry]);
  }
  const output: SolidFace[] = [];
  for (const group of planes.values()) {
    if (group.some(f => f.sign !== group[0]!.sign)) {
      group.sort((a,b) => a.minU-b.minU);
      let active: PlanarFace[] = [];
      for (const current of group) {
        active = active.filter(other => other.maxU > current.minU+EPS);
        for (const other of active) {
          if (current.sign === other.sign || current.face.owner === other.face.owner
            || Math.min(current.maxV,other.maxV) <= Math.max(current.minV,other.minV)+EPS
            || Math.min(current.maxU,other.maxU) <= Math.max(current.minU,other.minU)+EPS) continue;
          if (!intersects(current, other)) continue;
          onContact(current.face.owner, other.face.owner);
          if (surface) { subtract(current, other); subtract(other, current); }
        }
        active.push(current);
      }
    }
    if (surface) for (const entry of group) for (const points of entry.pieces) output.push({ ...entry.face, points });
  }
  return output;
}

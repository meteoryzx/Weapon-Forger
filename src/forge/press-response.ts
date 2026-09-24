import { FORGE_RULES } from "./forge-rules.ts";
import { yieldStrengthMPa } from "./forge-physics.ts";
import {
  assertHammerPose, cellCorners, freeSurfaceReach, fromAnvil, geometryVolumes,
  hammerFrame, lateralFlowWeights, nodePoint, placedHammerSurface, toAnvil,
  type HammerTriangle,
} from "./hammer-surface.ts";
import type { ForgePressOperation, WorkpieceNode, WorkpieceState } from "./forge-types.ts";
import type { SolidPoint } from "./solid-geometry.ts";

export const PRESS_RULES = {
  faceLength: FORGE_RULES.hammerFaceLength,
  faceWidth: FORGE_RULES.hammerFaceWidth,
  supportLength: FORGE_RULES.anvilFaceLength,
  supportWidth: FORGE_RULES.anvilFaceWidth,
  // 800 kN playable rating: the accepted 65–70% settings produce a visible
  // hot spring-steel upset (about 0.33–0.47 mm on the furnace baseline),
  // while loads below the material's actual resistance remain elastic.
  maximumForceN: 800_000,
  maximumStrokeMm: 24,
  maximumDwellMs: 4000,
  maximumCompression: 0.35,
  minimumHeightMm: 0.4,
  supportToleranceMm: 2,
  edgeTransitionMm: 4,
  lateralTransitionMm: 24,
  platenToleranceMm: 1e-5,
  relaxationMs: 900,
  contactSamples: 12,
  volumeTolerance: 1e-8,
} as const;

export function assertPressOperation(operation: ForgePressOperation): void {
  assertHammerPose(operation.pose);
  if (!Number.isFinite(operation.pressure) || operation.pressure < 0.1 || operation.pressure > 1) {
    throw new Error("压力机载荷必须在 10%–100% 之间。");
  }
  if (!Number.isFinite(operation.strokeMm) || operation.strokeMm <= 0 || operation.strokeMm > PRESS_RULES.maximumStrokeMm) {
    throw new Error("压力机行程无效。");
  }
  if (!Number.isFinite(operation.dwellMs) || operation.dwellMs < 0 || operation.dwellMs > PRESS_RULES.maximumDwellMs) {
    throw new Error("压力机保压时间无效。");
  }
  if (![operation.target.x, operation.target.z].every(Number.isFinite)) throw new Error("Invalid press target.");
}

const clamp = (x: number, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const tetrahedra = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]] as const;

export interface PressResponse {
  readonly nodes: readonly WorkpieceNode[];
  readonly supportRatio: number;
  /** Initial upper contact plane above the grounded support, in mm. */
  readonly contactHeightMm: number;
  /** Downward platen travel from first contact, excluding free approach. */
  readonly ramTravelMm: number;
  /** Largest actual nodal displacement along the load direction. */
  readonly compressionMm: number;
}

type PressPath = (dwellMs: number) => PressResponse;
interface CachedPressPath { key: string; source: WorkpieceState; evaluate: PressPath }
const paths = new WeakMap<WorkpieceState, CachedPressPath>();
// postMessage creates a fresh identity for the same immutable baseline. Keep
// ONE exact-content entry, not an id/hash-only cache that could reuse old metal,
// temperature, geometry, or plastic history after a new operation.

function clip(points: readonly SolidPoint[], axis: "x" | "z", boundary: number, sign: number): SolidPoint[] {
  const result: SolidPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    const da = sign * (a[axis] - boundary), db = sign * (b[axis] - boundary);
    if (da <= 0) result.push(a);
    if (da * db < 0) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return result;
}

function determinant(points: readonly SolidPoint[], indices: readonly number[]): number {
  const o = points[indices[0]!]!, a = points[indices[1]!]!, b = points[indices[2]!]!, c = points[indices[3]!]!;
  const ax = a.x - o.x, ay = a.y - o.y, az = a.z - o.z;
  const bx = b.x - o.x, by = b.y - o.y, bz = b.z - o.z;
  const cx = c.x - o.x, cy = c.y - o.y, cz = c.z - o.z;
  return ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
}

// Vertical rays read occupied surfaces, including saved cut/ground solids.
function column(surface: readonly HammerTriangle[], x: number, z: number) {
  let top = -Infinity, bottom = Infinity;
  for (const { points: [a, b, c] } of surface) {
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-10) continue;
    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
    if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
    const y = u * a.y + v * b.y + (1 - u - v) * c.y;
    top = Math.max(top, y); bottom = Math.min(bottom, y);
  }
  return Number.isFinite(top) && top - bottom > 1e-5 ? { top, bottom } : null;
}

function columnLookup(surface: readonly HammerTriangle[]) {
  const size = 4;
  const buckets = new Map<string, HammerTriangle[]>();
  for (const triangle of surface) {
    const minX = Math.floor(Math.min(...triangle.points.map(p => p.x)) / size);
    const maxX = Math.floor(Math.max(...triangle.points.map(p => p.x)) / size);
    const minZ = Math.floor(Math.min(...triangle.points.map(p => p.z)) / size);
    const maxZ = Math.floor(Math.max(...triangle.points.map(p => p.z)) / size);
    for (let i = minX; i <= maxX; i++) for (let j = minZ; j <= maxZ; j++) {
      const key = `${i},${j}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(triangle); else buckets.set(key, [triangle]);
    }
  }
  return (x: number, z: number) => column(buckets.get(`${Math.floor(x / size)},${Math.floor(z / size)}`) ?? [], x, z);
}

/** A rate-limited equilibrium path from one immutable pre-cycle state, never impacts. */
export function deformPress(piece: WorkpieceState, operation: ForgePressOperation): PressResponse {
  assertPressOperation(operation);
  const key = JSON.stringify([operation.pose, operation.target, operation.pressure, operation.strokeMm]);
  let path = paths.get(piece);
  if (path?.key !== key) {
    path = { key, source: piece, evaluate: preparePress(piece, operation) };
    paths.set(piece, path);
  }
  const result = path.evaluate(operation.dwellMs);
  return result.nodes === path.source.geometry.nodes && path.source !== piece
    ? { ...result, nodes: piece.geometry.nodes } : result;
}

function preparePress(piece: WorkpieceState, operation: ForgePressOperation): PressPath {
  let unchanged: PressResponse = { nodes: piece.geometry.nodes, supportRatio: 0, contactHeightMm: 0, ramTravelMm: 0, compressionMm: 0 };
  if (piece.geometry.nodes.length === 0 || piece.geometry.solids?.length === 0) return () => unchanged;
  const frame = hammerFrame(piece.geometry, operation.pose);
  const surface = placedHammerSurface(piece.geometry, frame);
  const readColumn = columnLookup(surface);
  // Clipped solid vertices interpolate the original lattice, including nodes
  // in a removed slot. Those control nodes must follow the surrounding field;
  // treating a void node as fixed pins the surviving cut edge above the die.
  const { solids: _solids, ...lattice } = piece.geometry;
  const readControlColumn = piece.geometry.solids ? columnLookup(placedHammerSurface(lattice, frame)) : readColumn;
  const halfX = PRESS_RULES.faceLength / 2, halfZ = PRESS_RULES.faceWidth / 2;
  const { x, z } = operation.target;
  const supported = (px: number, pz: number) => Math.abs(px) <= PRESS_RULES.supportLength / 2
    && Math.abs(pz) <= PRESS_RULES.supportWidth / 2;
  // A triangle crossing the die edge must have ALL of its top vertices lowered.
  // Keep one projected element span beyond the face at full displacement, then
  // transition outside it; an inward taper leaves a rim inside the flat die.
  let collarX = 0, collarZ = 0;
  for (const triangle of surface) {
    collarX = Math.max(collarX, Math.max(...triangle.points.map(p => p.x)) - Math.min(...triangle.points.map(p => p.x)));
    collarZ = Math.max(collarZ, Math.max(...triangle.points.map(p => p.z)) - Math.min(...triangle.points.map(p => p.z)));
  }
  const footprint = (px: number, pz: number) => smooth(1 + (halfX + collarX - Math.abs(px - x)) / PRESS_RULES.edgeTransitionMm)
    * smooth(1 + (halfZ + collarZ - Math.abs(pz - z)) / PRESS_RULES.edgeTransitionMm);
  let occupied = 0, bearing = 0, height = 0;
  const sampleCount = PRESS_RULES.contactSamples;
  for (let i = 0; i < sampleCount; i++) for (let j = 0; j < sampleCount; j++) {
    const px = x - halfX + (i + 0.5) * 2 * halfX / sampleCount;
    const pz = z - halfZ + (j + 0.5) * 2 * halfZ / sampleCount;
    const hit = readColumn(px, pz);
    if (!hit) continue;
    occupied++;
    if (supported(px, pz) && hit.bottom <= PRESS_RULES.supportToleranceMm) {
      bearing++; height = Math.max(height, hit.top);
    }
  }
  for (const triangle of surface) {
    let points: readonly SolidPoint[] = triangle.points;
    for (const [axis, min, max] of [
      ["x", x - halfX, x + halfX],
      ["z", z - halfZ, z + halfZ],
    ] as const) points = clip(clip(points, axis, min, -1), axis, max, 1);
    for (const p of points) height = Math.max(height, p.y);
  }
  unchanged = { ...unchanged, contactHeightMm: height };
  if (!bearing || height <= PRESS_RULES.minimumHeightMm) return () => unchanged;
  const supportRatio = bearing / occupied;
  unchanged = { ...unchanged, supportRatio };
  const area = occupied * PRESS_RULES.faceLength * PRESS_RULES.faceWidth / sampleCount ** 2;
  const force = operation.pressure * PRESS_RULES.maximumForceN * supportRatio;
  const world = piece.geometry.nodes.map(n => toAnvil(nodePoint(n), frame));
  const cells = piece.sections.flatMap((section, a) => section.blocks.map(block => {
    const indices = cellCorners(a, block, piece.geometry);
    const points = indices.map(i => world[i]!);
    const center = points.reduce((p, q) => ({ x: p.x + q.x / 8, y: p.y + q.y / 8, z: p.z + q.z / 8 }), { x: 0, y: 0, z: 0 });
    return { block, indices, points, loaded: Math.abs(center.x - x) <= halfX && Math.abs(center.z - z) <= halfZ && supported(center.x, center.z) };
  }));
  const loaded = cells.filter(cell => cell.loaded && cell.block.volume > 0);
  if (!loaded.length) return () => unchanged;
  const loadedVolume = loaded.reduce((sum, cell) => sum + cell.block.volume, 0);
  // Slab upsetting: growing area, strain hardening, and die friction raise the
  // required force as thickness falls. MPa * mm^2 = N. No sub-yield cold drive.
  const resistance = (depth: number) => {
    const ratio = Math.max(0.05, 1 - depth / height);
    const strain = -Math.log(ratio);
    const yieldMPa = loaded.reduce((sum, { block }) => sum + block.volume * yieldStrengthMPa({
      ...block, plasticStrain: block.plasticStrain + strain,
    }, piece.material), 0) / loadedVolume;
    const friction = 1 + (FORGE_RULES.hammerFriction + FORGE_RULES.anvilFriction)
      * Math.sqrt(area) / (6 * Math.max(height * ratio, PRESS_RULES.minimumHeightMm));
    return area / ratio * yieldMPa * friction;
  };
  const initialResistance = resistance(0);
  if (force <= initialResistance) return () => unchanged;
  let low = 0, high = height * 0.9;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (resistance(middle) < force) low = middle; else high = middle;
  }
  const equilibrium = (low + high) / 2;
  const timeConstant = PRESS_RULES.relaxationMs / Math.max(0.1, force / initialResistance - 1);
  const cap = Math.min(operation.strokeMm, height * PRESS_RULES.maximumCompression, height - PRESS_RULES.minimumHeightMm);
  const flow = lateralFlowWeights(freeSurfaceReach(surface, x, z, Math.max(halfX, halfZ)));
  const beforeVolume = [...geometryVolumes(piece).values()].reduce((sum, value) => sum + value, 0);
  if (!(beforeVolume > 0)) return () => unchanged;
  // Bound EVERY nodal displacement in the load direction to [0, depth].
  // Convex solid weights inherit the bound; lateral volume correction never
  // rescales Y, so it cannot silently consume additional ram stroke.
  const columns = new Map<string, ReturnType<typeof column>>();
  const movement = world.map(p => {
    const key = `${p.x},${p.z}`;
    if (!columns.has(key)) columns.set(key, footprint(p.x, p.z) > 0 && supported(p.x, p.z)
      ? readControlColumn(p.x, p.z) : null);
    const hit = columns.get(key);
    const thickness = hit ? hit.top - hit.bottom : 0;
    const compression = hit && hit.bottom <= PRESS_RULES.supportToleranceMm
      ? footprint(p.x, p.z) * clamp((p.y - hit.bottom) / thickness) : 0;
    const dx = p.x - x, dz = p.z - z;
    const local = smooth(1 + (halfX + collarX - Math.abs(dx)) / PRESS_RULES.lateralTransitionMm)
      * smooth(1 + (halfZ + collarZ - Math.abs(dz)) / PRESS_RULES.lateralTransitionMm);
    const decay = local / (1 + (dx / halfX) ** 2 + (dz / halfZ) ** 2);
    return { x: dx * decay * (dx >= 0 ? flow.plusX : flow.minusX), y: compression,
      gap: hit ? Math.max(0, height - hit.top) : height,
      limit: Math.max(0, Math.min(thickness * PRESS_RULES.maximumCompression, thickness - PRESS_RULES.minimumHeightMm)),
      z: dz * decay * (dz >= 0 ? flow.plusZ : flow.minusZ) };
  });
  const displacement = (i: number, depth: number) => movement[i]!.y * Math.min(movement[i]!.limit, Math.max(0, depth - movement[i]!.gap));
  const solve = (depth: number) => {
    const makeWorld = (spread: number) => world.map((p, i) => ({
      x: p.x + movement[i]!.x * spread, y: p.y - displacement(i, depth), z: p.z + movement[i]!.z * spread,
    }));
    const makeNodes = (points: readonly SolidPoint[]) => points.map((p, i) => {
      if (p.x === world[i]!.x && p.y === world[i]!.y && p.z === world[i]!.z) return piece.geometry.nodes[i]!;
      const local = fromAnvil(p, frame);
      return { ...piece.geometry.nodes[i]!, axialPosition: local.x, verticalOffset: local.y, lateralOffset: local.z };
    });
    const volume = (points: readonly SolidPoint[]) => piece.geometry.solids
      ? [...geometryVolumes(piece, { ...piece.geometry, nodes: makeNodes(points) }).values()].reduce((sum, value) => sum + value, 0)
      : cells.reduce((sum, cell) => sum + tetrahedra.reduce((v, t) => v + Math.abs(determinant(points, t.map(i => cell.indices[i]!))) / 6, 0), 0);
    let lo = 0, hi = 2;
    let lowVolume = volume(makeWorld(lo)), highVolume = volume(makeWorld(hi));
    if (highVolume < beforeVolume) return null;
    let spread = 0;
    // Bracketed secant converges rapidly for the quadratic lateral-volume
    // relation, including clipped solids. Stop by volume error, not frame time.
    for (let i = 0; i < 24; i++) {
      spread = lo + (hi - lo) * clamp((beforeVolume - lowVolume) / (highVolume - lowVolume));
      const total = volume(makeWorld(spread));
      if (Math.abs(total / beforeVolume - 1) < PRESS_RULES.volumeTolerance * 0.1) break;
      if (total < beforeVolume) { lo = spread; lowVolume = total; }
      else { hi = spread; highVolume = total; }
    }
    const points = makeWorld(spread);
    if (Math.abs(volume(points) / beforeVolume - 1) > PRESS_RULES.volumeTolerance) return null;
    for (const cell of cells) for (const t of tetrahedra) {
      const before = determinant(cell.points, t);
      const after = determinant(points, t.map(i => cell.indices[i]!));
      if (!Number.isFinite(after) || (Math.abs(before) > 1e-10 && after / before < 0.1)) return null;
    }
    const nodes = makeNodes(points);
    // Validate the actual post-spread triangles, including clipped edge
    // intersections. Never report ram travel through undeformed material.
    for (const triangle of placedHammerSurface({ ...piece.geometry, nodes }, frame)) {
      let polygon: readonly SolidPoint[] = triangle.points;
      polygon = clip(clip(polygon, "x", x - halfX, -1), "x", x + halfX, 1);
      polygon = clip(clip(polygon, "z", z - halfZ, -1), "z", z + halfZ, 1);
      if (polygon.some(p => p.y > height - depth + PRESS_RULES.platenToleranceMm)) return null;
    }
    return nodes;
  };
  // Determine the admissible endpoint from the baseline, independent of dwell.
  // Discrete per-preview fallback scales would make a held cycle jump backwards.
  let safeCap = cap;
  if (!solve(safeCap)) {
    let lo = 0, hi = cap;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (solve(mid)) lo = mid; else hi = mid;
    }
    safeCap = lo;
  }
  let lastDwell = -1, lastResult = unchanged;
  return dwellMs => {
    if (dwellMs === lastDwell) return lastResult;
    const depth = Math.min(equilibrium * -Math.expm1(-dwellMs / timeConstant), safeCap);
    if (depth <= 1e-10) return unchanged;
    const compressionMm = movement.reduce((max, _, i) => Math.max(max, displacement(i, depth)), 0);
    if (compressionMm <= 1e-10) return unchanged;
    const nodes = solve(depth);
    lastDwell = dwellMs;
    lastResult = nodes ? { nodes, supportRatio, contactHeightMm: height, ramTravelMm: depth, compressionMm } : unchanged;
    return lastResult;
  };
}

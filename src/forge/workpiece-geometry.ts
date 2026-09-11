import type {
  WorkpieceGeometry,
  WorkpieceGrid,
  WorkpieceNode,
  WorkpieceOutlinePoint,
} from "./forge-types.ts";

const GEOMETRY_EPSILON = 1e-8;

export interface PlanarPoint {
  readonly axialPosition: number;
  readonly lateralOffset: number;
}

export interface FiniteThroughCut {
  readonly id: string;
  readonly start: PlanarPoint;
  readonly end: PlanarPoint;
  readonly kerfWidth: number;
}

export interface FiniteThroughCutResult {
  readonly negative: readonly WorkpieceOutlinePoint[];
  readonly positive: readonly WorkpieceOutlinePoint[];
  readonly kerf: readonly WorkpieceOutlinePoint[];
  readonly originalArea: number;
  readonly removedArea: number;
}

export function createStructuredWorkpieceGeometry(
  workpieceId: string,
  grid: WorkpieceGrid,
  nodes: readonly WorkpieceNode[],
  sectionCount: number,
): WorkpieceGeometry {
  return {
    kind: "planar-height-field-v1",
    grid: { ...grid },
    nodes,
    outline: outlineFromStructuredNodes(workpieceId, grid, nodes, sectionCount),
  };
}

export function cloneWorkpieceGeometry(geometry: WorkpieceGeometry): WorkpieceGeometry {
  return {
    kind: geometry.kind,
    grid: { ...geometry.grid },
    nodes: geometry.nodes.map((node) => ({ ...node })),
    outline: geometry.outline.map((point) => ({ ...point })),
  };
}

export function outlineArea(outline: readonly PlanarPoint[]): number {
  return Math.abs(signedOutlineArea(outline));
}

function signedOutlineArea(outline: readonly PlanarPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    if (!current || !next) continue;
    twiceArea += current.axialPosition * next.lateralOffset
      - next.axialPosition * current.lateralOffset;
  }
  return twiceArea / 2;
}

export function splitOutlineByFiniteThroughCut(
  outline: readonly WorkpieceOutlinePoint[],
  cut: FiniteThroughCut,
): FiniteThroughCutResult {
  assertWorkpieceOutline(outline);
  assertCut(cut);
  const direction = subtract(cut.end, cut.start);
  const length = magnitude(direction);
  const normal = { axialPosition: -direction.lateralOffset / length, lateralOffset: direction.axialPosition / length };
  const signedDistance = (point: PlanarPoint) => dot(subtract(point, cut.start), normal);
  const centerIntersections = segmentBoundaryIntersections(outline, cut.start, cut.end);
  if (centerIntersections.length !== 2) {
    throw new Error("A finite through-cut must enter and leave the outer contour exactly once.");
  }

  const halfKerf = cut.kerfWidth / 2;
  for (const threshold of [-halfKerf, halfKerf]) {
    if (lineBoundaryIntersectionCount(outline, signedDistance, threshold) > 2) {
      throw new Error("A through-cut cannot create multiple contours in the current 2.5D geometry.");
    }
  }

  const negative = identifyCutBoundary(
    clipHalfPlane(outline, signedDistance, -halfKerf, false, `${cut.id}:negative`),
    signedDistance,
    -halfKerf,
    `${cut.id}:negative`,
  );
  const positive = identifyCutBoundary(
    clipHalfPlane(outline, signedDistance, halfKerf, true, `${cut.id}:positive`),
    signedDistance,
    halfKerf,
    `${cut.id}:positive`,
  );
  const kerfMinimum = clipHalfPlane(outline, signedDistance, -halfKerf, true, `${cut.id}:kerf-minimum`);
  const kerf = clipHalfPlane(kerfMinimum, signedDistance, halfKerf, false, `${cut.id}:kerf-maximum`);
  if (outlineArea(negative) <= GEOMETRY_EPSILON || outlineArea(positive) <= GEOMETRY_EPSILON) {
    throw new Error("A through-cut must leave material on both sides of the blade.");
  }

  return {
    negative,
    positive,
    kerf,
    originalArea: outlineArea(outline),
    removedArea: outlineArea(kerf),
  };
}

function outlineFromStructuredNodes(
  workpieceId: string,
  grid: WorkpieceGrid,
  nodes: readonly WorkpieceNode[],
  sectionCount: number,
): readonly WorkpieceOutlinePoint[] {
  const negativeSide = Array.from({ length: sectionCount + 1 }, (_, axialIndex) => (
    sidePoint(workpieceId, "negative", axialIndex, 0, grid, nodes)
  ));
  const positiveSide = Array.from({ length: sectionCount + 1 }, (_, offset) => {
    const axialIndex = sectionCount - offset;
    return sidePoint(workpieceId, "positive", axialIndex, grid.widthBlocks, grid, nodes);
  });
  return [...negativeSide, ...positiveSide];
}

function sidePoint(
  workpieceId: string,
  side: "negative" | "positive",
  axialIndex: number,
  widthIndex: number,
  grid: WorkpieceGrid,
  nodes: readonly WorkpieceNode[],
): WorkpieceOutlinePoint {
  const samples: WorkpieceNode[] = [];
  for (let heightIndex = 0; heightIndex <= grid.heightBlocks; heightIndex += 1) {
    const point = nodes[nodeIndex(axialIndex, widthIndex, heightIndex, grid)];
    if (!point) throw new Error("Structured geometry is missing an outline node.");
    samples.push(point);
  }
  return {
    id: `${workpieceId}:outline:${side}:${axialIndex}`,
    axialPosition: average(samples.map((point) => point.axialPosition)),
    lateralOffset: average(samples.map((point) => point.lateralOffset)),
  };
}

function clipHalfPlane(
  outline: readonly WorkpieceOutlinePoint[],
  signedDistance: (point: PlanarPoint) => number,
  threshold: number,
  keepGreater: boolean,
  intersectionPrefix: string,
): readonly WorkpieceOutlinePoint[] {
  const output: WorkpieceOutlinePoint[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    if (!current || !next) continue;
    const currentDistance = signedDistance(current) - threshold;
    const nextDistance = signedDistance(next) - threshold;
    const currentInside = keepGreater ? currentDistance >= -GEOMETRY_EPSILON : currentDistance <= GEOMETRY_EPSILON;
    const nextInside = keepGreater ? nextDistance >= -GEOMETRY_EPSILON : nextDistance <= GEOMETRY_EPSILON;

    if (currentInside) output.push({ ...current });
    if (currentInside === nextInside) continue;
    const denominator = currentDistance - nextDistance;
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) continue;
    const amount = currentDistance / denominator;
    output.push({
      id: `${intersectionPrefix}:${current.id}:${next.id}`,
      axialPosition: lerp(current.axialPosition, next.axialPosition, amount),
      lateralOffset: lerp(current.lateralOffset, next.lateralOffset, amount),
    });
  }
  return removeAdjacentDuplicates(output);
}

function segmentBoundaryIntersections(
  outline: readonly PlanarPoint[],
  start: PlanarPoint,
  end: PlanarPoint,
): readonly PlanarPoint[] {
  const direction = subtract(end, start);
  const intersections: PlanarPoint[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const first = outline[index];
    const second = outline[(index + 1) % outline.length];
    if (!first || !second) continue;
    const edge = subtract(second, first);
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) continue;
    const fromStart = subtract(first, start);
    const pathAmount = cross(fromStart, edge) / denominator;
    const edgeAmount = cross(fromStart, direction) / denominator;
    if (pathAmount < -GEOMETRY_EPSILON || pathAmount > 1 + GEOMETRY_EPSILON
      || edgeAmount < -GEOMETRY_EPSILON || edgeAmount > 1 + GEOMETRY_EPSILON) continue;
    intersections.push({
      axialPosition: start.axialPosition + direction.axialPosition * pathAmount,
      lateralOffset: start.lateralOffset + direction.lateralOffset * pathAmount,
    });
  }
  return uniquePoints(intersections);
}

function lineBoundaryIntersectionCount(
  outline: readonly PlanarPoint[],
  signedDistance: (point: PlanarPoint) => number,
  threshold: number,
): number {
  let intersections = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    if (!current || !next) continue;
    const first = signedDistance(current) - threshold;
    const second = signedDistance(next) - threshold;
    if ((first < -GEOMETRY_EPSILON && second > GEOMETRY_EPSILON)
      || (first > GEOMETRY_EPSILON && second < -GEOMETRY_EPSILON)) intersections += 1;
  }
  return intersections;
}

export function assertWorkpieceOutline(outline: readonly WorkpieceOutlinePoint[]): void {
  const ids = new Set<string>();
  if (outline.length < 3) {
    throw new Error("A workpiece outline needs at least three finite identified points.");
  }
  for (const point of outline) {
    if (!point.id || ids.has(point.id)
      || !Number.isFinite(point.axialPosition) || !Number.isFinite(point.lateralOffset)) {
      throw new Error("A workpiece outline needs at least three finite identified points.");
    }
    ids.add(point.id);
  }
  if (signedOutlineArea(outline) <= GEOMETRY_EPSILON) {
    throw new Error("A workpiece outline needs positive counter-clockwise area.");
  }
}

function identifyCutBoundary(
  outline: readonly WorkpieceOutlinePoint[],
  signedDistance: (point: PlanarPoint) => number,
  threshold: number,
  prefix: string,
): readonly WorkpieceOutlinePoint[] {
  return outline.map((point) => Math.abs(signedDistance(point) - threshold) <= GEOMETRY_EPSILON
    ? { ...point, id: `${prefix}:${point.id}` }
    : point);
}

function assertCut(cut: FiniteThroughCut): void {
  if (!cut.id || !finitePoint(cut.start) || !finitePoint(cut.end)
    || !Number.isFinite(cut.kerfWidth) || cut.kerfWidth < 0
    || magnitude(subtract(cut.end, cut.start)) <= GEOMETRY_EPSILON) {
    throw new Error("A finite through-cut needs an identified non-zero path and a non-negative kerf width.");
  }
}

function finitePoint(point: PlanarPoint): boolean {
  return Number.isFinite(point.axialPosition) && Number.isFinite(point.lateralOffset);
}

function removeAdjacentDuplicates(points: readonly WorkpieceOutlinePoint[]): readonly WorkpieceOutlinePoint[] {
  const result: WorkpieceOutlinePoint[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (!previous || distance(previous, point) > GEOMETRY_EPSILON) result.push(point);
  }
  if (result.length > 1 && distance(result[0]!, result.at(-1)!) <= GEOMETRY_EPSILON) result.pop();
  return result;
}

function uniquePoints(points: readonly PlanarPoint[]): readonly PlanarPoint[] {
  const result: PlanarPoint[] = [];
  for (const point of points) {
    if (!result.some((candidate) => distance(candidate, point) <= GEOMETRY_EPSILON)) result.push(point);
  }
  return result;
}

function nodeIndex(axialIndex: number, widthIndex: number, heightIndex: number, grid: WorkpieceGrid): number {
  return axialIndex * (grid.widthBlocks + 1) * (grid.heightBlocks + 1)
    + heightIndex * (grid.widthBlocks + 1)
    + widthIndex;
}

function subtract(first: PlanarPoint, second: PlanarPoint): PlanarPoint {
  return {
    axialPosition: first.axialPosition - second.axialPosition,
    lateralOffset: first.lateralOffset - second.lateralOffset,
  };
}

function dot(first: PlanarPoint, second: PlanarPoint): number {
  return first.axialPosition * second.axialPosition + first.lateralOffset * second.lateralOffset;
}

function cross(first: PlanarPoint, second: PlanarPoint): number {
  return first.axialPosition * second.lateralOffset - first.lateralOffset * second.axialPosition;
}

function magnitude(point: PlanarPoint): number {
  return Math.hypot(point.axialPosition, point.lateralOffset);
}

function distance(first: PlanarPoint, second: PlanarPoint): number {
  return magnitude(subtract(first, second));
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lerp(first: number, second: number, amount: number): number {
  return first + (second - first) * amount;
}

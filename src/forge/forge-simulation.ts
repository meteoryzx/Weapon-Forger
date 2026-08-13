import { DEFAULT_FORGE_MATERIAL, FORGE_PARAMETER_VERSION, FORGE_RULES } from "./forge-rules.ts";
import type {
  BladeBlock,
  BladeSection,
  ForgeIntent,
  ForgeMaterial,
  ForgeOperation,
  ForgeSnapshot,
  ForgeSnapshotBlock,
  ForgeSnapshotSection,
  ForgeState,
  HammerInfluencePreview,
  HammerOperation,
  WorkpieceGrid,
  WorkpieceNode,
} from "./forge-types.ts";

export interface CreateForgeStateOptions {
  readonly material?: ForgeMaterial;
  readonly sectionCount?: number;
}

type StruckFace = "top" | "bottom" | "left" | "right";
interface HammerContactTarget {
  readonly axialPosition: number;
  readonly tangentPosition: number;
}

interface HammerSurfaceSample {
  readonly index: number;
  readonly crownOffset: number;
}

interface CellBounds {
  readonly axialMinimum: number;
  readonly axialMaximum: number;
  readonly widthMinimum: number;
  readonly widthMaximum: number;
  readonly heightMinimum: number;
  readonly heightMaximum: number;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type MutableWorkpieceNode = { -readonly [Key in keyof WorkpieceNode]: WorkpieceNode[Key] };

interface EdgeConstraint {
  readonly first: number;
  readonly second: number;
  readonly restLength: number;
  lambda: number;
}

interface CellVolumeConstraint {
  readonly indices: readonly [number, number, number, number, number, number, number, number];
  readonly restVolume: number;
  lambda: number;
}

const DEFAULT_GRID: WorkpieceGrid = {
  widthBlocks: FORGE_RULES.crossSectionWidthBlocks,
  heightBlocks: FORGE_RULES.crossSectionHeightBlocks,
};

const CELL_TETRAHEDRA = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7],
] as const;

export function createForgeState(options: CreateForgeStateOptions = {}): ForgeState {
  const sectionCount = options.sectionCount ?? FORGE_RULES.defaultSectionCount;
  if (!Number.isInteger(sectionCount) || sectionCount < 3) {
    throw new Error("A forge workpiece needs at least three sections.");
  }

  const material = options.material ?? DEFAULT_FORGE_MATERIAL;
  assertMaterial(material);
  const nodes = createWorkpieceNodes(sectionCount, DEFAULT_GRID);
  const sections = Array.from({ length: sectionCount }, (_, sectionIndex) => (
    createSection(sectionIndex, nodes, DEFAULT_GRID)
  ));
  return {
    parameterVersion: FORGE_PARAMETER_VERSION,
    phase: "forging",
    material: { ...material },
    workpiece: {
      id: "workpiece-0",
      orientationQuarterTurns: 0,
      feedOffset: 0,
      grid: { ...DEFAULT_GRID },
      nodes,
      sections,
      joints: [],
    },
    operations: [],
  };
}

export function applyForgeOperation(state: ForgeState, operation: ForgeOperation): ForgeState {
  switch (operation.kind) {
    case "heat":
      assertTemperature(operation.temperatureC);
      return appendOperation({
        ...state,
        workpiece: {
          ...state.workpiece,
          sections: state.workpiece.sections.map((section, sectionIndex) => applyHeat(
            section,
            sectionIndex,
            state.workpiece.nodes,
            operation.temperatureC,
            state.material,
            state.workpiece.grid,
          )),
        },
      }, operation);
    case "rotate":
      assertQuarterTurns(operation.quarterTurns);
      return appendOperation({
        ...state,
        workpiece: {
          ...state.workpiece,
          orientationQuarterTurns: rotate(state.workpiece.orientationQuarterTurns, operation.quarterTurns),
        },
      }, operation);
    case "feed":
      assertFeedStep(operation.step);
      return appendOperation({
        ...state,
        workpiece: {
          ...state.workpiece,
          feedOffset: clampFeedOffset(
            state.workpiece.feedOffset + operation.step * FORGE_RULES.feedStepLength,
            state.workpiece.nodes,
          ),
        },
      }, operation);
    case "hammer":
      return appendOperation(applyHammer(state, operation), operation);
    case "quench":
    case "grind":
      throw new Error(`${operation.kind} is reserved for S3c and cannot run in S3a.`);
  }
}

export function applyForgeIntent(state: ForgeState, intent: ForgeIntent): ForgeState {
  return applyForgeOperation(state, { ...intent });
}

export function replayForgeState(initialState: ForgeState, operations: readonly ForgeOperation[]): ForgeState {
  return operations.reduce(applyForgeOperation, cloneStateWithoutOperations(initialState));
}

export function createForgeSnapshot(state: ForgeState): ForgeSnapshot {
  return {
    parameterVersion: state.parameterVersion,
    orientationQuarterTurns: state.workpiece.orientationQuarterTurns,
    feedOffset: state.workpiece.feedOffset,
    grid: { ...state.workpiece.grid },
    nodes: state.workpiece.nodes.map((node) => ({ ...node })),
    hasCracks: state.workpiece.sections.some((section) => section.cracked),
    hasOverheatedSections: state.workpiece.sections.some((section) => section.overheated),
    sections: state.workpiece.sections.map(sectionSnapshot),
  };
}

export function totalVolume(state: ForgeState): number {
  return state.workpiece.sections.reduce(
    (total, section) => total + section.blocks.reduce((subtotal, block) => subtotal + block.volume, 0),
    0,
  );
}

export function calculatePlasticity(temperatureC: number, material: ForgeMaterial = DEFAULT_FORGE_MATERIAL): number {
  const range = material.plasticityPeakC - material.plasticityStartC;
  return clamp((temperatureC - material.plasticityStartC) / range, 0, 1) * material.hotWorkability;
}

export function createHammerInfluencePreview(
  snapshot: ForgeSnapshot,
  target: Pick<HammerOperation, "sectionIndex" | "energy" | "faceBias">,
): HammerInfluencePreview {
  assertHammerTarget(snapshot.sections, target);
  const face = struckFaceForOrientation(snapshot.orientationQuarterTurns);
  const targetSection = snapshot.sections[target.sectionIndex];
  if (!targetSection) throw new Error("Missing hammer target section.");
  const contactTarget = contactTargetFor(targetSection, face, target.faceBias ?? 0.5);
  const samples = snapshot.sections.flatMap((section, sectionIndex) => section.blocks
    .filter((block) => (
      isSurfaceBlock(block, face, snapshot.grid) && footprintWeight(section, block, contactTarget, face) > 0
    ))
    .map((block) => ({
      sectionIndex,
      widthIndex: block.widthIndex,
      heightIndex: block.heightIndex,
      weight: roundWeight(footprintWeight(section, block, contactTarget, face) * target.energy),
    })));
  return {
    sectionIndex: target.sectionIndex,
    faceBias: target.faceBias ?? 0.5,
    energy: target.energy,
    samples,
  };
}

function applyHammer(state: ForgeState, operation: HammerOperation): ForgeState {
  assertHammerOperation(state, operation);
  const face = struckFaceForOrientation(state.workpiece.orientationQuarterTurns);
  const targetSection = state.workpiece.sections[operation.sectionIndex];
  if (!targetSection) throw new Error("Missing hammer target section.");
  const target = contactTargetFor(targetSection, face, operation.faceBias ?? 0.5);
  const contactCells = findContactCells(state.workpiece.sections, target, face, state.workpiece.grid);
  if (contactCells.length === 0) return state;

  const plasticity = contactCells.reduce((sum, item) => (
    sum + (state.workpiece.sections[item.sectionIndex]?.blocks.find(
      (block) => block.widthIndex === item.widthIndex && block.heightIndex === item.heightIndex,
    )?.plasticity ?? 0)
  ), 0) / contactCells.length;
  const activeBounds = activeBoundsFor(contactCells, face, state.workpiece.sections.length, state.workpiece.grid);
  const nodes = solveHammerContact(
    state.workpiece.nodes,
    state.workpiece.grid,
    activeBounds,
    target,
    face,
    operation.energy,
    plasticity,
    state.workpiece.feedOffset,
  );
  const sections = state.workpiece.sections.map((section, sectionIndex) => {
    if (sectionIndex < activeBounds.axialMinimum || sectionIndex > activeBounds.axialMaximum) {
      return section;
    }
    const geometricBlocks = section.blocks.map((block) => deriveBlockGeometry(
      block,
      sectionIndex,
      nodes,
      state.workpiece.grid,
    ));
    const updatedBlocks = geometricBlocks.map((geometry, blockIndex) => {
      const before = section.blocks[blockIndex];
      if (!before) throw new Error("Missing block state during hammer solve.");
      const weight = blockImpactWeight(section, before, target, face);
      return weight > 0
        ? updateHammerState(before, geometry, operation, weight, state.material, neighbourPlasticStrain(state, sectionIndex, before))
        : geometry;
    });
    return summarizeSection({ ...section, blocks: updatedBlocks }, sectionIndex, nodes, state.workpiece.grid);
  });

  return {
    ...state,
    workpiece: { ...state.workpiece, nodes, sections },
  };
}

function solveHammerContact(
  input: readonly WorkpieceNode[],
  grid: WorkpieceGrid,
  bounds: CellBounds,
  target: HammerContactTarget,
  face: StruckFace,
  energy: number,
  plasticity: number,
  feedOffset: number,
): readonly WorkpieceNode[] {
  const nodes: MutableWorkpieceNode[] = input.map((node) => ({ ...node }));
  const original = input.map(nodeVector);
  const pinned = boundaryNodeIndices(bounds, grid, input);
  const surfaceSamples = hammerSurfaceSamples(nodes, grid, bounds, target, face);
  if (surfaceSamples.length === 0) return nodes;

  const normal = faceNormal(face);
  const initialPlane = Math.max(...surfaceSamples.map((sample) => (
    orientedCoordinate(nodes[sample.index], normal) - sample.crownOffset
  )));
  const travel = hammerTravelForEnergy(
    nodes,
    surfaceSamples,
    normal,
    initialPlane,
    energy,
    plasticity,
  );
  const supportNodes = supportSurfaceNodeIndices(nodes, grid, bounds, face, feedOffset);
  const supportNormal: ReturnType<typeof faceNormal> = {
    coordinate: normal.coordinate,
    sign: normal.sign === 1 ? -1 : 1,
  };
  const supportPlane = supportNodes.length > 0
    ? Math.max(...supportNodes.map((index) => orientedCoordinate(nodes[index], supportNormal)))
    : null;
  const volumeConstraints = createCellVolumeConstraints(grid, bounds);
  const edges = createEdgeConstraints(input, grid, bounds);
  const contacted = new Set<number>();
  const shapeCompliance = lerp(FORGE_RULES.coldShapeCompliance, FORGE_RULES.hotShapeCompliance, plasticity);

  for (let substep = 1; substep <= FORGE_RULES.contactSubsteps; substep += 1) {
    const hammerPlane = initialPlane - travel * (substep / FORGE_RULES.contactSubsteps);
    for (const sample of surfaceSamples) {
      if (orientedCoordinate(nodes[sample.index], normal) >= hammerPlane + sample.crownOffset) {
        contacted.add(sample.index);
      }
    }
    for (const constraint of volumeConstraints) constraint.lambda = 0;
    for (const edge of edges) edge.lambda = 0;

    for (let iteration = 0; iteration < FORGE_RULES.solverIterations; iteration += 1) {
      projectContactSurface(nodes, surfaceSamples, contacted, normal, hammerPlane);
      if (supportPlane !== null) projectSupportPlane(nodes, supportNodes, supportNormal, supportPlane);
      solveEdgeConstraints(nodes, edges, pinned, shapeCompliance);
      applyContactFriction(nodes, original, contacted, normal, FORGE_RULES.hammerFriction);
      const supported = supportPlane === null ? [] : supportNodes.filter((index) => (
        orientedCoordinate(nodes[index], supportNormal) >= supportPlane - 0.000_1
      ));
      applyContactFriction(nodes, original, supported, supportNormal, FORGE_RULES.anvilFriction);
      projectContactSurface(nodes, surfaceSamples, contacted, normal, hammerPlane);
      if (supportPlane !== null) projectSupportPlane(nodes, supportNodes, supportNormal, supportPlane);
      solveCellVolumeConstraints(nodes, volumeConstraints, pinned);
    }
    if (supportPlane !== null) projectSupportPlane(nodes, supportNodes, supportNormal, supportPlane);
    const supported = supportPlane === null ? [] : supportNodes.filter((index) => (
      orientedCoordinate(nodes[index], supportNormal) >= supportPlane - 0.000_1
    ));
    solveAggregateVolumeConstraint(nodes, volumeConstraints, new Set([...pinned, ...supported]));
  }
  return nodes;
}

function hammerTravelForEnergy(
  nodes: readonly WorkpieceNode[],
  samples: readonly HammerSurfaceSample[],
  normal: ReturnType<typeof faceNormal>,
  initialPlane: number,
  energy: number,
  plasticity: number,
): number {
  const maximumTravel = energy * FORGE_RULES.hammerMaximumTravel;
  const volumeBudget = energy * lerp(
    FORGE_RULES.hammerDisplacedVolumeAtZeroPlasticity,
    FORGE_RULES.hammerDisplacedVolumeAtPeakPlasticity,
    plasticity,
  );
  const sweptVolume = (travel: number) => samples.reduce((sum, sample) => {
    const toolSurface = initialPlane - travel + sample.crownOffset;
    const penetration = Math.max(0, orientedCoordinate(nodes[sample.index], normal) - toolSurface);
    return sum + penetration * FORGE_RULES.simulationCellSize ** 2;
  }, 0);
  if (sweptVolume(maximumTravel) <= volumeBudget) return maximumTravel;

  let minimum = 0;
  let maximum = maximumTravel;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const candidate = (minimum + maximum) / 2;
    if (sweptVolume(candidate) <= volumeBudget) minimum = candidate;
    else maximum = candidate;
  }
  return minimum;
}

function solveCellVolumeConstraints(
  nodes: MutableWorkpieceNode[],
  constraints: readonly CellVolumeConstraint[],
  pinned: ReadonlySet<number>,
): void {
  for (const constraint of constraints) {
    const corners = constraint.indices.map((index) => nodeVector(nodes[index]));
    const { volume, gradients } = cellVolumeAndGradients(corners);
    const error = volume - constraint.restVolume;
    let denominator = FORGE_RULES.volumeCompliance;
    for (let index = 0; index < constraint.indices.length; index += 1) {
      const nodeIndex = constraint.indices[index];
      const gradient = gradients[index];
      if (nodeIndex !== undefined && gradient !== undefined && !pinned.has(nodeIndex)) {
        denominator += dot(gradient, gradient);
      }
    }
    if (denominator <= Number.EPSILON) continue;
    const deltaLambda = (-error - FORGE_RULES.volumeCompliance * constraint.lambda) / denominator;
    constraint.lambda += deltaLambda;
    for (let index = 0; index < constraint.indices.length; index += 1) {
      const nodeIndex = constraint.indices[index];
      const gradient = gradients[index];
      if (nodeIndex === undefined || gradient === undefined || pinned.has(nodeIndex)) continue;
      applyCorrection(nodes, nodeIndex, scale(gradient, deltaLambda));
    }
  }
}

function solveAggregateVolumeConstraint(
  nodes: MutableWorkpieceNode[],
  constraints: readonly CellVolumeConstraint[],
  pinned: ReadonlySet<number>,
): void {
  const gradients = new Map<number, Vec3>();
  let volumeError = 0;
  for (const constraint of constraints) {
    const corners = constraint.indices.map((index) => nodeVector(nodes[index]));
    const current = cellVolumeAndGradients(corners);
    volumeError += current.volume - constraint.restVolume;
    for (let corner = 0; corner < constraint.indices.length; corner += 1) {
      const nodeIndex = constraint.indices[corner];
      const gradient = current.gradients[corner];
      if (nodeIndex === undefined || gradient === undefined || pinned.has(nodeIndex)) continue;
      gradients.set(nodeIndex, add(gradients.get(nodeIndex) ?? { x: 0, y: 0, z: 0 }, gradient));
    }
  }
  const denominator = [...gradients.values()].reduce((sum, gradient) => sum + dot(gradient, gradient), 0);
  if (denominator <= Number.EPSILON) return;
  const multiplier = -volumeError / denominator;
  for (const [index, gradient] of gradients) applyCorrection(nodes, index, scale(gradient, multiplier));
}

function solveEdgeConstraints(
  nodes: MutableWorkpieceNode[],
  constraints: readonly EdgeConstraint[],
  pinned: ReadonlySet<number>,
  compliance: number,
): void {
  for (const constraint of constraints) {
    const first = nodeVector(nodes[constraint.first]);
    const second = nodeVector(nodes[constraint.second]);
    const delta = subtract(second, first);
    const length = magnitude(delta);
    if (length <= Number.EPSILON) continue;
    const firstWeight = pinned.has(constraint.first) ? 0 : 1;
    const secondWeight = pinned.has(constraint.second) ? 0 : 1;
    const denominator = firstWeight + secondWeight + compliance;
    if (denominator <= Number.EPSILON) continue;
    const gradient = scale(delta, 1 / length);
    const error = length - constraint.restLength;
    const deltaLambda = (-error - compliance * constraint.lambda) / denominator;
    constraint.lambda += deltaLambda;
    if (firstWeight > 0) applyCorrection(nodes, constraint.first, scale(gradient, -deltaLambda));
    if (secondWeight > 0) applyCorrection(nodes, constraint.second, scale(gradient, deltaLambda));
  }
}

function projectContactSurface(
  nodes: MutableWorkpieceNode[],
  samples: readonly HammerSurfaceSample[],
  contacted: ReadonlySet<number>,
  normal: ReturnType<typeof faceNormal>,
  plane: number,
): void {
  for (const sample of samples) {
    if (!contacted.has(sample.index)) continue;
    const node = nodes[sample.index];
    if (!node) continue;
    const current = orientedCoordinate(node, normal);
    const surface = plane + sample.crownOffset;
    if (current > surface) node[normal.coordinate] = normal.sign * surface;
  }
}

function projectSupportPlane(
  nodes: MutableWorkpieceNode[],
  indices: readonly number[],
  normal: ReturnType<typeof faceNormal>,
  plane: number,
): void {
  for (const index of indices) {
    const node = nodes[index];
    if (!node) continue;
    const current = orientedCoordinate(node, normal);
    if (current > plane) node[normal.coordinate] = normal.sign * plane;
  }
}

function applyContactFriction(
  nodes: MutableWorkpieceNode[],
  original: readonly Vec3[],
  indices: Iterable<number>,
  normal: ReturnType<typeof faceNormal>,
  friction: number,
): void {
  const amount = friction / FORGE_RULES.solverIterations;
  for (const index of indices) {
    const node = nodes[index];
    const start = original[index];
    if (!node || !start) continue;
    node.axialPosition = lerp(node.axialPosition, start.x, amount);
    if (normal.coordinate !== "lateralOffset") node.lateralOffset = lerp(node.lateralOffset, start.y, amount);
    if (normal.coordinate !== "verticalOffset") node.verticalOffset = lerp(node.verticalOffset, start.z, amount);
  }
}

function createCellVolumeConstraints(
  grid: WorkpieceGrid,
  bounds: CellBounds,
): CellVolumeConstraint[] {
  const constraints: CellVolumeConstraint[] = [];
  forEachCell(bounds, (axialIndex, widthIndex, heightIndex) => {
    constraints.push({
      indices: cellNodeIndices(axialIndex, widthIndex, heightIndex, grid),
      restVolume: FORGE_RULES.simulationCellSize ** 3,
      lambda: 0,
    });
  });
  return constraints;
}

function createEdgeConstraints(
  nodes: readonly WorkpieceNode[],
  grid: WorkpieceGrid,
  bounds: CellBounds,
): EdgeConstraint[] {
  const edges = new Map<string, EdgeConstraint>();
  const add = (first: number, second: number) => {
    const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    if (edges.has(key)) return;
    edges.set(key, { first, second, restLength: distance(nodeVector(nodes[first]), nodeVector(nodes[second])), lambda: 0 });
  };
  forEachCell(bounds, (axialIndex, widthIndex, heightIndex) => {
    const n = cellNodeIndices(axialIndex, widthIndex, heightIndex, grid);
    for (const [first, second] of [
      [0, 1], [2, 3], [4, 5], [6, 7],
      [0, 2], [1, 3], [4, 6], [5, 7],
      [0, 4], [1, 5], [2, 6], [3, 7],
      [0, 7], [1, 6], [2, 5], [3, 4],
    ] as const) {
      add(n[first], n[second]);
    }
  });
  return [...edges.values()];
}

function boundaryNodeIndices(
  bounds: CellBounds,
  grid: WorkpieceGrid,
  nodes: readonly WorkpieceNode[],
): Set<number> {
  const pinned = new Set<number>();
  const axialLimit = axialBlockCount(nodes, grid);
  for (let axialIndex = bounds.axialMinimum; axialIndex <= bounds.axialMaximum + 1; axialIndex += 1) {
    for (let widthIndex = bounds.widthMinimum; widthIndex <= bounds.widthMaximum + 1; widthIndex += 1) {
      for (let heightIndex = bounds.heightMinimum; heightIndex <= bounds.heightMaximum + 1; heightIndex += 1) {
        const axialBoundary = (bounds.axialMinimum > 0 && axialIndex === bounds.axialMinimum)
          || (bounds.axialMaximum < axialLimit - 1 && axialIndex === bounds.axialMaximum + 1);
        const widthBoundary = (bounds.widthMinimum > 0 && widthIndex === bounds.widthMinimum)
          || (bounds.widthMaximum < grid.widthBlocks - 1 && widthIndex === bounds.widthMaximum + 1);
        const heightBoundary = (bounds.heightMinimum > 0 && heightIndex === bounds.heightMinimum)
          || (bounds.heightMaximum < grid.heightBlocks - 1 && heightIndex === bounds.heightMaximum + 1);
        if (axialBoundary || widthBoundary || heightBoundary) {
          pinned.add(workpieceNodeIndex(axialIndex, widthIndex, heightIndex, grid));
        }
      }
    }
  }
  return pinned;
}

function hammerSurfaceSamples(
  nodes: readonly WorkpieceNode[],
  grid: WorkpieceGrid,
  bounds: CellBounds,
  target: HammerContactTarget,
  face: StruckFace,
): HammerSurfaceSample[] {
  const samples: HammerSurfaceSample[] = [];
  const halfLength = FORGE_RULES.hammerFaceLength / 2;
  const halfWidth = FORGE_RULES.hammerFaceWidth / 2;
  const surfaceWidth = face === "left" ? 0 : face === "right" ? grid.widthBlocks : null;
  const surfaceHeight = face === "bottom" ? 0 : face === "top" ? grid.heightBlocks : null;
  for (let axialIndex = bounds.axialMinimum; axialIndex <= bounds.axialMaximum + 1; axialIndex += 1) {
    for (let widthIndex = bounds.widthMinimum; widthIndex <= bounds.widthMaximum + 1; widthIndex += 1) {
      for (let heightIndex = bounds.heightMinimum; heightIndex <= bounds.heightMaximum + 1; heightIndex += 1) {
        if (surfaceWidth !== null && widthIndex !== surfaceWidth) continue;
        if (surfaceHeight !== null && heightIndex !== surfaceHeight) continue;
        const index = workpieceNodeIndex(axialIndex, widthIndex, heightIndex, grid);
        const node = nodes[index];
        if (!node) continue;
        const tangent = face === "top" || face === "bottom" ? node.lateralOffset : node.verticalOffset;
        const axialDistance = (node.axialPosition - target.axialPosition) / halfLength;
        const tangentDistance = (tangent - target.tangentPosition) / halfWidth;
        const ellipticalDistanceSquared = axialDistance ** 2 + tangentDistance ** 2;
        if (ellipticalDistanceSquared <= 1 + 0.000_1) samples.push({
          index,
          crownOffset: FORGE_RULES.hammerCrownHeight * ellipticalDistanceSquared,
        });
      }
    }
  }
  return samples;
}

function supportSurfaceNodeIndices(
  nodes: readonly WorkpieceNode[],
  grid: WorkpieceGrid,
  bounds: CellBounds,
  face: StruckFace,
  feedOffset: number,
): number[] {
  const opposite: StruckFace = face === "top" ? "bottom" : face === "bottom" ? "top" : face === "left" ? "right" : "left";
  const indices: number[] = [];
  const surfaceWidth = opposite === "left" ? 0 : opposite === "right" ? grid.widthBlocks : null;
  const surfaceHeight = opposite === "bottom" ? 0 : opposite === "top" ? grid.heightBlocks : null;
  for (let axialIndex = bounds.axialMinimum; axialIndex <= bounds.axialMaximum + 1; axialIndex += 1) {
    for (let widthIndex = bounds.widthMinimum; widthIndex <= bounds.widthMaximum + 1; widthIndex += 1) {
      for (let heightIndex = bounds.heightMinimum; heightIndex <= bounds.heightMaximum + 1; heightIndex += 1) {
        if (surfaceWidth !== null && widthIndex !== surfaceWidth) continue;
        if (surfaceHeight !== null && heightIndex !== surfaceHeight) continue;
        indices.push(workpieceNodeIndex(axialIndex, widthIndex, heightIndex, grid));
      }
    }
  }
  const axial = nodes.map((node) => node.axialPosition);
  const workpieceCenter = (Math.min(...axial) + Math.max(...axial)) / 2;
  return indices.filter((index) => {
    const node = nodes[index];
    if (!node) return false;
    const anvilAxial = node.axialPosition + feedOffset - workpieceCenter;
    const anvilTangent = face === "top" || face === "bottom" ? node.lateralOffset : node.verticalOffset;
    return Math.abs(anvilAxial) <= FORGE_RULES.anvilFaceLength / 2 + 0.000_1
      && Math.abs(anvilTangent) <= FORGE_RULES.anvilFaceWidth / 2 + 0.000_1;
  });
}

function activeBoundsFor(
  cells: readonly { readonly sectionIndex: number; readonly widthIndex: number; readonly heightIndex: number }[],
  face: StruckFace,
  sectionCount: number,
  grid: WorkpieceGrid,
): CellBounds {
  const margin = FORGE_RULES.activeMarginCells;
  const axial = cells.map((cell) => cell.sectionIndex);
  const width = cells.map((cell) => cell.widthIndex);
  const height = cells.map((cell) => cell.heightIndex);
  return {
    axialMinimum: clamp(Math.min(...axial) - margin, 0, sectionCount - 1),
    axialMaximum: clamp(Math.max(...axial) + margin, 0, sectionCount - 1),
    widthMinimum: face === "top" || face === "bottom" ? clamp(Math.min(...width) - margin, 0, grid.widthBlocks - 1) : 0,
    widthMaximum: face === "top" || face === "bottom" ? clamp(Math.max(...width) + margin, 0, grid.widthBlocks - 1) : grid.widthBlocks - 1,
    heightMinimum: face === "left" || face === "right" ? clamp(Math.min(...height) - margin, 0, grid.heightBlocks - 1) : 0,
    heightMaximum: face === "left" || face === "right" ? clamp(Math.max(...height) + margin, 0, grid.heightBlocks - 1) : grid.heightBlocks - 1,
  };
}

function findContactCells(
  sections: readonly (BladeSection | ForgeSnapshotSection)[],
  target: HammerContactTarget,
  face: StruckFace,
  grid: WorkpieceGrid,
) {
  return sections.flatMap((section, sectionIndex) => section.blocks
    .filter((block) => isSurfaceBlock(block, face, grid) && footprintWeight(section, block, target, face) > 0)
    .map((block) => ({ sectionIndex, widthIndex: block.widthIndex, heightIndex: block.heightIndex })));
}

function createWorkpieceNodes(sectionCount: number, grid: WorkpieceGrid): readonly WorkpieceNode[] {
  const width = FORGE_RULES.initialSectionWidth / grid.widthBlocks;
  const height = FORGE_RULES.initialSectionThickness / grid.heightBlocks;
  const nodes: WorkpieceNode[] = [];
  for (let axialIndex = 0; axialIndex <= sectionCount; axialIndex += 1) {
    for (let heightIndex = 0; heightIndex <= grid.heightBlocks; heightIndex += 1) {
      for (let widthIndex = 0; widthIndex <= grid.widthBlocks; widthIndex += 1) {
        nodes.push({
          axialIndex,
          widthIndex,
          heightIndex,
          axialPosition: axialIndex * FORGE_RULES.initialSectionLength,
          lateralOffset: (widthIndex - grid.widthBlocks / 2) * width,
          verticalOffset: (heightIndex - grid.heightBlocks / 2) * height,
        });
      }
    }
  }
  return nodes;
}

function createSection(
  sectionIndex: number,
  nodes: readonly WorkpieceNode[],
  grid: WorkpieceGrid,
): BladeSection {
  const blocks = Array.from({ length: grid.widthBlocks * grid.heightBlocks }, (_, blockIndex): BladeBlock => {
    const widthIndex = blockIndex % grid.widthBlocks;
    const heightIndex = Math.floor(blockIndex / grid.widthBlocks);
    const initial: BladeBlock = {
      widthIndex,
      heightIndex,
      length: FORGE_RULES.initialSectionLength,
      width: FORGE_RULES.simulationCellSize,
      thickness: FORGE_RULES.simulationCellSize,
      volume: FORGE_RULES.simulationCellSize ** 3,
      temperatureC: FORGE_RULES.ambientTemperatureC,
      plasticity: 0,
      stress: 0,
      plasticStrain: 0,
      damage: 0,
      integrity: 1,
      thermalDamage: 0,
      verticalOffset: 0,
      lateralOffset: 0,
      cracked: false,
      overheated: false,
    };
    return deriveBlockGeometry(initial, sectionIndex, nodes, grid);
  });
  return summarizeSection({
    position: sectionIndex * FORGE_RULES.initialSectionLength + FORGE_RULES.initialSectionLength / 2,
    length: FORGE_RULES.initialSectionLength,
    width: FORGE_RULES.initialSectionWidth,
    thickness: FORGE_RULES.initialSectionThickness,
    temperatureC: FORGE_RULES.ambientTemperatureC,
    plasticity: 0,
    stress: 0,
    plasticStrain: 0,
    damage: 0,
    integrity: 1,
    thermalDamage: 0,
    verticalOffset: 0,
    lateralOffset: 0,
    cracked: false,
    overheated: false,
    blocks,
  }, sectionIndex, nodes, grid);
}

function deriveBlockGeometry(
  block: BladeBlock,
  sectionIndex: number,
  nodes: readonly WorkpieceNode[],
  grid: WorkpieceGrid,
): BladeBlock {
  const corners = cellNodeIndices(sectionIndex, block.widthIndex, block.heightIndex, grid).map((index) => nodes[index]);
  if (corners.some((node) => node === undefined)) throw new Error("Missing node while deriving block geometry.");
  const axial = corners.map((node) => node?.axialPosition ?? 0);
  const lateral = corners.map((node) => node?.lateralOffset ?? 0);
  const vertical = corners.map((node) => node?.verticalOffset ?? 0);
  return {
    ...block,
    length: Math.max(...axial) - Math.min(...axial),
    width: Math.max(...lateral) - Math.min(...lateral),
    thickness: Math.max(...vertical) - Math.min(...vertical),
    lateralOffset: average(lateral),
    verticalOffset: average(vertical),
  };
}

function summarizeSection(
  section: BladeSection,
  sectionIndex: number,
  nodes: readonly WorkpieceNode[],
  grid: WorkpieceGrid,
): BladeSection {
  const sectionNodes: WorkpieceNode[] = [];
  for (let axialIndex = sectionIndex; axialIndex <= sectionIndex + 1; axialIndex += 1) {
    for (let heightIndex = 0; heightIndex <= grid.heightBlocks; heightIndex += 1) {
      for (let widthIndex = 0; widthIndex <= grid.widthBlocks; widthIndex += 1) {
        const node = nodes[workpieceNodeIndex(axialIndex, widthIndex, heightIndex, grid)];
        if (node) sectionNodes.push(node);
      }
    }
  }
  const total = section.blocks.reduce((sum, block) => sum + block.volume, 0);
  const weighted = (value: (block: BladeBlock) => number) => section.blocks.reduce(
    (sum, block) => sum + value(block) * block.volume,
    0,
  ) / total;
  const axial = sectionNodes.map((node) => node.axialPosition);
  const lateral = sectionNodes.map((node) => node.lateralOffset);
  const vertical = sectionNodes.map((node) => node.verticalOffset);
  return {
    ...section,
    position: (Math.min(...axial) + Math.max(...axial)) / 2,
    length: Math.max(...axial) - Math.min(...axial),
    width: Math.max(...lateral) - Math.min(...lateral),
    thickness: Math.max(...vertical) - Math.min(...vertical),
    temperatureC: weighted((block) => block.temperatureC),
    plasticity: weighted((block) => block.plasticity),
    stress: weighted((block) => block.stress),
    plasticStrain: weighted((block) => block.plasticStrain),
    damage: weighted((block) => block.damage),
    integrity: Math.min(...section.blocks.map((block) => block.integrity)),
    thermalDamage: weighted((block) => block.thermalDamage),
    verticalOffset: (Math.min(...vertical) + Math.max(...vertical)) / 2,
    lateralOffset: (Math.min(...lateral) + Math.max(...lateral)) / 2,
    cracked: section.blocks.some((block) => block.cracked),
    overheated: section.blocks.some((block) => block.overheated),
  };
}

function updateHammerState(
  before: BladeBlock,
  geometry: BladeBlock,
  operation: HammerOperation,
  impactWeight: number,
  material: ForgeMaterial,
  neighbourStrain: number,
): BladeBlock {
  const geometricStrain = average([
    Math.abs(Math.log(Math.max(geometry.length, 0.001) / Math.max(before.length, 0.001))),
    Math.abs(Math.log(Math.max(geometry.width, 0.001) / Math.max(before.width, 0.001))),
    Math.abs(Math.log(Math.max(geometry.thickness, 0.001) / Math.max(before.thickness, 0.001))),
  ]);
  const stressIncrease = impactWeight * operation.energy * material.coldStressMultiplier * lerp(
    FORGE_RULES.hotStressAtFullEnergy,
    FORGE_RULES.coldStressAtFullEnergy,
    1 - before.plasticity,
  );
  const stress = before.stress + stressIncrease;
  const plasticStrain = before.plasticStrain + geometricStrain * FORGE_RULES.plasticStrainPerCompression;
  const localisation = clamp((plasticStrain - neighbourStrain) / FORGE_RULES.localisationStrainRange, 0, 1);
  const thinness = clamp((FORGE_RULES.simulationCellSize - geometry.thickness) / FORGE_RULES.simulationCellSize, 0, 1);
  const coldness = (1 - before.plasticity) ** 3;
  const damageIncrease = impactWeight * operation.energy * coldness * (
    FORGE_RULES.coldImpactDamage
    + localisation * FORGE_RULES.localisationDamage
    + thinness * FORGE_RULES.thinSectionDamage
  ) * (1 + before.thermalDamage) / material.damageResistance;
  const damage = clamp(before.damage + damageIncrease, 0, 1);
  const integrity = Math.max(0, 1 - damage);
  return {
    ...geometry,
    stress,
    plasticStrain,
    damage,
    integrity,
    cracked: before.cracked || integrity <= FORGE_RULES.crackIntegrityThreshold,
  };
}

function applyHeat(
  section: BladeSection,
  sectionIndex: number,
  nodes: readonly WorkpieceNode[],
  temperatureC: number,
  material: ForgeMaterial,
  grid: WorkpieceGrid,
): BladeSection {
  const blocks = section.blocks.map((block) => {
    const plasticity = calculatePlasticity(temperatureC, material);
    const overheatRatio = clamp((temperatureC - material.overheatTemperatureC) / (1300 - material.overheatTemperatureC), 0, 1);
    const thermalDamage = clamp(block.thermalDamage + overheatRatio * FORGE_RULES.overheatDamagePerHeat, 0, 1);
    return {
      ...block,
      temperatureC,
      plasticity,
      stress: block.stress * (1 - plasticity * material.stressRecoveryAtPeak),
      thermalDamage,
      overheated: block.overheated || thermalDamage > 0,
    };
  });
  return summarizeSection({ ...section, blocks }, sectionIndex, nodes, grid);
}

function sectionSnapshot(section: BladeSection): ForgeSnapshotSection {
  return {
    position: section.position,
    length: section.length,
    width: section.width,
    thickness: section.thickness,
    temperatureC: section.temperatureC,
    plasticity: section.plasticity,
    thermalDamage: section.thermalDamage,
    damage: section.damage,
    verticalOffset: section.verticalOffset,
    lateralOffset: section.lateralOffset,
    cracked: section.cracked,
    overheated: section.overheated,
    blocks: section.blocks.map((block): ForgeSnapshotBlock => ({
      widthIndex: block.widthIndex,
      heightIndex: block.heightIndex,
      length: block.length,
      width: block.width,
      thickness: block.thickness,
      volume: block.volume,
      temperatureC: block.temperatureC,
      plasticity: block.plasticity,
      thermalDamage: block.thermalDamage,
      damage: block.damage,
      verticalOffset: block.verticalOffset,
      lateralOffset: block.lateralOffset,
      cracked: block.cracked,
      overheated: block.overheated,
    })),
  };
}

function appendOperation(state: ForgeState, operation: ForgeOperation): ForgeState {
  return { ...state, operations: [...state.operations, { ...operation }] };
}

function cloneStateWithoutOperations(state: ForgeState): ForgeState {
  return {
    ...state,
    material: { ...state.material },
    workpiece: {
      ...state.workpiece,
      grid: { ...state.workpiece.grid },
      nodes: state.workpiece.nodes.map((node) => ({ ...node })),
      sections: state.workpiece.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({ ...block })),
      })),
      joints: state.workpiece.joints.map((joint) => ({ ...joint, workpieceIds: [...joint.workpieceIds] })),
    },
    operations: [],
  };
}

function contactTargetFor(
  section: BladeSection | ForgeSnapshotSection,
  face: StruckFace,
  faceBias: number,
): HammerContactTarget {
  const tangentMinimum = face === "top" || face === "bottom"
    ? section.lateralOffset - section.width / 2
    : section.verticalOffset - section.thickness / 2;
  const tangentMaximum = face === "top" || face === "bottom"
    ? section.lateralOffset + section.width / 2
    : section.verticalOffset + section.thickness / 2;
  return {
    axialPosition: section.position,
    tangentPosition: lerp(tangentMinimum, tangentMaximum, faceBias),
  };
}

function footprintWeight(
  section: Pick<BladeSection | ForgeSnapshotSection, "position" | "length">,
  block: Pick<BladeBlock | ForgeSnapshotBlock, "width" | "thickness" | "lateralOffset" | "verticalOffset">,
  target: HammerContactTarget,
  face: StruckFace,
): number {
  const hitsThickness = face === "top" || face === "bottom";
  const axialDistance = distanceToInterval(target.axialPosition, section.position, section.length)
    / (FORGE_RULES.hammerFaceLength / 2);
  const tangentDistance = distanceToInterval(
    target.tangentPosition,
    hitsThickness ? block.lateralOffset : block.verticalOffset,
    hitsThickness ? block.width : block.thickness,
  ) / (FORGE_RULES.hammerFaceWidth / 2);
  return crownedHammerPressure(
    Math.sqrt(axialDistance ** 2 + tangentDistance ** 2),
  );
}

function blockImpactWeight(
  section: BladeSection,
  block: BladeBlock,
  target: HammerContactTarget,
  face: StruckFace,
): number {
  const footprint = footprintWeight(section, block, target, face);
  if (footprint === 0) return 0;
  const depthIndex = face === "top" ? FORGE_RULES.crossSectionHeightBlocks - 1 - block.heightIndex
    : face === "bottom" ? block.heightIndex
      : face === "left" ? block.widthIndex
        : FORGE_RULES.crossSectionWidthBlocks - 1 - block.widthIndex;
  const depthCount = face === "top" || face === "bottom"
    ? FORGE_RULES.crossSectionHeightBlocks
    : FORGE_RULES.crossSectionWidthBlocks;
  return footprint * lerp(1, 0.28, depthIndex / Math.max(1, depthCount - 1));
}

function isSurfaceBlock(block: Pick<BladeBlock | ForgeSnapshotBlock, "widthIndex" | "heightIndex">, face: StruckFace, grid: WorkpieceGrid): boolean {
  return face === "top" ? block.heightIndex === grid.heightBlocks - 1
    : face === "bottom" ? block.heightIndex === 0
      : face === "left" ? block.widthIndex === 0
        : block.widthIndex === grid.widthBlocks - 1;
}

function crownedHammerPressure(normalizedDistance: number): number {
  if (normalizedDistance >= 1) return 0;
  const halfMinimum = Math.min(FORGE_RULES.hammerFaceLength, FORGE_RULES.hammerFaceWidth) / 2;
  const transitionStart = 1 - FORGE_RULES.hammerEdgeTransition / halfMinimum;
  if (normalizedDistance <= transitionStart) {
    return lerp(1, 0.72, normalizedDistance / Math.max(transitionStart, Number.EPSILON));
  }
  const progress = (normalizedDistance - transitionStart) / Math.max(1 - transitionStart, Number.EPSILON);
  return 0.72 * (1 - progress * progress * (3 - 2 * progress));
}

function distanceToInterval(target: number, center: number, size: number): number {
  return Math.max(0, Math.abs(target - center) - size / 2);
}

function struckFaceForOrientation(orientationQuarterTurns: 0 | 1 | 2 | 3): StruckFace {
  return orientationQuarterTurns === 0 ? "top"
    : orientationQuarterTurns === 1 ? "left"
      : orientationQuarterTurns === 2 ? "bottom"
        : "right";
}

function faceNormal(face: StruckFace): { readonly coordinate: "lateralOffset" | "verticalOffset"; readonly sign: -1 | 1 } {
  return face === "top" ? { coordinate: "verticalOffset", sign: 1 }
    : face === "bottom" ? { coordinate: "verticalOffset", sign: -1 }
      : face === "left" ? { coordinate: "lateralOffset", sign: -1 }
        : { coordinate: "lateralOffset", sign: 1 };
}

function orientedCoordinate(
  node: WorkpieceNode | undefined,
  normal: { readonly coordinate: "lateralOffset" | "verticalOffset"; readonly sign: number },
): number {
  if (!node) throw new Error("Missing contact node.");
  return node[normal.coordinate] * normal.sign;
}

function workpieceNodeIndex(axialIndex: number, widthIndex: number, heightIndex: number, grid: WorkpieceGrid): number {
  const planeSize = (grid.widthBlocks + 1) * (grid.heightBlocks + 1);
  return axialIndex * planeSize + heightIndex * (grid.widthBlocks + 1) + widthIndex;
}

function cellNodeIndices(axialIndex: number, widthIndex: number, heightIndex: number, grid: WorkpieceGrid) {
  const at = (axial: number, width: number, height: number) => workpieceNodeIndex(axial, width, height, grid);
  return [
    at(axialIndex, widthIndex, heightIndex),
    at(axialIndex + 1, widthIndex, heightIndex),
    at(axialIndex, widthIndex + 1, heightIndex),
    at(axialIndex + 1, widthIndex + 1, heightIndex),
    at(axialIndex, widthIndex, heightIndex + 1),
    at(axialIndex + 1, widthIndex, heightIndex + 1),
    at(axialIndex, widthIndex + 1, heightIndex + 1),
    at(axialIndex + 1, widthIndex + 1, heightIndex + 1),
  ] as const;
}

function forEachCell(bounds: CellBounds, visit: (axial: number, width: number, height: number) => void): void {
  for (let axial = bounds.axialMinimum; axial <= bounds.axialMaximum; axial += 1) {
    for (let width = bounds.widthMinimum; width <= bounds.widthMaximum; width += 1) {
      for (let height = bounds.heightMinimum; height <= bounds.heightMaximum; height += 1) visit(axial, width, height);
    }
  }
}

function nodeVector(node: WorkpieceNode | undefined): Vec3 {
  if (!node) throw new Error("Missing workpiece node.");
  return { x: node.axialPosition, y: node.lateralOffset, z: node.verticalOffset };
}

function applyCorrection(nodes: MutableWorkpieceNode[], index: number, correction: Vec3): void {
  const node = nodes[index];
  if (!node) return;
  const maximum = FORGE_RULES.maximumNodeCorrection;
  node.axialPosition += clamp(correction.x, -maximum, maximum);
  node.lateralOffset += clamp(correction.y, -maximum, maximum);
  node.verticalOffset += clamp(correction.z, -maximum, maximum);
}

function signedTetraVolume(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function tetraVolumeGradients(a: Vec3, b: Vec3, c: Vec3, d: Vec3): readonly [Vec3, Vec3, Vec3, Vec3] {
  const gb = scale(cross(subtract(c, a), subtract(d, a)), 1 / 6);
  const gc = scale(cross(subtract(d, a), subtract(b, a)), 1 / 6);
  const gd = scale(cross(subtract(b, a), subtract(c, a)), 1 / 6);
  return [scale(add(add(gb, gc), gd), -1), gb, gc, gd];
}

function cellVolumeAndGradients(corners: readonly Vec3[]): { readonly volume: number; readonly gradients: readonly Vec3[] } {
  const gradients = Array.from({ length: 8 }, (): Vec3 => ({ x: 0, y: 0, z: 0 }));
  let volume = 0;
  for (const tetrahedron of CELL_TETRAHEDRA) {
    const [a, b, c, d] = tetrahedron.map((corner) => corners[corner]);
    if (!a || !b || !c || !d) throw new Error("Missing cell corner during volume solve.");
    volume += signedTetraVolume(a, b, c, d);
    const tetraGradients = tetraVolumeGradients(a, b, c, d);
    for (let index = 0; index < tetrahedron.length; index += 1) {
      const cornerIndex = tetrahedron[index];
      const current = cornerIndex === undefined ? undefined : gradients[cornerIndex];
      const contribution = tetraGradients[index];
      if (cornerIndex !== undefined && current && contribution) gradients[cornerIndex] = add(current, contribution);
    }
  }
  return { volume, gradients };
}

function neighbourPlasticStrain(state: ForgeState, sectionIndex: number, block: BladeBlock): number {
  const neighbours = [
    blockAt(state, sectionIndex - 1, block.widthIndex, block.heightIndex),
    blockAt(state, sectionIndex + 1, block.widthIndex, block.heightIndex),
    blockAt(state, sectionIndex, block.widthIndex - 1, block.heightIndex),
    blockAt(state, sectionIndex, block.widthIndex + 1, block.heightIndex),
    blockAt(state, sectionIndex, block.widthIndex, block.heightIndex - 1),
    blockAt(state, sectionIndex, block.widthIndex, block.heightIndex + 1),
  ].filter((candidate): candidate is BladeBlock => candidate !== undefined);
  return neighbours.length === 0 ? 0 : average(neighbours.map((neighbour) => neighbour.plasticStrain));
}

function blockAt(state: ForgeState, sectionIndex: number, widthIndex: number, heightIndex: number) {
  return state.workpiece.sections[sectionIndex]?.blocks.find(
    (block) => block.widthIndex === widthIndex && block.heightIndex === heightIndex,
  );
}

function axialBlockCount(nodes: readonly WorkpieceNode[], grid: WorkpieceGrid): number {
  return nodes.length / ((grid.widthBlocks + 1) * (grid.heightBlocks + 1)) - 1;
}

function rotate(current: 0 | 1 | 2 | 3, quarterTurns: 1 | -1): 0 | 1 | 2 | 3 {
  return ((current + quarterTurns + 4) % 4) as 0 | 1 | 2 | 3;
}

function clampFeedOffset(feedOffset: number, nodes: readonly WorkpieceNode[]): number {
  const axial = nodes.map((node) => node.axialPosition);
  return clamp(feedOffset, -(Math.max(...axial) - Math.min(...axial)) / 2, (Math.max(...axial) - Math.min(...axial)) / 2);
}

function assertTemperature(temperatureC: number): void {
  if (!Number.isFinite(temperatureC) || temperatureC < FORGE_RULES.ambientTemperatureC || temperatureC > 1300) {
    throw new Error("Heat temperature must be between ambient temperature and 1300C.");
  }
}

function assertMaterial(material: ForgeMaterial): void {
  if (!material.id || material.hotWorkability <= 0 || material.hotWorkability > 1 || material.coldStressMultiplier <= 0 || material.damageResistance <= 0) {
    throw new Error("Material workability values must be positive and hot workability at most one.");
  }
  if (material.plasticityStartC < FORGE_RULES.ambientTemperatureC || material.plasticityPeakC <= material.plasticityStartC
    || material.overheatTemperatureC <= material.plasticityPeakC || material.overheatTemperatureC >= 1300) {
    throw new Error("Material temperature windows must be ordered inside the simulation range.");
  }
  if (material.stressRecoveryAtPeak < 0 || material.stressRecoveryAtPeak > 1) {
    throw new Error("Material peak stress recovery must be between zero and one.");
  }
}

function assertHammerOperation(state: ForgeState, operation: HammerOperation): void {
  assertHammerTarget(state.workpiece.sections, operation);
  if (operation.lateralBias !== -1 && operation.lateralBias !== 0 && operation.lateralBias !== 1) {
    throw new Error("Hammer lateral bias must be -1, 0, or 1.");
  }
}

function assertHammerTarget(
  sections: readonly (BladeSection | ForgeSnapshotSection)[],
  operation: Pick<HammerOperation, "sectionIndex" | "energy" | "faceBias">,
): void {
  if (!Number.isInteger(operation.sectionIndex) || operation.sectionIndex < 0 || operation.sectionIndex >= sections.length) {
    throw new Error("Hammer target must be an existing section.");
  }
  if (!Number.isFinite(operation.energy) || operation.energy <= 0 || operation.energy > 1) {
    throw new Error("Hammer energy must be greater than zero and at most one.");
  }
  if (operation.faceBias !== undefined && (!Number.isFinite(operation.faceBias) || operation.faceBias < 0 || operation.faceBias > 1)) {
    throw new Error("Hammer face bias must be between zero and one.");
  }
}

function assertQuarterTurns(quarterTurns: number): void {
  if (quarterTurns !== -1 && quarterTurns !== 1) throw new Error("Rotation must be exactly one quarter turn in either direction.");
}

function assertFeedStep(step: number): void {
  if (step !== -1 && step !== 1) throw new Error("Feed must move exactly one step in either direction.");
}

function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(value: Vec3, amount: number): Vec3 { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function magnitude(value: Vec3): number { return Math.sqrt(dot(value, value)); }
function distance(a: Vec3, b: Vec3): number { return magnitude(subtract(a, b)); }
function average(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function lerp(start: number, end: number, amount: number): number { return start + (end - start) * amount; }
function roundWeight(value: number): number { return Math.round(value * 1_000) / 1_000; }

import { DEFAULT_FORGE_MATERIAL, FORGE_PARAMETER_VERSION, FORGE_RULES } from "./forge-rules.ts";
import type {
  BladeBlock,
  BladeSection,
  ForgeIntent,
  ForgeMaterial,
  ForgeOperation,
  ForgeSnapshot,
  ForgeState,
  HammerOperation,
  WorkpieceGrid,
} from "./forge-types.ts";

export interface CreateForgeStateOptions {
  readonly material?: ForgeMaterial;
  readonly sectionCount?: number;
}

type StruckFace = "top" | "bottom" | "left" | "right";

interface BlockTarget {
  readonly widthIndex: number;
  readonly heightIndex: number;
}

const DEFAULT_GRID: WorkpieceGrid = {
  widthBlocks: FORGE_RULES.crossSectionWidthBlocks,
  heightBlocks: FORGE_RULES.crossSectionHeightBlocks,
};

export function createForgeState(options: CreateForgeStateOptions = {}): ForgeState {
  const sectionCount = options.sectionCount ?? FORGE_RULES.defaultSectionCount;
  if (!Number.isInteger(sectionCount) || sectionCount < 3) {
    throw new Error("A forge workpiece needs at least three sections.");
  }

  const material = options.material ?? DEFAULT_FORGE_MATERIAL;
  assertMaterial(material);
  const sections = Array.from({ length: sectionCount }, (_, index) => createSection(index, DEFAULT_GRID));
  return {
    parameterVersion: FORGE_PARAMETER_VERSION,
    phase: "forging",
    material: { ...material },
    workpiece: {
      id: "workpiece-0",
      orientationQuarterTurns: 0,
      feedOffset: 0,
      grid: { ...DEFAULT_GRID },
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
          sections: state.workpiece.sections.map((section) => applyHeat(section, operation.temperatureC, state.material)),
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
            state.workpiece.sections,
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
    hasCracks: state.workpiece.sections.some((section) => section.cracked),
    hasOverheatedSections: state.workpiece.sections.some((section) => section.overheated),
    sections: state.workpiece.sections.map((section) => ({
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
      blocks: section.blocks.map((block) => ({
        widthIndex: block.widthIndex,
        heightIndex: block.heightIndex,
        length: block.length,
        width: block.width,
        thickness: block.thickness,
        temperatureC: block.temperatureC,
        plasticity: block.plasticity,
        thermalDamage: block.thermalDamage,
        damage: block.damage,
        verticalOffset: block.verticalOffset,
        lateralOffset: block.lateralOffset,
        cracked: block.cracked,
        overheated: block.overheated,
      })),
    })),
  };
}

export function totalVolume(state: ForgeState): number {
  return state.workpiece.sections.reduce(
    (total, section) => total + section.blocks.reduce((sectionTotal, block) => sectionTotal + blockVolume(block), 0),
    0,
  );
}

export function calculatePlasticity(temperatureC: number, material: ForgeMaterial = DEFAULT_FORGE_MATERIAL): number {
  const range = material.plasticityPeakC - material.plasticityStartC;
  return clamp((temperatureC - material.plasticityStartC) / range, 0, 1) * material.hotWorkability;
}

function applyHammer(state: ForgeState, operation: HammerOperation): ForgeState {
  assertHammerOperation(state, operation);
  const struckFace = struckFaceForOrientation(state.workpiece.orientationQuarterTurns);
  const target = blockTargetFor(struckFace, operation.faceBias ?? 0.5, state.workpiece.grid);
  const sections = state.workpiece.sections.map((section, sectionIndex) => {
    const lengthInfluence = hammerKernel(sectionIndex - operation.sectionIndex);
    if (lengthInfluence === 0) {
      return section;
    }

    const deformedBlocks = section.blocks.map((block) => {
      const crossSectionInfluence = blockKernel(block, target, struckFace);
      if (crossSectionInfluence === 0) {
        return block;
      }
      return hammerBlock(
        block,
        operation,
        lengthInfluence * crossSectionInfluence,
        struckFace,
        state.material,
        neighbourPlasticStrain(state, sectionIndex, block),
      );
    });
    const blocks = repackBlocks(section.blocks, deformedBlocks, struckFace, state.workpiece.grid);
    return summarizeSection({ ...section, blocks });
  });

  return {
    ...state,
    workpiece: { ...state.workpiece, sections: repositionSections(sections) },
  };
}

function hammerBlock(
  block: BladeBlock,
  operation: HammerOperation,
  influence: number,
  struckFace: StruckFace,
  material: ForgeMaterial,
  neighbourStrain: number,
): BladeBlock {
  const deformation = operation.energy * influence * (
    FORGE_RULES.deformationAtZeroPlasticity
    + (FORGE_RULES.deformationAtFullPlasticity - FORGE_RULES.deformationAtZeroPlasticity) * block.plasticity
  );
  const compression = Math.min(FORGE_RULES.maxCompressionPerHit, deformation);
  const hitsThickness = struckFace === "top" || struckFace === "bottom";
  const originalNormalDimension = hitsThickness ? block.thickness : block.width;
  const compressedDimension = originalNormalDimension * (1 - compression);
  const length = block.length * (1 + compression * FORGE_RULES.lengthShareOfSpread);
  const spreadDimension = blockVolume(block) / (compressedDimension * length);
  const surfaceDisplacement = (originalNormalDimension - compressedDimension) / 2;
  const stressIncrease = operation.energy * influence * material.coldStressMultiplier * (
    FORGE_RULES.hotStressAtFullEnergy
    + (FORGE_RULES.coldStressAtFullEnergy - FORGE_RULES.hotStressAtFullEnergy) * (1 - block.plasticity)
  );
  const stress = block.stress + stressIncrease;
  const plasticStrain = block.plasticStrain + compression * FORGE_RULES.plasticStrainPerCompression;
  const localisation = clamp((plasticStrain - neighbourStrain) / FORGE_RULES.localisationStrainRange, 0, 1);
  const thinness = clamp(
    (FORGE_RULES.initialSectionThickness / DEFAULT_GRID.heightBlocks - block.thickness)
      / (FORGE_RULES.initialSectionThickness / DEFAULT_GRID.heightBlocks),
    0,
    1,
  );
  const coldness = (1 - block.plasticity) ** 3;
  const damageIncrease = operation.energy * influence * coldness * (
    FORGE_RULES.coldImpactDamage
    + localisation * FORGE_RULES.localisationDamage
    + thinness * FORGE_RULES.thinSectionDamage
  ) * (1 + block.thermalDamage) / material.damageResistance;
  const damage = clamp(block.damage + damageIncrease, 0, 1);
  const integrity = Math.max(0, 1 - damage);

  return {
    ...block,
    width: hitsThickness ? spreadDimension : compressedDimension,
    thickness: hitsThickness ? compressedDimension : spreadDimension,
    length,
    stress,
    plasticStrain,
    damage,
    integrity,
    verticalOffset: block.verticalOffset + verticalShiftForFace(struckFace, surfaceDisplacement),
    lateralOffset: block.lateralOffset
      + lateralShiftForFace(struckFace, surfaceDisplacement)
      + operation.lateralBias * operation.energy * influence * block.plasticity * FORGE_RULES.lateralBendAtFullEnergy,
    cracked: block.cracked || integrity <= FORGE_RULES.crackIntegrityThreshold,
  };
}

function applyHeat(section: BladeSection, temperatureC: number, material: ForgeMaterial): BladeSection {
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
  return summarizeSection({ ...section, blocks });
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
      sections: state.workpiece.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({ ...block })),
      })),
      joints: state.workpiece.joints.map((joint) => ({ ...joint, workpieceIds: [...joint.workpieceIds] })),
    },
    operations: [],
  };
}

function createSection(index: number, grid: WorkpieceGrid): BladeSection {
  const blockWidth = FORGE_RULES.initialSectionWidth / grid.widthBlocks;
  const blockThickness = FORGE_RULES.initialSectionThickness / grid.heightBlocks;
  const blocks = Array.from({ length: grid.widthBlocks * grid.heightBlocks }, (_, blockIndex): BladeBlock => {
    const widthIndex = blockIndex % grid.widthBlocks;
    const heightIndex = Math.floor(blockIndex / grid.widthBlocks);
    return {
      widthIndex,
      heightIndex,
      length: FORGE_RULES.initialSectionLength,
      width: blockWidth,
      thickness: blockThickness,
      temperatureC: FORGE_RULES.ambientTemperatureC,
      plasticity: 0,
      stress: 0,
      plasticStrain: 0,
      damage: 0,
      integrity: 1,
      thermalDamage: 0,
      verticalOffset: (heightIndex - (grid.heightBlocks - 1) / 2) * blockThickness,
      lateralOffset: (widthIndex - (grid.widthBlocks - 1) / 2) * blockWidth,
      cracked: false,
      overheated: false,
    };
  });
  return summarizeSection({
    position: index * FORGE_RULES.initialSectionLength,
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
  });
}

function summarizeSection(section: BladeSection): BladeSection {
  const total = section.blocks.reduce((sum, block) => sum + blockVolume(block), 0);
  const weighted = (value: (block: BladeBlock) => number) => section.blocks.reduce(
    (sum, block) => sum + value(block) * blockVolume(block),
    0,
  ) / total;
  const minimumLateral = Math.min(...section.blocks.map((block) => block.lateralOffset - block.width / 2));
  const maximumLateral = Math.max(...section.blocks.map((block) => block.lateralOffset + block.width / 2));
  const minimumVertical = Math.min(...section.blocks.map((block) => block.verticalOffset - block.thickness / 2));
  const maximumVertical = Math.max(...section.blocks.map((block) => block.verticalOffset + block.thickness / 2));
  return {
    ...section,
    length: weighted((block) => block.length),
    width: maximumLateral - minimumLateral,
    thickness: maximumVertical - minimumVertical,
    temperatureC: weighted((block) => block.temperatureC),
    plasticity: weighted((block) => block.plasticity),
    stress: weighted((block) => block.stress),
    plasticStrain: weighted((block) => block.plasticStrain),
    damage: weighted((block) => block.damage),
    integrity: Math.min(...section.blocks.map((block) => block.integrity)),
    thermalDamage: weighted((block) => block.thermalDamage),
    verticalOffset: (minimumVertical + maximumVertical) / 2,
    lateralOffset: (minimumLateral + maximumLateral) / 2,
    cracked: section.blocks.some((block) => block.cracked),
    overheated: section.blocks.some((block) => block.overheated),
  };
}

function blockTargetFor(face: StruckFace, faceBias: number, grid: WorkpieceGrid): BlockTarget {
  if (face === "top" || face === "bottom") {
    return {
      widthIndex: Math.round(faceBias * (grid.widthBlocks - 1)),
      heightIndex: face === "top" ? grid.heightBlocks - 1 : 0,
    };
  }
  return {
    widthIndex: face === "right" ? grid.widthBlocks - 1 : 0,
    heightIndex: Math.round(faceBias * (grid.heightBlocks - 1)),
  };
}

function blockKernel(block: BladeBlock, target: BlockTarget, face: StruckFace): number {
  const depth = face === "top"
    ? target.heightIndex - block.heightIndex
    : face === "bottom"
      ? block.heightIndex - target.heightIndex
      : face === "left"
        ? block.widthIndex - target.widthIndex
        : target.widthIndex - block.widthIndex;
  const depthInfluence = FORGE_RULES.throughThicknessKernel[depth] ?? 0;
  if (depthInfluence === 0) return 0;
  const tangentDistance = face === "top" || face === "bottom"
    ? Math.abs(block.widthIndex - target.widthIndex)
    : Math.abs(block.heightIndex - target.heightIndex);
  if (tangentDistance === 0) {
    return depthInfluence;
  }
  return tangentDistance === 1 ? depthInfluence * FORGE_RULES.adjacentBlockInfluence : 0;
}

function repackBlocks(
  before: readonly BladeBlock[],
  after: readonly BladeBlock[],
  face: StruckFace,
  grid: WorkpieceGrid,
): readonly BladeBlock[] {
  const packed = new Map<string, BladeBlock>();
  const store = (block: BladeBlock) => packed.set(`${block.widthIndex}:${block.heightIndex}`, block);

  if (face === "top" || face === "bottom") {
    for (let widthIndex = 0; widthIndex < grid.widthBlocks; widthIndex += 1) {
      const originalColumn = blocksInColumn(before, widthIndex);
      const nextColumn = blocksInColumn(after, widthIndex);
      if (face === "top") {
        let cursor = Math.min(...originalColumn.map((block) => block.verticalOffset - block.thickness / 2));
        nextColumn.forEach((block) => {
          const next = { ...block, verticalOffset: cursor + block.thickness / 2 };
          cursor += block.thickness;
          store(next);
        });
      } else {
        let cursor = Math.max(...originalColumn.map((block) => block.verticalOffset + block.thickness / 2));
        [...nextColumn].reverse().forEach((block) => {
          const next = { ...block, verticalOffset: cursor - block.thickness / 2 };
          cursor -= block.thickness;
          store(next);
        });
      }
    }
  } else {
    for (let heightIndex = 0; heightIndex < grid.heightBlocks; heightIndex += 1) {
      const originalRow = blocksInRow(before, heightIndex);
      const nextRow = blocksInRow(after, heightIndex);
      if (face === "right") {
        let cursor = Math.min(...originalRow.map((block) => block.lateralOffset - block.width / 2));
        nextRow.forEach((block) => {
          const next = { ...block, lateralOffset: cursor + block.width / 2 };
          cursor += block.width;
          store(next);
        });
      } else {
        let cursor = Math.max(...originalRow.map((block) => block.lateralOffset + block.width / 2));
        [...nextRow].reverse().forEach((block) => {
          const next = { ...block, lateralOffset: cursor - block.width / 2 };
          cursor -= block.width;
          store(next);
        });
      }
    }
  }

  return after.map((block) => packed.get(`${block.widthIndex}:${block.heightIndex}`) ?? block);
}

function blocksInColumn(blocks: readonly BladeBlock[], widthIndex: number): BladeBlock[] {
  return blocks
    .filter((block) => block.widthIndex === widthIndex)
    .sort((left, right) => left.heightIndex - right.heightIndex);
}

function blocksInRow(blocks: readonly BladeBlock[], heightIndex: number): BladeBlock[] {
  return blocks
    .filter((block) => block.heightIndex === heightIndex)
    .sort((left, right) => left.widthIndex - right.widthIndex);
}

function struckFaceForOrientation(orientationQuarterTurns: 0 | 1 | 2 | 3): StruckFace {
  switch (orientationQuarterTurns) {
    case 0:
      return "top";
    case 1:
      return "left";
    case 2:
      return "bottom";
    case 3:
      return "right";
  }
}

function verticalShiftForFace(face: StruckFace, surfaceDisplacement: number): number {
  if (face === "top") return -surfaceDisplacement;
  if (face === "bottom") return surfaceDisplacement;
  return 0;
}

function lateralShiftForFace(face: StruckFace, surfaceDisplacement: number): number {
  if (face === "left") return surfaceDisplacement;
  if (face === "right") return -surfaceDisplacement;
  return 0;
}

function hammerKernel(distance: number): number {
  const center = Math.floor(FORGE_RULES.neighbourKernel.length / 2);
  return FORGE_RULES.neighbourKernel[distance + center] ?? 0;
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
  return neighbours.length === 0
    ? 0
    : neighbours.reduce((sum, neighbour) => sum + neighbour.plasticStrain, 0) / neighbours.length;
}

function blockAt(
  state: ForgeState,
  sectionIndex: number,
  widthIndex: number,
  heightIndex: number,
): BladeBlock | undefined {
  return state.workpiece.sections[sectionIndex]?.blocks.find(
    (block) => block.widthIndex === widthIndex && block.heightIndex === heightIndex,
  );
}

function blockVolume(block: BladeBlock): number {
  return block.length * block.width * block.thickness;
}

function rotate(current: 0 | 1 | 2 | 3, quarterTurns: 1 | -1): 0 | 1 | 2 | 3 {
  return ((current + quarterTurns + 4) % 4) as 0 | 1 | 2 | 3;
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
  if (!Number.isInteger(operation.sectionIndex) || operation.sectionIndex < 0 || operation.sectionIndex >= state.workpiece.sections.length) {
    throw new Error("Hammer target must be an existing section.");
  }
  if (!Number.isFinite(operation.energy) || operation.energy <= 0 || operation.energy > 1) {
    throw new Error("Hammer energy must be greater than zero and at most one.");
  }
  if (operation.lateralBias !== -1 && operation.lateralBias !== 0 && operation.lateralBias !== 1) {
    throw new Error("Hammer lateral bias must be -1, 0, or 1.");
  }
  if (operation.faceBias !== undefined && (!Number.isFinite(operation.faceBias) || operation.faceBias < 0 || operation.faceBias > 1)) {
    throw new Error("Hammer face bias must be between zero and one.");
  }
}

function assertQuarterTurns(quarterTurns: number): void {
  if (quarterTurns !== -1 && quarterTurns !== 1) {
    throw new Error("Rotation must be exactly one quarter turn in either direction.");
  }
}

function assertFeedStep(step: number): void {
  if (step !== -1 && step !== 1) {
    throw new Error("Feed must move exactly one step in either direction.");
  }
}

function clampFeedOffset(feedOffset: number, sections: readonly BladeSection[]): number {
  const first = sections[0];
  const last = sections.at(-1);
  if (!first || !last) {
    return 0;
  }
  const halfLength = (last.position + last.length / 2 - (first.position - first.length / 2)) / 2;
  return clamp(feedOffset, -halfLength, halfLength);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function repositionSections(sections: readonly BladeSection[]): readonly BladeSection[] {
  let position = 0;
  return sections.map((section) => {
    const next = { ...section, position };
    position += section.length;
    return next;
  });
}

import { DEFAULT_FORGE_MATERIAL, FORGE_PARAMETER_VERSION, FORGE_RULES } from "./forge-rules.ts";
import type {
  BladeSection,
  ForgeMaterial,
  ForgeOperation,
  ForgeSnapshot,
  ForgeState,
  HammerOperation,
} from "./forge-types.ts";

export interface CreateForgeStateOptions {
  readonly material?: ForgeMaterial;
  readonly sectionCount?: number;
}

export function createForgeState(options: CreateForgeStateOptions = {}): ForgeState {
  const sectionCount = options.sectionCount ?? 9;
  if (!Number.isInteger(sectionCount) || sectionCount < 3) {
    throw new Error("A forge workpiece needs at least three sections.");
  }

  const material = options.material ?? DEFAULT_FORGE_MATERIAL;
  const sections = Array.from({ length: sectionCount }, (_, index) => createSection(index));
  return {
    parameterVersion: FORGE_PARAMETER_VERSION,
    phase: "forging",
    material: { ...material },
    workpiece: {
      id: "workpiece-0",
      orientationQuarterTurns: 0,
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
          sections: state.workpiece.sections.map((section) => ({
            ...section,
            temperatureC: operation.temperatureC,
            plasticity: calculatePlasticity(operation.temperatureC, state.material),
          })),
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
    case "hammer":
      return appendOperation(applyHammer(state, operation), operation);
    case "quench":
    case "grind":
      throw new Error(`${operation.kind} is reserved for S3c and cannot run in S3a.`);
  }
}

export function replayForgeState(initialState: ForgeState, operations: readonly ForgeOperation[]): ForgeState {
  return operations.reduce(applyForgeOperation, cloneStateWithoutOperations(initialState));
}

export function createForgeSnapshot(state: ForgeState): ForgeSnapshot {
  return {
    parameterVersion: state.parameterVersion,
    orientationQuarterTurns: state.workpiece.orientationQuarterTurns,
    hasCracks: state.workpiece.sections.some((section) => section.cracked),
    sections: state.workpiece.sections.map((section) => ({
      position: section.position,
      length: section.length,
      width: section.width,
      thickness: section.thickness,
      temperatureC: section.temperatureC,
      plasticity: section.plasticity,
      lateralOffset: section.lateralOffset,
      cracked: section.cracked,
    })),
  };
}

export function totalVolume(state: ForgeState): number {
  return state.workpiece.sections.reduce((volume, section) => volume + section.length * section.width * section.thickness, 0);
}

export function calculatePlasticity(temperatureC: number, material: ForgeMaterial = DEFAULT_FORGE_MATERIAL): number {
  const range = FORGE_RULES.maximumPlasticTemperatureC - FORGE_RULES.minimumPlasticTemperatureC;
  return clamp((temperatureC - FORGE_RULES.minimumPlasticTemperatureC) / range, 0, 1) * material.hotWorkability;
}

function applyHammer(state: ForgeState, operation: HammerOperation): ForgeState {
  assertHammerOperation(state, operation);
  const hitsThickness = state.workpiece.orientationQuarterTurns % 2 === 0;
  const center = operation.sectionIndex;
  const sections = state.workpiece.sections.map((section, index) => {
    const kernel = hammerKernel(index - center);
    if (kernel === 0) {
      return section;
    }
    return hammerSection(section, operation, kernel, hitsThickness, state.material);
  });

  return {
    ...state,
    workpiece: { ...state.workpiece, sections },
  };
}

function hammerSection(
  section: BladeSection,
  operation: HammerOperation,
  kernel: number,
  hitsThickness: boolean,
  material: ForgeMaterial,
): BladeSection {
  const deformation = operation.energy * kernel * material.hotWorkability * (
    FORGE_RULES.deformationAtZeroPlasticity
    + (FORGE_RULES.deformationAtFullPlasticity - FORGE_RULES.deformationAtZeroPlasticity) * section.plasticity
  );
  const compression = Math.min(FORGE_RULES.maxCompressionPerHit, deformation);
  const area = section.width * section.thickness;
  const compressedDimension = hitsThickness ? section.thickness * (1 - compression) : section.width * (1 - compression);
  const spreadDimension = area / compressedDimension;
  const stressIncrease = operation.energy * kernel * material.coldStressMultiplier * (
    FORGE_RULES.hotStressAtFullEnergy
    + (FORGE_RULES.coldStressAtFullEnergy - FORGE_RULES.hotStressAtFullEnergy) * (1 - section.plasticity)
  );
  const stress = section.stress + stressIncrease;
  const integrity = Math.max(0, section.integrity - Math.max(0, stress - FORGE_RULES.stressDamageThreshold) * FORGE_RULES.integrityLossScale);

  return {
    ...section,
    width: hitsThickness ? spreadDimension : compressedDimension,
    thickness: hitsThickness ? compressedDimension : spreadDimension,
    stress,
    integrity,
    lateralOffset: section.lateralOffset
      + operation.lateralBias * operation.energy * kernel * section.plasticity * FORGE_RULES.lateralBendAtFullEnergy,
    cracked: section.cracked || integrity <= FORGE_RULES.crackIntegrityThreshold,
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
      sections: state.workpiece.sections.map((section) => ({ ...section })),
      joints: state.workpiece.joints.map((joint) => ({ ...joint, workpieceIds: [...joint.workpieceIds] })),
    },
    operations: [],
  };
}

function createSection(index: number): BladeSection {
  return {
    position: index * FORGE_RULES.initialSectionLength,
    length: FORGE_RULES.initialSectionLength,
    width: FORGE_RULES.initialSectionWidth,
    thickness: FORGE_RULES.initialSectionThickness,
    temperatureC: FORGE_RULES.ambientTemperatureC,
    plasticity: 0,
    stress: 0,
    integrity: 1,
    lateralOffset: 0,
    cracked: false,
  };
}

function hammerKernel(distance: number): number {
  return FORGE_RULES.neighbourKernel[distance + 1] ?? 0;
}

function rotate(current: 0 | 1 | 2 | 3, quarterTurns: 1 | -1): 0 | 1 | 2 | 3 {
  return ((current + quarterTurns + 4) % 4) as 0 | 1 | 2 | 3;
}

function assertTemperature(temperatureC: number): void {
  if (!Number.isFinite(temperatureC) || temperatureC < FORGE_RULES.ambientTemperatureC || temperatureC > 1300) {
    throw new Error("Heat temperature must be between ambient temperature and 1300C.");
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
}

function assertQuarterTurns(quarterTurns: number): void {
  if (quarterTurns !== -1 && quarterTurns !== 1) {
    throw new Error("Rotation must be exactly one quarter turn in either direction.");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

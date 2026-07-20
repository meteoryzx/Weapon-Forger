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
  assertMaterial(material);
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
    case "advanceTime":
      assertDuration(operation.durationSeconds);
      return appendOperation({
        ...state,
        workpiece: {
          ...state.workpiece,
          sections: state.workpiece.sections.map((section) => ({
            ...applyCooling(section, operation.durationSeconds, state.material),
          })),
        },
      }, operation);
    case "heat":
      assertTemperature(operation.temperatureC);
      return appendOperation({
        ...state,
        workpiece: {
          ...state.workpiece,
          sections: state.workpiece.sections.map((section) => ({
            ...applyHeat(section, operation.temperatureC, state.material),
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
      lateralOffset: section.lateralOffset,
      cracked: section.cracked,
      overheated: section.overheated,
    })),
  };
}

export function totalVolume(state: ForgeState): number {
  return state.workpiece.sections.reduce((volume, section) => volume + section.length * section.width * section.thickness, 0);
}

export function calculatePlasticity(temperatureC: number, material: ForgeMaterial = DEFAULT_FORGE_MATERIAL): number {
  const range = material.plasticityPeakC - material.plasticityStartC;
  return clamp((temperatureC - material.plasticityStartC) / range, 0, 1) * material.hotWorkability;
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
    return hammerSection(section, operation, kernel, hitsThickness, state.material, neighbourPlasticStrain(state, index));
  });

  return {
    ...state,
    workpiece: { ...state.workpiece, sections: repositionSections(sections) },
  };
}

function hammerSection(
  section: BladeSection,
  operation: HammerOperation,
  kernel: number,
  hitsThickness: boolean,
  material: ForgeMaterial,
  neighbourStrain: number,
): BladeSection {
  const deformation = operation.energy * kernel * (
    FORGE_RULES.deformationAtZeroPlasticity
    + (FORGE_RULES.deformationAtFullPlasticity - FORGE_RULES.deformationAtZeroPlasticity) * section.plasticity
  );
  const compression = Math.min(FORGE_RULES.maxCompressionPerHit, deformation);
  const compressedDimension = hitsThickness ? section.thickness * (1 - compression) : section.width * (1 - compression);
  const length = section.length * (1 + compression * FORGE_RULES.lengthShareOfSpread);
  const volume = section.length * section.width * section.thickness;
  const spreadDimension = volume / (compressedDimension * length);
  const stressIncrease = operation.energy * kernel * material.coldStressMultiplier * (
    FORGE_RULES.hotStressAtFullEnergy
    + (FORGE_RULES.coldStressAtFullEnergy - FORGE_RULES.hotStressAtFullEnergy) * (1 - section.plasticity)
  );
  const stress = section.stress + stressIncrease;
  const plasticStrain = section.plasticStrain + compression * FORGE_RULES.plasticStrainPerCompression;
  const localisation = clamp((plasticStrain - neighbourStrain) / FORGE_RULES.localisationStrainRange, 0, 1);
  const thinness = clamp((FORGE_RULES.initialSectionThickness - section.thickness) / FORGE_RULES.initialSectionThickness, 0, 1);
  // Cold-work damage rises sharply outside the material's workable temperature range.
  const coldness = (1 - section.plasticity) ** 3;
  const damageIncrease = operation.energy * kernel * coldness * (
    FORGE_RULES.coldImpactDamage
    + localisation * FORGE_RULES.localisationDamage
    + thinness * FORGE_RULES.thinSectionDamage
  ) * (1 + section.thermalDamage) / material.damageResistance;
  const damage = clamp(section.damage + damageIncrease, 0, 1);
  const integrity = Math.max(0, 1 - damage);

  return {
    ...section,
    width: hitsThickness ? spreadDimension : compressedDimension,
    thickness: hitsThickness ? compressedDimension : spreadDimension,
    length,
    stress,
    plasticStrain,
    damage,
    integrity,
    lateralOffset: section.lateralOffset
      + operation.lateralBias * operation.energy * kernel * section.plasticity * FORGE_RULES.lateralBendAtFullEnergy,
    cracked: section.cracked || integrity <= FORGE_RULES.crackIntegrityThreshold,
  };
}

function applyHeat(section: BladeSection, temperatureC: number, material: ForgeMaterial): BladeSection {
  const plasticity = calculatePlasticity(temperatureC, material);
  const overheatRatio = clamp((temperatureC - material.overheatTemperatureC) / (1300 - material.overheatTemperatureC), 0, 1);
  const thermalDamage = clamp(section.thermalDamage + overheatRatio * FORGE_RULES.overheatDamagePerHeat, 0, 1);
  return {
    ...section,
    temperatureC,
    plasticity,
    // Reheating allows recovery/recrystallisation; it cannot restore lost integrity or close a crack.
    stress: section.stress * (1 - plasticity * material.stressRecoveryAtPeak),
    thermalDamage,
    overheated: section.overheated || thermalDamage > 0,
  };
}

function applyCooling(section: BladeSection, durationSeconds: number, material: ForgeMaterial): BladeSection {
  const temperatureC = FORGE_RULES.ambientTemperatureC
    + (section.temperatureC - FORGE_RULES.ambientTemperatureC) * Math.exp(-FORGE_RULES.coolingRatePerSecond * durationSeconds);
  return {
    ...section,
    temperatureC,
    plasticity: calculatePlasticity(temperatureC, material),
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
    plasticStrain: 0,
    damage: 0,
    integrity: 1,
    thermalDamage: 0,
    lateralOffset: 0,
    cracked: false,
    overheated: false,
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

function assertDuration(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 300) {
    throw new Error("Advance time duration must be greater than zero and at most 300 seconds.");
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

function neighbourPlasticStrain(state: ForgeState, index: number): number {
  const neighbours = [state.workpiece.sections[index - 1], state.workpiece.sections[index + 1]].filter(Boolean);
  return neighbours.reduce((sum, section) => sum + section.plasticStrain, 0) / neighbours.length;
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

function repositionSections(sections: readonly BladeSection[]): readonly BladeSection[] {
  let position = 0;
  return sections.map((section) => {
    const next = { ...section, position };
    position += section.length;
    return next;
  });
}

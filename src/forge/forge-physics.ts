import { FORGE_RULES } from "./forge-rules.ts";
import type { ForgeMaterial } from "./forge-types.ts";

export interface MechanicalGeometry {
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly volume: number;
}

export interface MechanicalState {
  readonly temperatureC: number;
  readonly plasticity: number;
  readonly stress: number;
  readonly plasticStrain: number;
  readonly elasticStrain: number;
  readonly damage: number;
  readonly thermalDamage: number;
  readonly mechanicalWorkJ: number;
  readonly volume: number;
}

export interface MechanicalLoad {
  /** Fraction of the tool load carried by this cell. */
  readonly impactWeight: number;
  /** Difference between this cell's accumulated strain and its neighbours. */
  readonly localisation: number;
  /** Normalized risk from a locally thin section. */
  readonly thinSectionRisk: number;
  /** Fraction of the cell supported by the opposing tool or anvil. */
  readonly supportRatio: number;
}

export interface MechanicalResponse {
  readonly stress: number;
  readonly plasticStrain: number;
  readonly elasticStrain: number;
  readonly damage: number;
  readonly integrity: number;
  readonly mechanicalWorkJ: number;
  readonly equivalentStrainIncrement: number;
  readonly plasticStrainIncrement: number;
}

/**
 * Equivalent logarithmic strain is invariant to the order of the three axes
 * and stays meaningful when the geometry solver preserves volume.
 */
export function equivalentLogStrain(before: MechanicalGeometry, after: MechanicalGeometry): number {
  const logarithmicStrains = [
    Math.log(Math.max(after.length, Number.EPSILON) / Math.max(before.length, Number.EPSILON)),
    Math.log(Math.max(after.width, Number.EPSILON) / Math.max(before.width, Number.EPSILON)),
    Math.log(Math.max(after.thickness, Number.EPSILON) / Math.max(before.thickness, Number.EPSILON)),
  ];
  const mean = logarithmicStrains.reduce((sum, value) => sum + value, 0) / logarithmicStrains.length;
  return Math.sqrt(
    (2 / 3) * logarithmicStrains.reduce((sum, value) => sum + (value - mean) ** 2, 0),
  );
}

export function yieldStrengthMPa(state: Pick<MechanicalState, "temperatureC" | "plasticity" | "plasticStrain">, material: ForgeMaterial): number {
  const hotBlend = smoothstep(clamp(state.plasticity / material.hotWorkability, 0, 1));
  const thermalYield = lerp(material.yieldStrengthAmbientMPa, material.yieldStrengthHotMPa, hotBlend);
  const hardening = 1 + Math.pow(
    Math.max(state.plasticStrain, 0) / FORGE_RULES.hardeningReferenceStrain,
    material.workHardeningExponent,
  );
  return thermalYield * hardening;
}

export function integrateMechanicalResponse(
  before: MechanicalState,
  beforeGeometry: MechanicalGeometry,
  afterGeometry: MechanicalGeometry,
  material: ForgeMaterial,
  load: MechanicalLoad,
): MechanicalResponse {
  const impactWeight = clamp(load.impactWeight, 0, 1);
  const equivalentStrainIncrement = equivalentLogStrain(beforeGeometry, afterGeometry) * impactWeight;
  const flowBlend = clamp(before.plasticity / material.hotWorkability, 0, 1);
  const plasticFlowFraction = lerp(
    FORGE_RULES.plasticFlowAtZeroPlasticity,
    FORGE_RULES.plasticFlowAtPeakPlasticity,
    smoothstep(flowBlend),
  );
  const plasticStrainIncrement = equivalentStrainIncrement * plasticFlowFraction;
  const elasticStrainIncrement = equivalentStrainIncrement - plasticStrainIncrement;
  const yieldStrength = yieldStrengthMPa(before, material);

  // Residual stress is stored as a normalized state value. Exponential
  // accumulation prevents repeated blows from becoming a linear hit counter.
  const stressDrive = (elasticStrainIncrement / FORGE_RULES.elasticStrainReference)
    * (1 + (1 - flowBlend) * 0.5)
    + (1 - flowBlend) * impactWeight * FORGE_RULES.coldDamageStressContribution;
  const stress = clamp(
    1 - (1 - before.stress) * Math.exp(-stressDrive * FORGE_RULES.stressAccumulationScale),
    0,
    1,
  );
  const elasticStrain = Math.max(0, before.elasticStrain + elasticStrainIncrement);

  const triaxiality = clamp(
    0.18
      + clamp(load.localisation, 0, 1) * 0.62
      + clamp(load.thinSectionRisk, 0, 1) * 0.25
      + (1 - clamp(load.supportRatio, 0, 1)) * 0.25,
    0,
    1,
  );
  const coldFlowRisk = 0.01 + 0.99 * (1 - flowBlend) ** 2.5;
  const hardeningRisk = 1 + Math.min(before.plasticStrain / FORGE_RULES.hardeningReferenceStrain, 4) * 0.25;
  const damageDriver = (equivalentStrainIncrement / FORGE_RULES.elasticStrainReference)
    + (1 - flowBlend) * impactWeight * FORGE_RULES.coldDamageStressContribution;
  const damageExponent = FORGE_RULES.damageAccumulationScale
    * damageDriver
    * Math.pow(triaxiality, FORGE_RULES.damageTriaxialityExponent)
    * coldFlowRisk
    * hardeningRisk
    * (1 + before.thermalDamage)
    / material.damageResistance;
  const damage = clamp(1 - (1 - before.damage) * Math.exp(-damageExponent), 0, 1);

  // sigma * strain * volume gives work. The conversion assumes one model unit
  // is one millimetre, which matches the existing geometry and density data.
  const averageYieldStrength = (yieldStrength + yieldStrengthMPa({
    ...before,
    plasticStrain: before.plasticStrain + plasticStrainIncrement,
  }, material)) / 2;
  const workJ = averageYieldStrength * 1_000_000
    * (plasticStrainIncrement + elasticStrainIncrement * 0.5)
    * Math.max(before.volume, 0) * 1e-9;

  return {
    stress,
    plasticStrain: before.plasticStrain + plasticStrainIncrement,
    elasticStrain,
    damage,
    integrity: Math.max(0, 1 - damage),
    mechanicalWorkJ: before.mechanicalWorkJ + Math.max(0, workJ),
    equivalentStrainIncrement,
    plasticStrainIncrement,
  };
}

function smoothstep(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

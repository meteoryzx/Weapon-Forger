import type { ForgeMaterial } from "./forge-types.ts";

export const FORGE_PARAMETER_VERSION = "s3a-1";

export const DEFAULT_FORGE_MATERIAL: ForgeMaterial = {
  id: "simulation-steel",
  hotWorkability: 1,
  coldStressMultiplier: 1,
  plasticityStartC: 700,
  plasticityPeakC: 1000,
  overheatTemperatureC: 1150,
  stressRecoveryAtPeak: 0.75,
};

export const FORGE_RULES = {
  ambientTemperatureC: 20,
  initialSectionLength: 14,
  initialSectionWidth: 32,
  initialSectionThickness: 8,
  maxCompressionPerHit: 0.22,
  deformationAtFullPlasticity: 0.055,
  deformationAtZeroPlasticity: 0.003,
  coldStressAtFullEnergy: 0.98,
  hotStressAtFullEnergy: 0.08,
  stressDamageThreshold: 0.72,
  integrityLossScale: 0.14,
  crackIntegrityThreshold: 0.3,
  lateralBendAtFullEnergy: 0.8,
  lengthShareOfSpread: 0.6,
  overheatDamagePerHeat: 0.22,
  neighbourKernel: [0.25, 1, 0.25] as const,
} as const;

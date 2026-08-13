import type { ForgeMaterial } from "./forge-types.ts";

export const FORGE_PARAMETER_VERSION = "r1h-8";

const WORKPIECE_LENGTH = 336;
const WORKPIECE_WIDTH = 48;
const WORKPIECE_THICKNESS = 8;
const SIMULATION_CELL_SIZE = 2;

export const DEFAULT_FORGE_MATERIAL: ForgeMaterial = {
  id: "simulation-steel",
  hotWorkability: 1,
  coldStressMultiplier: 1,
  damageResistance: 1,
  plasticityStartC: 700,
  plasticityPeakC: 1000,
  overheatTemperatureC: 1150,
  stressRecoveryAtPeak: 0.75,
};

export const FORGE_RULES = {
  ambientTemperatureC: 20,
  workpieceLength: WORKPIECE_LENGTH,
  simulationCellSize: SIMULATION_CELL_SIZE,
  defaultSectionCount: WORKPIECE_LENGTH / SIMULATION_CELL_SIZE,
  crossSectionWidthBlocks: WORKPIECE_WIDTH / SIMULATION_CELL_SIZE,
  crossSectionHeightBlocks: WORKPIECE_THICKNESS / SIMULATION_CELL_SIZE,
  initialSectionLength: SIMULATION_CELL_SIZE,
  initialSectionWidth: WORKPIECE_WIDTH,
  initialSectionThickness: WORKPIECE_THICKNESS,

  // Tool dimensions share the billet's physical unit system.
  hammerFaceLength: 48,
  hammerFaceWidth: 48,
  hammerCrownHeight: 0.35,
  hammerEdgeTransition: 8,
  anvilFaceLength: 224,
  anvilFaceWidth: 104,

  // Energy limits both the displaced volume and the deepest point of the crowned face.
  hammerDisplacedVolumeAtPeakPlasticity: 680,
  hammerDisplacedVolumeAtZeroPlasticity: 12,
  hammerMaximumTravel: 0.45,
  contactSubsteps: 2,
  solverIterations: 3,
  activeMarginCells: 2,
  volumeCompliance: 0,
  coldShapeCompliance: 0.04,
  hotShapeCompliance: 12,
  hammerFriction: 0.16,
  anvilFriction: 0.28,
  maximumNodeCorrection: 0.35,

  // Stress and damage use the same physical footprint and contact depth as geometry.
  coldStressAtFullEnergy: 0.98,
  hotStressAtFullEnergy: 0.08,
  crackIntegrityThreshold: 0.3,
  plasticStrainPerCompression: 10,
  localisationStrainRange: 0.12,
  coldImpactDamage: 0.1,
  localisationDamage: 0.15,
  thinSectionDamage: 0.12,
  lateralBendAtFullEnergy: 0.8,
  feedStepLength: 14,
  overheatDamagePerHeat: 0.22,
} as const;

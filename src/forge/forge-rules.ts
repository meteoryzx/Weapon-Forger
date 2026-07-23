import type { ForgeMaterial } from "./forge-types.ts";

export const FORGE_PARAMETER_VERSION = "r1i-1";

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
  densityKgPerM3: 7_850,
  molarMassKgPerMol: 0.055_845,
  cleanEmissivity: 0.35,
  oxidizedEmissivity: 0.8,
  oxidationActivationEnergyJPerMol: 150_000,
  // NIST-JANAF solid iron Shomate coefficients, Cp in J/(mol K), t = K / 1000.
  heatCapacitySegments: [
    { minimumK: 298, maximumK: 700, a: 18.42868, b: 24.64301, c: -8.91372, d: 9.664706, e: -0.012643 },
    { minimumK: 700, maximumK: 1042, a: -57_767.65, b: 137_919.7, c: -122_773.2, d: 38_682.42, e: 3_993.08 },
    { minimumK: 1042, maximumK: 1100, a: -325.8859, b: 28.92876, c: 0, d: 0, e: 411.9629 },
    { minimumK: 1100, maximumK: 1809, a: -776.7387, b: 919.4005, c: -383.7184, d: 57.08148, e: 242.1369 },
  ],
};

export const FORGE_RULES = {
  ambientTemperatureC: 20,
  furnaceGasTemperatureC: 1_150,
  furnaceWallTemperatureC: 1_250,
  furnaceConvectionWPerM2K: 45,
  furnaceRadiationViewFactor: 0.85,
  airConvectionWPerM2K: 12,
  stefanBoltzmannWPerM2K4: 5.670_374_419e-8,
  thermalTimeScale: 6,
  thermalStepSeconds: 0.1,
  maximumThermalIntentMs: 120_000,
  hotExposureThresholdC: 600,
  oxidationReferenceTemperatureC: 1_000,
  oxidationEmissivityDose: 90,
  stressRecoveryPerPhysicalSecond: 0.004,
  overheatDamagePerPhysicalSecond: 0.001,
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

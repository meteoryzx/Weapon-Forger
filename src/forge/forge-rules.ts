import type { ForgeMaterial } from "./forge-types.ts";

export const FORGE_PARAMETER_VERSION = "demo-1";

const WORKPIECE_LENGTH = 336;
const WORKPIECE_WIDTH = 48;
const WORKPIECE_THICKNESS = 8;
const SIMULATION_CELL_SIZE = 2;

const IRON_HEAT_CAPACITY_SEGMENTS = [
  { minimumK: 298, maximumK: 700, a: 18.42868, b: 24.64301, c: -8.91372, d: 9.664706, e: -0.012643 },
  { minimumK: 700, maximumK: 1042, a: -57_767.65, b: 137_919.7, c: -122_773.2, d: 38_682.42, e: 3_993.08 },
  { minimumK: 1042, maximumK: 1100, a: -325.8859, b: 28.92876, c: 0, d: 0, e: 411.9629 },
  { minimumK: 1100, maximumK: 1809, a: -776.7387, b: 919.4005, c: -383.7184, d: 57.08148, e: 242.1369 },
] as const;

// 低碳钢：韧性好，但淬火可达到的硬度上限低。适合格挡、耐久场景。
export const DEFAULT_FORGE_MATERIAL: ForgeMaterial = {
  id: "mild-steel",
  carbon: 0.2,
  hotWorkability: 1,
  hardenability: 0.55,
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
  heatCapacitySegments: IRON_HEAT_CAPACITY_SEGMENTS,
};

// 高碳钢：可淬得很硬，但更脆、冷锻更易裂。适合切割、破甲场景。
export const HIGH_CARBON_STEEL: ForgeMaterial = {
  id: "high-carbon-steel",
  carbon: 0.9,
  hotWorkability: 0.9,
  hardenability: 0.95,
  coldStressMultiplier: 1.15,
  damageResistance: 0.8,
  plasticityStartC: 680,
  plasticityPeakC: 980,
  overheatTemperatureC: 1120,
  stressRecoveryAtPeak: 0.7,
  densityKgPerM3: 7_850,
  molarMassKgPerMol: 0.055_845,
  cleanEmissivity: 0.35,
  oxidizedEmissivity: 0.8,
  oxidationActivationEnergyJPerMol: 150_000,
  heatCapacitySegments: IRON_HEAT_CAPACITY_SEGMENTS,
};

// 选料界面的数据来源；新增材料只需在此登记并保证字段齐全。
export const FORGE_MATERIALS: readonly ForgeMaterial[] = [DEFAULT_FORGE_MATERIAL, HIGH_CARBON_STEEL];

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

  // Quench only records facts and cools the billet; hardness/brittleness are
  // interpreted by evaluate from the quench start temperature and medium.
  quenchIdealStartC: 860,
  quenchMinimumStartC: 720,
} as const;

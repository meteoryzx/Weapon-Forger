export type BilletLocation = "inspection" | "furnace";

export interface HeatCapacitySegment {
  readonly minimumK: number;
  readonly maximumK: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
}

export interface ForgeMaterial {
  readonly id: string;
  // 含碳量 0–1，是「成分」这个根基量的主数字；焊合时按体积加权平均。
  readonly carbon: number;
  readonly hotWorkability: number;
  readonly hardenability: number;
  readonly damageResistance: number;
  readonly plasticityStartC: number;
  readonly plasticityPeakC: number;
  readonly overheatTemperatureC: number;
  readonly stressRecoveryAtPeak: number;
  readonly densityKgPerM3: number;
  readonly molarMassKgPerMol: number;
  // Mechanical response parameters for the shared reduced-order model.
  readonly yieldStrengthAmbientMPa: number;
  readonly yieldStrengthHotMPa: number;
  readonly workHardeningExponent: number;
  readonly cleanEmissivity: number;
  readonly oxidizedEmissivity: number;
  readonly oxidationActivationEnergyJPerMol: number;
  readonly heatCapacitySegments: readonly HeatCapacitySegment[];
}

export interface BladeSection {
  readonly position: number;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly temperatureC: number;
  readonly plasticity: number;
  // A normalized residual-stress index, not a real-world MPa measurement.
  readonly stress: number;
  // Accumulated equivalent plastic strain, not an operation counter.
  readonly plasticStrain: number;
  // Recoverable strain retained as residual elastic energy after a load.
  readonly elasticStrain: number;
  // Mechanical work absorbed by this cell, in joules in the model's unit scale.
  readonly mechanicalWorkJ: number;
  readonly damage: number;
  readonly integrity: number;
  readonly thermalDamage: number;
  readonly verticalOffset: number;
  readonly lateralOffset: number;
  readonly cracked: boolean;
  readonly overheated: boolean;
  // 0..1 grind progress on this section's edge, accumulated by grinding along the edge.
  readonly groundAmount: number;
  readonly blocks: readonly BladeBlock[];
}

export interface WorkpieceNode {
  readonly axialIndex: number;
  readonly widthIndex: number;
  readonly heightIndex: number;
  readonly axialPosition: number;
  readonly lateralOffset: number;
  readonly verticalOffset: number;
}

export interface BladeBlock {
  readonly widthIndex: number;
  readonly heightIndex: number;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly volume: number;
  readonly temperatureC: number;
  readonly plasticity: number;
  readonly stress: number;
  readonly plasticStrain: number;
  readonly elasticStrain: number;
  readonly mechanicalWorkJ: number;
  readonly damage: number;
  readonly integrity: number;
  readonly thermalDamage: number;
  readonly verticalOffset: number;
  readonly lateralOffset: number;
  readonly cracked: boolean;
  readonly overheated: boolean;
}

export interface WorkpieceGrid {
  readonly widthBlocks: number;
  readonly heightBlocks: number;
}

export interface JointState {
  readonly id: string;
  readonly workpieceIds: readonly string[];
  readonly contactArea: number;
  readonly integrity: number;
}

export type QuenchMedium = "water" | "oil";

export interface QuenchState {
  // null until the player quenches; medium and the temperature it started from
  // are the only real facts the hardness/brittleness derivation needs.
  readonly medium: QuenchMedium | null;
  readonly startTemperatureC: number | null;
}

export interface TemperState {
  // 回火温度；null 表示未回火。温度越高越韧越软。
  readonly temperatureC: number | null;
}

export interface WorkpieceState {
  readonly id: string;
  // 每个工件自带材料：焊合会按体积混合 carbon，故材料必须随工件走。
  readonly material: ForgeMaterial;
  // 焊合层数；初始 1。大马士革 = 反复切割+焊合 → 层数翻倍。
  readonly layerCount: number;
  readonly orientationQuarterTurns: 0 | 1 | 2 | 3;
  readonly feedOffset: number;
  readonly grid: WorkpieceGrid;
  readonly nodes: readonly WorkpieceNode[];
  readonly sections: readonly BladeSection[];
  readonly joints: readonly JointState[];
  readonly thermal: WorkpieceThermalState;
  readonly quench: QuenchState;
  readonly temper: TemperState;
}

export interface WorkpieceThermalState {
  readonly location: BilletLocation;
  readonly peakTemperatureC: number;
  readonly hotExposureSeconds: number;
  // A normalized Arrhenius time integral reserved for later scale growth.
  readonly oxidationDose: number;
  readonly overheatDose: number;
}

export interface SelectMaterialOperation {
  readonly kind: "select-material";
  readonly materialId: string;
}

export interface SelectWorkpieceOperation {
  readonly kind: "select-workpiece";
  readonly benchIndex: number;
}

export interface HeatOperation {
  readonly kind: "heat";
  readonly temperatureC: number;
}

export interface MoveBilletOperation {
  readonly kind: "move-billet";
  readonly destination: BilletLocation;
  readonly elapsedMs: number;
}

export interface RotateOperation {
  readonly kind: "rotate";
  readonly quarterTurns: 1 | -1;
}

export interface FeedOperation {
  readonly kind: "feed";
  readonly step: 1 | -1;
}

export interface HammerOperation {
  readonly kind: "hammer";
  readonly sectionIndex: number;
  readonly energy: number;
  readonly faceBias?: number;
}

export interface QuenchOperation {
  readonly kind: "quench";
  readonly medium: QuenchMedium;
}

export interface GrindOperation {
  readonly kind: "grind";
  readonly sectionIndex: number;
  readonly amount: number;
}

// 切割：把当前工件在 sectionIndex 处一分为二，后半段移入工作台 bench。
export interface CutOperation {
  readonly kind: "cut";
  readonly sectionIndex: number;
}

// 焊合：把当前工件与 bench[benchIndex] 加热后锻成一块；层数相加、carbon 按体积平均。
export interface WeldOperation {
  readonly kind: "weld";
  readonly benchIndex: number;
}

// 回火：设定回火温度，调「硬↔韧」。
export interface TemperOperation {
  readonly kind: "temper";
  readonly temperatureC: number;
}

export type ForgeOperation =
  | SelectMaterialOperation
  | SelectWorkpieceOperation
  | HeatOperation
  | MoveBilletOperation
  | RotateOperation
  | FeedOperation
  | HammerOperation
  | QuenchOperation
  | GrindOperation
  | CutOperation
  | WeldOperation
  | TemperOperation;

export interface SelectMaterialIntent {
  readonly kind: "select-material";
  readonly materialId: string;
}

export interface SelectWorkpieceIntent {
  readonly kind: "select-workpiece";
  readonly benchIndex: number;
}

export interface HammerIntent {
  readonly kind: "hammer";
  readonly sectionIndex: number;
  readonly energy: number;
  readonly faceBias?: number;
}

export interface RotateIntent {
  readonly kind: "rotate";
  readonly quarterTurns: 1 | -1;
}

export interface FeedIntent {
  readonly kind: "feed";
  readonly step: 1 | -1;
}

export interface MoveBilletIntent {
  readonly kind: "move-billet";
  readonly destination: BilletLocation;
  readonly elapsedMs: number;
}

export interface QuenchIntent {
  readonly kind: "quench";
  readonly medium: QuenchMedium;
}

export interface GrindIntent {
  readonly kind: "grind";
  readonly sectionIndex: number;
  readonly amount: number;
}

export interface CutIntent {
  readonly kind: "cut";
  readonly sectionIndex: number;
}

export interface WeldIntent {
  readonly kind: "weld";
  readonly benchIndex: number;
}

export interface TemperIntent {
  readonly kind: "temper";
  readonly temperatureC: number;
}

export type ForgeIntent =
  | SelectMaterialIntent
  | SelectWorkpieceIntent
  | HammerIntent
  | RotateIntent
  | FeedIntent
  | MoveBilletIntent
  | QuenchIntent
  | GrindIntent
  | CutIntent
  | WeldIntent
  | TemperIntent;

export interface ForgeState {
  readonly parameterVersion: string;
  // 当前正在加工的工件；其余切割下来的工件放在 bench，供焊合取用。
  readonly workpiece: WorkpieceState;
  readonly bench: readonly WorkpieceState[];
  readonly operations: readonly ForgeOperation[];
}

export interface ForgeSnapshotSection {
  readonly position: number;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly temperatureC: number;
  readonly plasticity: number;
  readonly stress: number;
  readonly plasticStrain: number;
  readonly elasticStrain: number;
  readonly mechanicalWorkJ: number;
  readonly thermalDamage: number;
  readonly damage: number;
  readonly verticalOffset: number;
  readonly lateralOffset: number;
  readonly cracked: boolean;
  readonly overheated: boolean;
  readonly groundAmount: number;
  readonly blocks: readonly ForgeSnapshotBlock[];
}

export interface ForgeSnapshotBlock {
  readonly widthIndex: number;
  readonly heightIndex: number;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly volume: number;
  readonly temperatureC: number;
  readonly plasticity: number;
  readonly stress: number;
  readonly plasticStrain: number;
  readonly elasticStrain: number;
  readonly mechanicalWorkJ: number;
  readonly thermalDamage: number;
  readonly damage: number;
  readonly verticalOffset: number;
  readonly lateralOffset: number;
  readonly cracked: boolean;
  readonly overheated: boolean;
}

export interface ForgeSnapshot {
  readonly parameterVersion: string;
  readonly workpieceId: string;
  readonly materialId: string;
  readonly billetLocation: BilletLocation;
  readonly averageTemperatureC: number;
  readonly peakTemperatureC: number;
  readonly hotExposureSeconds: number;
  readonly oxidationDose: number;
  readonly overheatDose: number;
  readonly orientationQuarterTurns: 0 | 1 | 2 | 3;
  readonly feedOffset: number;
  readonly grid: WorkpieceGrid;
  readonly nodes: readonly WorkpieceNode[];
  readonly sections: readonly ForgeSnapshotSection[];
  readonly hasCracks: boolean;
  readonly hasOverheatedSections: boolean;
  readonly quenchMedium: QuenchMedium | null;
  readonly quenched: boolean;
  readonly edgeCoverage: number;
  readonly edgeEvenness: number;
  readonly layerCount: number;
  readonly carbon: number;
  readonly temperTemperatureC: number | null;
  readonly benchCount: number;
}

export interface HammerInfluenceSample {
  readonly sectionIndex: number;
  readonly widthIndex: number;
  readonly heightIndex: number;
  readonly weight: number;
}

export interface HammerInfluencePreview {
  readonly sectionIndex: number;
  readonly faceBias: number;
  readonly energy: number;
  readonly samples: readonly HammerInfluenceSample[];
}

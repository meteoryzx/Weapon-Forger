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
  // 含碳量 0-1。工件级材料是降阶计算摘要；空间来源保存在每个 block 上。
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
  // Material volume removed by grinding in the simulation's cubic-millimetre unit.
  readonly removedVolume: number;
  readonly blocks: readonly BladeBlock[];
}

export interface WorkpieceNode {
  readonly id: string;
  readonly axialIndex: number;
  readonly widthIndex: number;
  readonly heightIndex: number;
  readonly axialPosition: number;
  readonly lateralOffset: number;
  readonly verticalOffset: number;
}

export interface BladeBlock {
  readonly id: string;
  readonly materialId: string;
  // Identifies a spatial material region. Cutting may partition one source region;
  // welding keeps regions separate instead of pretending the result is homogeneous.
  readonly materialRegionId: string;
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

export interface WorkpieceOutlinePoint {
  readonly id: string;
  readonly axialPosition: number;
  readonly lateralOffset: number;
}

export interface WorkpieceGeometry {
  readonly kind: "planar-height-field-v1";
  readonly grid: WorkpieceGrid;
  readonly nodes: readonly WorkpieceNode[];
  // One counter-clockwise outer contour. Closed holes and overlapping height
  // layers are deliberately outside the current 2.5D contract.
  readonly outline: readonly WorkpieceOutlinePoint[];
}

export interface JointState {
  readonly id: string;
  readonly workpieceIds: readonly string[];
  readonly contactArea: number;
  readonly weldTemperatureC: number;
  readonly integrity: number;
}

export type QuenchMedium = "water" | "oil";

export interface QuenchEvent {
  readonly kind: "quench";
  readonly operationIndex: number;
  readonly medium: QuenchMedium;
  readonly startTemperatureC: number;
  readonly endTemperatureC: number;
}

export interface TemperEvent {
  readonly kind: "temper";
  readonly operationIndex: number;
  readonly temperatureC: number;
}

export type HeatTreatmentEvent = QuenchEvent | TemperEvent;

export interface WorkpieceState {
  readonly id: string;
  // 工件级材料供现有降阶公式读取，不代表焊合后的工件已物理均质化。
  readonly material: ForgeMaterial;
  // 操作历史中的累计层数摘要；不等同于空间层状几何或完整大马士革实现。
  readonly layerCount: number;
  readonly orientationQuarterTurns: 0 | 1 | 2 | 3;
  readonly feedOffset: number;
  readonly geometry: WorkpieceGeometry;
  readonly sections: readonly BladeSection[];
  readonly joints: readonly JointState[];
  readonly thermal: WorkpieceThermalState;
  readonly heatTreatments: readonly HeatTreatmentEvent[];
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
  /** Legacy orthogonal cut location. Omit when a finite path is supplied. */
  readonly sectionIndex?: number;
  readonly path?: {
    readonly id: string;
    readonly start: { readonly axialPosition: number; readonly lateralOffset: number };
    readonly end: { readonly axialPosition: number; readonly lateralOffset: number };
    readonly kerfWidth: number;
  };
}

// 焊合：把当前工件与指定 bench 工件合并；保留来源区域，工件级材料按体积汇总。
export interface WeldOperation {
  readonly kind: "weld";
  readonly benchIndex: number;
}

// 回火：记录回火温度事件；物性解释属于后续材料模型或下游规则。
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
  readonly stateVersion: string;
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
  readonly removedVolume: number;
  readonly blocks: readonly ForgeSnapshotBlock[];
}

export interface ForgeSnapshotBlock {
  readonly id: string;
  readonly materialId: string;
  readonly materialRegionId: string;
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

export interface ForgeSnapshotWorkpiece {
  readonly workpieceId: string;
  readonly materialId: string;
  readonly averageTemperatureC: number;
  readonly geometry: WorkpieceGeometry;
  readonly sections: readonly ForgeSnapshotSection[];
  readonly layerCount: number;
  readonly carbon: number;
  readonly materialRegionCount: number;
}

export interface ForgeSnapshot {
  readonly stateVersion: string;
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
  readonly geometry: WorkpieceGeometry;
  readonly sections: readonly ForgeSnapshotSection[];
  readonly hasCracks: boolean;
  readonly hasOverheatedSections: boolean;
  readonly quenchMedium: QuenchMedium | null;
  readonly quenchStartTemperatureC: number | null;
  readonly quenched: boolean;
  readonly edgeCoverage: number;
  readonly edgeEvenness: number;
  readonly layerCount: number;
  readonly carbon: number;
  readonly temperTemperatureC: number | null;
  readonly heatTreatmentCount: number;
  readonly materialRegionCount: number;
  readonly removedVolume: number;
  readonly benchCount: number;
  readonly bench: readonly ForgeSnapshotWorkpiece[];
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

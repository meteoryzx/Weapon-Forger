export type ForgePhase = "forging";

export interface ForgeMaterial {
  readonly id: string;
  readonly hotWorkability: number;
  readonly coldStressMultiplier: number;
  readonly damageResistance: number;
  readonly plasticityStartC: number;
  readonly plasticityPeakC: number;
  readonly overheatTemperatureC: number;
  readonly stressRecoveryAtPeak: number;
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
  // A normalized record of repeated local shaping for deterministic damage checks.
  readonly plasticStrain: number;
  readonly damage: number;
  readonly integrity: number;
  readonly thermalDamage: number;
  readonly verticalOffset: number;
  readonly lateralOffset: number;
  readonly cracked: boolean;
  readonly overheated: boolean;
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

export interface WorkpieceState {
  readonly id: string;
  readonly orientationQuarterTurns: 0 | 1 | 2 | 3;
  readonly feedOffset: number;
  readonly grid: WorkpieceGrid;
  readonly nodes: readonly WorkpieceNode[];
  readonly sections: readonly BladeSection[];
  readonly joints: readonly JointState[];
}

export interface HeatOperation {
  readonly kind: "heat";
  readonly temperatureC: number;
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
  readonly lateralBias: -1 | 0 | 1;
  readonly faceBias?: number;
}

// Reserved for the complete forging chain. S3a intentionally has no thermal-treatment rules yet.
export interface QuenchOperation {
  readonly kind: "quench";
  readonly medium: "water" | "oil";
}

export interface GrindOperation {
  readonly kind: "grind";
  readonly sectionIndex: number;
  readonly amount: number;
}

export type ForgeOperation = HeatOperation | RotateOperation | FeedOperation | HammerOperation | QuenchOperation | GrindOperation;
export type S3aForgeOperation = HeatOperation | RotateOperation | FeedOperation | HammerOperation;

export interface HammerIntent {
  readonly kind: "hammer";
  readonly sectionIndex: number;
  readonly energy: number;
  readonly lateralBias: -1 | 0 | 1;
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

export type ForgeIntent = HammerIntent | RotateIntent | FeedIntent;

export interface ForgeState {
  readonly parameterVersion: string;
  readonly phase: ForgePhase;
  readonly material: ForgeMaterial;
  readonly workpiece: WorkpieceState;
  readonly operations: readonly ForgeOperation[];
}

export interface ForgeSnapshotSection {
  readonly position: number;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly temperatureC: number;
  readonly plasticity: number;
  readonly thermalDamage: number;
  readonly damage: number;
  readonly verticalOffset: number;
  readonly lateralOffset: number;
  readonly cracked: boolean;
  readonly overheated: boolean;
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
  readonly thermalDamage: number;
  readonly damage: number;
  readonly verticalOffset: number;
  readonly lateralOffset: number;
  readonly cracked: boolean;
  readonly overheated: boolean;
}

export interface ForgeSnapshot {
  readonly parameterVersion: string;
  readonly orientationQuarterTurns: 0 | 1 | 2 | 3;
  readonly feedOffset: number;
  readonly grid: WorkpieceGrid;
  readonly nodes: readonly WorkpieceNode[];
  readonly sections: readonly ForgeSnapshotSection[];
  readonly hasCracks: boolean;
  readonly hasOverheatedSections: boolean;
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

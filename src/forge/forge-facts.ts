import { createForgeSnapshot, totalVolume } from "./forge-simulation.ts";
import { occupiedAxialCenter, solidBounds } from "./solid-geometry.ts";
import type { ForgeSnapshot, ForgeState } from "./forge-types.ts";

export interface ForgeFacts {
  readonly stateVersion: string;
  readonly parameterVersion: string;
  readonly carbon: number;
  readonly densityKgPerM3: number;
  readonly hardenability: number;
  readonly materialDamageResistance: number;
  readonly layerCount: number;
  readonly materialRegions: readonly {
    readonly regionId: string;
    readonly materialId: string;
    readonly volume: number;
  }[];
  readonly totalVolume: number;
  readonly totalLength: number;
  readonly centerOfMass: number;
  readonly averageThickness: number;
  readonly averageTemperatureC: number;
  readonly peakTemperatureC: number;
  readonly hotExposureSeconds: number;
  readonly stress: number;
  readonly plasticStrain: number;
  readonly elasticStrain: number;
  readonly mechanicalWorkJ: number;
  readonly damage: number;
  readonly cracked: boolean;
  readonly quenchMedium: "water" | "oil" | null;
  readonly quenchStartTemperatureC: number | null;
  readonly temperTemperatureC: number | null;
  readonly edgeCoverage: number;
  readonly edgeEvenness: number;
  readonly jointIntegrity: number;
  readonly heatTreatmentCount: number;
  readonly removedVolume: number;
}

export function createForgeFacts(
  state: ForgeState,
  snapshot: ForgeSnapshot = createForgeSnapshot(state),
): ForgeFacts {
  const sections = state.workpiece.sections.filter(section => section.blocks.length > 0);
  const occupiedBounds = state.workpiece.geometry.solids && solidBounds(state.workpiece.geometry.solids, state.workpiece.geometry);
  const totalLength = occupiedBounds ? occupiedBounds.maxX - occupiedBounds.minX : sections.reduce((sum, section) => sum + section.length, 0);
  const workpieceVolume = totalVolume(state);
  const centerOfMass = state.workpiece.geometry.solids ? occupiedAxialCenter(state.workpiece) : workpieceVolume === 0
    ? 0
    : sections.reduce((sum, section) => {
      const sectionVolume = section.blocks.reduce((subtotal, block) => subtotal + block.volume, 0);
      return sum + section.position * sectionVolume;
    }, 0) / workpieceVolume;

  return {
    stateVersion: state.stateVersion,
    parameterVersion: state.parameterVersion,
    carbon: state.workpiece.material.carbon,
    densityKgPerM3: state.workpiece.material.densityKgPerM3,
    hardenability: state.workpiece.material.hardenability,
    materialDamageResistance: state.workpiece.material.damageResistance,
    layerCount: state.workpiece.layerCount,
    materialRegions: materialRegionsOf(state),
    totalVolume: workpieceVolume,
    totalLength,
    centerOfMass,
    averageThickness: average(sections.map((section) => section.thickness)),
    averageTemperatureC: snapshot.averageTemperatureC,
    peakTemperatureC: snapshot.peakTemperatureC,
    hotExposureSeconds: snapshot.hotExposureSeconds,
    stress: average(sections.map((section) => section.stress)),
    plasticStrain: average(sections.map((section) => section.plasticStrain)),
    elasticStrain: average(sections.map((section) => section.elasticStrain)),
    mechanicalWorkJ: sections.reduce((sum, section) => sum + section.mechanicalWorkJ, 0),
    damage: Math.min(1, Math.max(
      average(sections.map((section) => section.damage)),
      snapshot.hasCracks ? 1 : 0,
    )),
    cracked: snapshot.hasCracks,
    quenchMedium: snapshot.quenchMedium,
    quenchStartTemperatureC: snapshot.quenchStartTemperatureC,
    temperTemperatureC: snapshot.temperTemperatureC,
    edgeCoverage: snapshot.edgeCoverage,
    edgeEvenness: snapshot.edgeEvenness,
    jointIntegrity: average(state.workpiece.joints.map((joint) => joint.integrity), 1),
    heatTreatmentCount: snapshot.heatTreatmentCount,
    removedVolume: snapshot.removedVolume,
  };
}

function materialRegionsOf(state: ForgeState): ForgeFacts["materialRegions"] {
  const regions = new Map<string, { materialId: string; volume: number }>();
  for (const section of state.workpiece.sections) {
    for (const block of section.blocks) {
      const current = regions.get(block.materialRegionId);
      regions.set(block.materialRegionId, {
        materialId: block.materialId,
        volume: (current?.volume ?? 0) + block.volume,
      });
    }
  }
  return [...regions.entries()].map(([regionId, region]) => ({ regionId, ...region }));
}

function average(values: readonly number[], fallback = 0): number {
  return values.length === 0 ? fallback : values.reduce((sum, value) => sum + value, 0) / values.length;
}

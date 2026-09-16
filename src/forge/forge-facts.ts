import { createForgeSnapshot, totalVolume } from "./forge-simulation.ts";
import { occupiedAxialCenter, solidBounds } from "./solid-geometry.ts";
import type { ForgeSnapshot, ForgeState } from "./forge-types.ts";

export interface ForgeSectionProfile {
  /** Centre of the occupied section along the workpiece axis. */
  readonly axialPositionMm: number;
  /** Volume-weighted mean of each cell's own height (volume / footprint). */
  readonly thicknessMm: number;
  readonly widthMm: number;
  readonly volumeMm3: number;
}

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
  /**
   * Volume-weighted mean thickness of the whole workpiece. A section's
   * `thickness` field is only its vertical span, so a locally thinned middle
   * with untouched edges would otherwise keep this number at the original
   * billet thickness no matter how far the piece is drawn out.
   */
  readonly averageThickness: number;
  readonly minimumThickness: number;
  readonly maximumThickness: number;
  /** Per-section shape, so downstream consumers can read the actual profile. */
  readonly sectionProfile: readonly ForgeSectionProfile[];
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
  // Summing per-section spans used to double as "length", but a deformed lattice
  // spreads a section's span without filling it, so that sum inflates: one blow
  // reported 418 mm on a 337 mm piece and 40 blows reported 1408 mm on 359 mm.
  // Measure the occupied axial extent instead.
  const totalLength = occupiedBounds ? occupiedBounds.maxX - occupiedBounds.minX : occupiedAxialExtent(state);
  const workpieceVolume = totalVolume(state);
  // Thickness is a property of a material column (one axial x lateral position),
  // not of a single cell: the billet is 8 mm thick but four cells tall, so one
  // cell's own height is only 2 mm. A section's vertical span is the wrong
  // measure too, because the edge strips a 32 mm hammer face never reaches stay
  // at the original thickness while the worked middle is really thinner.
  const columns = new Map<string, { sectionIndex: number; footprint: number; thickness: number; volumeMm3: number }>();
  state.workpiece.sections.forEach((section, sectionIndex) => {
    if (section.blocks.length === 0) return;
    for (const block of section.blocks) {
      const key = `${sectionIndex}:${block.widthIndex}`;
      const footprint = block.length * block.width;
      const column = columns.get(key) ?? { sectionIndex, footprint: 0, thickness: 0, volumeMm3: 0 };
      column.footprint = Math.max(column.footprint, footprint);
      column.thickness += footprint > 0 ? block.volume / footprint : 0;
      column.volumeMm3 += block.volume;
      columns.set(key, column);
    }
  });
  const occupiedColumns = [...columns.values()];
  const footprintMm2 = occupiedColumns.reduce((sum, column) => sum + column.footprint, 0);
  const meanThickness = footprintMm2 > 0
    ? occupiedColumns.reduce((sum, column) => sum + column.thickness * column.footprint, 0) / footprintMm2
    : 0;
  const sectionProfile = sections.map((section, index): ForgeSectionProfile => {
    const own = occupiedColumns.filter(column => column.sectionIndex === index);
    const ownFootprint = own.reduce((sum, column) => sum + column.footprint, 0);
    return {
      axialPositionMm: section.position,
      thicknessMm: ownFootprint > 0 ? own.reduce((sum, column) => sum + column.thickness * column.footprint, 0) / ownFootprint : 0,
      widthMm: section.width,
      volumeMm3: own.reduce((sum, column) => sum + column.volumeMm3, 0),
    };
  });
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
    averageThickness: meanThickness,
    minimumThickness: occupiedColumns.length === 0 ? 0 : Math.min(...occupiedColumns.map(column => column.thickness)),
    maximumThickness: occupiedColumns.length === 0 ? 0 : Math.max(...occupiedColumns.map(column => column.thickness)),
    sectionProfile,
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

/** Axial extent of the occupied lattice, ignoring empty sections and their nodes. */
function occupiedAxialExtent(state: ForgeState): number {
  const { grid, nodes } = state.workpiece.geometry;
  const plane = (grid.widthBlocks + 1) * (grid.heightBlocks + 1);
  let minimum = Infinity, maximum = -Infinity;
  state.workpiece.sections.forEach((section, index) => {
    if (section.blocks.length === 0) return;
    for (const axialIndex of [index, index + 1]) {
      const base = axialIndex * plane;
      for (let offset = 0; offset < plane; offset += 1) {
        const value = nodes[base + offset]?.axialPosition;
        if (value === undefined) continue;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    }
  });
  return Number.isFinite(minimum) ? maximum - minimum : 0;
}

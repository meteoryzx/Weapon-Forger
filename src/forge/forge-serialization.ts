import { FORGE_STATE_VERSION } from "./forge-rules.ts";
import { assertWorkpieceOutline, createStructuredWorkpieceGeometry } from "./workpiece-geometry.ts";
import type {
  ForgeState,
  HeatTreatmentEvent,
  WorkpieceGrid,
  WorkpieceNode,
  WorkpieceOutlinePoint,
  WorkpieceState,
} from "./forge-types.ts";

const PREVIOUS_FORGE_STATE_VERSION = "forge-state-2";

export function serializeForgeState(state: ForgeState): string {
  assertForgeState(state);
  return JSON.stringify(state);
}

export function deserializeForgeState(serialized: string): ForgeState {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Forge state must be valid JSON.");
  }
  const migrated = migrateForgeState(value);
  assertForgeState(migrated);
  return migrated;
}

export function assertForgeState(value: unknown): asserts value is ForgeState {
  const state = record(value, "Forge state");
  if (state.stateVersion !== FORGE_STATE_VERSION) {
    throw new Error(`Unsupported forge state version: ${String(state.stateVersion)}.`);
  }
  stringValue(state.parameterVersion, "Forge parameter version");
  const identities = {
    workpieces: new Set<string>(),
    nodes: new Set<string>(),
    blocks: new Set<string>(),
  };
  workpiece(state.workpiece, "Active workpiece", identities);
  arrayValue(state.bench, "Forge bench").forEach((item, index) => (
    workpiece(item, `Bench workpiece ${index}`, identities)
  ));
  arrayValue(state.operations, "Forge operations").forEach((item, index) => {
    const operation = record(item, `Forge operation ${index}`);
    stringValue(operation.kind, `Forge operation ${index} kind`);
  });
}

function workpiece(
  value: unknown,
  label: string,
  identities: { workpieces: Set<string>; nodes: Set<string>; blocks: Set<string> },
): asserts value is WorkpieceState {
  const item = record(value, label);
  stringValue(item.id, `${label} id`);
  uniqueId(identities.workpieces, item.id, "Workpiece");
  const material = record(item.material, `${label} material`);
  stringValue(material.id, `${label} material id`);
  positiveNumber(material.densityKgPerM3, `${label} density`);
  positiveInteger(item.layerCount, `${label} layer count`);

  const geometry = record(item.geometry, `${label} geometry`);
  if (geometry.kind !== "planar-height-field-v1") throw new Error(`${label} has an unsupported geometry kind.`);
  const grid = record(geometry.grid, `${label} geometry grid`);
  positiveInteger(grid.widthBlocks, `${label} grid width`);
  positiveInteger(grid.heightBlocks, `${label} grid height`);
  const nodes = arrayValue(geometry.nodes, `${label} geometry nodes`);
  nodes.forEach((node, index) => {
    const point = record(node, `${label} node ${index}`);
    stringValue(point.id, `${label} node ${index} id`);
    uniqueId(identities.nodes, point.id, "Geometry node");
    nonNegativeInteger(point.axialIndex, `${label} node ${index} axial index`);
    nonNegativeInteger(point.widthIndex, `${label} node ${index} width index`);
    nonNegativeInteger(point.heightIndex, `${label} node ${index} height index`);
    finiteNumber(point.axialPosition, `${label} node ${index} axial position`);
    finiteNumber(point.lateralOffset, `${label} node ${index} lateral offset`);
    finiteNumber(point.verticalOffset, `${label} node ${index} vertical offset`);
  });
  const outlineIds = new Set<string>();
  const outline = arrayValue(geometry.outline, `${label} geometry outline`);
  const outlinePoints: WorkpieceOutlinePoint[] = outline.map((point, index) => {
    const vertex = record(point, `${label} outline point ${index}`);
    stringValue(vertex.id, `${label} outline point ${index} id`);
    uniqueId(outlineIds, vertex.id, `${label} outline point`);
    finiteNumber(vertex.axialPosition, `${label} outline point ${index} axial position`);
    finiteNumber(vertex.lateralOffset, `${label} outline point ${index} lateral offset`);
    return {
      id: vertex.id,
      axialPosition: vertex.axialPosition,
      lateralOffset: vertex.lateralOffset,
    };
  });
  assertWorkpieceOutline(outlinePoints);

  const sections = arrayValue(item.sections, `${label} sections`);
  sections.forEach((section, sectionIndex) => {
    const slice = record(section, `${label} section ${sectionIndex}`);
    nonNegativeNumber(slice.removedVolume, `${label} section ${sectionIndex} removed volume`);
    arrayValue(slice.blocks, `${label} section ${sectionIndex} blocks`).forEach((block, blockIndex) => {
      const cell = record(block, `${label} block ${sectionIndex}:${blockIndex}`);
      stringValue(cell.id, `${label} block id`);
      uniqueId(identities.blocks, cell.id, "Geometry block");
      stringValue(cell.materialId, `${label} block material`);
      stringValue(cell.materialRegionId, `${label} block material region`);
      positiveNumber(cell.volume, `${label} block volume`);
    });
  });
  const expectedNodeCount = (sections.length + 1)
    * ((grid.widthBlocks as number) + 1)
    * ((grid.heightBlocks as number) + 1);
  if (nodes.length !== expectedNodeCount) throw new Error(`${label} geometry node count does not match its grid.`);
  arrayValue(item.joints, `${label} joints`).forEach((joint, index) => {
    const connection = record(joint, `${label} joint ${index}`);
    nonNegativeNumber(connection.contactArea, `${label} joint contact area`);
    finiteNumber(connection.weldTemperatureC, `${label} joint weld temperature`);
  });
  arrayValue(item.heatTreatments, `${label} heat treatments`).forEach((event, index) => {
    heatTreatment(event, `${label} heat treatment ${index}`);
  });
}

function migrateForgeState(value: unknown): unknown {
  const state = record(value, "Forge state");
  if (state.stateVersion !== PREVIOUS_FORGE_STATE_VERSION) return value;
  return {
    ...state,
    stateVersion: FORGE_STATE_VERSION,
    workpiece: migrateV2Workpiece(state.workpiece, "Active workpiece"),
    bench: arrayValue(state.bench, "Forge bench").map((item, index) => (
      migrateV2Workpiece(item, `Bench workpiece ${index}`)
    )),
  };
}

function migrateV2Workpiece(value: unknown, label: string): Record<string, unknown> {
  const item = record(value, label);
  stringValue(item.id, `${label} id`);
  const gridRecord = record(item.grid, `${label} grid`);
  positiveInteger(gridRecord.widthBlocks, `${label} grid width`);
  positiveInteger(gridRecord.heightBlocks, `${label} grid height`);
  const grid: WorkpieceGrid = {
    widthBlocks: gridRecord.widthBlocks as number,
    heightBlocks: gridRecord.heightBlocks as number,
  };
  const nodes: WorkpieceNode[] = arrayValue(item.nodes, `${label} nodes`).map((node, index) => {
    const point = record(node, `${label} node ${index}`);
    nonNegativeInteger(point.axialIndex, `${label} node ${index} axial index`);
    nonNegativeInteger(point.widthIndex, `${label} node ${index} width index`);
    nonNegativeInteger(point.heightIndex, `${label} node ${index} height index`);
    finiteNumber(point.axialPosition, `${label} node ${index} axial position`);
    finiteNumber(point.lateralOffset, `${label} node ${index} lateral offset`);
    finiteNumber(point.verticalOffset, `${label} node ${index} vertical offset`);
    return {
      id: `${item.id}:node:${point.axialIndex}:${point.widthIndex}:${point.heightIndex}`,
      axialIndex: point.axialIndex as number,
      widthIndex: point.widthIndex as number,
      heightIndex: point.heightIndex as number,
      axialPosition: point.axialPosition as number,
      lateralOffset: point.lateralOffset as number,
      verticalOffset: point.verticalOffset as number,
    };
  });
  const sourceSections = arrayValue(item.sections, `${label} sections`);
  const sections = sourceSections.map((section, sectionIndex) => {
    const slice = record(section, `${label} section ${sectionIndex}`);
    return {
      ...slice,
      blocks: arrayValue(slice.blocks, `${label} section ${sectionIndex} blocks`).map((block, blockIndex) => {
        const cell = record(block, `${label} block ${sectionIndex}:${blockIndex}`);
        nonNegativeInteger(cell.widthIndex, `${label} block width index`);
        nonNegativeInteger(cell.heightIndex, `${label} block height index`);
        return {
          ...cell,
          id: `${item.id}:cell:${sectionIndex}:${cell.widthIndex}:${cell.heightIndex}`,
        };
      }),
    };
  });
  const { grid: _grid, nodes: _nodes, sections: _sections, ...rest } = item;
  return {
    ...rest,
    geometry: createStructuredWorkpieceGeometry(item.id, grid, nodes, sections.length),
    sections,
  };
}

function heatTreatment(value: unknown, label: string): asserts value is HeatTreatmentEvent {
  const event = record(value, label);
  nonNegativeInteger(event.operationIndex, `${label} operation index`);
  if (event.kind === "quench") {
    if (event.medium !== "water" && event.medium !== "oil") throw new Error(`${label} has an invalid medium.`);
    finiteNumber(event.startTemperatureC, `${label} start temperature`);
    finiteNumber(event.endTemperatureC, `${label} end temperature`);
    return;
  }
  if (event.kind === "temper") {
    finiteNumber(event.temperatureC, `${label} temperature`);
    return;
  }
  throw new Error(`${label} has an invalid kind.`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function stringValue(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
}

function uniqueId(ids: Set<string>, id: string, label: string): void {
  if (ids.has(id)) throw new Error(`${label} ids must be unique.`);
  ids.add(id);
}

function finiteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite.`);
}

function positiveNumber(value: unknown, label: string): asserts value is number {
  finiteNumber(value, label);
  if (value <= 0) throw new Error(`${label} must be positive.`);
}

function nonNegativeNumber(value: unknown, label: string): asserts value is number {
  finiteNumber(value, label);
  if (value < 0) throw new Error(`${label} must not be negative.`);
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer.`);
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer.`);
}

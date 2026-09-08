import { FORGE_STATE_VERSION } from "./forge-rules.ts";
import type { ForgeState, HeatTreatmentEvent, WorkpieceState } from "./forge-types.ts";

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
  assertForgeState(value);
  return value;
}

export function assertForgeState(value: unknown): asserts value is ForgeState {
  const state = record(value, "Forge state");
  if (state.stateVersion !== FORGE_STATE_VERSION) {
    throw new Error(`Unsupported forge state version: ${String(state.stateVersion)}.`);
  }
  stringValue(state.parameterVersion, "Forge parameter version");
  workpiece(state.workpiece, "Active workpiece");
  arrayValue(state.bench, "Forge bench").forEach((item, index) => workpiece(item, `Bench workpiece ${index}`));
  arrayValue(state.operations, "Forge operations").forEach((item, index) => {
    const operation = record(item, `Forge operation ${index}`);
    stringValue(operation.kind, `Forge operation ${index} kind`);
  });
}

function workpiece(value: unknown, label: string): asserts value is WorkpieceState {
  const item = record(value, label);
  stringValue(item.id, `${label} id`);
  const material = record(item.material, `${label} material`);
  stringValue(material.id, `${label} material id`);
  positiveNumber(material.densityKgPerM3, `${label} density`);
  positiveInteger(item.layerCount, `${label} layer count`);

  const grid = record(item.grid, `${label} grid`);
  positiveInteger(grid.widthBlocks, `${label} grid width`);
  positiveInteger(grid.heightBlocks, `${label} grid height`);
  arrayValue(item.nodes, `${label} nodes`).forEach((node, index) => {
    const point = record(node, `${label} node ${index}`);
    finiteNumber(point.axialPosition, `${label} node ${index} axial position`);
    finiteNumber(point.lateralOffset, `${label} node ${index} lateral offset`);
    finiteNumber(point.verticalOffset, `${label} node ${index} vertical offset`);
  });
  arrayValue(item.sections, `${label} sections`).forEach((section, sectionIndex) => {
    const slice = record(section, `${label} section ${sectionIndex}`);
    nonNegativeNumber(slice.removedVolume, `${label} section ${sectionIndex} removed volume`);
    arrayValue(slice.blocks, `${label} section ${sectionIndex} blocks`).forEach((block, blockIndex) => {
      const cell = record(block, `${label} block ${sectionIndex}:${blockIndex}`);
      stringValue(cell.materialId, `${label} block material`);
      stringValue(cell.materialRegionId, `${label} block material region`);
      positiveNumber(cell.volume, `${label} block volume`);
    });
  });
  arrayValue(item.joints, `${label} joints`).forEach((joint, index) => {
    const connection = record(joint, `${label} joint ${index}`);
    nonNegativeNumber(connection.contactArea, `${label} joint contact area`);
    finiteNumber(connection.weldTemperatureC, `${label} joint weld temperature`);
  });
  arrayValue(item.heatTreatments, `${label} heat treatments`).forEach((event, index) => {
    heatTreatment(event, `${label} heat treatment ${index}`);
  });
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

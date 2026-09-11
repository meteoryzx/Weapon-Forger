import { describe, expect, it } from "vitest";

import {
  applyForgeOperation,
  createForgeState,
  deserializeForgeState,
  serializeForgeState,
} from "../../src/forge/index.ts";

describe("forge state serialization", () => {
  it("round-trips the versioned raw state", () => {
    let state = createForgeState({ sectionCount: 8 });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 900 });
    state = applyForgeOperation(state, { kind: "quench", medium: "oil" });

    expect(deserializeForgeState(serializeForgeState(state))).toEqual(state);
  });

  it("rejects malformed JSON and unsupported state versions", () => {
    expect(() => deserializeForgeState("not-json")).toThrow("valid JSON");
    const state = createForgeState({ sectionCount: 8 });
    expect(() => deserializeForgeState(JSON.stringify({ ...state, stateVersion: "future-state" })))
      .toThrow("Unsupported forge state version");
  });

  it("rejects the previous schema until an explicit migration exists", () => {
    const state = createForgeState({ sectionCount: 8 });
    expect(() => deserializeForgeState(JSON.stringify({ ...state, stateVersion: "forge-state-1" })))
      .toThrow("Unsupported forge state version");
  });

  it("migrates forge-state-2 workpieces into the identified geometry boundary", () => {
    let state = createForgeState({ sectionCount: 8 });
    state = applyForgeOperation(state, { kind: "select-material", materialId: "spring-steel" });
    const legacy = JSON.parse(serializeForgeState(state)) as Record<string, unknown>;
    legacy.stateVersion = "forge-state-2";
    for (const piece of [legacy.workpiece, ...(legacy.bench as unknown[])]) {
      const workpiece = piece as Record<string, unknown>;
      const geometry = workpiece.geometry as {
        grid: unknown;
        nodes: Record<string, unknown>[];
      };
      workpiece.grid = geometry.grid;
      workpiece.nodes = geometry.nodes.map(({ id: _id, ...node }) => node);
      delete workpiece.geometry;
      for (const section of workpiece.sections as { blocks: Record<string, unknown>[] }[]) {
        section.blocks.forEach((block) => delete block.id);
      }
    }

    expect(deserializeForgeState(JSON.stringify(legacy))).toEqual(state);
  });

  it("rejects missing material provenance", () => {
    const state = createForgeState({ sectionCount: 8 });
    const serialized = JSON.parse(serializeForgeState(state)) as {
      workpiece: { sections: { blocks: Record<string, unknown>[] }[] };
    };
    delete serialized.workpiece.sections[0]?.blocks[0]?.materialRegionId;
    expect(() => deserializeForgeState(JSON.stringify(serialized))).toThrow("material region");
  });

  it("rejects duplicate geometry unit identities", () => {
    const state = createForgeState({ sectionCount: 8 });
    const serialized = JSON.parse(serializeForgeState(state)) as {
      workpiece: { geometry: { nodes: { id: string }[] } };
    };
    serialized.workpiece.geometry.nodes[1]!.id = serialized.workpiece.geometry.nodes[0]!.id;
    expect(() => deserializeForgeState(JSON.stringify(serialized))).toThrow("ids must be unique");
  });
});

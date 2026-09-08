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

  it("rejects missing material provenance", () => {
    const state = createForgeState({ sectionCount: 8 });
    const serialized = JSON.parse(serializeForgeState(state)) as {
      workpiece: { sections: { blocks: Record<string, unknown>[] }[] };
    };
    delete serialized.workpiece.sections[0]?.blocks[0]?.materialRegionId;
    expect(() => deserializeForgeState(JSON.stringify(serialized))).toThrow("material region");
  });
});

import { describe, expect, it } from "vitest";
import {
  applyForgeOperation,
  createForgeFacts,
  createForgeState,
  totalVolume,
  type ForgeState,
} from "../../src/forge/index.ts";

describe("R1 single-workpiece chain", () => {
  it("preserves identity, geometry facts and process history across the base workflow", () => {
    const initial = createForgeState({ sectionCount: 16 });
    const initialId = initial.workpiece.id;
    const initialVolume = totalVolume(initial);
    let state: ForgeState = applyForgeOperation(initial, {
      kind: "cut",
      path: {
        id: "r1-chain-cut",
        start: { axialPosition: 6, lateralOffset: -18 },
        end: { axialPosition: 6, lateralOffset: 18 },
        kerfWidth: 1,
      },
    });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 950 });
    state = applyForgeOperation(state, {
      kind: "hammer",
      sectionIndex: 8,
      energy: 0.45,
    });
    state = applyForgeOperation(state, { kind: "quench", medium: "oil" });
    state = applyForgeOperation(state, {
      kind: "temper",
      temperatureC: 220,
      durationMs: 60_000,
    });
    state = applyForgeOperation(state, {
      kind: "grind",
      sectionIndex: 8,
      amount: 0.35,
      contact: {
        axialPosition: 8,
        verticalOffset: 0,
        axialWidth: 5,
        verticalHeight: 24,
        depth: 1.5,
        angle: Math.PI / 8,
      },
    });

    const facts = createForgeFacts(state);
    expect(state.workpiece.id).toBe(initialId);
    expect(facts.totalVolume).toBeLessThan(initialVolume);
    expect(facts.removedVolume).toBeGreaterThan(0);
    expect(facts.quenchMedium).toBe("oil");
    expect(facts.temperTemperatureC).toBe(220);
    expect(facts.mechanicalWorkJ).toBeGreaterThan(0);
    expect(facts.heatTreatmentCount).toBe(2);
    expect(facts.materialRegions.length).toBeGreaterThan(0);
    expect(facts.totalLength).toBeGreaterThan(0);
    expect(facts.averageThickness).toBeGreaterThan(0);
    expect(state.operations.map(operation => operation.kind)).toEqual([
      "cut",
      "heat",
      "hammer",
      "quench",
      "temper",
      "grind",
    ]);
  });
});

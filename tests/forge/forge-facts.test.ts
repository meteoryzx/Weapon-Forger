import { describe, expect, it } from "vitest";

import {
  applyForgeOperation,
  createForgeFacts,
  createForgeState,
  type ForgeOperation,
} from "../../src/forge/index.ts";

describe("forge facts", () => {
  it("exports raw facts after an eight-verb sample without host attributes", () => {
    const operations: readonly ForgeOperation[] = [
      { kind: "select-material", materialId: "high-carbon-steel" },
      { kind: "select-workpiece", benchIndex: 0 },
      { kind: "heat", temperatureC: 950 },
      { kind: "cut", sectionIndex: 4 },
      { kind: "weld", benchIndex: 1 },
      { kind: "hammer", sectionIndex: 3, energy: 0.6, faceBias: 0.5 },
      { kind: "quench", medium: "water" },
      { kind: "temper", temperatureC: 220 },
      { kind: "grind", sectionIndex: 3, amount: 0.8 },
    ];
    const state = operations.reduce(applyForgeOperation, createForgeState({ sectionCount: 8 }));
    const facts = createForgeFacts(state);

    expect(facts.materialRegions).toHaveLength(2);
    expect(facts.layerCount).toBe(2);
    expect(facts.jointIntegrity).toBeGreaterThan(0);
    expect(facts.quenchMedium).toBe("water");
    expect(facts.temperTemperatureC).toBe(220);
    expect(facts.removedVolume).toBeGreaterThan(0);
    expect(facts.mechanicalWorkJ).toBeGreaterThan(0);
    expect(facts).not.toHaveProperty("attributes");
    expect(facts).not.toHaveProperty("story");
  });
});

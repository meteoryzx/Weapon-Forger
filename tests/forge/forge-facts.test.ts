import { describe, expect, it } from "vitest";

import {
  applyForgeOperation,
  createForgeFacts,
  createForgeState,
  HAMMER_HOME,
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

  it("reports a thickness profile that follows the hammered shape", () => {
    const start = applyForgeOperation(createForgeState({ sectionCount: 24 }), { kind: "heat", temperatureC: 950 });
    const initial = createForgeFacts(start);
    expect(initial.averageThickness).toBeCloseTo(8, 2);
    expect(initial.minimumThickness).toBeCloseTo(8, 2);
    expect(initial.sectionProfile).toHaveLength(24);

    let state = start;
    for (const x of [-12, -4, 4, 12]) {
      state = applyForgeOperation(state, {
        kind: "surface-hammer",
        pose: { ...HAMMER_HOME, x },
        target: { x: 0, z: 0 },
        energy: 0.8,
      });
    }
    const drawn = createForgeFacts(state);

    // A section's vertical span can stay at the original billet thickness while
    // the material is really drawn out, so the reported facts must come from
    // the deformed volume instead of that span.
    expect(drawn.totalVolume).toBeCloseTo(initial.totalVolume, 3);
    expect(drawn.totalLength).toBeGreaterThan(initial.totalLength);
    expect(drawn.averageThickness).toBeLessThan(initial.averageThickness * 0.95);
    expect(drawn.minimumThickness).toBeLessThan(initial.minimumThickness);
    expect(drawn.minimumThickness).toBeLessThanOrEqual(drawn.averageThickness);
    expect(drawn.maximumThickness).toBeGreaterThanOrEqual(drawn.averageThickness);
    expect(drawn.sectionProfile.reduce((sum, entry) => sum + entry.volumeMm3, 0)).toBeCloseTo(initial.totalVolume, 3);
    expect(drawn.sectionProfile.every(entry => entry.thicknessMm > 0 && entry.widthMm > 0)).toBe(true);
    expect(createForgeFacts(state)).toEqual(drawn);
  });
});

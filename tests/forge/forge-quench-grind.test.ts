import { describe, expect, it } from "vitest";

import {
  applyForgeIntent,
  applyForgeOperation,
  createForgeSnapshot,
  createForgeState,
  replayForgeState,
  type ForgeOperation,
} from "../../src/forge/index.ts";

describe("quench and grind", () => {
  it("quench records its medium and start temperature, then cools to ambient", () => {
    let state = createForgeState();
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 900 });
    const quenched = applyForgeOperation(state, { kind: "quench", medium: "water" });

    expect(quenched.workpiece.quench).toEqual({ medium: "water", startTemperatureC: 900 });
    expect(createForgeSnapshot(quenched).averageTemperatureC).toBeLessThan(40);
    expect(createForgeSnapshot(quenched).quenched).toBe(true);
    expect(createForgeSnapshot(quenched).quenchMedium).toBe("water");
  });

  it("grinds a stroke along the edge, emphasizing the clicked section", () => {
    let state = createForgeState({ sectionCount: 8 });
    state = applyForgeOperation(state, { kind: "grind", sectionIndex: 3, amount: 0.5 });
    state = applyForgeOperation(state, { kind: "grind", sectionIndex: 3, amount: 0.5 });
    const snapshot = createForgeSnapshot(state);

    expect(snapshot.sections[3]?.groundAmount).toBe(1);
    expect(snapshot.sections[0]?.groundAmount).toBeLessThan(1);
    expect(snapshot.sections[3]?.groundAmount).toBeGreaterThan(snapshot.sections[0]?.groundAmount ?? 0);
    expect(snapshot.edgeCoverage).toBeGreaterThan(0);
    expect(snapshot.edgeEvenness).toBeLessThan(1);
  });

  it("rejects invalid quench and grind inputs before changing state", () => {
    const initial = createForgeState();
    expect(() => applyForgeIntent(initial, { kind: "quench", medium: "mud" as "water" })).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "grind", sectionIndex: 999, amount: 0.5 })).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "grind", sectionIndex: 0, amount: 0 })).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "grind", sectionIndex: 0, amount: 1.5 })).toThrow();
    expect(initial.operations).toHaveLength(0);
  });

  it("replays a mixed chain including quench and grind deterministically", () => {
    const initial = createForgeState({ sectionCount: 8 });
    const operations: ForgeOperation[] = [
      { kind: "heat", temperatureC: 950 },
      { kind: "quench", medium: "oil" },
      { kind: "grind", sectionIndex: 2, amount: 0.6 },
      { kind: "grind", sectionIndex: 5, amount: 0.4 },
    ];
    const direct = replayForgeState(initial, operations);
    const replayed = replayForgeState(JSON.parse(JSON.stringify(initial)), JSON.parse(JSON.stringify(operations)));
    expect(replayed).toEqual(direct);
  });
});

import { describe, expect, it } from "vitest";

import {
  applyForgeIntent,
  applyForgeOperation,
  createForgeSnapshot,
  createForgeState,
  replayForgeState,
  type ForgeOperation,
  HIGH_CARBON_STEEL,
} from "../../src/forge/index.ts";

describe("quench and grind", () => {
  it("records interaction facts and preserves partial cooling for a shallow moving quench", () => {
    let state = applyForgeOperation(createForgeState({ sectionCount: 8 }), { kind: "heat", temperatureC: 900 });
    state = applyForgeOperation(state, {
      kind: "quench", medium: "oil", immersion: 0.35, movement: 0.2, dwellMs: 120, exitTemperatureC: 610,
    });
    const event = state.workpiece.heatTreatments.at(-1);
    expect(event).toMatchObject({ kind: "quench", medium: "oil", immersion: 0.35, movement: 0.2, dwellMs: 120, exitTemperatureC: 610 });
    expect(event?.kind === "quench" ? event.endTemperatureC : 0).toBeGreaterThan(40);
    expect(event?.kind === "quench" ? event.endTemperatureC : 0).toBeLessThan(900);
  });

  it("quench records its medium and start temperature, then cools to ambient", () => {
    let state = createForgeState();
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 900 });
    const quenched = applyForgeOperation(state, { kind: "quench", medium: "water" });

    expect(quenched.workpiece.heatTreatments.at(-1)).toEqual({
      kind: "quench",
      operationIndex: 1,
      medium: "water",
      startTemperatureC: 900,
      endTemperatureC: 20,
    });
    expect(createForgeSnapshot(quenched).averageTemperatureC).toBeLessThan(40);
    expect(createForgeSnapshot(quenched).quenched).toBe(true);
    expect(createForgeSnapshot(quenched).quenchMedium).toBe("water");
  });

  it("cools only immersed blocks and does not cool on zero-dwell contact", () => {
    let state = applyForgeOperation(createForgeState({ sectionCount: 8 }), { kind: "heat", temperatureC: 900 });
    const untouched = state.workpiece.sections.flatMap((section) => section.blocks)
      .filter((block) => block.heightIndex > 0)
      .map((block) => block.temperatureC);
    state = applyForgeOperation(state, { kind: "quench", medium: "water", immersion: 0.25, movement: 0, dwellMs: 0 });
    const blocks = state.workpiece.sections.flatMap((section) => section.blocks);
    expect(blocks.filter((block) => block.heightIndex === 0).every((block) => block.temperatureC < 900)).toBe(true);
    expect(blocks.filter((block) => block.heightIndex > 0).map((block) => block.temperatureC)).toEqual(untouched);
  });

  it("turns severe high-carbon water quench into a real crack state", () => {
    let state = applyForgeOperation(
      createForgeState({ material: HIGH_CARBON_STEEL, sectionCount: 8 }),
      { kind: "heat", temperatureC: 900 },
    );
    state = applyForgeOperation(state, {
      kind: "quench", medium: "water", immersion: 1, movement: 0.8, dwellMs: 1_000,
    });
    const blocks = state.workpiece.sections.flatMap((section) => section.blocks);
    expect(blocks.some((block) => block.cracked)).toBe(true);
    expect(blocks.some((block) => block.thermalDamage > 0)).toBe(true);
    expect(blocks.some((block) => block.stress > 0)).toBe(true);
  });

  it("makes oil quench less damaging than the same water quench", () => {
    const heated = applyForgeOperation(
      createForgeState({ material: HIGH_CARBON_STEEL, sectionCount: 8 }),
      { kind: "heat", temperatureC: 900 },
    );
    const water = applyForgeOperation(heated, { kind: "quench", medium: "water", immersion: 1, movement: 0.8, dwellMs: 1_000 });
    const oil = applyForgeOperation(heated, { kind: "quench", medium: "oil", immersion: 1, movement: 0.8, dwellMs: 1_000 });
    const waterDamage = water.workpiece.sections.flatMap((section) => section.blocks).reduce((sum, block) => sum + block.damage, 0);
    const oilDamage = oil.workpiece.sections.flatMap((section) => section.blocks).reduce((sum, block) => sum + block.damage, 0);
    expect(waterDamage).toBeGreaterThan(oilDamage);
  });

  it("grinds a stroke along the edge, emphasizing the clicked section", () => {
    let state = createForgeState({ sectionCount: 8 });
    const beforeVolume = state.workpiece.sections.reduce(
      (sum, section) => sum + section.blocks.reduce((subtotal, block) => subtotal + block.volume, 0),
      0,
    );
    state = applyForgeOperation(state, { kind: "grind", sectionIndex: 3, amount: 0.5 });
    state = applyForgeOperation(state, { kind: "grind", sectionIndex: 3, amount: 0.5 });
    const snapshot = createForgeSnapshot(state);

    expect(snapshot.sections[3]?.groundAmount).toBe(1);
    expect(snapshot.sections[0]?.groundAmount).toBeLessThan(1);
    expect(snapshot.sections[3]?.groundAmount).toBeGreaterThan(snapshot.sections[0]?.groundAmount ?? 0);
    expect(snapshot.edgeCoverage).toBeGreaterThan(0);
    expect(snapshot.edgeEvenness).toBeLessThan(1);
    expect(snapshot.removedVolume).toBeGreaterThan(0);
    expect(snapshot.removedVolume + state.workpiece.sections.reduce(
      (sum, section) => sum + section.blocks.reduce((subtotal, block) => subtotal + block.volume, 0),
      0,
    )).toBeCloseTo(beforeVolume, 8);
  });

  it("removes only the finite rotated contact patch and conserves solid volume", () => {
    let state = createForgeState({ sectionCount: 8 });
    const before = state.workpiece.geometry.nodes.map(node => node.verticalOffset);
    state = applyForgeOperation(state, {
      kind: "grind", sectionIndex: 3, amount: 1,
      contact: { axialPosition: 7, verticalOffset: 0, axialWidth: 4, verticalHeight: 28, depth: 2, angle: Math.PI / 6 },
    });
    expect(state.workpiece.sections[0]?.removedVolume).toBe(0);
    expect(state.workpiece.sections.some(section => section.removedVolume > 0)).toBe(true);
    expect(state.workpiece.geometry.solids).toBeUndefined();
    expect(state.workpiece.geometry.nodes.some((node, index) => node.verticalOffset < before[index]!)).toBe(true);
  });

  it("retains repeated quench and temper events in order", () => {
    let state = createForgeState({ sectionCount: 8 });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 900 });
    state = applyForgeOperation(state, { kind: "quench", medium: "oil" });
    state = applyForgeOperation(state, { kind: "temper", temperatureC: 180 });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 860 });
    state = applyForgeOperation(state, { kind: "quench", medium: "water" });

    expect(state.workpiece.heatTreatments.map((event) => event.kind)).toEqual(["quench", "temper", "quench"]);
    expect(createForgeSnapshot(state).heatTreatmentCount).toBe(3);
    expect(createForgeSnapshot(state).quenchMedium).toBe("water");
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

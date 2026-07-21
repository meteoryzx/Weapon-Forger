import { describe, expect, it } from "vitest";

import {
  applyForgeOperation,
  applyForgeIntent,
  createForgeSnapshot,
  createForgeState,
  replayForgeState,
  totalVolume,
  type ForgeOperation,
  type ForgeState,
} from "../../src/forge/index.ts";

const CENTER = 4;

function forgeAt(temperatureC: number, operations: readonly ForgeOperation[] = []): ForgeState {
  let state = createForgeState({ sectionCount: 9 });
  state = applyForgeOperation(state, { kind: "heat", temperatureC });
  for (const operation of operations) {
    state = applyForgeOperation(state, operation);
  }
  return state;
}

function center(state: ForgeState) {
  const section = state.workpiece.sections[CENTER];
  if (!section) {
    throw new Error("Missing center section.");
  }
  return section;
}

describe("forge simulation", () => {
  it("turns a workpiece through a replayable rotate intent", () => {
    const initial = createForgeState({ sectionCount: 9 });
    const turned = applyForgeIntent(initial, { kind: "rotate", quarterTurns: 1 });

    expect(turned.workpiece.orientationQuarterTurns).toBe(1);
    expect(turned.operations).toEqual([{ kind: "rotate", quarterTurns: 1 }]);
  });

  it("feeds the whole billet along its long axis with clamped ends", () => {
    let state = createForgeState({ sectionCount: 9 });

    expect(state.workpiece.feedOffset).toBe(0);
    state = applyForgeIntent(state, { kind: "feed", step: -1 });
    expect(state.workpiece.feedOffset).toBeLessThan(0);
    state = applyForgeIntent(state, { kind: "feed", step: 1 });
    expect(state.workpiece.feedOffset).toBe(0);

    for (let index = 0; index < 12; index += 1) {
      state = applyForgeIntent(state, { kind: "feed", step: -1 });
    }

    expect(state.workpiece.feedOffset).toBe(-63);
    expect(state.operations.at(-1)).toEqual({ kind: "feed", step: -1 });
  });

  it("replays the same serializable start and operation history", () => {
    const initial = createForgeState({ sectionCount: 9 });
    const operations: ForgeOperation[] = [
      { kind: "heat", temperatureC: 950 },
      { kind: "feed", step: -1 },
      { kind: "hammer", sectionIndex: CENTER, energy: 0.7, lateralBias: -1 },
      { kind: "rotate", quarterTurns: 1 },
      { kind: "hammer", sectionIndex: CENTER, energy: 0.45, lateralBias: 0 },
    ];

    const direct = replayForgeState(initial, operations);
    const replayed = replayForgeState(JSON.parse(JSON.stringify(initial)), JSON.parse(JSON.stringify(operations)));

    expect(replayed).toEqual(direct);
    expect(initial.operations).toHaveLength(0);
  });

  it("deforms hot material more and accumulates more cold stress", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 0.85, lateralBias: 0 };
    const hot = forgeAt(950, [hammer]);
    const cold = forgeAt(500, [hammer]);
    const original = center(createForgeState({ sectionCount: 9 }));

    expect(original.thickness - center(hot).thickness).toBeGreaterThan(original.thickness - center(cold).thickness);
    expect(center(cold).stress).toBeGreaterThan(center(hot).stress);
  });

  it("gives a full-force hot hammer blow a clearly visible local compression", () => {
    const hot = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 }]);

    expect(center(hot).thickness).toBeLessThan(7.2);
  });

  it("changes the affected axis after a quarter-turn", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 0.8, lateralBias: 0 };
    const original = center(createForgeState({ sectionCount: 9 }));
    const faceOn = forgeAt(950, [hammer]);
    const edgeOn = forgeAt(950, [{ kind: "rotate", quarterTurns: 1 }, hammer]);

    expect(center(faceOn).thickness).toBeLessThan(original.thickness);
    expect(center(faceOn).width).toBeGreaterThan(original.width);
    expect(center(edgeOn).width).toBeLessThan(original.width);
    expect(center(edgeOn).thickness).toBeGreaterThan(original.thickness);
  });

  it("smooths hammering across neighbours and preserves approximate volume", () => {
    const initial = createForgeState({ sectionCount: 9 });
    const result = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: 0 }]);
    const centerChange = center(result).thickness - center(initial).thickness;
    const neighbour = result.workpiece.sections[CENTER - 1];
    const initialNeighbour = initial.workpiece.sections[CENTER - 1];
    if (!neighbour || !initialNeighbour) {
      throw new Error("Missing neighbouring section.");
    }
    const neighbourChange = neighbour.thickness - initialNeighbour.thickness;

    expect(Math.abs(neighbourChange)).toBeGreaterThan(0);
    expect(Math.abs(neighbourChange)).toBeLessThan(Math.abs(centerChange));
    expect(center(result).length).toBeGreaterThan(center(initial).length);
    expect(Math.abs(totalVolume(result) - totalVolume(initial))).toBeLessThan(0.000001);
  });

  it("relieves stress when reheated without repairing existing damage", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 };
    const coldWorked = forgeAt(450, [hammer, hammer]);
    const reheated = applyForgeOperation(coldWorked, { kind: "heat", temperatureC: 950 });

    expect(center(reheated).stress).toBeLessThan(center(coldWorked).stress);
    expect(center(reheated).integrity).toBe(center(coldWorked).integrity);
    expect(center(reheated).cracked).toBe(center(coldWorked).cracked);
  });

  it("adds deterministic thermal damage from repeated overheating", () => {
    let state = createForgeState({ sectionCount: 9 });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 1200 });
    const once = state;
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 1200 });
    const snapshot = createForgeSnapshot(state);

    expect(center(state).thermalDamage).toBeGreaterThan(center(once).thermalDamage);
    expect(center(state).overheated).toBe(true);
    expect(snapshot.hasOverheatedSections).toBe(true);
  });

  it("bends after one-sided hits and can be corrected from the opposite side", () => {
    const oneSided = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: 1 }]);
    const corrected = forgeAt(950, [
      { kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: 1 },
      { kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: -1 },
    ]);

    expect(Math.abs(center(oneSided).lateralOffset)).toBeGreaterThan(0);
    expect(Math.abs(center(corrected).lateralOffset)).toBeLessThan(Math.abs(center(oneSided).lateralOffset));
  });

  it("creates deterministic cracks from repeated cold heavy impacts", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 };
    const result = forgeAt(450, [hammer, hammer, hammer, hammer, hammer]);
    const snapshot = createForgeSnapshot(result);

    expect(center(result).cracked).toBe(true);
    expect(snapshot.hasCracks).toBe(true);
    expect(snapshot.sections.some((section) => section.cracked)).toBe(true);
  });

  it("treats crack risk as local cold-working damage rather than raw stress", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 };
    const hot = forgeAt(950, [hammer, hammer, hammer, hammer, hammer]);
    const spreadOut = forgeAt(450, [
      { kind: "hammer", sectionIndex: CENTER - 2, energy: 1, lateralBias: 0 },
      { kind: "hammer", sectionIndex: CENTER - 1, energy: 1, lateralBias: 0 },
      { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 },
      { kind: "hammer", sectionIndex: CENTER + 1, energy: 1, lateralBias: 0 },
      { kind: "hammer", sectionIndex: CENTER + 2, energy: 1, lateralBias: 0 },
    ]);

    expect(center(hot).cracked).toBe(false);
    expect(center(hot).integrity).toBeGreaterThan(0.98);
    expect(spreadOut.workpiece.sections.some((section) => section.cracked)).toBe(false);
  });

  it("rejects invalid external operations before changing a state", () => {
    const initial = createForgeState({ sectionCount: 9 });

    expect(() => applyForgeOperation(initial, { kind: "heat", temperatureC: 1401 })).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "rotate", quarterTurns: 2 } as unknown as ForgeOperation)).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "feed", step: 0 } as unknown as ForgeOperation)).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 3 } as unknown as ForgeOperation)).toThrow();
    expect(initial.operations).toHaveLength(0);
    expect(center(initial).integrity).toBe(1);
  });
});

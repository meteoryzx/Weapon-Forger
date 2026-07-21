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
  type BladeBlock,
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

function block(state: ForgeState, widthIndex = 2, heightIndex = 3, sectionIndex = CENTER): BladeBlock {
  const result = state.workpiece.sections[sectionIndex]?.blocks.find(
    (candidate) => candidate.widthIndex === widthIndex && candidate.heightIndex === heightIndex,
  );
  if (!result) {
    throw new Error("Missing target block.");
  }
  return result;
}

describe("forge simulation", () => {
  it("creates 24 sections made from a solid 4 by 4 block grid", () => {
    const state = createForgeState();

    expect(state.workpiece.sections).toHaveLength(24);
    expect(state.workpiece.grid).toEqual({ widthBlocks: 4, heightBlocks: 4 });
    expect(state.workpiece.sections.every((section) => section.blocks.length === 16)).toBe(true);
    expect(new Set(center(createForgeState({ sectionCount: 9 })).blocks.map((item) => `${item.widthIndex}:${item.heightIndex}`)).size).toBe(16);
  });

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

    const first = state.workpiece.sections[0];
    const last = state.workpiece.sections.at(-1);
    if (!first || !last) {
      throw new Error("Missing sections for feed bounds.");
    }
    const halfLength = (last.position + last.length / 2 - (first.position - first.length / 2)) / 2;

    expect(state.workpiece.feedOffset).toBe(-halfLength);
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

    expect(block(originalState()).thickness - block(hot).thickness).toBeGreaterThan(
      block(originalState()).thickness - block(cold).thickness,
    );
    expect(block(cold).stress).toBeGreaterThan(block(hot).stress);
  });

  it("gives a full-force hot hammer blow a clearly visible local compression", () => {
    const hot = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 }]);

    expect(block(hot).thickness).toBeLessThan(1.8);
  });

  it("changes the affected axis after a quarter-turn", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 0.8, lateralBias: 0 };
    const original = createForgeState({ sectionCount: 9 });
    const faceOn = forgeAt(950, [hammer]);
    const edgeOn = forgeAt(950, [{ kind: "rotate", quarterTurns: 1 }, hammer]);

    expect(block(faceOn).thickness).toBeLessThan(block(original).thickness);
    expect(block(faceOn).width).toBeGreaterThan(block(original).width);
    expect(block(edgeOn, 0, 2).width).toBeLessThan(block(original, 0, 2).width);
    expect(block(edgeOn, 0, 2).thickness).toBeGreaterThan(block(original, 0, 2).thickness);
  });

  it("moves only the struck face instead of collapsing both faces toward the center", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 0.8, lateralBias: 0 };
    const original = createForgeState({ sectionCount: 9 });
    const faceOn = forgeAt(950, [hammer]);
    const edgeOn = forgeAt(950, [{ kind: "rotate", quarterTurns: 1 }, hammer]);

    expect(block(faceOn).verticalOffset).toBeLessThan(block(original).verticalOffset);
    expect(block(faceOn).lateralOffset).toBe(block(original).lateralOffset);
    expect(block(edgeOn, 0, 2).verticalOffset).toBe(block(original, 0, 2).verticalOffset);
    expect(block(edgeOn, 0, 2).lateralOffset).toBeGreaterThan(block(original, 0, 2).lateralOffset);
  });

  it("keeps the supported face in place while the struck face moves inward", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 0.8, lateralBias: 0 };
    const original = createForgeState({ sectionCount: 9 });
    const result = forgeAt(950, [hammer]);

    const originalBottom = block(original, 2, 0).verticalOffset - block(original, 2, 0).thickness / 2;
    const resultBottom = block(result, 2, 0).verticalOffset - block(result, 2, 0).thickness / 2;
    const originalTop = block(original).verticalOffset + block(original).thickness / 2;
    const resultTop = block(result).verticalOffset + block(result).thickness / 2;

    expect(resultBottom).toBeCloseTo(originalBottom);
    expect(resultTop).toBeLessThan(originalTop);
  });

  it("smooths hammering across neighbours and preserves approximate volume", () => {
    const initial = createForgeState({ sectionCount: 9 });
    const result = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: 0 }]);
    const centerChange = block(result).thickness - block(initial).thickness;
    const neighbourChange = block(result, 2, 3, CENTER - 1).thickness - block(initial, 2, 3, CENTER - 1).thickness;

    expect(Math.abs(neighbourChange)).toBeGreaterThan(0);
    expect(Math.abs(neighbourChange)).toBeLessThan(Math.abs(centerChange));
    expect(block(result).length).toBeGreaterThan(block(initial).length);
    expect(Math.abs(totalVolume(result) - totalVolume(initial))).toBeLessThan(0.000001);
  });

  it("transmits a surface hit through stacked blocks with depth attenuation", () => {
    const initial = forgeAt(950);
    const leftHit = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, faceBias: 0, energy: 0.9, lateralBias: 0 }]);
    const rightHit = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, faceBias: 1, energy: 0.9, lateralBias: 0 }]);

    expect(block(leftHit, 0, 3).thickness).toBeLessThan(block(initial, 0, 3).thickness);
    expect(block(leftHit, 1, 3).thickness).toBeLessThan(block(initial, 1, 3).thickness);
    expect(block(leftHit, 3, 3)).toEqual(block(initial, 3, 3));
    expect(block(leftHit, 0, 2).thickness).toBeLessThan(block(initial, 0, 2).thickness);
    expect(block(leftHit, 0, 2).thickness - block(leftHit, 0, 3).thickness).toBeGreaterThan(0);
    expect(block(leftHit, 0, 3).verticalOffset - block(leftHit, 0, 3).thickness / 2).toBeCloseTo(
      block(leftHit, 0, 2).verticalOffset + block(leftHit, 0, 2).thickness / 2,
    );
    expect(block(rightHit, 3, 3).thickness).toBeLessThan(block(initial, 3, 3).thickness);
    expect(block(rightHit, 0, 3)).toEqual(block(initial, 0, 3));
  });

  it("relieves stress when reheated without repairing existing damage", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 };
    const coldWorked = forgeAt(450, [hammer, hammer]);
    const reheated = applyForgeOperation(coldWorked, { kind: "heat", temperatureC: 950 });

    expect(block(reheated).stress).toBeLessThan(block(coldWorked).stress);
    expect(block(reheated).integrity).toBe(block(coldWorked).integrity);
    expect(block(reheated).cracked).toBe(block(coldWorked).cracked);
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

    expect(Math.abs(block(oneSided).lateralOffset - block(originalState()).lateralOffset)).toBeGreaterThan(0);
    expect(Math.abs(block(corrected).lateralOffset - block(originalState()).lateralOffset)).toBeLessThan(
      Math.abs(block(oneSided).lateralOffset - block(originalState()).lateralOffset),
    );
  });

  it("creates deterministic cracks from repeated cold heavy impacts", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 };
    const result = forgeAt(450, [hammer, hammer, hammer, hammer, hammer]);
    const snapshot = createForgeSnapshot(result);

    expect(block(result).cracked).toBe(true);
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

    expect(block(hot).cracked).toBe(false);
    expect(block(hot).integrity).toBeGreaterThan(0.98);
    expect(spreadOut.workpiece.sections.some((section) => section.cracked)).toBe(false);
  });

  it("rejects invalid external operations before changing a state", () => {
    const initial = createForgeState({ sectionCount: 9 });

    expect(() => applyForgeOperation(initial, { kind: "heat", temperatureC: 1401 })).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "rotate", quarterTurns: 2 } as unknown as ForgeOperation)).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "feed", step: 0 } as unknown as ForgeOperation)).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 3 } as unknown as ForgeOperation)).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0, faceBias: 1.1 })).toThrow();
    expect(initial.operations).toHaveLength(0);
    expect(center(initial).integrity).toBe(1);
  });
});

function originalState(): ForgeState {
  return createForgeState({ sectionCount: 9 });
}

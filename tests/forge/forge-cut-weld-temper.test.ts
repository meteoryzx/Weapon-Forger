import { describe, expect, it } from "vitest";

import {
  applyForgeOperation,
  createForgeSnapshot,
  createForgeState,
  replayForgeState,
  totalVolume,
  type ForgeOperation,
  type WorkpieceState,
} from "../../src/forge/index.ts";

function volumeOf(workpiece: WorkpieceState): number {
  return workpiece.sections.reduce(
    (total, section) => total + section.blocks.reduce((subtotal, block) => subtotal + block.volume, 0),
    0,
  );
}

describe("cut, weld, temper", () => {
  it("cut splits the workpiece into two pieces that keep their total volume", () => {
    const initial = createForgeState({ sectionCount: 8 });
    const before = totalVolume(initial);
    const cut = applyForgeOperation(initial, { kind: "cut", sectionIndex: 4 });

    expect(cut.workpiece.sections).toHaveLength(4);
    expect(cut.bench).toHaveLength(1);
    expect(cut.bench[0]?.sections).toHaveLength(4);
    expect(volumeOf(cut.workpiece) + volumeOf(cut.bench[0]!)).toBeCloseTo(before, 8);
    expect(cut.workpiece.layerCount).toBe(1);
  });

  it("temper records a temperature and rejects an invalid one", () => {
    const tempered = applyForgeOperation(createForgeState({ sectionCount: 8 }), { kind: "temper", temperatureC: 200 });
    expect(createForgeSnapshot(tempered).temperTemperatureC).toBe(200);
    expect(() => applyForgeOperation(createForgeState({ sectionCount: 8 }), { kind: "temper", temperatureC: 600 })).toThrow();
  });

  it("weld mixes carbon by volume and doubles layer count (damascus)", () => {
    let state = createForgeState({ sectionCount: 8 });
    state = applyForgeOperation(state, { kind: "select-material", materialId: "high-carbon-steel" });
    const welded = applyForgeOperation(state, { kind: "weld", benchIndex: 0 });

    // 低碳 0.2 与高碳 0.9 等体积混合 → 0.55；层数 1+1=2。
    expect(createForgeSnapshot(welded).carbon).toBeCloseTo(0.55, 8);
    expect(createForgeSnapshot(welded).layerCount).toBe(2);
    expect(welded.bench).toHaveLength(0);
  });

  it("replays a free-combination chain deterministically", () => {
    const initial = createForgeState({ sectionCount: 8 });
    const operations: ForgeOperation[] = [
      { kind: "heat", temperatureC: 950 },
      { kind: "select-material", materialId: "high-carbon-steel" },
      { kind: "cut", sectionIndex: 4 },
      { kind: "weld", benchIndex: 1 },
      { kind: "temper", temperatureC: 220 },
    ];
    const direct = replayForgeState(initial, operations);
    const replayed = replayForgeState(JSON.parse(JSON.stringify(initial)), JSON.parse(JSON.stringify(operations)));
    expect(replayed).toEqual(direct);
    expect(createForgeSnapshot(direct).layerCount).toBeGreaterThan(1);
  });

  it("rejects invalid cut and weld inputs", () => {
    const state = createForgeState({ sectionCount: 8 });
    expect(() => applyForgeOperation(state, { kind: "cut", sectionIndex: 0 })).toThrow();
    expect(() => applyForgeOperation(state, { kind: "cut", sectionIndex: 8 })).toThrow();
    expect(() => applyForgeOperation(state, { kind: "weld", benchIndex: 5 })).toThrow();
  });
});

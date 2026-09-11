import { describe, expect, it } from "vitest";

import {
  applyForgeOperation,
  createForgeFacts,
  createForgeSnapshot,
  createForgeState,
  FORGE_RULES,
  outlineArea,
  replayForgeState,
  SPRING_STEEL,
  splitOutlineByFiniteThroughCut,
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

function conservedCellState(workpieces: readonly WorkpieceState[]) {
  const blocks = workpieces.flatMap((workpiece) => workpiece.sections.flatMap((section) => section.blocks));
  const weighted = (value: (block: (typeof blocks)[number]) => number) => (
    blocks.reduce((sum, block) => sum + value(block) * block.volume, 0)
  );
  return {
    volume: blocks.reduce((sum, block) => sum + block.volume, 0),
    temperature: weighted((block) => block.temperatureC),
    stress: weighted((block) => block.stress),
    damage: weighted((block) => block.damage),
    mechanicalWork: blocks.reduce((sum, block) => sum + block.mechanicalWorkJ, 0),
  };
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

    const originalCellIds = initial.workpiece.sections.flatMap((section) => section.blocks.map((block) => block.id));
    const cutCellIds = [cut.workpiece, ...cut.bench]
      .flatMap((piece) => piece.sections.flatMap((section) => section.blocks.map((block) => block.id)));
    expect(cutCellIds.sort()).toEqual(originalCellIds.sort());

    const frontLastNode = cut.workpiece.geometry.nodes[cut.workpiece.geometry.nodes.length - 1];
    const backFirstNode = cut.bench[0]?.geometry.nodes[0];
    const backLastNode = cut.bench[0]?.geometry.nodes[cut.bench[0].geometry.nodes.length - 1];
    expect(cut.workpiece.geometry.nodes[0]?.axialIndex).toBe(0);
    expect(backFirstNode?.axialIndex).toBe(0);
    expect(backFirstNode?.axialPosition).toBeCloseTo(0, 8);
    expect(backLastNode?.axialPosition).toBeCloseTo(frontLastNode?.axialPosition ?? 0, 8);
  });

  it("matches the old orthogonal cut and conserves cell process state", () => {
    let initial = createForgeState({ sectionCount: 8 });
    initial = applyForgeOperation(initial, { kind: "heat", temperatureC: 900 });
    initial = applyForgeOperation(initial, { kind: "hammer", sectionIndex: 4, energy: 0.6 });
    const before = conservedCellState([initial.workpiece]);
    const cut = applyForgeOperation(initial, { kind: "cut", sectionIndex: 4 });
    const after = conservedCellState([cut.workpiece, ...cut.bench]);

    expect(after).toEqual(before);
    expect(before.stress).toBeGreaterThan(0);

    const pristine = createForgeState({ sectionCount: 8 });
    const legacyCut = applyForgeOperation(pristine, { kind: "cut", sectionIndex: 4 });
    const outline = pristine.workpiece.geometry.outline;
    const cutPosition = pristine.workpiece.sections[4]!.position
      - pristine.workpiece.sections[4]!.length / 2;
    const lateral = outline.map((point) => point.lateralOffset);
    const geometricCut = splitOutlineByFiniteThroughCut(outline, {
      id: "legacy-equivalence",
      start: { axialPosition: cutPosition, lateralOffset: Math.min(...lateral) - 1 },
      end: { axialPosition: cutPosition, lateralOffset: Math.max(...lateral) + 1 },
      kerfWidth: 0,
    });
    const primitiveVolumes = [geometricCut.negative, geometricCut.positive]
      .map((piece) => outlineArea(piece) * FORGE_RULES.initialSectionThickness)
      .sort((first, second) => first - second);
    const legacyVolumes = [legacyCut.workpiece, ...legacyCut.bench]
      .map(volumeOf)
      .sort((first, second) => first - second);

    expect(primitiveVolumes[0]).toBeCloseTo(legacyVolumes[0]!, 6);
    expect(primitiveVolumes[1]).toBeCloseTo(legacyVolumes[1]!, 6);
  });

  it("switches the active workpiece without losing either raw state", () => {
    const initial = createForgeState({ sectionCount: 8 });
    const cut = applyForgeOperation(initial, { kind: "cut", sectionIndex: 4 });
    const selected = applyForgeOperation(cut, { kind: "select-workpiece", benchIndex: 0 });

    expect(selected.workpiece.id).toBe(cut.bench[0]?.id);
    expect(selected.bench[0]?.id).toBe(cut.workpiece.id);
    expect(createForgeSnapshot(selected).workpieceId).toBe(selected.workpiece.id);
  });

  it("temper records a temperature and rejects an invalid one", () => {
    const tempered = applyForgeOperation(createForgeState({ sectionCount: 8 }), { kind: "temper", temperatureC: 200 });
    expect(tempered.workpiece.heatTreatments.at(-1)).toEqual({
      kind: "temper",
      operationIndex: 0,
      temperatureC: 200,
    });
    expect(createForgeSnapshot(tempered).temperTemperatureC).toBe(200);
    expect(() => applyForgeOperation(createForgeState({ sectionCount: 8 }), { kind: "temper", temperatureC: 600 })).toThrow();
  });

  it("weld keeps source material regions while exposing an aggregate carbon value", () => {
    let state = createForgeState();
    const sectionCount = state.workpiece.sections.length;
    const onePieceVolume = totalVolume(state);
    state = applyForgeOperation(state, { kind: "select-material", materialId: "high-carbon-steel" });
    const welded = applyForgeOperation(state, { kind: "weld", benchIndex: 0 });

    // 低碳 0.2 与高碳 0.9 等体积混合 → 0.55；层数 1+1=2。
    expect(createForgeSnapshot(welded).carbon).toBeCloseTo(0.55, 8);
    expect(createForgeSnapshot(welded).layerCount).toBe(2);
    expect(createForgeSnapshot(welded).materialRegionCount).toBe(2);
    expect(createForgeFacts(welded).materialRegions.map((region) => region.materialId).sort()).toEqual([
      "high-carbon-steel",
      "mild-steel",
    ]);
    expect(welded.workpiece.joints[0]?.integrity).toBeGreaterThanOrEqual(0);
    expect(welded.workpiece.joints[0]?.integrity).toBeLessThanOrEqual(1);
    expect(welded.workpiece.joints[0]?.contactArea).toBeCloseTo(48 * 8, 8);
    expect(welded.workpiece.joints[0]?.weldTemperatureC).toBe(20);
    expect(welded.bench).toHaveLength(0);
    expect(welded.workpiece.sections).toHaveLength(sectionCount * 2);
    expect(totalVolume(welded)).toBeCloseTo(onePieceVolume * 2, 8);
    expect(welded.workpiece.sections[sectionCount]?.position).toBeCloseTo(
      (welded.workpiece.sections[sectionCount - 1]?.position ?? 0)
        + (welded.workpiece.sections[sectionCount - 1]?.length ?? 0),
      8,
    );
  });

  it("can weld the selected cut half instead of the unrelated bench workpiece", () => {
    let state = createForgeState({ material: SPRING_STEEL, sectionCount: 8 });
    state = applyForgeOperation(state, { kind: "select-material", materialId: "high-carbon-steel" });
    state = applyForgeOperation(state, { kind: "select-workpiece", benchIndex: 0 });
    const originalVolume = totalVolume(state);
    state = applyForgeOperation(state, { kind: "cut", sectionIndex: 4 });

    expect(state.bench.map((piece) => piece.material.id)).toEqual(["spring-steel", "high-carbon-steel"]);
    const welded = applyForgeOperation(state, { kind: "weld", benchIndex: 1 });

    expect(createForgeSnapshot(welded).carbon).toBeCloseTo(0.9, 8);
    expect(createForgeSnapshot(welded).layerCount).toBe(2);
    expect(totalVolume(welded)).toBeCloseTo(originalVolume, 8);
    expect(welded.workpiece.joints[0]?.workpieceIds).toEqual([
      "workpiece-1-front",
      "workpiece-1-back",
    ]);
    expect(welded.bench.map((piece) => piece.material.id)).toEqual(["spring-steel"]);
  });

  it("keeps both workpieces' heat-treatment events in operation order", () => {
    let state = createForgeState({ sectionCount: 8 });
    state = applyForgeOperation(state, { kind: "quench", medium: "water" });
    state = applyForgeOperation(state, { kind: "select-material", materialId: "high-carbon-steel" });
    state = applyForgeOperation(state, { kind: "select-workpiece", benchIndex: 0 });
    state = applyForgeOperation(state, { kind: "temper", temperatureC: 200 });
    const welded = applyForgeOperation(state, { kind: "weld", benchIndex: 0 });

    expect(welded.workpiece.heatTreatments.map((event) => [event.kind, event.operationIndex])).toEqual([
      ["quench", 0],
      ["temper", 3],
    ]);
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

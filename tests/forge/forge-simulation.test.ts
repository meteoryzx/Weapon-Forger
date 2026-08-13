import { describe, expect, it } from "vitest";

import {
  FORGE_RULES,
  applyForgeIntent,
  applyForgeOperation,
  createForgeSnapshot,
  createForgeState,
  createHammerInfluencePreview,
  replayForgeState,
  totalVolume,
  type BladeBlock,
  type ForgeOperation,
  type ForgeState,
  type WorkpieceNode,
} from "../../src/forge/index.ts";

const TEST_SECTION_COUNT = 31;
const CENTER = Math.floor(TEST_SECTION_COUNT / 2);
const CENTER_LEFT = FORGE_RULES.crossSectionWidthBlocks / 2 - 1;
const TOP = FORGE_RULES.crossSectionHeightBlocks - 1;
const TETRAHEDRA = [
  [0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7],
  [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7],
] as const;

function forgeAt(temperatureC: number, operations: readonly ForgeOperation[] = []): ForgeState {
  let state = createForgeState({ sectionCount: TEST_SECTION_COUNT });
  state = applyForgeOperation(state, { kind: "heat", temperatureC });
  return operations.reduce(applyForgeOperation, state);
}

function section(state: ForgeState, sectionIndex = CENTER) {
  const result = state.workpiece.sections[sectionIndex];
  if (!result) throw new Error("Missing target section.");
  return result;
}

function block(state: ForgeState, widthIndex = CENTER_LEFT, heightIndex = TOP, sectionIndex = CENTER): BladeBlock {
  const result = section(state, sectionIndex).blocks.find(
    (candidate) => candidate.widthIndex === widthIndex && candidate.heightIndex === heightIndex,
  );
  if (!result) throw new Error("Missing target block.");
  return result;
}

describe("forge simulation", () => {
  it("uses one physical unit system and a shared three-dimensional node lattice", () => {
    const state = createForgeState();
    const first = block(state, 0, 0, 0);

    expect(state.workpiece.sections).toHaveLength(168);
    expect(state.workpiece.grid).toEqual({ widthBlocks: 24, heightBlocks: 4 });
    expect(state.workpiece.nodes).toHaveLength(169 * 25 * 5);
    expect(section(state, 0).blocks).toHaveLength(96);
    expect(first.length).toBe(FORGE_RULES.simulationCellSize);
    expect(first.width).toBe(FORGE_RULES.simulationCellSize);
    expect(first.thickness).toBe(FORGE_RULES.simulationCellSize);
    expect(FORGE_RULES.hammerFaceLength / FORGE_RULES.simulationCellSize).toBe(24);
    expect(FORGE_RULES.hammerFaceWidth / FORGE_RULES.simulationCellSize).toBe(24);
  });

  it("turns and replays only serializable forge operations", () => {
    const initial = createForgeState({ sectionCount: TEST_SECTION_COUNT });
    const operations: ForgeOperation[] = [
      { kind: "heat", temperatureC: 950 },
      { kind: "feed", step: -1 },
      { kind: "hammer", sectionIndex: CENTER, energy: 0.7, lateralBias: 0, faceBias: 0.25 },
      { kind: "rotate", quarterTurns: 1 },
      { kind: "hammer", sectionIndex: CENTER, energy: 0.45, lateralBias: 0, faceBias: 0.75 },
    ];

    const direct = replayForgeState(initial, operations);
    const replayed = replayForgeState(JSON.parse(JSON.stringify(initial)), JSON.parse(JSON.stringify(operations)));

    expect(direct.workpiece.orientationQuarterTurns).toBe(1);
    expect(replayed).toEqual(direct);
    expect(initial.operations).toHaveLength(0);
  });

  it("feeds the whole billet reversibly and clamps both ends", () => {
    let state = createForgeState({ sectionCount: TEST_SECTION_COUNT });
    state = applyForgeIntent(state, { kind: "feed", step: -1 });
    expect(state.workpiece.feedOffset).toBe(-FORGE_RULES.feedStepLength);
    state = applyForgeIntent(state, { kind: "feed", step: 1 });
    expect(state.workpiece.feedOffset).toBe(0);
    for (let index = 0; index < 20; index += 1) state = applyForgeIntent(state, { kind: "feed", step: -1 });
    expect(state.workpiece.feedOffset).toBe(-(TEST_SECTION_COUNT * FORGE_RULES.simulationCellSize) / 2);
  });

  it("moves a hot hammer plane farther and accumulates more cold stress", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0, faceBias: 0.5 };
    const initial = createForgeState({ sectionCount: TEST_SECTION_COUNT });
    const hot = forgeAt(950, [hammer]);
    const cold = forgeAt(500, [hammer]);
    const initialTop = latticeNode(initial, CENTER, CENTER_LEFT, FORGE_RULES.crossSectionHeightBlocks).verticalOffset;
    const hotTop = latticeNode(hot, CENTER, CENTER_LEFT, FORGE_RULES.crossSectionHeightBlocks).verticalOffset;
    const coldTop = latticeNode(cold, CENTER, CENTER_LEFT, FORGE_RULES.crossSectionHeightBlocks).verticalOffset;

    expect(initialTop - hotTop).toBeGreaterThan(initialTop - coldTop);
    expect(block(cold).stress).toBeGreaterThan(block(hot).stress);
  });

  it("keeps the physical footprint fixed while charge changes expected pressure", () => {
    const snapshot = createForgeSnapshot(forgeAt(950));
    const light = createHammerInfluencePreview(snapshot, { sectionIndex: CENTER, faceBias: 0.5, energy: 0.3 });
    const heavy = createHammerInfluencePreview(snapshot, { sectionIndex: CENTER, faceBias: 0.5, energy: 1 });
    const keys = (samples: typeof light.samples) => samples.map(
      (sample) => `${sample.sectionIndex}:${sample.widthIndex}:${sample.heightIndex}`,
    );

    expect(keys(light.samples)).toEqual(keys(heavy.samples));
    expect(Math.max(...heavy.samples.map((sample) => sample.weight))).toBeGreaterThan(
      Math.max(...light.samples.map((sample) => sample.weight)),
    );
    expect(new Set(heavy.samples.map((sample) => sample.sectionIndex)).size * FORGE_RULES.simulationCellSize)
      .toBeGreaterThanOrEqual(FORGE_RULES.hammerFaceLength);
  });

  it("uses an elliptical footprint with a soft crowned pressure falloff", () => {
    const preview = createHammerInfluencePreview(createForgeSnapshot(forgeAt(950)), {
      sectionIndex: CENTER, faceBias: 0.5, energy: 1,
    });
    const center = preview.samples.find((sample) => (
      sample.sectionIndex === CENTER && sample.widthIndex === CENTER_LEFT && sample.heightIndex === TOP
    ));
    const axialEdge = preview.samples
      .filter((sample) => sample.widthIndex === CENTER_LEFT)
      .sort((left, right) => Math.abs(right.sectionIndex - CENTER) - Math.abs(left.sectionIndex - CENTER))[0];
    const diagonalCorner = preview.samples.find((sample) => (
      sample.sectionIndex === CENTER + 11 && sample.widthIndex === FORGE_RULES.crossSectionWidthBlocks - 1
    ));

    expect(center?.weight).toBeGreaterThan(0.9);
    expect(axialEdge?.weight).toBeLessThan(center?.weight ?? 0);
    expect(diagonalCorner).toBeUndefined();
  });

  it("anchors the supported anvil side while the crowned hammer compresses the struck side", () => {
    const initial = forgeAt(950);
    const result = applyForgeOperation(initial, {
      kind: "hammer", sectionIndex: CENTER, faceBias: 0.5, energy: 1, lateralBias: 0,
    });
    const bottomBefore = latticeNode(initial, CENTER, CENTER_LEFT, 0).verticalOffset;
    const bottomAfter = latticeNode(result, CENTER, CENTER_LEFT, 0).verticalOffset;
    const topBefore = latticeNode(initial, CENTER, CENTER_LEFT, FORGE_RULES.crossSectionHeightBlocks).verticalOffset;
    const topAfter = latticeNode(result, CENTER, CENTER_LEFT, FORGE_RULES.crossSectionHeightBlocks).verticalOffset;

    expect(bottomAfter).toBeGreaterThanOrEqual(bottomBefore - 0.000_001);
    expect(topAfter).toBeLessThan(topBefore);
    expect(topBefore - topAfter).toBeLessThanOrEqual(FORGE_RULES.hammerMaximumTravel * 1.05);
  });

  it("only supports nodes that are physically above the finite anvil face", () => {
    let supported = createForgeState();
    supported = applyForgeOperation(supported, { kind: "heat", temperatureC: 950 });
    let overhanging = supported;
    for (let step = 0; step < 12; step += 1) {
      overhanging = applyForgeOperation(overhanging, { kind: "feed", step: 1 });
    }
    const center = Math.floor(supported.workpiece.sections.length / 2);
    const hammer: ForgeOperation = {
      kind: "hammer", sectionIndex: center, faceBias: 0.5, energy: 1, lateralBias: 0,
    };
    const supportedAfter = applyForgeOperation(supported, hammer);
    const overhangingAfter = applyForgeOperation(overhanging, hammer);
    const bottom = 0;
    const supportedBottomTravel = Math.abs(
      latticeNode(supportedAfter, center, CENTER_LEFT, bottom).verticalOffset
        - latticeNode(supported, center, CENTER_LEFT, bottom).verticalOffset,
    );
    const overhangingBottomTravel = Math.abs(
      latticeNode(overhangingAfter, center, CENTER_LEFT, bottom).verticalOffset
        - latticeNode(overhanging, center, CENTER_LEFT, bottom).verticalOffset,
    );

    expect(supportedBottomTravel).toBeLessThan(0.01);
    expect(overhangingBottomTravel).toBeGreaterThan(supportedBottomTravel + 0.02);
  });

  it("contacts high points first and reduces roughness under a crowned hammer", () => {
    const initial = forgeAt(950);
    const rough = withRoughTop(initial);
    const before = topSurfaceRange(rough);
    const result = applyForgeOperation(rough, {
      kind: "hammer", sectionIndex: CENTER, faceBias: 0.5, energy: 1, lateralBias: 0,
    });
    const after = topSurfaceRange(result);

    expect(before).toBeGreaterThan(0.5);
    expect(after).toBeLessThan(before * 0.55);
  });

  it("covers the narrow side without stamping a rectangular shoulder", () => {
    const initial = forgeAt(950, [{ kind: "rotate", quarterTurns: 1 }]);
    const result = applyForgeOperation(initial, {
      kind: "hammer", sectionIndex: CENTER, faceBias: 0.5, energy: 1, lateralBias: 0,
    });
    const before = Array.from({ length: FORGE_RULES.crossSectionHeightBlocks + 1 }, (_, height) => (
      latticeNode(initial, CENTER, 0, height).lateralOffset
    ));
    const after = Array.from({ length: FORGE_RULES.crossSectionHeightBlocks + 1 }, (_, height) => (
      latticeNode(result, CENTER, 0, height).lateralOffset
    ));
    const movement = after.map((value, index) => value - (before[index] ?? value));

    expect(Math.min(...movement)).toBeGreaterThan(0);
    expect(Math.max(...movement) - Math.min(...movement)).toBeLessThan(0.12);
  });

  it("spreads locally without runaway billet lengthening", () => {
    let state = forgeAt(950);
    const initialLength = billetLength(state);
    const initialWidth = section(state).width;
    const initialThickness = localThickness(state, CENTER, FORGE_RULES.crossSectionWidthBlocks / 2);
    for (let hit = 0; hit < 8; hit += 1) {
      state = applyForgeOperation(state, {
        kind: "hammer", sectionIndex: CENTER, faceBias: 0.5, energy: 1, lateralBias: 0,
      });
    }

    expect(section(state).length).toBeGreaterThan(FORGE_RULES.initialSectionLength * 1.08);
    expect(section(state).width).toBeGreaterThan(initialWidth * 1.03);
    expect(localThickness(state, CENTER, FORGE_RULES.crossSectionWidthBlocks / 2)).toBeLessThan(initialThickness * 0.93);
    expect(billetLength(state)).toBeLessThan(initialLength * 1.04);
  });

  it("can independently spread a blade region and narrow a separated tip region", () => {
    const sectionCount = 61;
    const bodyIndex = 18;
    const tipIndex = 45;
    let state = createForgeState({ sectionCount });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 950 });
    const initialVolume = geometricVolume(state);
    const initialBodyThickness = localThickness(state, bodyIndex, FORGE_RULES.crossSectionWidthBlocks / 2);
    const initialTipWidth = localWidth(state, tipIndex, FORGE_RULES.crossSectionHeightBlocks / 2);

    for (let hit = 0; hit < 4; hit += 1) {
      state = applyForgeOperation(state, {
        kind: "hammer", sectionIndex: bodyIndex, faceBias: 0.5, energy: 1, lateralBias: 0,
      });
    }
    state = applyForgeOperation(state, { kind: "rotate", quarterTurns: 1 });
    for (let hit = 0; hit < 5; hit += 1) {
      state = applyForgeOperation(state, {
        kind: "hammer", sectionIndex: tipIndex, faceBias: 0.5, energy: 1, lateralBias: 0,
      });
    }
    state = applyForgeOperation(state, { kind: "rotate", quarterTurns: 1 });
    state = applyForgeOperation(state, { kind: "rotate", quarterTurns: 1 });
    for (let hit = 0; hit < 5; hit += 1) {
      state = applyForgeOperation(state, {
        kind: "hammer", sectionIndex: tipIndex, faceBias: 0.5, energy: 1, lateralBias: 0,
      });
    }

    const bodyWidth = localWidth(state, bodyIndex, FORGE_RULES.crossSectionHeightBlocks / 2);
    const tipWidth = localWidth(state, tipIndex, FORGE_RULES.crossSectionHeightBlocks / 2);
    expect(localThickness(state, bodyIndex, FORGE_RULES.crossSectionWidthBlocks / 2))
      .toBeLessThan(initialBodyThickness * 0.96);
    expect(bodyWidth).toBeGreaterThan(tipWidth * 1.1);
    expect(tipWidth).toBeLessThan(initialTipWidth * 0.95);
    expect(Math.abs(geometricVolume(state) - initialVolume) / initialVolume).toBeLessThan(0.005);
    expect(allTetrahedraPositive(state)).toBe(true);
  });

  it("preserves actual signed cell volume through orthogonal and opposite hits", () => {
    let state = forgeAt(950);
    const initial = geometricVolume(state);
    for (let hit = 0; hit < 30; hit += 1) {
      state = applyForgeOperation(state, {
        kind: "hammer",
        sectionIndex: CENTER + (hit % 3) - 1,
        faceBias: (hit % 4) / 3,
        energy: 0.8,
        lateralBias: 0,
      });
      state = applyForgeOperation(state, { kind: "rotate", quarterTurns: 1 });
    }

    expect(Math.abs(geometricVolume(state) - initial) / initial).toBeLessThan(0.005);
    expect(totalVolume(state)).toBeCloseTo(initial, 8);
    expect(allTetrahedraPositive(state)).toBe(true);
  });

  it("does not reverse a corner deformation after striking its orthogonal face", () => {
    let state = forgeAt(950);
    for (let hit = 0; hit < 4; hit += 1) {
      state = applyForgeOperation(state, {
        kind: "hammer", sectionIndex: CENTER, faceBias: 0.05, energy: 1, lateralBias: 0,
      });
    }
    const cornerAfterTop = latticeNode(state, CENTER, 0, FORGE_RULES.crossSectionHeightBlocks);
    state = applyForgeOperation(state, { kind: "rotate", quarterTurns: 1 });
    state = applyForgeOperation(state, {
      kind: "hammer", sectionIndex: CENTER, faceBias: 0.95, energy: 1, lateralBias: 0,
    });
    const cornerAfterSide = latticeNode(state, CENTER, 0, FORGE_RULES.crossSectionHeightBlocks);

    expect(cornerAfterSide.verticalOffset).toBeLessThan(FORGE_RULES.initialSectionThickness / 2);
    expect(cornerAfterSide.verticalOffset - cornerAfterTop.verticalOffset).toBeLessThan(0.35);
    expect(cornerAfterSide.lateralOffset).toBeGreaterThan(cornerAfterTop.lateralOffset - 0.1);
    expect(allTetrahedraPositive(state)).toBe(true);
  });

  it("relieves stress when reheated without repairing damage", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 };
    const coldWorked = forgeAt(450, [hammer, hammer]);
    const reheated = applyForgeOperation(coldWorked, { kind: "heat", temperatureC: 950 });

    expect(block(reheated).stress).toBeLessThan(block(coldWorked).stress);
    expect(block(reheated).integrity).toBe(block(coldWorked).integrity);
  });

  it("adds deterministic thermal damage from repeated overheating", () => {
    let state = createForgeState({ sectionCount: TEST_SECTION_COUNT });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 1200 });
    const once = state;
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 1200 });

    expect(section(state).thermalDamage).toBeGreaterThan(section(once).thermalDamage);
    expect(createForgeSnapshot(state).hasOverheatedSections).toBe(true);
  });

  it("creates local cracks from repeated cold heavy impacts but not hot work", () => {
    const hammer: ForgeOperation = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 };
    const cold = forgeAt(450, [hammer, hammer, hammer, hammer, hammer, hammer]);
    const hot = forgeAt(950, [hammer, hammer, hammer, hammer, hammer, hammer]);

    expect(createForgeSnapshot(cold).hasCracks).toBe(true);
    expect(createForgeSnapshot(hot).hasCracks).toBe(false);
  });

  it("rejects invalid external operations before changing state", () => {
    const initial = createForgeState({ sectionCount: TEST_SECTION_COUNT });
    expect(() => applyForgeOperation(initial, { kind: "heat", temperatureC: 1401 })).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "rotate", quarterTurns: 2 } as unknown as ForgeOperation)).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "feed", step: 0 } as unknown as ForgeOperation)).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 3 } as unknown as ForgeOperation)).toThrow();
    expect(() => applyForgeOperation(initial, { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0, faceBias: 1.1 })).toThrow();
    expect(initial.operations).toHaveLength(0);
  });
});

function latticeNode(state: ForgeState, axialIndex: number, widthIndex: number, heightIndex: number): WorkpieceNode {
  const planeSize = (state.workpiece.grid.widthBlocks + 1) * (state.workpiece.grid.heightBlocks + 1);
  const index = axialIndex * planeSize + heightIndex * (state.workpiece.grid.widthBlocks + 1) + widthIndex;
  const result = state.workpiece.nodes[index];
  if (!result) throw new Error("Missing lattice node.");
  return result;
}

function cellNodes(state: ForgeState, axial: number, width: number, height: number): readonly WorkpieceNode[] {
  return [
    latticeNode(state, axial, width, height), latticeNode(state, axial + 1, width, height),
    latticeNode(state, axial, width + 1, height), latticeNode(state, axial + 1, width + 1, height),
    latticeNode(state, axial, width, height + 1), latticeNode(state, axial + 1, width, height + 1),
    latticeNode(state, axial, width + 1, height + 1), latticeNode(state, axial + 1, width + 1, height + 1),
  ];
}

function tetraVolume(a: WorkpieceNode, b: WorkpieceNode, c: WorkpieceNode, d: WorkpieceNode): number {
  const ab = vector(a, b);
  const ac = vector(a, c);
  const ad = vector(a, d);
  return (ab.x * (ac.y * ad.z - ac.z * ad.y)
    + ab.y * (ac.z * ad.x - ac.x * ad.z)
    + ab.z * (ac.x * ad.y - ac.y * ad.x)) / 6;
}

function cellVolume(state: ForgeState, axial: number, width: number, height: number): number {
  const nodes = cellNodes(state, axial, width, height);
  return TETRAHEDRA.reduce((sum, tetrahedron) => {
    const [a, b, c, d] = tetrahedron.map((index) => nodes[index]);
    if (!a || !b || !c || !d) throw new Error("Missing tetrahedron node.");
    return sum + tetraVolume(a, b, c, d);
  }, 0);
}

function geometricVolume(state: ForgeState): number {
  let volume = 0;
  for (let axial = 0; axial < state.workpiece.sections.length; axial += 1) {
    for (let width = 0; width < state.workpiece.grid.widthBlocks; width += 1) {
      for (let height = 0; height < state.workpiece.grid.heightBlocks; height += 1) {
        volume += cellVolume(state, axial, width, height);
      }
    }
  }
  return volume;
}

function allTetrahedraPositive(state: ForgeState): boolean {
  for (let axial = 0; axial < state.workpiece.sections.length; axial += 1) {
    for (let width = 0; width < state.workpiece.grid.widthBlocks; width += 1) {
      for (let height = 0; height < state.workpiece.grid.heightBlocks; height += 1) {
        const nodes = cellNodes(state, axial, width, height);
        for (const tetrahedron of TETRAHEDRA) {
          const [a, b, c, d] = tetrahedron.map((index) => nodes[index]);
          if (!a || !b || !c || !d || tetraVolume(a, b, c, d) <= 0) return false;
        }
      }
    }
  }
  return true;
}

function withRoughTop(state: ForgeState): ForgeState {
  const nodes = state.workpiece.nodes.map((node) => {
    const nearHammer = Math.abs(node.axialIndex - CENTER) <= 5
      && node.widthIndex >= CENTER_LEFT - 3 && node.widthIndex <= CENTER_LEFT + 4
      && node.heightIndex === FORGE_RULES.crossSectionHeightBlocks;
    return nearHammer
      ? { ...node, verticalOffset: node.verticalOffset + ((node.axialIndex + node.widthIndex) % 2 === 0 ? 0.45 : -0.25) }
      : { ...node };
  });
  return { ...state, workpiece: { ...state.workpiece, nodes } };
}

function topSurfaceRange(state: ForgeState): number {
  const values = state.workpiece.nodes.filter((node) => (
    Math.abs(node.axialIndex - CENTER) <= 5
    && node.widthIndex >= CENTER_LEFT - 3 && node.widthIndex <= CENTER_LEFT + 4
    && node.heightIndex === FORGE_RULES.crossSectionHeightBlocks
  )).map((node) => node.verticalOffset);
  return Math.max(...values) - Math.min(...values);
}

function billetLength(state: ForgeState): number {
  const axial = state.workpiece.nodes.map((node) => node.axialPosition);
  return Math.max(...axial) - Math.min(...axial);
}

function localThickness(state: ForgeState, axialIndex: number, widthIndex: number): number {
  return latticeNode(state, axialIndex, widthIndex, FORGE_RULES.crossSectionHeightBlocks).verticalOffset
    - latticeNode(state, axialIndex, widthIndex, 0).verticalOffset;
}

function localWidth(state: ForgeState, axialIndex: number, heightIndex: number): number {
  return latticeNode(state, axialIndex, FORGE_RULES.crossSectionWidthBlocks, heightIndex).lateralOffset
    - latticeNode(state, axialIndex, 0, heightIndex).lateralOffset;
}

function vector(from: WorkpieceNode, to: WorkpieceNode) {
  return {
    x: to.axialPosition - from.axialPosition,
    y: to.lateralOffset - from.lateralOffset,
    z: to.verticalOffset - from.verticalOffset,
  };
}

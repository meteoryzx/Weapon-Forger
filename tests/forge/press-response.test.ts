import { describe, expect, it, vi } from "vitest";
import * as hammerSolver from "../../src/forge/hammer-surface.ts";
import {
  HAMMER_HOME, applyForgeOperation, createForgeState, hammerContact, hammerFrame,
  placedHammerSurface, createForgeFacts, createForgeSnapshot, deformPress, PRESS_RULES,
  geometryVolumes, serializeForgeState, deserializeForgeState, replayForgeState,
  toAnvil, nodePoint, totalVolume, HIGH_CARBON_STEEL, type ForgePressOperation, type ForgeState,
} from "../../src/forge/index.ts";

const hot = () => applyForgeOperation(createForgeState({ sectionCount: 24 }), { kind: "heat", temperatureC: 950 });
const press: ForgePressOperation = {
  kind: "forge-press", pose: HAMMER_HOME, target: { x: 0, z: 0 },
  pressure: 0.8, strokeMm: 14, dwellMs: 1000,
};
const height = (state: ForgeState) => hammerContact(
  placedHammerSurface(state.workpiece.geometry, hammerFrame(state.workpiece.geometry, HAMMER_HOME)), 0, 0,
)!.thickness;
const volume = (state: ForgeState) => [...geometryVolumes(state.workpiece).values()].reduce((sum, v) => sum + v, 0);
const width = (state: ForgeState) => Math.max(...state.workpiece.geometry.nodes.map(n => n.lateralOffset))
  - Math.min(...state.workpiece.geometry.nodes.map(n => n.lateralOffset));
const unchanged = (a: ForgeState, b: ForgeState) => expect(JSON.stringify(a.workpiece) === JSON.stringify(b.workpiece)).toBe(true);

function expectFinite(value: unknown): void {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === "object") for (const child of Object.values(value)) expectFinite(child);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe("quasi-static press", () => {
  it("starts loading at zero without plastic geometry or material changes", () => {
    const initial = hot();
    unchanged(applyForgeOperation(initial, { ...press, dwellMs: 0 }), initial);
  });

  it("caps actual local thickness reduction by even a very small stroke", () => {
    const initial = hot();
    const result = applyForgeOperation(initial, { ...press, pressure: 1, strokeMm: 0.02, dwellMs: 4000 });
    expect(height(initial) - height(result)).toBeGreaterThan(0);
    expect(height(initial) - height(result)).toBeLessThanOrEqual(0.020001);
  });

  it("records deterministic empty and unsupported cycles without changing the workpiece", () => {
    const initial = hot();
    for (const operation of [
      { ...press, target: { x: 0, z: 100 } },
      { ...press, pose: { ...HAMMER_HOME, x: 300 }, target: { x: 300, z: 0 } },
    ]) {
      const result = applyForgeOperation(initial, operation);
      unchanged(result, initial);
      expect(result.operations).toEqual([...initial.operations, operation]);
    }
  });

  it("uses a square flat face and sustained equilibrium without calling the impulse solver", () => {
    expect([PRESS_RULES.faceLength, PRESS_RULES.faceWidth, PRESS_RULES.supportLength, PRESS_RULES.supportWidth])
      .toEqual([48, 48, 224, 104]);
    const spy = vi.spyOn(hammerSolver, "deformSurfaceHammer");
    try {
      const initial = hot();
      const result = applyForgeOperation(initial, press);
      expect(spy).not.toHaveBeenCalled();
      expect(height(result)).toBeLessThan(height(initial));
      // A square corner lies outside the old circular hammer kernel.
      const g = initial.workpiece.geometry, frame = hammerFrame(g, HAMMER_HOME);
      const corner = g.nodes.findIndex(n => {
        const p = toAnvil(nodePoint(n), frame);
        return p.x === 18 && p.z === 18 && p.y === 8;
      });
      expect(result.workpiece.geometry.nodes[corner]!.verticalOffset).toBeLessThan(g.nodes[corner]!.verticalOffset);
      expect(result.operations.at(-1)).toEqual(press);
      expect(result.operations.filter(op => op.kind === "surface-hammer")).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });

  it("requires force above temperature/material yield and responds to increased force", () => {
    const initial = hot();
    const low = applyForgeOperation(initial, { ...press, pressure: 0.1, dwellMs: 4000 });
    const medium = applyForgeOperation(initial, { ...press, pressure: 0.55 });
    const high = applyForgeOperation(initial, { ...press, pressure: 1 });
    unchanged(low, initial);
    expect(height(high)).toBeLessThan(height(medium));
    expect(height(medium)).toBeLessThan(height(initial));
    const cold = createForgeState({ sectionCount: 24 });
    // The 600 kN machine remains below the cold yield threshold; cold cycles
    // must not silently create plastic geometry.
    unchanged(applyForgeOperation(cold, { ...press, pressure: 0.5, dwellMs: 4000 }), cold);
    const coldFull = applyForgeOperation(cold, { ...press, pressure: 1, dwellMs: 4000 });
    unchanged(coldFull, cold);
    const hard = applyForgeOperation(createForgeState({ sectionCount: 24, material: HIGH_CARBON_STEEL }), { kind: "heat", temperatureC: 950 });
    expect(height(applyForgeOperation(hard, press))).toBeGreaterThan(height(applyForgeOperation(initial, press)));
    const visible = deformPress(initial.workpiece, { ...press, pressure: 0.7, dwellMs: 4000 });
    expect(visible.compressionMm).toBeGreaterThan(0.4);
  });

  it("monotonically approaches equilibrium with continuous width from cumulative dwell", () => {
    const initial = freeze(hot());
    const baseline = serializeForgeState(initial);
    const times = [0, 1, 50, 200, 400, 800, 1200, 2000, 3000, 3999, 4000];
    let lastDepth = 0, lastWidth = width(initial);
    for (const dwellMs of times) {
      const result = applyForgeOperation(initial, { ...press, dwellMs });
      const depth = height(initial) - height(result);
      expect(depth).toBeGreaterThanOrEqual(lastDepth - 1e-8);
      expect(width(result)).toBeGreaterThanOrEqual(lastWidth - 1e-7);
      lastDepth = depth; lastWidth = width(result);
    }
    expect(lastDepth).toBeGreaterThan(0.2);
    const at = (dwellMs: number) => applyForgeOperation(initial, { ...press, dwellMs });
    expect(height(at(3000)) - height(at(4000))).toBeLessThan(height(at(0)) - height(at(1000)));
    expect(width(at(4000)) - width(at(3999))).toBeLessThan(0.01);
    expect(serializeForgeState(initial) === baseline).toBe(true);
    expect(serializeForgeState(at(4000)) === serializeForgeState(at(4000))).toBe(true);
  });

  it("holds an exact stroke plateau without adding strain or work as dwell continues", () => {
    const initial = hot();
    const operation = { ...press, pressure: 1, strokeMm: 0.1 };
    const early = applyForgeOperation(initial, { ...operation, dwellMs: 2000 });
    const late = applyForgeOperation(initial, { ...operation, dwellMs: 4000 });
    expect(height(initial) - height(late)).toBeCloseTo(0.1, 6);
    unchanged(early, late);
    const metadata = deformPress(initial.workpiece, { ...operation, dwellMs: 4000 });
    expect(metadata.contactHeightMm).toBeCloseTo(8, 8);
    expect(metadata.ramTravelMm).toBe(0.1);
    expect(metadata.compressionMm).toBeCloseTo(0.1, 8);
    const zero = deformPress(initial.workpiece, { ...operation, dwellMs: 0 });
    expect(zero.nodes).toBe(initial.workpiece.geometry.nodes);
    expect(zero.contactHeightMm).toBe(8);
    expect(zero.ramTravelMm).toBe(0);
  });

  it("keeps supported flat interior nodes on one platen plane and bounds plastic work by force times travel", () => {
    const initial = hot();
    const result = applyForgeOperation(initial, press);
    const response = deformPress(initial.workpiece, press);
    const frame = hammerFrame(initial.workpiece.geometry, press.pose);
    initial.workpiece.geometry.nodes.forEach((node, i) => {
      const p = toAnvil(nodePoint(node), frame);
      if (p.y === 8 && Math.abs(p.x) <= 18 && Math.abs(p.z) <= 18) {
        expect(toAnvil(nodePoint(result.workpiece.geometry.nodes[i]!), frame).y)
          .toBeCloseTo(response.contactHeightMm - response.ramTravelMm, 7);
      }
    });
    const work = result.workpiece.sections.reduce((sum, section) => sum + section.mechanicalWorkJ, 0);
    expect(work).toBeGreaterThan(0);
    expect(work).toBeLessThanOrEqual(PRESS_RULES.maximumForceN * press.pressure * response.ramTravelMm / 1000);
  });

  it("bounds a maximum-stroke cycle and preserves clearance through repeated side pressing", () => {
    let initial = hot();
    const operation = { ...press, pose: { ...HAMMER_HOME, roll: Math.PI / 2 }, pressure: 1, strokeMm: 24, dwellMs: 4000 };
    const originalVolume = volume(initial);
    for (let i = 0; i < 5; i++) {
      const result = applyForgeOperation(initial, operation);
      const response = deformPress(initial.workpiece, operation);
      expect(response.compressionMm).toBeLessThanOrEqual(24);
      expect(response.compressionMm).toBeLessThanOrEqual(response.contactHeightMm * PRESS_RULES.maximumCompression + 1e-8);
      expect(result.workpiece.geometry.nodes.every(n => Number.isFinite(n.lateralOffset))).toBe(true);
      expect(volume(result) / originalVolume).toBeCloseTo(1, 6);
      initial = result;
    }
    expect(initial.workpiece.sections.every(section => section.blocks.every(block => block.width > 0 && block.thickness > 0))).toBe(true);
  });

  it("preserves hand-hammer and power-hammer operation semantics exactly", () => {
    const initial = hot();
    const operation = { kind: "power-hammer", pose: HAMMER_HOME, target: press.target, energy: 0.35, blows: 3, cadenceMs: 180 } as const;
    let manual = initial;
    for (let i = 0; i < 3; i++) manual = applyForgeOperation(manual, { kind: "surface-hammer", pose: operation.pose, target: operation.target, energy: operation.energy });
    unchanged(applyForgeOperation(initial, operation), manual);
  });

  it.each([0, 0.37, Math.PI / 2])("caps load-direction displacement and local thinning at roll %s", roll => {
    const initial = hot();
    const operation = { ...press, pose: { ...HAMMER_HOME, yaw: 0.29, roll }, pressure: 1, strokeMm: 0.05, dwellMs: 4000 };
    const result = applyForgeOperation(initial, operation);
    const frame = hammerFrame(initial.workpiece.geometry, operation.pose);
    let max = 0;
    initial.workpiece.geometry.nodes.forEach((n, i) => {
      const before = toAnvil(nodePoint(n), frame), after = toAnvil(nodePoint(result.workpiece.geometry.nodes[i]!), frame);
      expect(before.y - after.y).toBeGreaterThanOrEqual(-1e-8);
      expect(before.y - after.y).toBeLessThanOrEqual(operation.strokeMm + 1e-8);
      max = Math.max(max, before.y - after.y);
    });
    expect(max).toBeCloseTo(deformPress(initial.workpiece, operation).compressionMm, 8);
    if (roll === 0 || roll === Math.PI / 2) expect(max).toBeGreaterThan(0);
    else unchanged(result, initial); // The high edge has no opposing bearing column.
    expect(volume(result) / volume(initial)).toBeCloseTo(1, 6);
  });

  it("stops a partially supported cycle when its unsupported rim obstructs the flat platen", () => {
    const initial = applyForgeOperation(createForgeState({ sectionCount: 96 }), { kind: "heat", temperatureC: 950 });
    const centered = deformPress(initial.workpiece, { ...press, pressure: 1 });
    const edge = deformPress(initial.workpiece, { ...press, pressure: 1, pose: { ...HAMMER_HOME, x: 110 }, target: { x: 110, z: 0 } });
    expect(edge.supportRatio).toBeLessThan(centered.supportRatio);
    expect(edge.compressionMm).toBeLessThan(centered.compressionMm);
    expect(edge.compressionMm).toBe(0);
    expect(edge.ramTravelMm).toBe(0);
    expect(edge.nodes).toBe(initial.workpiece.geometry.nodes);
  });

  it("keeps a saved finite slot, material identity, volume, and finite facts through repeated cycles", () => {
    const cut = applyForgeOperation(hot(), { kind: "cut", path: {
      id: "slot", start: { axialPosition: 24, lateralOffset: -5 }, end: { axialPosition: 24, lateralOffset: 5 }, kerfWidth: 3,
    } });
    let result = deserializeForgeState(serializeForgeState(cut));
    const beforeVolume = volume(result);
    const solids = JSON.stringify(result.workpiece.geometry.solids);
    for (let i = 0; i < 3; i++) result = applyForgeOperation(result, { ...press, target: { x: 10, z: 0 }, strokeMm: 0.2 });
    expect(JSON.stringify(result.workpiece.geometry.solids) === solids).toBe(true);
    expect(result.cutLosses).toEqual(cut.cutLosses);
    expect(result.workpiece.id).toBe(cut.workpiece.id);
    expect(result.workpiece.material).toEqual(cut.workpiece.material);
    expect(totalVolume(result)).toBe(totalVolume(cut));
    expect(volume(result) / beforeVolume).toBeCloseTo(1, 6);
    expectFinite(createForgeFacts(result));
    expectFinite(createForgeSnapshot(result));
    expect(result.workpiece.sections.some(s => s.mechanicalWorkJ > 0 && s.plasticStrain > 0)).toBe(true);
    const saved = serializeForgeState(result);
    expect(serializeForgeState(deserializeForgeState(saved)) === saved).toBe(true);
    expect(serializeForgeState(replayForgeState(createForgeState({ sectionCount: 24 }), result.operations)) === saved).toBe(true);
  }, 15000);

  it("does not reinterpret the geometry of old saved press results", () => {
    const oldShape = applyForgeOperation(hot(), { kind: "surface-hammer", pose: HAMMER_HOME, target: press.target, energy: 0.65 });
    const saved = JSON.stringify({ ...oldShape, operations: [...oldShape.operations.slice(0, -1), press] });
    const restored = deserializeForgeState(saved);
    expect(JSON.stringify(restored.workpiece.geometry) === JSON.stringify(oldShape.workpiece.geometry)).toBe(true);
    unchanged(applyForgeOperation(restored, { ...press, dwellMs: 0 }), restored);
  });

  it.each([
    { pressure: 0 }, { pressure: 1.01 }, { pressure: NaN }, { strokeMm: 0 }, { strokeMm: 24.01 },
    { strokeMm: Infinity }, { dwellMs: -1 }, { dwellMs: 4001 }, { target: { x: NaN, z: 0 } },
  ])("rejects invalid controls without mutating the baseline: %j", invalid => {
    const initial = hot();
    const saved = serializeForgeState(initial);
    expect(() => applyForgeOperation(initial, { ...press, ...invalid })).toThrow();
    expect(serializeForgeState(initial) === saved).toBe(true);
  });
});

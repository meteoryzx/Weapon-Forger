import { describe, expect, it } from "vitest";
import {
  HAMMER_HOME,
  applyForgeOperation,
  createForgeState,
  deserializeForgeState,
  geometryVolumes,
  hammerContact,
  hammerFrame,
  placedHammerSurface,
  replayForgeState,
  serializeForgeState,
  type ForgePressOperation,
  type ForgeState,
  type PowerHammerOperation,
} from "../../src/forge/index.ts";

const hot = () => applyForgeOperation(createForgeState({ sectionCount: 24 }), { kind: "heat", temperatureC: 950 });
const volume = (state: ForgeState) => [...geometryVolumes(state.workpiece).values()].reduce((sum, value) => sum + value, 0);
const height = (state: ForgeState) => hammerContact(
  placedHammerSurface(state.workpiece.geometry, hammerFrame(state.workpiece.geometry, HAMMER_HOME)),
  0,
  0,
)!.point.y;

const power: PowerHammerOperation = {
  kind: "power-hammer",
  pose: HAMMER_HOME,
  target: { x: 0, z: 0 },
  energy: 0.35,
  blows: 3,
  cadenceMs: 180,
};

const press: ForgePressOperation = {
  kind: "forge-press",
  pose: HAMMER_HOME,
  target: { x: 0, z: 0 },
  pressure: 0.55,
  strokeMm: 14,
  dwellMs: 1_000,
};

describe("powered forging", () => {
  it("records one deterministic power-hammer cycle while reusing repeated surface contact", () => {
    const initial = hot();
    const result = applyForgeOperation(initial, power);
    expect(result.operations.at(-1)).toEqual(power);
    expect(result.operations.filter(operation => operation.kind === "surface-hammer")).toHaveLength(0);
    expect(height(result)).toBeLessThan(height(initial));
    expect(volume(result) / volume(initial)).toBeCloseTo(1, 3);
    const restored = deserializeForgeState(serializeForgeState(result));
    expect(serializeForgeState(replayForgeState(createForgeState({ sectionCount: 24 }), restored.operations)))
      .toBe(serializeForgeState(restored));
  });

  it("records a single slow pressure cycle and preserves the shared material state", () => {
    const initial = hot();
    const result = applyForgeOperation(initial, press);
    expect(result.operations.at(-1)).toEqual(press);
    expect(result.operations.filter(operation => operation.kind === "surface-hammer")).toHaveLength(0);
    expect(height(result)).toBeLessThan(height(initial));
    expect(volume(result) / volume(initial)).toBeCloseTo(1, 3);
    expect(result.workpiece.sections.some(section => section.plasticStrain > 0)).toBe(true);
    expect(result.workpiece.sections.every(section => section.blocks.every(block => Number.isFinite(block.stress)))).toBe(true);
  });

  it("rejects invalid machine controls before changing the workpiece", () => {
    const initial = hot();
    expect(() => applyForgeOperation(initial, { ...power, blows: 0 })).toThrow(/1–6/);
    expect(() => applyForgeOperation(initial, { ...press, dwellMs: 5_000 })).toThrow(/保压/);
    expect(serializeForgeState(initial)).toBe(serializeForgeState(hot()));
  });
});

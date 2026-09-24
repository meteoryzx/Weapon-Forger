import { describe, expect, it, vi } from "vitest";
import * as contactHelpers from "../../src/forge/hammer-surface.ts";
import {
  HAMMER_HOME, applyForgeOperation, createForgeState, deformPress, geometryVolumes,
  hammerFrame, placedHammerSurface, HIGH_CARBON_STEEL, SPRING_STEEL, type ForgePressOperation,
} from "../../src/forge/index.ts";
import type { SolidPoint } from "../../src/forge/solid-geometry.ts";
import { GameApplication } from "../../src/app/game-application.ts";

// Independent geometric oracle: extrema of a clipped planar triangle occur at
// polygon vertices, including edge intersections that are not lattice nodes.
function clippedMaximum(triangles: ReturnType<typeof placedHammerSurface>, x: number, z: number): number {
  let maximum = -Infinity;
  for (const triangle of triangles) {
    let polygon: readonly SolidPoint[] = triangle.points;
    for (const [axis, boundary, sign] of [["x", x - 24, -1], ["x", x + 24, 1], ["z", z - 24, -1], ["z", z + 24, 1]] as const) {
      const next: SolidPoint[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
        const da = sign * (a[axis] - boundary), db = sign * (b[axis] - boundary);
        if (da <= 0) next.push(a);
        if (da * db < 0) {
          const t = da / (da - db);
          next.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) });
        }
      }
      polygon = next;
    }
    for (const point of polygon) maximum = Math.max(maximum, point.y);
  }
  return maximum;
}

describe("flat press platen clearance", () => {
  it.each([HIGH_CARBON_STEEL, SPRING_STEEL])("keeps the furnace baseline idle below yield and loads at 65 percent: $id", material => {
    const app = new GameApplication(material);
    app.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
    app.getSnapshot(30000);
    app.commitPreview();
    app.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs: 0 });
    const baseline = app.getState();
    expect(app.getSnapshot().averageTemperatureC).toBeCloseTo(1006.6213349112738, 5);
    const idle = applyForgeOperation(baseline, { kind: "forge-press", pose: HAMMER_HOME,
      target: { x: 0, z: 0 }, pressure: 0.3, strokeMm: 24, dwellMs: 4000 });
    const idleDelta = Math.max(...idle.workpiece.geometry.nodes.map((node, i) =>
      Math.abs(node.verticalOffset - baseline.workpiece.geometry.nodes[i]!.verticalOffset)));
    expect(idleDelta).toBeLessThan(0.0001);
    let previous = 8;
    for (const dwellMs of [701, 1000, 2000, 4000]) {
      const operation: ForgePressOperation = { kind: "forge-press", pose: HAMMER_HOME,
        target: { x: 0, z: 0 }, pressure: 0.65, strokeMm: 24, dwellMs };
      const result = applyForgeOperation(baseline, operation);
      const response = deformPress(baseline.workpiece, operation);
      const geometry = result.workpiece.geometry;
      const maximum = clippedMaximum(placedHammerSurface(geometry, hammerFrame(geometry, HAMMER_HOME)), 0, 0);
      expect(maximum).toBeLessThan(8);
      expect(maximum).toBeLessThan(previous);
      expect(maximum).toBeCloseTo(response.contactHeightMm - response.ramTravelMm, 5);
      expect(app.getState()).toBe(baseline);
      previous = maximum;
    }
    const visible = deformPress(baseline.workpiece, { kind: "forge-press", pose: HAMMER_HOME,
      target: { x: 0, z: 0 }, pressure: 0.7, strokeMm: 24, dwellMs: 4000 });
    expect(visible.compressionMm).toBeGreaterThan(0.4);
  }, 15000);

  it.each([{ x: 0, z: 0, pressure: 1 }, { x: 0.7, z: 0.3, pressure: 1 }, { x: 0, z: 0, pressure: 0.5 }])("lowers the entire clipped default-billet footprint monotonically at %j", ({ pressure, ...target }) => {
    const baseline = applyForgeOperation(createForgeState(), { kind: "heat", temperatureC: 950 });
    const operation: ForgePressOperation = { kind: "forge-press", pose: HAMMER_HOME, target, pressure, strokeMm: 24, dwellMs: 0 };
    const frame = hammerFrame(baseline.workpiece.geometry, operation.pose);
    let lastMaximum = 8;
    for (const dwellMs of [0, 1, 100, 250, 500, 701, 1000, 2000, 4000]) {
      const response = deformPress(baseline.workpiece, { ...operation, dwellMs });
      const geometry = { ...baseline.workpiece.geometry, nodes: response.nodes };
      const maximum = clippedMaximum(placedHammerSurface(geometry, frame), target.x, target.z);
      const renderedMaximum = clippedMaximum(placedHammerSurface(geometry, hammerFrame(geometry, operation.pose)), target.x, target.z);
      const plane = response.contactHeightMm - response.ramTravelMm;
      expect(maximum - plane).toBeLessThanOrEqual(1e-5);
      expect(renderedMaximum - plane).toBeLessThanOrEqual(1e-5);
      expect(maximum).toBeLessThanOrEqual(lastMaximum + 1e-7);
      expect(maximum).toBeCloseTo(plane, 5);
      lastMaximum = maximum;
    }
    expect(lastMaximum).toBeLessThan(8 - 1e-3);
  }, 15000);

  it("leaves remote nodes fixed while conserving actual geometry volume", () => {
    const baseline = applyForgeOperation(createForgeState(), { kind: "heat", temperatureC: 950 });
    const response = deformPress(baseline.workpiece, { kind: "forge-press", pose: HAMMER_HOME, target: { x: 0, z: 0 }, pressure: 1, strokeMm: 24, dwellMs: 4000 });
    const volume = (nodes: typeof response.nodes) => [...geometryVolumes(baseline.workpiece, { ...baseline.workpiece.geometry, nodes }).values()].reduce((sum, v) => sum + v, 0);
    expect(volume(response.nodes) / volume(baseline.workpiece.geometry.nodes)).toBeCloseTo(1, 6);
    for (let i = 0; i < response.nodes.length; i++) {
      const before = baseline.workpiece.geometry.nodes[i]!;
      if (Math.abs(before.axialPosition - 168) > 80) expect(response.nodes[i]).toEqual(before);
    }
  });

  it("keeps saved cut-edge triangles below the actual platen after volume-preserving spread", () => {
    const initial = applyForgeOperation(createForgeState({ sectionCount: 24 }), { kind: "heat", temperatureC: 950 });
    const baseline = applyForgeOperation(initial, { kind: "cut", path: { id: "platen-slot",
      start: { axialPosition: 24, lateralOffset: -5 }, end: { axialPosition: 24, lateralOffset: 5 }, kerfWidth: 3 } });
    const frame = hammerFrame(baseline.workpiece.geometry, HAMMER_HOME);
    for (const dwellMs of [100, 1000, 4000]) {
      const result = deformPress(baseline.workpiece, { kind: "forge-press", pose: HAMMER_HOME, target: { x: 10, z: 0 }, pressure: 1, strokeMm: 0.2, dwellMs });
      const maximum = clippedMaximum(placedHammerSurface({ ...baseline.workpiece.geometry, nodes: result.nodes }, frame), 10, 0);
      expect(maximum).toBeCloseTo(result.contactHeightMm - result.ramTravelMm, 5);
      expect(maximum).toBeLessThan(8);
    }
  }, 15000);

  it("reuses an exact cloned baseline, preserves zero-dwell identity, and invalidates changed content", () => {
    const baseline = applyForgeOperation(createForgeState({ sectionCount: 25 }), { kind: "heat", temperatureC: 951 });
    const operation: ForgePressOperation = { kind: "forge-press", pose: HAMMER_HOME, target: { x: 0.1, z: 0 }, pressure: 0.8, strokeMm: 1, dwellMs: 0 };
    const spy = vi.spyOn(contactHelpers, "hammerFrame");
    try {
      const first = deformPress(baseline.workpiece, operation);
      expect(spy).toHaveBeenCalledTimes(1);
      const clone = structuredClone(baseline.workpiece);
      expect(deformPress(clone, operation).nodes).toBe(clone.geometry.nodes);
      expect(first.nodes).toBe(baseline.workpiece.geometry.nodes);
      const copiedResult = deformPress(clone, { ...operation, dwellMs: 1000 });
      expect(spy).toHaveBeenCalledTimes(2);
      const originalResult = deformPress(baseline.workpiece, { ...operation, dwellMs: 1000 });
      expect(copiedResult).toEqual(originalResult);
      const cold = applyForgeOperation(baseline, { kind: "heat", temperatureC: 25 });
      const stopped = deformPress(cold.workpiece, { ...operation, dwellMs: 1000 });
      expect(spy).toHaveBeenCalledTimes(3);
      expect(stopped.nodes).toBe(cold.workpiece.geometry.nodes);
      expect(stopped.ramTravelMm).toBe(0);
      const changedGeometry = { ...baseline.workpiece, geometry: { ...baseline.workpiece.geometry,
        nodes: baseline.workpiece.geometry.nodes.map(n => ({ ...n, verticalOffset: n.verticalOffset * 1.1 })) } };
      expect(deformPress(changedGeometry, operation).contactHeightMm).toBeCloseTo(8.8, 6);
      expect(spy).toHaveBeenCalledTimes(4);
    } finally { spy.mockRestore(); }
  });
});

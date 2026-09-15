import { describe, expect, it } from "vitest";
import { applyForgeOperation, createForgeSnapshot, createForgeState, replayForgeState, totalVolume, serializeForgeState, deserializeForgeState, type GrindOperation } from "../../src/forge/index.ts";
import { solidPoint, solidVolume } from "../../src/forge/solid-geometry.ts";

function stroke(side = 1): GrindOperation {
  const a = Math.PI / 6;
  return { kind: "grind", sectionIndex: 3, amount: 1, contact: {
    axialPosition: 8, verticalOffset: 0, axialWidth: 8, verticalHeight: 100, depth: 1,
    frame: { origin: { x: 8, y: side * 4, z: 24 },
      normal: { x: 0, y: side * Math.cos(a), z: Math.sin(a) },
      across: { x: 1, y: 0, z: 0 }, down: { x: 0, y: Math.sin(a), z: -side * Math.cos(a) }, width: 8, height: 100 },
  } };
}

describe("finite abrasive contact", () => {
  it("forms opposite bevel faces from the actual normal and accounts for the exact removed volume", () => {
    const initial = createForgeState({ sectionCount: 8 });
    const top = applyForgeOperation(initial, stroke());
    const bottom = applyForgeOperation(initial, stroke(-1));
    expect(top.workpiece.geometry.solids?.length).toBeGreaterThan(0);
    expect(top.workpiece.geometry.nodes).toEqual(initial.workpiece.geometry.nodes);
    expect(totalVolume(top) + createForgeSnapshot(top).removedVolume).toBeCloseTo(totalVolume(initial), 7);
    const occupied = top.workpiece.geometry.solids!.reduce((v, s) => v + solidVolume(s, top.workpiece.geometry), 0);
    expect(totalVolume(top)).toBeCloseTo(occupied, 7);
    expect(totalVolume(top)).toBeCloseTo(totalVolume(bottom), 7);
    const points = (state: typeof top) => state.workpiece.geometry.solids!.flatMap(s => s.vertices.map(v => solidPoint(v, state.workpiece.geometry)));
    expect(points(top).some(p => p.z > 22 && p.y > 0 && p.y < 4)).toBe(true);
    expect(points(bottom).some(p => p.z > 22 && p.y < 0 && p.y > -4)).toBe(true);
    expect(top.workpiece.sections[0]!.removedVolume).toBe(0);
    const both = applyForgeOperation(top, stroke(-1));
    expect(totalVolume(both)).toBeLessThan(totalVolume(top));
    expect(createForgeSnapshot(both).grindMetrics.bladeAngleDeg).toBeCloseTo(60, 3);
    expect(replayForgeState(initial, [stroke(), stroke(-1)])).toEqual(both);
    expect(deserializeForgeState(serializeForgeState(both))).toEqual(both);
  });

  it("retains earlier cut voids, billet identity and material accounting",()=>{
    const initial=createForgeState({sectionCount:8});
    const cut=applyForgeOperation(initial,{kind:"cut",path:{id:"notch",start:{axialPosition:3,lateralOffset:18},end:{axialPosition:11,lateralOffset:18},kerfWidth:1}});
    const ground=applyForgeOperation(cut,stroke());
    expect(ground.workpiece.id).toBe(cut.workpiece.id);
    expect(ground.workpiece.geometry.nodes).toEqual(cut.workpiece.geometry.nodes);
    expect(ground.cutLosses).toEqual(cut.cutLosses);
    expect(totalVolume(ground)+createForgeSnapshot(ground).removedVolume).toBeCloseTo(totalVolume(cut),6);
    expect(deserializeForgeState(serializeForgeState(ground))).toEqual(ground);
  });

  it("does not grind outside the finite belt, or change shape when only the displayed angle differs", () => {
    const initial = createForgeState({ sectionCount: 8 });
    const op = stroke();
    const miss: GrindOperation = { ...op, contact: { ...op.contact!, frame: { ...op.contact!.frame!, origin: {x: 200, y: 4, z: 24} } } };
    expect(applyForgeOperation(initial, miss)).toBe(initial);
    const a = applyForgeOperation(initial, op), b = applyForgeOperation(initial, { ...op, angle: 1 });
    expect(createForgeSnapshot(a).grindMetrics).toEqual(createForgeSnapshot(b).grindMetrics);
    expect(a.workpiece.geometry).toEqual(b.workpiece.geometry);
  });
});

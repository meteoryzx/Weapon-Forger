import { describe, expect, it } from "vitest";
import { applyForgeIntent, applyForgeOperation, createForgeFacts, createForgeSnapshot, createForgeState, totalVolume,
  serializeForgeState, deserializeForgeState, replayForgeState, previewThermalState, outlineArea, splitOutlineByFiniteThroughCut,
  type ForgeState, type CutOperation } from "../../src/forge/index.ts";
import { solidBounds, solidVolume, solidSurfaceArea } from "../../src/forge/solid-geometry.ts";
import { createBilletGeometry } from "../../src/render/forge-billet-view.ts";

const initialState = () => createForgeState({ sectionCount: 8 });
const verticalCut = (x: number, kerfWidth = 0): CutOperation => ({ kind: "cut", path: {
  id: `cut-${x}`, start: { axialPosition: x, lateralOffset: -30 },
  end: { axialPosition: x, lateralOffset: 30 }, kerfWidth,
} });
const sumVolume = (state: ForgeState) => [state.workpiece, ...state.bench].reduce((sum, workpiece) => sum + totalVolume({ ...state, workpiece }), 0);
const lostVolume = (state: ForgeState) => (state.cutLosses ?? []).reduce((sum, loss) => sum + loss.volume, 0);
const shapeVolume = (state: ForgeState) => state.workpiece.geometry.solids!.reduce((sum, solid) => sum + solidVolume(solid, state.workpiece.geometry), 0);

function expectClosedRenderedVolume(state: ForgeState) {
  const geometry = createBilletGeometry(createForgeSnapshot(state), null);
  const vertices = geometry.getAttribute("position");
  let volume = 0;
  for (let i = 0; i < vertices.count; i += 3) {
    const a = [vertices.getX(i), vertices.getY(i), vertices.getZ(i)];
    const b = [vertices.getX(i+1), vertices.getY(i+1), vertices.getZ(i+1)];
    const c = [vertices.getX(i+2), vertices.getY(i+2), vertices.getZ(i+2)];
    volume += (a[0]!*(b[1]!*c[2]!-b[2]!*c[1]!) + a[1]!*(b[2]!*c[0]!-b[0]!*c[2]!) + a[2]!*(b[0]!*c[1]!-b[1]!*c[0]!))/6;
  }
  expect(volume).toBeCloseTo(shapeVolume(state), 2);
  geometry.dispose();
}

describe("finite cut conservation", () => {
  it.each([4, 8, 12])("preserves all material in a zero-kerf cut at %s mm", (axialPosition) => {
    const initial = createForgeState({ sectionCount: 8 });
    const cut = applyForgeOperation(initial, { kind: "cut", path: {
      id: "conservation", start: { axialPosition, lateralOffset: -30 },
      end: { axialPosition, lateralOffset: 30 }, kerfWidth: 0,
    } });
    const volumes = [cut.workpiece, ...cut.bench].map(workpiece => totalVolume({ ...cut, workpiece }));
    expect(volumes.reduce((sum, volume) => sum + volume, 0)).toBeCloseTo(totalVolume(initial), 8);
    expect(volumes.sort((a, b) => a - b)).toEqual([axialPosition * 48 * 8, (16 - axialPosition) * 48 * 8].sort((a, b) => a - b));
  });

  it("loses only the 1 mm kerf and keeps each child's material on its actual side", () => {
    const initial = initialState();
    const cut = applyForgeIntent(initial, verticalCut(8, 1));
    expect(lostVolume(cut)).toBeCloseTo(48 * 8, 8);
    expect(sumVolume(cut) + lostVolume(cut)).toBeCloseTo(totalVolume(initial), 8);
    expect(totalVolume(cut)).toBeCloseTo(7.5 * 48 * 8, 8);
    expect(solidBounds(cut.workpiece.geometry.solids!, cut.workpiece.geometry).minX).toBeCloseTo(8.5, 8);
    expect(createForgeFacts(cut).totalLength).toBeCloseTo(7.5, 8);
    expect(createForgeFacts(cut).centerOfMass).toBeCloseTo((8.5 + 16) / 2, 8);
    expect(solidSurfaceArea(cut.workpiece.geometry)).toBeCloseTo(2 * (7.5*48 + 7.5*8 + 48*8), 6);
    expectClosedRenderedVolume(cut);
    expectClosedRenderedVolume({ ...cut, workpiece: cut.bench[0]! });
  });

  it.each([0, 0.8, 2])("clips diagonal cells with %s mm kerf, matching an independent planar calculation", kerfWidth => {
    const initial = initialState();
    const path = { id: "diagonal", start: { axialPosition: -5, lateralOffset: -30 }, end: { axialPosition: 21, lateralOffset: 30 }, kerfWidth };
    const expected = splitOutlineByFiniteThroughCut(initial.workpiece.geometry.outline, path);
    const cut = applyForgeOperation(initial, { kind: "cut", path });
    expect(totalVolume(cut)).toBeCloseTo(outlineArea(expected.negative) * 8, 6);
    expect(lostVolume(cut)).toBeCloseTo(expected.removedArea * 8, 6);
    expect(sumVolume(cut) + lostVolume(cut)).toBeCloseTo(totalVolume(initial), 6);
    expectClosedRenderedVolume(cut);
    expect(deserializeForgeState(serializeForgeState(cut))).toEqual(cut);
  });

  it("does not depend on path midpoint or direction when the covered cut is the same", () => {
    const initial = initialState(), operation = verticalCut(5, 0.6);
    const path = operation.path!;
    const a = applyForgeOperation(initial, operation);
    const b = applyForgeOperation(initial, { ...operation, path: { ...path, end: { axialPosition: 5, lateralOffset: 300 } } });
    const c = applyForgeOperation(initial, { ...operation, path: { ...path, start: path.end, end: path.start } });
    expect(totalVolume(a)).toBeCloseTo(totalVolume(b), 7);
    expect(totalVolume(a)).toBeCloseTo(totalVolume({ ...c, workpiece: c.bench[0]! }), 7);
    expect(lostVolume(a)).toBeCloseTo(lostVolume(c), 7);
  });

  it("keeps a triangular piece's true centroid through a second cut and thermal preview", () => {
    const initial = initialState();
    const diagonal = applyForgeOperation(initial, { kind: "cut", path: { id: "corner-diagonal",
      start: { axialPosition: 0, lateralOffset: -24 }, end: { axialPosition: 16, lateralOffset: 24 }, kerfWidth: 0 } });
    expect(createForgeFacts(diagonal).centerOfMass).toBeCloseTo(32 / 3, 7);
    const preview = previewThermalState(diagonal, 100);
    expect(preview.workpiece.sections.map(s => [s.width, s.length])).toEqual(diagonal.workpiece.sections.map(s => [s.width, s.length]));
    const recut = applyForgeOperation(diagonal, verticalCut(10, 0.2));
    expect(sumVolume(recut) + lostVolume(recut)).toBeCloseTo(totalVolume(initial), 7);
    expect(deserializeForgeState(serializeForgeState(recut))).toEqual(recut);
  });

  it("preserves per-cell material, temperature, stress and damage; splits mechanical work only once", () => {
    const original = initialState();
    const initial = { ...original, workpiece: { ...original.workpiece, sections: original.workpiece.sections.map((section, index) => ({ ...section,
      blocks: section.blocks.map(block => ({ ...block, materialRegionId: `region-${index}`, temperatureC: 100 + index * 100,
        stress: index * 0.01, damage: index * 0.02, mechanicalWorkJ: block.volume * 0.2 })) })) } };
    const cut = applyForgeOperation(initial, verticalCut(7, 0.5));
    for (const piece of [cut.workpiece, ...cut.bench]) for (const section of piece.sections) for (const block of section.blocks) {
      const index = Number(block.materialRegionId.split("-")[1]);
      expect(block.temperatureC).toBe(100 + index * 100);
      expect(block.stress).toBe(index * 0.01);
      expect(block.damage).toBe(index * 0.02);
      expect(block.mechanicalWorkJ).toBeCloseTo(block.volume * 0.2, 7);
    }
    expect(cut.workpiece.sections.flatMap(s => s.blocks).every(b => Number(b.materialRegionId.split("-")[1]) >= 3)).toBe(true);
    expect(cut.cutLosses![0]!.materials.every(material => material.materialRegionId === "region-3")).toBe(true);
    const retainedWork = [cut.workpiece, ...cut.bench].flatMap(p => p.sections.flatMap(s => s.blocks)).reduce((sum, b) => sum + b.mechanicalWorkJ, 0);
    expect(retainedWork + cut.cutLosses![0]!.mechanicalWorkJ).toBeCloseTo(totalVolume(initial) * 0.2, 7);
  });

  it("conserves material over successive cuts and stores immutable, replayable paths", () => {
    const initial = initialState();
    const firstOperation = verticalCut(5, 0.5);
    const first = applyForgeOperation(initial, firstOperation);
    const second = applyForgeOperation(first, verticalCut(11, 0.7));
    expect(sumVolume(second) + lostVolume(second)).toBeCloseTo(totalVolume(initial), 7);
    expect(second.bench).toHaveLength(2);
    expect(replayForgeState(initial, second.operations)).toEqual(second);
    expect(deserializeForgeState(serializeForgeState(second))).toEqual(second);
    Object.assign(firstOperation.path!.start, { axialPosition: 999 });
    expect((first.operations[0] as CutOperation).path!.start.axialPosition).toBe(5);
  });

  it("rejects a partial zero-width legacy fracture without changing input", () => {
    const initial = initialState(), before = serializeForgeState(initial);
    expect(() => applyForgeOperation(initial, { kind: "cut", path: { id: "short",
      start: { axialPosition: 8, lateralOffset: -10 }, end: { axialPosition: 8, lateralOffset: 10 }, kerfWidth:0 } })).toThrow(/cover/);
    expect(serializeForgeState(initial)).toBe(before);
  });

  it("keeps a finite notch connected, then separates only after the remaining bridge is cut", () => {
    const initial=initialState(), before=serializeForgeState(initial);
    const first:CutOperation={kind:"cut",path:{id:"notch",start:{axialPosition:8,lateralOffset:-30},end:{axialPosition:8,lateralOffset:0},kerfWidth:1}};
    const notch=applyForgeOperation(initial,first);
    expect(notch.workpiece.id).toBe(initial.workpiece.id);
    expect(notch.bench).toHaveLength(0);
    expect(lostVolume(notch)).toBeCloseTo(24*8,7);
    expect(shapeVolume(notch)).toBeCloseTo(totalVolume(initial)-24*8,7);
    expect(solidSurfaceArea(notch.workpiece.geometry)).toBeCloseTo(2560+336,6);
    expectClosedRenderedVolume(notch);
    expect(serializeForgeState(initial)).toBe(before);
    const completed=applyForgeOperation(notch,{kind:"cut",path:{...first.path!,id:"bridge",start:{axialPosition:8,lateralOffset:0},end:{axialPosition:8,lateralOffset:30}}});
    expect(completed.bench).toHaveLength(1);
    expect(sumVolume(completed)+lostVolume(completed)).toBeCloseTo(totalVolume(initial),7);
    expect(lostVolume(completed)).toBeCloseTo(48*8,7);
    expectClosedRenderedVolume(completed);
    expectClosedRenderedVolume({...completed,workpiece:completed.bench[0]!});
    expect(replayForgeState(initial,completed.operations)).toEqual(completed);
    expect(deserializeForgeState(serializeForgeState(notch))).toEqual(notch);
  });

  it("retains an internal finite slot without filling it or inventing separate pieces", () => {
    const initial=initialState();
    const operation:CutOperation={kind:"cut",path:{id:"slot",start:{axialPosition:8,lateralOffset:-10},end:{axialPosition:8,lateralOffset:10},kerfWidth:1}};
    const slot=applyForgeOperation(initial,operation);
    expect(slot.bench).toHaveLength(0);
    expect(lostVolume(slot)).toBeCloseTo(20*8,7);
    expect(solidSurfaceArea(slot.workpiece.geometry)).toBeCloseTo(2560-40+336,6);
    expectClosedRenderedVolume(slot);
    expect(()=>applyForgeOperation(slot,operation)).toThrow(/does not intersect/);
    const reverse=applyForgeOperation(initial,{kind:"cut",path:{...operation.path!,start:operation.path!.end,end:operation.path!.start}});
    expect(totalVolume(reverse)).toBeCloseTo(totalVolume(slot),7);
    expectClosedRenderedVolume(reverse);
  });

  it("creates every new component when a final cut severs several previously notched fingers", () => {
    const initial=initialState();
    let state=initial;
    for(const x of [5,11]) state=applyForgeOperation(state,{kind:"cut",path:{id:`finger-${x}`,
      start:{axialPosition:x,lateralOffset:-30},end:{axialPosition:x,lateralOffset:10},kerfWidth:1}});
    expect(state.bench).toHaveLength(0);
    state=applyForgeOperation(state,{kind:"cut",path:{id:"sever-bridge",
      start:{axialPosition:-1,lateralOffset:10},end:{axialPosition:17,lateralOffset:10},kerfWidth:1}});
    expect(state.bench).toHaveLength(3);
    expect(new Set([state.workpiece,...state.bench].map(p=>p.id)).size).toBe(4);
    expect(sumVolume(state)+lostVolume(state)).toBeCloseTo(totalVolume(initial),7);
    expect(lostVolume(state)).toBeCloseTo(2*34*8+15*8,7);
    for(const workpiece of [state.workpiece,...state.bench]) expectClosedRenderedVolume({...state,workpiece});
    expect(deserializeForgeState(serializeForgeState(state))).toEqual(state);
  });

  it("does not cut or charge loss when the finite tool misses all remaining material", () => {
    const initial=initialState(), before=serializeForgeState(initial);
    expect(()=>applyForgeOperation(initial,{kind:"cut",path:{id:"miss",
      start:{axialPosition:8,lateralOffset:30},end:{axialPosition:8,lateralOffset:40},kerfWidth:1}})).toThrow(/does not intersect/);
    expect(serializeForgeState(initial)).toBe(before);
  });

  it.each([0,16])("can shave an end at %s mm without requiring material on both sides", x=>{
    const initial=initialState(), state=applyForgeOperation(initial,verticalCut(x,1));
    expect(state.workpiece.id).toBe(initial.workpiece.id);
    expect(state.bench).toHaveLength(0);
    expect(lostVolume(state)).toBeCloseTo(0.5*48*8,7);
    expect(sumVolume(state)+lostVolume(state)).toBeCloseTo(totalVolume(initial),7);
    expectClosedRenderedVolume(state);
  });

  it("preserves an oblique notch through heating, hammering, grinding, saving and another cut", () => {
    const initial=initialState();
    let state=applyForgeOperation(initial,{kind:"cut",path:{id:"oblique-notch",
      start:{axialPosition:5.13,lateralOffset:-30.7},end:{axialPosition:8.37,lateralOffset:0.63},kerfWidth:0.73}});
    expect(state.bench).toHaveLength(0);
    expectClosedRenderedVolume(state);
    const notch=state.workpiece.geometry.solids!;
    state=applyForgeOperation(state,{kind:"heat",temperatureC:1050});
    state=applyForgeOperation(state,{kind:"hammer",sectionIndex:5,energy:0.4});
    expect(state.workpiece.geometry.solids).toEqual(notch);
    state=applyForgeOperation(state,{kind:"grind",sectionIndex:5,amount:0.4});
    const ground=state.workpiece.sections.reduce((sum,s)=>sum+s.removedVolume,0);
    state=deserializeForgeState(serializeForgeState(state));
    expectClosedRenderedVolume(state);
    state=applyForgeOperation(state,verticalCut(11,0.7));
    expect(sumVolume(state)+lostVolume(state)+ground).toBeCloseTo(totalVolume(initial),6);
    expect(state.bench).toHaveLength(1);
    for(const workpiece of [state.workpiece,...state.bench]) expectClosedRenderedVolume({...state,workpiece});
    expect(Object.values(createForgeFacts(state)).filter(v=>typeof v==="number").every(Number.isFinite)).toBe(true);
  });

  it("keeps the cut through heat, hammer, grind, weld, and save/load", () => {
    const initial = initialState();
    let state = applyForgeOperation(initial, verticalCut(7, 0.5));
    const cutSolids = state.workpiece.geometry.solids!;
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 1050 });
    state = applyForgeOperation(state, { kind: "hammer", sectionIndex: 5, energy: 0.4 });
    expect(state.workpiece.geometry.solids).toEqual(cutSolids);
    expect(sumVolume(state) + lostVolume(state)).toBeCloseTo(totalVolume(initial), 7);
    expect(deserializeForgeState(serializeForgeState(state))).toEqual(state);
    state = applyForgeOperation(state, { kind: "grind", sectionIndex: 5, amount: 0.4 });
    const ground = state.workpiece.sections.reduce((sum, s) => sum + s.removedVolume, 0);
    expect(ground).toBeGreaterThan(0);
    expect(sumVolume(state) + lostVolume(state) + ground).toBeCloseTo(totalVolume(initial), 7);
    expectClosedRenderedVolume(state);
    const beforeWeld = sumVolume(state);
    const shapeBeforeWeld = shapeVolume(state) + shapeVolume({ ...state, workpiece: state.bench[0]! });
    state = applyForgeOperation(state, { kind: "weld", benchIndex: 0 });
    expect(totalVolume(state)).toBeCloseTo(beforeWeld, 7);
    expect(shapeVolume(state)).toBeCloseTo(shapeBeforeWeld, 6);
    expect(deserializeForgeState(serializeForgeState(state))).toEqual(state);
    expect(Object.values(createForgeFacts(state)).filter(v => typeof v === "number").every(Number.isFinite)).toBe(true);
  });

  it("migrates intact v3 saves but rejects historically corrupted finite-cut results", () => {
    const initial = initialState();
    expect(deserializeForgeState(JSON.stringify({ ...initial, stateVersion: "forge-state-3" }))).toEqual(initial);
    const cut = applyForgeOperation(initial, verticalCut(8));
    expect(() => deserializeForgeState(JSON.stringify({ ...cut, stateVersion: "forge-state-3" }))).toThrow(/unreliable material volumes/);
  });

  it("rejects invalid solid vertex references in a save", () => {
    const cut = JSON.parse(serializeForgeState(applyForgeOperation(initialState(), verticalCut(8))));
    cut.workpiece.geometry.solids[0].vertices[0].weights[0].nodeIndex = 999999;
    expect(() => deserializeForgeState(JSON.stringify(cut))).toThrow(/node reference/);
  });
});

import { describe, expect, it } from "vitest";
import { Box3, Raycaster, Vector3 } from "three";
import { applyForgeIntent, createForgeSnapshot, createForgeState } from "../../src/forge/index.ts";
import { createBilletGeometry } from "../../src/render/forge-billet-view.ts";
import { FURNACE, FURNACE_ORIGIN, FurnaceStationView } from "../../src/render/furnace-station-view.ts";
import { MaterialsStationView } from "../../src/render/materials-station-view.ts";
import { SawStationView } from "../../src/render/saw-station-view.ts";
import { CUT_HOME } from "../../src/app/cut-placement.ts";

describe("front-opening forge", () => {
  it("uses the same billet dimensions at selection, cutting and heating", () => {
    const snapshot = createForgeSnapshot(createForgeState());
    const geometry = (piece: Parameters<typeof createBilletGeometry>[0]) => createBilletGeometry(piece, null);
    const selection = new MaterialsStationView(geometry);
    const saw = new SawStationView(geometry);
    const furnace = new FurnaceStationView(geometry);
    selection.update(null, [snapshot], snapshot.workpieceId, [snapshot.workpieceId]);
    saw.update(snapshot, CUT_HOME, null);
    furnace.update(snapshot);
    const dimensions = (item: import("three").Mesh) => {
      item.geometry.computeBoundingBox();
      return item.geometry.boundingBox!.getSize(new Vector3()).multiply(item.scale).toArray();
    };
    expect(dimensions(selection.tableItems[0]!)).toEqual(dimensions(saw.item));
    expect(dimensions(furnace.item)).toEqual(dimensions(saw.item));
    selection.dispose(); saw.dispose(); furnace.dispose();
  });
  it("has a clear through tunnel, feet on the floor and burners along its depth", () => {
    const view = new FurnaceStationView(piece => createBilletGeometry(piece, null));
    view.group.updateMatrixWorld(true);
    expect(new Box3().setFromObject(view.body).min.y).toBeCloseTo(FURNACE.floor);
    for (const x of [-30, 0, 30]) {
      const ray = new Raycaster(FURNACE_ORIGIN.clone().add(new Vector3(x, 95, 400)), new Vector3(0, 0, -1));
      expect(ray.intersectObject(view.body, true)).toHaveLength(0);
    }
    const burners = view.body.children.filter(object => object.name === "burner");
    expect(burners).toHaveLength(3);
    expect(new Set(burners.map(object => object.position.z)).size).toBe(3);
    expect(burners.every(object => object.position.x === 0)).toBe(true);
    expect(FURNACE_ORIGIN.x).toBeGreaterThan(300);
    expect(FURNACE_ORIGIN.z).toBeLessThan(-200);
    view.dispose();
  });

  it("supports long and cut-sized billets and translates them into the mouth without rotating", () => {
    for (const sectionCount of [12, 168]) {
      const view = new FurnaceStationView(piece => createBilletGeometry(piece, null));
      const cold = createForgeState({ sectionCount });
      view.update(createForgeSnapshot(cold));
      view.group.updateMatrixWorld(true);
      const outside = new Box3().setFromObject(view.item);
      expect(outside.min.y).toBeCloseTo(FURNACE.hearth);
      expect(outside.min.z).toBeGreaterThan(FURNACE_ORIGIN.z + FURNACE.front);
      const rotation = view.itemRig.quaternion.clone();
      view.update(createForgeSnapshot(applyForgeIntent(cold, { kind: "move-billet", destination: "furnace", elapsedMs: 0 })));
      for (let t = 0; t < 1800; t += 16) view.tick(t);
      view.group.updateMatrixWorld(true);
      const inside = new Box3().setFromObject(view.item);
      expect(inside.min.y).toBeCloseTo(FURNACE.hearth);
      expect(inside.max.y).toBeLessThan(FURNACE.ceiling);
      expect(inside.min.z).toBeLessThan(FURNACE_ORIGIN.z + FURNACE.front);
      expect(inside.max.z).toBeGreaterThan(FURNACE_ORIGIN.z + FURNACE.front);
      expect(inside.min.x).toBeGreaterThan(FURNACE_ORIGIN.x - FURNACE.halfOpening);
      expect(inside.max.x).toBeLessThan(FURNACE_ORIGIN.x + FURNACE.halfOpening);
      expect(view.itemRig.quaternion.equals(rotation)).toBe(true);
      view.dispose();
    }
  });
});

import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, Raycaster, Vector3 } from "three";
import { applyForgeIntent, createForgeSnapshot, createForgeState } from "../../src/forge/index.ts";
import { createBilletGeometry } from "../../src/render/forge-billet-view.ts";
import { FURNACE, FURNACE_ORIGIN, TEMPER_FURNACE_ORIGIN, FurnaceStationView, furnaceCameraFrame, temperCameraFrame } from "../../src/render/furnace-station-view.ts";
import { MaterialsStationView } from "../../src/render/materials-station-view.ts";
import { SawStationView } from "../../src/render/saw-station-view.ts";
import { ROOM_INTERIOR } from "../../src/render/workshop-assets.ts";
import { CUT_HOME } from "../../src/app/cut-placement.ts";
import { WORKSHOP_LAYOUT } from "../../src/app/workshop-scale.ts";

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
    for (const x of [-15, 0, 15]) {
      const ray = new Raycaster(FURNACE_ORIGIN.clone().add(new Vector3(x, FURNACE.hearth+1, 400)), new Vector3(0, 0, -1));
      expect(ray.intersectObject(view.body, true)).toHaveLength(0);
    }
    const burners = view.body.children.filter(object => object.name === "burner");
    expect(burners).toHaveLength(3);
    expect(new Set(burners.map(object => object.position.z)).size).toBe(3);
    expect(burners.every(object => object.position.x === 0)).toBe(true);
    expect(FURNACE_ORIGIN.toArray()).toEqual([...WORKSHOP_LAYOUT.furnace!.origin]);
    expect(TEMPER_FURNACE_ORIGIN.toArray()).toEqual([...WORKSHOP_LAYOUT.temper!.origin]);
    view.dispose();
  });

  it("owns distinct heating and tempering targets", () => {
    const geometry = () => new BoxGeometry(336, 8, 48);
    const heating = new FurnaceStationView(geometry, FURNACE_ORIGIN, "heating-station", "furnace");
    const tempering = new FurnaceStationView(geometry, TEMPER_FURNACE_ORIGIN, "tempering-station", "temper");
    expect(heating.group.position.toArray()).not.toEqual(tempering.group.position.toArray());
    expect(heating.target.userData.station).toBe("furnace");
    expect(tempering.target.userData.station).toBe("temper");
    heating.dispose();
    tempering.dispose();
  });

  it("services the tempering furnace from the aisle and keeps both cameras in the room", () => {
    const heating = furnaceCameraFrame(16 / 9, FURNACE_ORIGIN, 1);
    const tempering = temperCameraFrame(16 / 9);
    // Heating is viewed from its right; the tempering unit to its right is a
    // mirrored station serviced from the aisle on its left.
    expect(heating.position[0]!).toBeGreaterThan(FURNACE_ORIGIN.x);
    expect(tempering.position[0]!).toBeLessThan(TEMPER_FURNACE_ORIGIN.x);
    for (const aspect of [16 / 9, 390 / 844]) {
      for (const frame of [furnaceCameraFrame(aspect, FURNACE_ORIGIN, 1), temperCameraFrame(aspect)]) {
        expect(Math.abs(frame.position[0]!)).toBeLessThan(ROOM_INTERIOR.halfWidthX);
        expect(frame.position[1]!).toBeGreaterThan(FURNACE.ceiling);
      }
    }
    expect(tempering.position[2]!).toBeGreaterThan(TEMPER_FURNACE_ORIGIN.z + FURNACE.front);
    const geometry = () => new BoxGeometry(336, 8, 48);
    const heatingView = new FurnaceStationView(geometry, FURNACE_ORIGIN, "heating-station", "furnace");
    const temperingView = new FurnaceStationView(geometry, TEMPER_FURNACE_ORIGIN, "tempering-station", "temper");
    expect(heatingView.temperControl.position.x).toBeGreaterThan(0);
    expect(temperingView.temperControl.position.x).toBeLessThan(0);
    expect(temperingView.group.position.x).toBeGreaterThan(heatingView.group.position.x);
    heatingView.dispose();
    temperingView.dispose();
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
      expect(inside.min.z).toBeGreaterThan(FURNACE_ORIGIN.z + FURNACE.rear);
      expect(inside.max.z).toBeLessThan(FURNACE_ORIGIN.z + FURNACE.front);
      expect(inside.min.x).toBeGreaterThan(FURNACE_ORIGIN.x - FURNACE.halfOpening);
      expect(inside.max.x).toBeLessThan(FURNACE_ORIGIN.x + FURNACE.halfOpening);
      expect(view.itemRig.quaternion.equals(rotation)).toBe(true);
      view.dispose();
    }
  });

  it("does not rebuild billet geometry for thermal-only updates", () => {
    let builds=0;
    const view = new FurnaceStationView(piece => {
      builds += 1;
      return createBilletGeometry(piece, null);
    });
    const cold=createForgeState();
    view.update(createForgeSnapshot(cold));
    const hot=applyForgeIntent(cold,{kind:"move-billet",destination:"furnace",elapsedMs:0});
    view.update(createForgeSnapshot(hot));
    const heated=applyForgeIntent(hot,{kind:"move-billet",destination:"furnace",elapsedMs:5_000});
    view.update(createForgeSnapshot(heated));
    expect(builds).toBe(1);
    view.dispose();
  });
});

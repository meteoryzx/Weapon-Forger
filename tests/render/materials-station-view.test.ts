import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, PerspectiveCamera, Vector3 } from "three";
import { createForgeSnapshot, createForgeState } from "../../src/forge/index.ts";
import { MaterialsStationView, materialsCameraFrame } from "../../src/render/materials-station-view.ts";

function cameraFor(aspect: number) {
  const camera = new PerspectiveCamera(52, aspect, 0.1, 2000);
  const frame = materialsCameraFrame("table", aspect);
  camera.position.fromArray(frame.position);
  camera.lookAt(new Vector3().fromArray(frame.target));
  camera.updateMatrixWorld(true);
  return camera;
}

function longAxis(mesh: import("three").Mesh): Vector3 {
  return new Vector3(1, 0, 0).applyQuaternion(mesh.quaternion).normalize();
}

describe("material station geometry without browser rendering", () => {
  it("stores stock flat along scene depth and in contact with the shelf", () => {
    const station = new MaterialsStationView(() => new BoxGeometry(336, 8, 48));
    station.group.visible = true;
    station.group.updateMatrixWorld(true);
    for (const candidate of station.candidates) {
      const axis = longAxis(candidate);
      expect(Math.abs(axis.z)).toBeGreaterThan(0.99);
      expect(Math.abs(axis.y)).toBeLessThan(0.01);
      const bounds = new Box3().setFromObject(candidate);
      expect(bounds.min.y).toBeCloseTo(candidate.userData.storageShelfSurfaceY as number, 1);
    }
    station.dispose();
  });

  it("extracts the inspected stock toward the player while leaving its upper end on the shelf", () => {
    const station = new MaterialsStationView(() => new BoxGeometry(336, 8, 48));
    station.group.visible = true;
    const selected = station.candidates[1]!;
    const home = selected.position.clone();
    station.update(selected.userData.materialId as string, []);
    for (let time = 0; time <= 160; time += 16) station.tick(time);
    expect(selected.position.z).toBeGreaterThan(home.z + 100);
    expect(Math.abs(longAxis(selected).y)).toBeLessThan(0.01);
    for (let time = 176; time <= 900; time += 16) station.tick(time);
    const axis = longAxis(selected);
    expect(selected.position.z).toBeGreaterThan(home.z + 60);
    expect(selected.position.y).toBeLessThan(home.y);
    expect(axis.y).toBeGreaterThan(0.45);
    expect(axis.z).toBeLessThan(-0.8);
    const crossSectionSide = new Vector3(0, 0, 1).applyQuaternion(selected.quaternion).normalize();
    expect(crossSectionSide.x).toBeGreaterThan(0.99);
    expect(Math.abs(crossSectionSide.y)).toBeLessThan(0.01);
    const rearEnd = selected.position.clone().addScaledVector(axis, 336 * 0.46 / 2);
    expect(rearEnd.y).toBeCloseTo(
      (selected.userData.storageShelfSurfaceY as number) + 8 * 0.46 / 2,
      0,
    );
    expect(rearEnd.z).toBeCloseTo(-5, 0);
    station.dispose();
  });

  it("lays four selected workpieces flat along depth on the table", () => {
    const sample = createForgeSnapshot(createForgeState({ sectionCount: 8 }));
    const pieces = Array.from({ length: 4 }, (_, index) => ({ ...sample, workpieceId: `piece-${index}` }));
    const station = new MaterialsStationView(() => new BoxGeometry(336, 8, 48));
    station.group.visible = true;
    station.update(null, pieces, "piece-1", pieces.map((piece) => piece.workpieceId));
    station.group.updateMatrixWorld(true);
    expect(station.tableItems).toHaveLength(4);
    expect(station.rackItems).toHaveLength(0);
    expect(new Set(station.tableItems.map((item) => item.position.x)).size).toBe(4);
    for (const item of station.tableItems) {
      expect(Math.abs(longAxis(item).z)).toBeGreaterThan(0.99);
      const bottomY = new Box3().setFromObject(item).min.y;
      expect(bottomY).toBeGreaterThan(72);
      expect(bottomY).toBeLessThan(74);
      expect(item.userData.workpieceId).toBeTruthy();
    }
    station.dispose();
  });

  it("shows returned and selected identities once in the same fixed view", () => {
    const sample = createForgeSnapshot(createForgeState({ sectionCount: 8 }));
    const pieces = [
      { ...sample, workpieceId: "table-piece" },
      { ...sample, workpieceId: "rack-piece" },
    ];
    const station = new MaterialsStationView(() => new BoxGeometry(336, 8, 48));
    station.group.visible = true;
    station.update(null, pieces, "table-piece", ["table-piece"]);
    expect(station.tableItems.map((item) => item.userData.workpieceId)).toEqual(["table-piece"]);
    expect(station.rackItems.map((item) => item.userData.workpieceId)).toEqual(["rack-piece"]);
    const ids = [...station.tableItems, ...station.rackItems].map((item) => item.userData.workpieceId);
    expect(new Set(ids).size).toBe(2);
    station.dispose();
  });

  it("keeps stock and four table slots inside desktop and narrow frames", () => {
    const sample = createForgeSnapshot(createForgeState({ sectionCount: 8 }));
    const pieces = Array.from({ length: 4 }, (_, index) => ({ ...sample, workpieceId: `piece-${index}` }));
    const station = new MaterialsStationView(() => new BoxGeometry(336, 8, 48));
    station.group.visible = true;
    station.update(null, pieces, "piece-0", pieces.map((piece) => piece.workpieceId));
    station.group.updateMatrixWorld(true);
    for (const aspect of [1068 / 452, 286 / 520]) {
      const camera = cameraFor(aspect);
      for (const mesh of [...station.candidates, ...station.tableItems]) {
        const projected = mesh.getWorldPosition(new Vector3()).project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
      }
    }
    station.dispose();
  });
});

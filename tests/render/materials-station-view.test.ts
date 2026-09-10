import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { createForgeSnapshot, createForgeState } from "../../src/forge/index.ts";
import { MaterialsStationView, materialsCameraFrame } from "../../src/render/materials-station-view.ts";

function cameraFor(focus: "table" | "rack", aspect: number) {
  const camera = new PerspectiveCamera(52, aspect, 0.1, 2000);
  const frame = materialsCameraFrame(focus, aspect);
  camera.position.fromArray(frame.position);
  camera.lookAt(new Vector3().fromArray(frame.target));
  camera.updateMatrixWorld(true);
  return camera;
}

describe("material station geometry without browser rendering", () => {
  it("keeps the staging table in front of the rack", () => {
    const station = new MaterialsStationView(() => new BoxGeometry(336, 8, 48));
    station.group.visible = true;
    const sample = createForgeSnapshot(createForgeState({ sectionCount: 8 }));
    station.update(null, [sample]);
    station.group.updateMatrixWorld(true);
    for (const candidate of station.candidates.slice(0, 1)) {
      const initial = candidate.getWorldPosition(new Vector3()).z;
      station.update(candidate.userData.materialId as string, [sample]);
      for (let time = 0; time <= 600; time += 16) station.tick(time);
      expect(candidate.getWorldPosition(new Vector3()).z).toBeGreaterThan(initial);
    }
    station.dispose();
  });

  it("shows all three independently pickable sources on desktop and narrow viewports", () => {
    const station = new MaterialsStationView(() => new BoxGeometry(336, 8, 48));
    station.group.visible = true;
    station.group.updateMatrixWorld(true);
    for (const aspect of [1068 / 452, 286 / 520]) {
      const camera = cameraFor("table", aspect);
      for (const candidate of station.candidates) {
        const point = candidate.getWorldPosition(new Vector3());
        const projected = point.clone().project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
        const ray = new Raycaster();
        ray.setFromCamera(new Vector2(projected.x, projected.y), camera);
        const first = ray.intersectObject(station.group, true)[0]?.object;
        expect(first?.userData.materialId).toBe(candidate.userData.materialId);
      }
    }
    const selected = station.candidates[1]!;
    const initial = selected.position.clone();
    station.update(selected.userData.materialId, []);
    for (let time = 0; time <= 600; time += 16) station.tick(time);
    expect(selected.position.z).toBeGreaterThan(initial.z + 50);
    expect(selected.position.y).toBe(initial.y);
    station.update(null, []);
    for (let time = 616; time <= 1400; time += 16) station.tick(time);
    expect(selected.position.z).toBeCloseTo(initial.z, 1);
    station.dispose();
  });

  it("keeps every displayed workpiece selectable and replaces old page meshes", () => {
    const sample = createForgeSnapshot(createForgeState({ sectionCount: 8 }));
    const pieces = Array.from({ length: 4 }, (_, index) => ({ ...sample, workpieceId: `piece-${index}` }));
    const station = new MaterialsStationView(() => new BoxGeometry(336, 8, 48));
    station.group.visible = true;
    station.update(null, pieces);
    station.group.updateMatrixWorld(true);
    const camera = cameraFor("rack", 1068 / 452);
    for (const item of station.rackItems) {
      const projected = item.getWorldPosition(new Vector3()).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(1);
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(projected.x, projected.y), camera);
      const first = ray.intersectObject(station.group, true)[0]?.object;
      expect(first?.userData.workpieceId).toBe(item.userData.workpieceId);
    }
    station.update(null, [{ ...sample, workpieceId: "next-page" }]);
    expect(station.rackItems.map((item) => item.userData.workpieceId)).toEqual(["next-page"]);
    const ownedMeshes: Mesh[] = [];
    station.rack.traverse((object) => {
      if (object instanceof Mesh && object.userData.workpieceId) ownedMeshes.push(object);
    });
    expect(ownedMeshes).toHaveLength(1);
    station.dispose();
  });
});

import { describe, expect, it } from "vitest";
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { createForgePress, FORGE_PRESS } from "../../src/render/forge-press-model.ts";
import { WorkshopModelKit } from "../../src/render/workshop-model-kit.ts";
import { WORKSHOP_FLOOR_Y, workshopUnits as u } from "../../src/app/workshop-scale.ts";

const bounds = (object: import("three").Object3D) => {
  object.updateWorldMatrix(true, true);
  return new Box3().setFromObject(object);
};
const size = (object: import("three").Object3D) => bounds(object).getSize(new Vector3());
const at = (x: number, y: number, z: number) => new Vector3(u(x), WORKSHOP_FLOOR_Y + u(y), u(z));

describe("reference-derived hydraulic press", () => {
  it("fits the real occupied envelope including controls and rests on the workshop floor", () => {
    const a = createForgePress(new WorkshopModelKit()), b = bounds(a.root), s = size(a.root);
    expect(s.x).toBeLessThanOrEqual(u(1000)); expect(s.z).toBeLessThanOrEqual(u(925));
    expect(s.y).toBeCloseTo(u(1900)); expect(b.min.y).toBeCloseTo(WORKSHOP_FLOOR_Y);
    expect(b.min.x).toBeCloseTo(-u(490)); expect(b.max.x).toBeCloseTo(u(496));
    expect(b.max.x + 68).toBeLessThan(108);
    expect(FORGE_PRESS).toEqual({ dieZ: 0, surfaceY: 875, openGap: 120 });
  });

  it("uses actual solver-sized faces and closes exactly with translation alone", () => {
    const a = createForgePress(new WorkshopModelKit());
    const supportSize = size(a.contact);
    expect(supportSize.x).toBeCloseTo(u(224)); expect(supportSize.y).toBeCloseTo(u(20)); expect(supportSize.z).toBeCloseTo(u(104));
    expect(size(a.upper).x).toBeCloseTo(u(48)); expect(size(a.upper).z).toBeCloseTo(u(48));
    expect(bounds(a.contact).max.y).toBeCloseTo(WORKSHOP_FLOOR_Y + u(875));
    expect(bounds(a.upper).min.y).toBeCloseTo(WORKSHOP_FLOOR_Y + u(995));
    const meshes = a.root.userData.referenceMeshes as Record<string, Mesh>;
    const shell = bounds(meshes["cylinder-shell"]!);
    for (let travel = 0; travel <= 120; travel += 15) {
      a.ram.position.y = -u(travel); a.root.updateMatrixWorld(true);
      expect(bounds(a.upper).min.y - bounds(a.contact).max.y).toBeCloseTo(u(120 - travel));
      expect(bounds(meshes["cylinder-shell"]!)).toEqual(shell);
      expect(bounds(meshes.piston!).intersectsBox(shell)).toBe(true);
      expect(bounds(a.upper).getCenter(new Vector3()).z).toBeCloseTo(0);
    }
    expect(a.ram.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(a.closedRamY).toBe(-u(120)); expect(a.openRamY).toBe(0);
  });

  it("provides a true 600 mm iron opening and accessible front work zone", () => {
    const a = createForgePress(new WorkshopModelKit()); a.root.updateMatrixWorld(true);
    const frame = a.root.userData.referenceMeshes["gate-frame"] as Mesh;
    const left = new Raycaster(at(0, 1300, 0), new Vector3(-1, 0, 0)).intersectObject(frame)[0]!;
    const right = new Raycaster(at(0, 1300, 0), new Vector3(1, 0, 0)).intersectObject(frame)[0]!;
    expect(left.point.x).toBeCloseTo(-u(300)); expect(right.point.x).toBeCloseTo(u(300));
    for (const x of [-295, 0, 295]) {
      expect(new Raycaster(at(x, 950, 500), new Vector3(0, 0, -1)).intersectObject(frame)).toHaveLength(0);
    }
    const front = new Raycaster(at(0, 920, 500), new Vector3(0, 0, -1)).intersectObject(a.root, true);
    expect(front).toHaveLength(0);
  });

  it("joins all tooling and fixed support surfaces without floating gaps", () => {
    const a = createForgePress(new WorkshopModelKit()), m = a.root.userData.referenceMeshes as Record<string, Mesh>;
    for (const [top, lower] of [["pedestal", "base"], ["lower-holder", "pedestal"], ["lower-support", "lower-holder"], ["crosshead", "upper-holder"], ["upper-holder", "upper-die"]]) {
      expect(bounds(m[top!]!).min.y).toBeCloseTo(bounds(m[lower!]!).max.y);
    }
    expect(size(m.pedestal!).x).toBeCloseTo(u(540)); expect(size(m.pedestal!).z).toBeCloseTo(u(500));
    expect(size(m["lower-holder"]!).x).toBeCloseTo(u(320)); expect(size(m["lower-holder"]!).z).toBeCloseTo(u(220));
    expect(bounds(m.crosshead!).min.y).toBeCloseTo(WORKSHOP_FLOOR_Y + u(1050));
    expect(size(m.crosshead!).x).toBeCloseTo(u(540)); expect(size(m.crosshead!).z).toBeCloseTo(u(260));
    for (const side of ["left", "right"]) {
      expect(bounds(m[`guide-${side}`]!).intersectsBox(bounds(m["gate-frame"]!))).toBe(true);
      for (const travel of [0, 120]) {
        a.ram.position.y = -u(travel); a.root.updateMatrixWorld(true);
        const guide = bounds(m[`guide-${side}`]!), shoe = bounds(m[`shoe-${side}-front`]!);
        expect(shoe.min.y).toBeGreaterThan(guide.min.y); expect(shoe.max.y).toBeLessThan(guide.max.y);
      }
    }
  });

  it("keeps pick surfaces opaque and never mutates shared kit materials", () => {
    const k = new WorkshopModelKit(), original = k.materials.iron.color.getHex(), a = createForgePress(k);
    expect(a.contact.visible).toBe(true); expect(a.contact.material.opacity).toBe(1);
    expect(a.contact.material).not.toBe(k.materials.steel);
    expect(a.control.material).not.toBe(k.materials.brass);
    expect(k.materials.steel.opacity).toBe(1); expect(k.materials.iron.color.getHex()).toBe(original);
    a.root.updateMatrixWorld(true);
    expect(new Raycaster(at(0, 900, 0), new Vector3(0, -1, 0)).intersectObject(a.contact)).not.toHaveLength(0);
    let triangles = 0;
    a.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      expect(object.name.length).toBeGreaterThan(0);
      expect((object.material as MeshStandardMaterial).opacity).toBe(1);
      const p = object.geometry.getAttribute("position");
      expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
      triangles += (object.geometry.index?.count ?? p.count) / 3;
    });
    expect(triangles).toBeLessThan(6000);
    expect(a.root.userData.sculptRuntime.constraints.ram.min).toBe(-u(120));
  });
});

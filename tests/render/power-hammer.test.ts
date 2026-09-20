import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { createPowerHammer } from "../../src/render/power-hammer-model.ts";
import { WorkshopModelKit } from "../../src/render/workshop-model-kit.ts";
import { forgingPressAsset } from "../../src/render/workshop-assets.ts";
import { WORKSHOP_FLOOR_Y, workshopUnits as u } from "../../src/app/workshop-scale.ts";
import { PowerHammerWorkpiece } from "../../src/render/power-hammer-workpiece.ts";
import { createForgeState, createForgeSnapshot, HAMMER_HOME } from "../../src/forge/index.ts";

describe("img2threejs power hammer integration",()=>{
  it("retains the reference body and dimensions, with real tooling and finite travel",()=>{
    const asset=createPowerHammer(new WorkshopModelKit());
    asset.root.updateMatrixWorld(true);
    const meshes=asset.root.userData.referenceMeshes;
    expect(Object.keys(meshes)).toHaveLength(30);
    expect(new Box3().setFromObject(meshes["lubricator-top"]).intersectsBox(new Box3().setFromObject(meshes["front-cap"]))).toBe(true);
    for(const id of ["service-tall","service-low","small-service-cover","service-round","lubricator-front"]){
      expect(meshes[id].visible).toBe(true);
      const support=id==="lubricator-front"?meshes["front-cylinder"]:meshes.frame;
      expect(new Box3().setFromObject(meshes[id]).intersectsBox(new Box3().setFromObject(support))).toBe(true);
    }
    const base=new Box3().setFromObject(meshes.base),size=base.getSize(new Vector3());
    expect(size.x).toBeCloseTo(u(1050));expect(size.z).toBeCloseTo(u(1400));
    expect(base.min.y).toBeCloseTo(WORKSHOP_FLOOR_Y);
    const lower=new Box3().setFromObject(asset.contact),upper=new Box3().setFromObject(asset.upper);
    expect(lower.max.y).toBeCloseTo(WORKSHOP_FLOOR_Y+u(875));
    expect(upper.min.y-lower.max.y).toBeCloseTo(u(120));
    expect(upper.getSize(new Vector3()).x).toBeCloseTo(u(48));
    expect(lower.getSize(new Vector3()).x).toBeCloseTo(u(224));
    const cylinderBefore=new Box3().setFromObject(meshes["front-cylinder"]);
    asset.ram.position.y=asset.closedRamY;asset.root.updateMatrixWorld(true);
    expect(new Box3().setFromObject(asset.upper).min.y).toBeCloseTo(lower.max.y);
    expect(new Box3().setFromObject(meshes["front-cylinder"])).toEqual(cylinderBefore);
  });
  it("does not let the pressure-machine picking proxy erase shared steel",()=>{
    const kit=new WorkshopModelKit(),asset=createPowerHammer(kit),press=forgingPressAsset(kit);
    expect(press.contact!.material.opacity).toBe(0);
    expect(kit.materials.steel.opacity).toBe(1);
    expect(asset.contact.material.opacity).toBe(1);
    expect(asset.upper.material.opacity).toBe(1);
  });
  it("uses real placed surface for contact and blocks sweeping through the upper die",()=>{
    const item=new PowerHammerWorkpiece(),snapshot=createForgeSnapshot(createForgeState());
    item.update(snapshot,HAMMER_HOME);
    expect(item.contact?.point.y).toBeCloseTo(8);
    expect(item.preview.visible).toBe(true);
    expect(item.canPlace(snapshot,{...HAMMER_HOME,roll:Math.PI/2})).toBe(true);
    expect(item.canPlace(snapshot,{...HAMMER_HOME,z:-600})).toBe(false);
    item.update(snapshot,{...HAMMER_HOME,z:100});
    expect(item.contact).toBeNull();expect(item.preview.visible).toBe(false);
    item.dispose();
  });
});
